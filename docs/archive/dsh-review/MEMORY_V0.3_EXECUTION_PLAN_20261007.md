# HDSI 记忆 V0.3 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将七天详细短期、九十天可续期长期、固定细节与常驻记忆接入独立向量检索，同时确保后台维护让位于正常聊天。

**Architecture:** 保留单故事槽及现有两阶段提交。增加一个后台准备槽，异步计算结果先保存，宿主空闲时按单元应用；每个单元后实际让出事件循环并重查故事。版本校验保护前台更新，预备长期摘要保证到期记忆无需等待后台模型即可被检索。

**Tech Stack:** TypeScript、Node.js >=22.13.0、node:sqlite DatabaseSync、Zod、Vitest、现有 Koishi 插件及 HTTP 模型适配；不引入外部向量数据库或新守护进程。

**Spec:** [MEMORY_V0.3_IMPLEMENTATION_20261007.md](MEMORY_V0.3_IMPLEMENTATION_20261007.md)。执行前同时阅读该细化；与原方案草案不同的部分以细化为准。

状态：未执行。本次仅准备文档。各步骤采用当前会话直接实施，不自动创建额外任务或代理。当前目录不是 Git 仓库，任务检查点写入实施记录，不执行虚构的 Git 提交。

## Global Constraints

- shortDays=7、longDays=90、renewAfter=3、durableAfter=30，每记忆每天最多一次有效唤醒；日期使用 Asia/Shanghai，恢复使用冻结 TurnRecord.at。
- batchItems=20、batchCharacters=12000（软目标）、backgroundConcurrency=1；每日维护04:30，每单元后 await node:timers/promises.setImmediate。
- queryTimeoutMs=1500、backgroundTimeoutMs=120000、retryDelayMs=300000；查询向量缓存最多256条、TTL600000ms，只缓存向量。
- 向量默认 qwen3.7-text-embedding、1024维，查询／文档双侧归一化，配置与表情向量独立。
- memory_consolidation 单独 Flash/high，memory 保留 Flash/high，其余原模型及强度保留；所有任务后续允许选择 Pro。
- 原文最多30条、细节12条、短期12条、长期／常驻经历8条；初始8000可见字符预算，按3000／2500／1000／1500分块，保留当前必需来源及状态。
- 任何事务不包含网络 await；维护失败不暂停故事；迁移／重建索引不制造唤醒或任意续期。
- 保留 sourceIds 非空、当前来源白名单、输入可见性和单次合法补查限制。只处理正常业务所需规则，不扩展极端情况防御框架。
- 正式服务仍由用户双击两个 .cmd 运行；本计划的验证不启动 QQ 正式会话，不展示密钥，不将作者背景发作测试提示。

## Review Focus

1. 后台 LLM 请求尚未返回，新输入15秒后仍能完成故事和发送（任务6）。
2. 多个 ready 单元之间有真实 I/O 输入到达，下一单元必须等待该输入对应前台轮（任务6）。
3. 前台更新维护快照里的正文／次数／事实，冲突单元不能覆盖，但其他单元继续有效（任务5）。
4. 七天到期时维护积压或向量失败，详细短期退出且简要长期仍可词法召回（任务2、4）。
5. 文件重开、同日重复、合并重叠日期不能重复提交、加次数或生成续期（任务1、2、5）。

## 文件与类型约定

新业务模块及职责按细化第9节，以下任务覆盖全部模块。新增测试与现有测试均在 tests/；生产装配位于 src/index.ts 和 src/app.ts。

任务1在 src/memory/types.ts 定义并导出以下共享接口；以下列出跨任务使用的最低字段，详细业务正文按细化第2～5节补齐，不建立第二套同名类型。

| 类型 | 跨模块字段／含义 |
| --- | --- |
| MemoryOwnerRef | ownerType: 'short'\|'long'\|'detail'\|'learned'；ownerId: string |
| OwnerVersion | MemoryOwnerRef + revision: number + stateVersion: number |
| RetrievalPermissions | allowArchive: boolean；allowDetailHistory: boolean；visibleSourceIds: string[] |
| RetrievalRequest | query: string；at: string；phase: string；scope: 'current'\|'archive'；includeDetailHistory: boolean；permissions: RetrievalPermissions；budget: number |
| LookupRequest | string 或 {query: string, scope: 'current'\|'archive', includeDetailHistory: boolean} |
| MemoryCandidate | OwnerVersion + content: string、sourceIds: string[]、createdAt: string、有效状态与期限、可选的当前配置 normalizedVector: Float32Array；事实另有 key／value／aliases |
| RetrievedContext | recent、detailHistory 延续当前上下文字段，details／shortTerm／longTerm／learned 四个候选数组；当前角色状态继续由调用者另行提供 |
| AwakeningInput | id: string；turnId: string；at: string；sourceIds: string[]；reason: string；allowedIds: string[]；allowedSourceIds: string[] |
| IndexJob | id: string；owner: OwnerVersion；text: string；configSignature: string；createdAt: string；status: pending/computing/ready/done；retryAt: string\|null |
| IndexResult | jobId: string；owner: OwnerVersion；configSignature: string；normalizedVector: Float32Array |
| MaintenanceUnit | unitKey: string；action: refine/merge/discard/promote/retain；readSet: OwnerVersion[]；写入主／副 ID、正文与来源；应用标记归 job 保存 |
| ModelRunOptions | signal?: AbortSignal；lookup?: ((request: LookupRequest) => Promise<unknown>)\|null；null 明确禁用，undefined 才兼容旧默认回调 |

模型 JSON 不携带 Float32Array／AbortSignal／程序生成的版本、期限和计数。DTO 由 Zod 合同单独定义，再转换为以上内部类型。类型中涉及日期的字段统一保存 ISO 时刻。

## 任务1：存储、SQL 过滤与幂等迁移

**Files:** 新增 src/memory/types.ts、store.ts、scripts/migrate-memory.ts；修改 src/storage.ts、src/types.ts、package.json；新增 tests/memory-v3-store.test.ts。

**Interfaces:**
- 产生 `MemoryStore(storage: Storage)`、`migrate(now: string): void`、`selectCandidates(request: RetrievalRequest): MemoryCandidate[]`。
- `Storage` 增加仅供业务 SQL 使用的参数化 prepare 入口，沿用现有 transaction；新表与旧表共同参与同一个 SQLite 事务。
- store 提供按主 ID 获取 owner、读写 awakening/grant/job 和版本的同步方法；函数在对应业务任务首次使用时固定签名，禁止网络依赖进入 store。

- [ ] 写迁移测试：2026-10-07T00:00:00.000Z 迁移旧短期、长期和细节，主键／来源保留、版本为1、legacyMentions 保留、新计数0，旧长期到期为2027-01-05T00:00:00.000Z；迁移两次结果相同。
- [ ] 写真实临时文件 SQLite 测试：事务异常后正文与 job 标记同时回滚，重开仍一致；存在未完成 V0.2 turn 时迁移拒绝且不改数据。
- [ ] 写 owner 过滤测试：merged、副本、过期／未生效、旧 revision 向量不进 current；无向量的有效事实仍返回；archive／history 按独立权限过滤。
- [ ] 运行 `npm test -- tests/memory-v3-store.test.ts`，确认因新迁移／过滤未实现而失败，而非夹具或导入配置错误。
- [ ] 实现细化第8节六张新表、版本标记与迁移；新增用于类型／状态／日期／job选择的 SQL 索引。旧短期先用既有摘要建立 preview，过期时刻仍按原 createdAt+7天计算。
- [ ] 实现参数化 SQL owner 过滤和索引连接，确认不用 `storage.all()` 后再从全量正文中过滤整个业务库。
- [ ] 运行该测试及 `npm run typecheck`，绿色后在 docs/MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md 记录实际检查点、文件及验证结果。后续每项续写此记录。

## 任务2：每轮合同、预备摘要与生命周期

**Files:** 新增 src/memory/lifecycle.ts；修改 src/memory/organize.ts、src/model/contracts.ts、prompts.ts、src/types.ts；新增 tests/memory-v3-lifecycle.test.ts；更新 tests/helpers.ts 及受新 memory 合同影响的既有夹具。

**Interfaces:**
- 消费任务1的 MemoryStore、OwnerVersion、AwakeningInput。
- 产生 `MemoryLifecycle(store: MemoryStore)`、`awaken(input: AwakeningInput): void`、`merge(ids: string[], canonicalId: string): void`；调用者在同一正式事务中调用。
- 每轮 `schemaVersion: 3` 的 create/update/awaken/detail 合同按细化第4.1节；post job 保存生成 ID 映射，段B应用 preview、detail、日期计数与索引待办。

- [ ] 写七天测试：10月7日00:00Z创建普通事件，shortExpiresAt=10月14日00:00Z，关联长期 retainedFrom 同时刻、expiresAt=次年1月12日00:00Z；重要事件从10月7日即长期可见。
- [ ] 写更新测试：真实新进展延长七天；仅重谈／改写不延长；已生效长期更新正文不因改写刷新期限；更新 ID 必须来自提供集合，缺 sourceIds 进入修补。
- [ ] 写日期测试：同日多轮只1次，跨三日第三次按冻结 at 续90天，查询不加数；归档实际唤醒重新激活且窗口计数0；durable 无到期窗口。
- [ ] 写合并测试：A有10月20、22日，B有21、22日，并集为3次；已有合法 grant 保留，不能使用合并时刻续期。覆盖 grant 触发日期不再次消费、归档缺 reactivate 不复活、旧副 ID 可追溯。
- [ ] 写常驻测试：30有效日期登记候选一次；retain 表示未通过时无新 evidence 不再重复准备；提升后普通检索不同时返回旧长期和learned投影，唤醒仍记主身份；单个事件的重复不能伪造跨事件稳定认识。
- [ ] 运行 `npm test -- tests/memory-v3-lifecycle.test.ts tests/memory.test.ts tests/review-fixes.test.ts`，确认新预期失败后实施生命周期及新合同。保持原别名“非空替换／空保留”和当前来源门禁。
- [ ] 保存 grant 的 anchorAt、kind、triggerDates，并重放最后合法窗口之后的未消费日期；日内去重、合并、期限与候选登记在一事务完成。
- [ ] 更新 memory 提示：详细过程与事件／感受摘要同次生成；来源语义要求明确；短期正文归档保留。运行上述测试、typecheck，记录检查点。

## 任务3：独立调用上下文与派生向量

**Files:** 新增 src/embedding.ts、src/memory/index.ts；修改 src/output/stickers.ts、src/model/client.ts、src/types.ts；新增 tests/memory-v3-index.test.ts、tests/model-call-context.test.ts；保留 tests/stickers.test.ts 语义。

**Interfaces:**
- 共享 `EmbeddingProvider.embed(text: string, options?: {signal?: AbortSignal}): Promise<number[]>`，HttpEmbeddingProvider 实现；原表情模块重新导出已有类型／类以兼容调用。
- `Transport.complete(request: CompletionRequest, options?: {signal?: AbortSignal}): Promise<unknown>`；`ModelRunner.runModel<T>(task: ModelTask<T>, input: unknown, options?: ModelRunOptions): Promise<T>`。
- 产生 `MemoryIndex.query(text: string, signal?: AbortSignal): Promise<Float32Array|null>`、`prepare(job: IndexJob, signal: AbortSignal): Promise<IndexResult>`；构造注入 store、provider、配置签名、时钟及超时／缓存参数。

- [ ] 写归一化与缓存测试：非单位向量双侧结果正确；同查询复用一次向量；正文变更不复用旧检索结果；端点／模型／维度／模板变化各使缓存失效，TTL／256上限可观察。
- [ ] 写查询1500ms超时／失败返回null、后台 signal 可中止请求测试；prepare 返回向量而不直接修改正式 owner／index。
- [ ] 写并发两个模型任务测试：各自 lookup、修补和 signal 独立；后台 lookup=null 禁用默认回调；修补／补查续调用沿用原 task 配置且最多一次逻辑补查。
- [ ] 运行 `npm test -- tests/memory-v3-index.test.ts tests/model-call-context.test.ts tests/stickers.test.ts`，核对失败针对新增行为。
- [ ] 提取现有 HTTP EmbeddingProvider，透传 signal 到 fetch，不把 signal 写入请求 JSON；维护调用超时／取消必须跳出调用，不将取消当成待修补 JSON。
- [ ] 实现 float32 BLOB 编解码、配置签名、LRU256／10分钟及1500ms查询超时，索引输入文本统一模板。避免将查询向量请求计入单后台准备槽；它属于前台召回且有等待上限。
- [ ] 运行上述测试及 typecheck，记录检查点；此阶段不执行真实供应商请求。

## 任务4：有权限的混合检索与异步上下文

**Files:** 新增 src/memory/retrieval.ts；修改 src/memory/context.ts、src/memory/organize.ts、src/app.ts、src/directors/narrative.ts、personal.ts、world.ts、school.ts、src/output/expression.ts 的模型调用 options 透传；新增 tests/memory-v3-retrieval.test.ts；更新 tests/shared-scene.test.ts、memory.test.ts；新增 scripts/check-memory-retrieval.ts、tests/fixtures/memory-retrieval-labels.json。

**Interfaces:**
- 消费 `MemoryStore.selectCandidates(request)`、`MemoryIndex.query(text, signal?)`。
- 产生 `MemoryRetrieval.build(request: RetrievalRequest): Promise<RetrievedContext>`，构造注入 store/index；现有 ContextBuilder.build 改为 `build(request: RetrievalRequest): Promise<RetrievedContext>`，buildForMemory 改为 `buildForMemory(request: RetrievalRequest): Promise<{details: MemoryCandidate[]; retrieved: MemoryCandidate[]}>`。src/app.ts 内叙事／个人上下文分别 await，src/memory/organize.ts 内整理上下文 await；阶段可见性沿用原门禁。
- 结构化 lookup 的权限来源于调用时的可见主题；不能由 lookup JSON 自行授予。memory_consolidation 使用快照，不调用这个入口。
- 产生 `MemoryRetrieval.lookup(request: LookupRequest, base: RetrievalRequest): Promise<RetrievedContext>`，合并本次 query／申请范围并验证 base.permissions；调用者闭包固定 base，不允许模型改阶段权限。

- [ ] 写隐藏输入测试：未看私聊的回忆字样不能开启普通主叙事档案；共同场景／可见个人导演允许实际明确回忆，普通当前手机查询不能混入旧手机历史。
- [ ] 写到期测试：把后台与向量都阻住，七天边界短期全文退出、preview 仍按词法命中；90天边界退出 current，合法 archive 仍可检索；merged 和旧索引两路都不泄漏。
- [ ] 写固定结果候选测试：key／别名优先、RRF60、两路各24、最终12／12／8／30配额；8000预算保留必需来源，800字符稳定认识常驻上限；buildForMemory 保留独立预算。
- [ ] 写10,000条及三／六个月固定样本检索测试／基准，输出 SQL 候选耗时、端到端离线耗时、召回／误召；不对供应商延迟作离线结论。
- [ ] 运行 `npm test -- tests/memory-v3-retrieval.test.ts tests/shared-scene.test.ts tests/memory.test.ts`，确认新增规则未实现导致失败。
- [ ] 将所有 ContextBuilder 调用改为 async 权限请求，按词法与就绪向量混合检索；超时用词法，所有候选再次校验当前 owner 状态和版本。各前台 runModel 透传本阶段 lookup 闭包，世界／学校只允许当前事实；无需补查的表达／看图调用传 null，不回退到旧全局历史入口。
- [ ] 实现标注验证脚本：事实与经历分组，训练／验证分离，验证集观察切分点按F1选阈值、同分选高阈值；报告带配置签名。未真实标定 semantic-only 关闭，允许报告“待标定”，不能把假向量分数当真实 Qwen 阈值。
- [ ] 运行上述测试和 typecheck，记录检查点。在线模型标定如需发送项目内容，另按既有授权范围确认实际数据范围；本次文档不扩大此前固定在线测试授权。

## 任务5：持久化后台协调器及逐单元应用

**Files:** 新增 src/memory/maintenance.ts；修改 src/memory/store.ts、src/model/contracts.ts、prompts.ts、src/recovery.ts；新增 tests/memory-v3-maintenance.test.ts、tests/memory-v3-recovery.test.ts。

**Interfaces:**
- 消费 MemoryLifecycle、MemoryIndex.prepare、带 signal/lookup=null 的 ModelRunner；构造注入 store、这些依赖、clock 及通知宿主的 onReady 回调。
- 产生 `MemoryMaintenance.startOne(now: string): boolean`（仅启动，不 await远程）、`applyOneReady(now: string): 'applied'|'stale'|'none'`（同步）、`nextDeadline(now: string): string|null`、`stop(): Promise<void>`。
- 协调器管理压缩及索引共用的一槽，回调只保存 ready／错误待办并通知；ready索引提交同样由 applyOneReady 校验 owner revision／配置后完成。

- [ ] 写20条／12000软目标和单条超额测试；固定 cutoff 后新增到期内容不混入当前周期，04:30推进一次；可重试压缩／索引按 createdAt、jobId 公平取最早。
- [ ] 写后台 deferred Promise 测试：startOne 立即返回，不第二次启动；完成仅变 ready，owner 不变；ready 应用每次只处理一个不重叠单元。
- [ ] 写三个单元测试：准备后更新第二个 owner 的 stateVersion，第二单元 stale 且不覆新值，第一／第三仍应用；冲突候选仍合格才重新准备。索引仅正文revision变化使结果作废。
- [ ] 写文件重开测试：computing退pending、ready不重调用LLM、已应用单元不重复；故意使事务提交失败时正文与 appliedUnitKey 同时回滚。维护失败保留preview、不改变全局paused。
- [ ] 运行 `npm test -- tests/memory-v3-maintenance.test.ts tests/memory-v3-recovery.test.ts`，确认失败后实现闭合快照合同与 disjoint units 校验。
- [ ] 实现120秒后台超时、5分钟 retryAt、stateVersion readSet、日期／grant 合并、常驻结果应用；每个单元正式变更、索引待办与应用标记同事务。压缩只读取快照，禁止额外补查绕开readSet。
- [ ] 实现 stop 中止后台并等待收尾，禁止关闭库后回调；完成后立即通知宿主，但不在回调应用正式状态。运行上述测试和 typecheck，记录检查点。

## 任务6：宿主前台优先与真实事件循环让位

**Files:** 修改 src/host/runtime.ts、scheduler.ts、src/app.ts；新增 tests/memory-v3-host.test.ts；扩展 tests/scheduler.test.ts、input.test.ts、recovery.test.ts。

**Interfaces:**
- SerialHost 依赖一个任务5协调器；维护 Promise 不纳入 `active`。新增可注入 `yieldToEvents: () => Promise<void>`，生产默认 `setImmediate`，测试可控制让位时机。
- pump、armTimer、pause/resume/stop/status 仍由 SerialHost 负责；Scheduler 继续决定原世界→学校→故事顺序，后台不改其业务优先级。

- [ ] 写“未释放后台仍完成故事”测试：后台 deferred 不 resolve；acceptInput 后立即有落库输入，推进15秒执行前台，断言 outbox confirmed／turn done，再释放后台；先释放后台才通过的测试不合格。
- [ ] 写真实让位测试：ready有两个单元，首单元后 `yieldToEvents` 让待输入完成落库；测试同时用真实 setImmediate 走一次，不只 mock collectReady。第二单元必须在静默截止和相应故事完成后应用。
- [ ] 写启动排序测试：unfinished旧故事→已到期世界→学校→故事→维护；openBatch时既不启动新后台也不应用ready，不改变15秒静默截止。
- [ ] 写暂停／定时测试：pause期间无新后台／正式应用；已到期维护在computing时不造成0ms反复唤醒；resume继续ready；stop后台Abort后等待收尾才关库。
- [ ] 运行 `npm test -- tests/memory-v3-host.test.ts tests/scheduler.test.ts tests/input.test.ts tests/recovery.test.ts`，确认当前宿主缺上述行为而失败。
- [ ] 按细化第7.2节改 pump：每个维护单元后 `await yieldToEvents()`，重新 closeReady／检查旧轮／collectReady；不要将一次批次作为必须结束的“旧故事”。
- [ ] 定时取前台截止与可运行维护截止中的最早项；paused只保留原合批所需截止，在途后台靠结果通知wake、不把past maintenance deadline重复上报。status增加维护积压／在途／ready／retry／lastError。
- [ ] 运行上述测试和 typecheck，记录检查点。若后台挂起仍能形成前台真实发送记录，才算通过聊天优先验收。

## 任务7：配置装配、核心背景和交付核对

**Files:** 修改 src/settings.ts、config.ts、index.ts、app.ts、examples/ 下实际示例、config.local.json、runtime/ 下需要变化的实际部署配置、package.json；新增 scripts/prepare-character-background.ts、tests/memory-v3-deployment.test.ts；更新 README.md、REMAKE_V0.2_MEMORY.md、REMAKE_V0.2_INTERFACES.md、REMAKE_V0.2_IMPLEMENTATION.md、REMAKE_V0.2_RECOVERY.md、REMAKE_V0.2_LIFE.md、REMAKE_V0.2.md、docs/DOCUMENT_AUDIT.md、docs/IMPLEMENTATION_LOG.md 及本计划实施记录。保留 DSH 审核快照。

**Interfaces:**
- 装配唯一 store/lifecycle/index/retrieval/maintenance 实例，ModelClient 生产构造不传默认 lookup，分别将每次调用 lookup 闭包交给 runModel，将 onReady 接到 host.wake。
- 增加 `memoryEmbedding`、`memory_consolidation`、上述初始参数及阈值配置签名；新增 npm 离线入口 `memory:migrate`、`memory:check`、`memory:background`，对应迁移、召回标注、背景摘录脚本。
- 背景脚本产生 core 摘录、稳定 details 初始化差异和来源映射；不直接覆盖作者文件。候选文件置于 runtime/data/ 下，仅在审阅通过后切换生产背景入口。

- [ ] 写配置测试：11项模型各自可设Flash/Pro，压缩high，memory仍high，其余原配置保留；记忆Embedding改模型不会偷偷改表情配置／向量。
- [ ] 写装配与背景测试：使用人工构造的角色夹具，核心保留、手机／室友等事实进入details；不能靠真实作者私密内容出现在测试快照中。检查源映射与可变旧值不会在core和details重复生效。
- [ ] 运行 `npm test -- tests/memory-v3-deployment.test.ts tests/deployment.test.ts tests/model-settings.test.ts tests/plugin.test.ts`，确认新增配置缺失后实现装配和脚本；迁移脚本要求服务停止及无未完成旧轮。
- [ ] 离线生成本地真实角色摘录与细节差异，记录需用户检查的具体变化；在摘录审核前保持生产入口，不以关键词自动删掉背景段落。迁移及生产开关的实际执行另记准确状态。
- [ ] 完成全文档同步：将实施事实与草案区分，更新合同、调度优先级、暂停／恢复、迁移步骤和实际测试统计，不复制旧78测试结论为新验收。
- [ ] 运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run smoke --prefix runtime`、`./start-hdsi.cmd --check`、`./start-snowluma.cmd --check`。后两条仅检查依赖，不新建长期进程。
- [ ] 执行临时库迁移／检索检查，核对基准和未标定项；生产库迁移只在上述前置条件满足后进行。供应商真实在线验证与正式服务运行分开记录。
- [ ] 更新实施记录的验收矩阵、实际命令／结果、未解决项。完成只指已实际验收部分；背景切换／Qwen阈值／生产迁移若仍待处理，应明确列出。

## 计划自检与交付范围

覆盖关系：身份／版本／SQL迁移→任务1；每轮来源、预备摘要、7／90／3／30与合并→任务2；并发调用／向量→任务3；权限／召回／预算→任务4；持久化批次／冲突／恢复→任务5；聊天优先／让位／暂停／退出→任务6；配置／背景／脚本／文档及全量验收→任务7。

实施时每项先证明新行为失败，再实现并通过相应检查；最终完整检查只在有代码后执行。本计划生成时未运行这些测试，未迁移正式数据库，未调用供应商，也未启动服务。

建议用户／DSH重点检查细化第7节的调度规则，以及第3节“预备摘要”是否符合七天后的简要长期预期；执行计划主要供实施和复盘使用。
