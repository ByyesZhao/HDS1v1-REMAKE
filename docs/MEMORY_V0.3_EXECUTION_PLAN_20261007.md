# HDSI 记忆 V0.3 执行计划

提示词／上下文V0.1现状：普通聊天默认最近4个完整普通段，普通双方实际消息后空闲15分钟关闭，当前计入；共同活动整体不占4段、不刷新普通锚点。活动工作阶段使用本场完整授权原文；结束后由逐轮短期记忆统一检索召回，跨结束未读输入仍直接可见。关闭普通段仍可在4段窗口内，无30条二次裁剪。模型资料按身份合池和阶段职责投影；无新来源免记忆整理，明确超限报错暂停且不自动裁剪。历史测试数字只描述原交付。本期入口：[实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将七天详细短期、九十天可续期长期、固定细节与常驻记忆接入独立向量检索，同时确保后台维护让位于正常聊天。

**Architecture:** 保留单故事槽及现有两阶段提交。增加一个后台准备槽，异步计算结果先保存，宿主空闲时按单元应用；每个单元后实际让出事件循环并重查故事。版本校验保护前台更新，预备长期摘要保证到期记忆无需等待后台模型即可被检索。

**Tech Stack:** TypeScript、Node.js >=22.13.0、node:sqlite DatabaseSync、Zod、Vitest、现有 Koishi 插件及 HTTP 模型适配；不引入外部向量数据库或新守护进程。

**Spec:** [MEMORY_V0.3_IMPLEMENTATION_20261007.md](MEMORY_V0.3_IMPLEMENTATION_20261007.md)。执行前同时阅读该细化；与原方案草案不同的部分以细化为准。

状态：记忆任务1～7离线核心已执行，证据见MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md。背景切换及真实语义标定仍待审阅／真实接入。各步骤采用当前会话直接实施，不自动创建额外任务或代理。当前目录不是 Git 仓库，任务检查点写入实施记录，不执行虚构的 Git 提交。

2026-10-07修订：已并入第四轮被接受的澄清，以及用户确认的“取消人为预算，默认不限”。本计划与docs/下最新实施细化共同作为V0.3直接实施依据；方案草案、DSH-review副本及审核回应是历史材料，不能恢复其中已取消的800／8000等上限。现有V0.2代码／根文档用于保留其他行为，后续完成才更新落地结论。

汇总修订：第五轮接受的相关性／统一上限／初始化／容量错误规则已并入任务4、5、7；生活个人导演查阅来源并入任务1、2，网页字符配置撤去。真实搜索按[搜索业务细化](WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)和[搜索执行计划](WEB_SEARCH_EXECUTION_PLAN_20261007.md)实施，不能仅完成记忆计划就宣称搜索可用。共四份直接依据，先完成本计划任务1～7，再执行搜索任务1～6；审核副本及rebuttal只作为历史。

## Global Constraints

- shortDays=7、longDays=90、renewAfter=3、durableAfter=30，每记忆每天最多一次有效唤醒；日期使用 Asia/Shanghai，恢复使用冻结 TurnRecord.at。
- batchItems=20、batchCharacters=null（可选软目标默认关闭）、backgroundConcurrency=1；每日维护04:30，每单元后 await node:timers/promises.setImmediate。
- queryTimeoutMs=1500、backgroundTimeoutMs=120000、retryDelayMs=300000；查询向量缓存最多256条、TTL600000ms，只缓存向量。
- 向量默认 qwen3.7-text-embedding、1024维，查询／文档双侧归一化，配置与表情向量独立。
- memory_consolidation 单独 Flash/high，memory 保留 Flash/high，其余原模型及强度保留；所有任务后续允许选择 Pro。
- 近期原文窗口最近4个完整对话段（当前段计入，双方实际交互后空闲15分钟划段）；historyBudget、alwaysIncludeCharactersLimit、candidateItemsPerRoute、detailItemsLimit、shortItemsLimit、longItemsLimit均默认null，取消800／8000字符、分块配额、24／12／12／8固定配额。可选配置仅在用户显式设置非空值时生效，当前必需来源及状态不裁。撤去拟议webMaterialCharactersLimit，网页20／40及无字符截断由独立WebSearchConfig／搜索计划负责。
- 选中且符合权限／期限／相关性的正文完整提供，默认不新增模型输出max_tokens／max_completion_tokens或文本Zod字数上限；实际技术容量按所选接口，不把字符预算当token容量。
- 任何事务不包含网络 await；维护失败不暂停故事；迁移／重建索引不制造唤醒或任意续期。
- 保留 sourceIds 非空、当前来源白名单、输入可见性和单次合法补查限制。只处理正常业务所需规则，不扩展极端情况防御框架。
- shortTermChanges另允许本轮personal_life的self_web_read来源；detailChanges及longTermChanges.awaken保留原基础来源范围。网页报道不转为亲历；查阅类记忆沿用七天及长期流程。
- 正式服务仍由用户双击两个 .cmd 运行；本计划的验证不启动 QQ 正式会话，不展示密钥，不将作者背景发作测试提示。

## Review Focus

1. 后台 LLM 请求尚未返回，新输入15秒后仍能完成故事和发送（任务6）。
2. 多个 ready 单元之间有真实 I/O 输入到达，下一单元必须等待该输入对应前台轮（任务6）。
3. 前台更新维护快照里的正文／次数／事实，冲突单元不能覆盖，但其他单元继续有效（任务5）。
4. 七天到期时维护积压或向量失败，详细短期退出且简要长期仍可词法召回（任务2、4）。
5. 文件重开、同日重复、合并重叠日期不能重复提交、加次数或生成续期（任务1、2、5）。

第七轮补验：tests/review7-memory.test.ts覆盖archive与lookup未生效门禁、DTO字段、已知事件范围／投影、可选预算及提升窗口；tests/review7-maintenance.test.ts覆盖应用异常整体回滚、ready五分钟退避、其他待办和真实输入优先。应用错误保持ready及原准备结果，retryAt由全部调度入口共同尊重，不误标stale。详细RED→GREEN证据见REVIEW7_FIX_IMPLEMENTATION_20261007.md。

## 文件与类型约定

新业务模块及职责按细化第9节，以下任务覆盖全部模块。新增测试与现有测试均在 tests/；生产装配位于 src/index.ts 和 src/app.ts。

任务1在 src/memory/types.ts 定义并导出以下共享接口；以下列出跨任务使用的最低字段，详细业务正文按细化第2～5节补齐，不建立第二套同名类型。

| 类型 | 跨模块字段／含义 |
| --- | --- |
| MemoryOwnerRef | ownerType: 'short'\|'long'\|'detail'\|'learned'；ownerId: string |
| OwnerVersion | MemoryOwnerRef + revision: number + stateVersion: number |
| Runtime扩展（src/types.ts） | nextMaintenanceAt: string\|null；周期cutoff／处理进度保存在维护状态／jobs，不变成故事请求 |
| ContextLimits | historyBudget、alwaysIncludeCharactersLimit、candidateItemsPerRoute、detailItemsLimit、shortItemsLimit、longItemsLimit均number\|null，默认null；recentDialogueSegments:number，默认4；dialogueIdleMinutes:number，默认15 |
| RetrievalStats | queries、cacheHits、remoteRequests、timeouts、failures、lexicalFallbacks均number，进程内累计，startedAt:string |
| RetrievalPermissions | allowArchive: boolean；allowDetailHistory: boolean；visibleSourceIds: string[] |
| RetrievalRequest | query: string；at: string；phase: string；scope: 'current'\|'archive'；includeDetailHistory: boolean；permissions: RetrievalPermissions；budget: number\|null（默认null） |
| LookupRequest | string 或 {query: string, scope: 'current'\|'archive', includeDetailHistory: boolean} |
| MemoryCandidate | OwnerVersion + content: string、sourceIds: string[]、createdAt: string、happenedAt:string、happenedUntil?:string、lastEventUpdateAt:string、有效状态与期限、可选的当前配置 normalizedVector: Float32Array；事实另有 key／value／aliases；不保存模型DTO操作字段 |
| RetrievedContext | recent、detailHistory 延续当前上下文字段，details／shortTerm／longTerm／learned 四个候选数组；当前角色状态继续由调用者另行提供 |
| AwakeningInput | id: string；turnId: string；at: string；sourceIds: string[]；reason: string；allowedIds: string[]；allowedSourceIds: string[] |
| SelfWebReadSource | id、turnId、runId、operationId、materialId、url、readAt均string；sourceKind: 'self_web_read'；phase: 'personal_life'；程序登记并持久化，不由模型任意生成 |
| IndexJob | id: string；owner: OwnerVersion；text: string；configSignature: string；createdAt: string；status: pending/computing/ready/done；retryAt: string\|null；completedAt:string\|null；completionReason:'applied'\|'stale'\|null |
| IndexResult | jobId: string；owner: OwnerVersion；configSignature: string；normalizedVector: Float32Array |
| MaintenanceUnit | unitKey: string；action: refine/merge/discard/promote/retain；readSet: OwnerVersion[]；写入主／副 ID、正文与来源；应用标记归 job 保存 |
| ModelRunOptions | signal?: AbortSignal；lookup?: ((request: LookupRequest) => Promise<unknown>)\|null；null 明确禁用，undefined 才兼容旧默认回调 |

模型 JSON 不携带 Float32Array／AbortSignal／程序生成的版本、期限和计数。DTO 由 Zod 合同单独定义，再转换为以上内部类型。类型中涉及日期的字段统一保存 ISO 时刻。

## 任务1：存储、SQL 过滤与幂等迁移

**Files:** 新增 src/memory/types.ts、store.ts、scripts/migrate-memory.ts；修改 src/storage.ts、src/types.ts、package.json；新增 tests/memory-v3-store.test.ts。

**Interfaces:**
- 产生 `MemoryStore(storage: Storage)`、`migrate(now: string): void`、`selectCandidates(request: RetrievalRequest): MemoryCandidate[]`。
- `Storage` 增加仅供业务 SQL 使用的参数化 prepare 入口，沿用现有 transaction；新表与旧表共同参与同一个 SQLite 事务。
- 本任务固定Runtime.nextMaintenanceAt共享字段；初始化为下一04:30，迁移存在已到期待办时置为now以便补办；周期cutoff／单元进度独立持久化。MemoryCandidate已包含OwnerVersion，无需额外版本DTO。
- store 提供按主 ID 获取 owner、读写 awakening/grant/job 和版本的同步方法；函数在对应业务任务首次使用时固定签名，禁止网络依赖进入 store。

- [x] 写迁移测试：2026-10-07T00:00:00.000Z 迁移旧短期、长期和细节，主键／来源保留、版本为1、legacyMentions 保留、新计数0，旧长期到期为2027-01-05T00:00:00.000Z；迁移两次结果相同。
- [x] 写真实临时文件 SQLite 测试：事务异常后正文与 job 标记同时回滚，重开仍一致；存在未完成 V0.2 turn 时迁移拒绝且不改数据。
- [x] 写 owner 过滤测试：merged、副本、过期／未生效、旧 revision 向量不进 current；无向量的有效事实仍返回；archive／history 按独立权限过滤。archive只绕过到期，不绕过retainedFrom；普通预备长期在生效前不进任何上下文或lookup。
- [x] 写调度字段迁移测试：无已到期任务时nextMaintenanceAt为下一04:30，有已到期待办时置迁移now；迁移重复执行不重新推进现有周期／截止。
- [x] 运行 `npm test -- tests/memory-v3-store.test.ts`，确认因新迁移／过滤未实现而失败，而非夹具或导入配置错误。
- [x] 实现细化第8节六张新表、版本标记与迁移；新增用于类型／状态／日期／job选择的 SQL 索引。旧短期先用既有摘要建立 preview，过期时刻仍按原 createdAt+7天计算。
- [x] 实现参数化 SQL owner 过滤和索引连接，确认不用 `storage.all()` 后再从全量正文中过滤整个业务库。
- [x] 运行该测试及 `npm run typecheck`，绿色后在 docs/MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md 记录实际检查点、文件及验证结果。后续每项续写此记录。

## 任务2：每轮合同、预备摘要与生命周期

**Files:** 新增 src/memory/lifecycle.ts；修改 src/memory/organize.ts、src/model/contracts.ts、prompts.ts、src/types.ts；新增 tests/memory-v3-lifecycle.test.ts；更新 tests/helpers.ts 及受新 memory 合同影响的既有夹具。

**Interfaces:**
- 消费任务1的 MemoryStore、OwnerVersion、AwakeningInput。
- 产生 `MemoryLifecycle(store: MemoryStore)`、`awaken(input: AwakeningInput): void`、`merge(ids: string[], canonicalId: string): void`；调用者在同一正式事务中调用。
- 每轮 `schemaVersion: 3` 的 create/update/awaken/detail 合同按细化第4.1节；post job 保存生成 ID 映射，段B应用 preview、detail、日期计数与索引待办。
- 整理输入可携带程序验证并实际提供的本轮SelfWebReadSource[]（未接入搜索时为空），随post job保存来源。短期合同的allowedSourceIds为基础来源与这些ID的并集；细节／唤醒仅使用基础来源集合，不以一个全局集合放宽所有操作。搜索模块负责来源登记，记忆模块负责按操作校验及保留溯源。

- [x] 写七天测试：10月7日00:00Z创建普通事件，shortExpiresAt=10月14日00:00Z，关联长期 retainedFrom 同时刻、expiresAt=次年1月12日00:00Z；重要事件从10月7日即长期可见。
- [x] 写更新测试：真实新进展延长七天；仅重谈／改写不延长；已生效长期更新正文不因改写刷新期限；更新 ID 必须来自提供集合，缺 sourceIds 进入修补。
- [x] 写查阅来源合同测试：本轮personal_life已提供的self_web_read无聊天来源也可新增／更新短期；未提供、其他阶段、其他轮ID拒绝；仅用该ID更改details或提交awaken拒绝。恢复复用ID且材料重放不延长七天；正文与预备摘要保留学到的知识／查阅性质，有感受时引用实际个人导演输出，不能写成报道事件亲历。七天到期及维护后保留原溯源；搜索未配置时空来源列表不影响既有规则。
- [x] 写两线独立测试：只update且hasNewEventProgress=true不自动加唤醒，单独合法awaken才记；同日多次进展可延长详细窗口，仍只记一个唤醒日期；归档正文更新不隐式激活。
- [x] 写日期测试：同日多轮只1次，跨三日第三次按冻结 at 续90天，查询不加数；归档实际唤醒重新激活且窗口计数0；durable 无到期窗口。
- [x] 写合并测试：A有10月20、22日，B有21、22日，并集为3次；已有合法 grant 保留，不能使用合并时刻续期。覆盖 grant 触发日期不再次消费、归档缺 reactivate 不复活、旧副 ID 可追溯。
- [x] 写真实唯一约束测试：主／副同日行按(canonicalMemoryId,localDate)聚合UPSERT，再删副唤醒行；最早有效时刻与首次turnId对应、来源并集，失败时计数／grants／合并去向整体回滚。
- [x] 写常驻测试：30有效日期登记候选一次；retain 表示未通过时无新 evidence 不再重复准备；提升后普通检索不同时返回旧长期和learned投影，唤醒仍记主身份；单个事件的重复不能伪造跨事件稳定认识。
- [x] 运行 `npm test -- tests/memory-v3-lifecycle.test.ts tests/memory.test.ts tests/review-fixes.test.ts`，确认新预期失败后实施生命周期及新合同。保持原别名“非空替换／空保留”和当前来源门禁。
- [x] 保存grant的anchorAt、kind、triggerDates；initial normal从shortExpiresAt、high从at，createdAt不算窗口；renew／reactivate／migration各用既定锚点。重放最后合法窗口之后未消费日期，日内UPSERT、合并、期限与候选同事务完成。
- [x] 更新 memory 提示：详细过程与事件／感受摘要同次生成；来源语义要求明确；短期正文归档保留。运行上述测试、typecheck，记录检查点。

## 任务3：独立调用上下文与派生向量

**Files:** 新增 src/embedding.ts、src/memory/index.ts；修改 src/output/stickers.ts、src/model/client.ts、src/types.ts；新增 tests/memory-v3-index.test.ts、tests/model-call-context.test.ts；保留 tests/stickers.test.ts 语义。

**Interfaces:**
- 共享 `EmbeddingProvider.embed(text: string, options?: {signal?: AbortSignal}): Promise<number[]>`，HttpEmbeddingProvider 实现；原表情模块重新导出已有类型／类以兼容调用。
- `Transport.complete(request: CompletionRequest, options?: {signal?: AbortSignal}): Promise<unknown>`；`ModelRunner.runModel<T>(task: ModelTask<T>, input: unknown, options?: ModelRunOptions): Promise<T>`。
- 产生 `MemoryIndex.query(text: string, signal?: AbortSignal): Promise<Float32Array|null>`、`prepare(job: IndexJob, signal: AbortSignal): Promise<IndexResult>`；构造注入 store、provider、配置签名、时钟及超时／缓存参数。
- 产生只读引用`MemoryIndex.stats: RetrievalStats`，检索层共享该统计对象记录词法降级，宿主只读展示；不用共享可变调用权限来承载统计。

- [x] 写归一化与缓存测试：非单位向量双侧结果正确；同查询复用一次向量；正文变更不复用旧检索结果；端点／模型／维度／模板变化各使缓存失效，TTL／256上限可观察。
- [x] 写查询1500ms超时／失败返回null、后台 signal 可中止请求测试；prepare 返回向量而不直接修改正式 owner／index。
- [x] 写最小统计测试：缓存命中不加remoteRequests，超时／失败分别累计，status可使用同一进程内RetrievalStats，不保存查询正文或每轮统计表。
- [x] 写并发两个模型任务测试：各自 lookup、修补和 signal 独立；后台 lookup=null 禁用默认回调；修补／补查续调用沿用原 task 配置且最多一次逻辑补查。
- [x] 运行 `npm test -- tests/memory-v3-index.test.ts tests/model-call-context.test.ts tests/stickers.test.ts`，核对失败针对新增行为。
- [x] 提取现有 HTTP EmbeddingProvider，透传 signal 到 fetch，不把 signal 写入请求 JSON；维护调用超时／取消必须跳出调用，不将取消当成待修补 JSON。
- [x] 实现 float32 BLOB 编解码、配置签名、LRU256／10分钟及1500ms查询超时，索引输入文本统一模板。避免将查询向量请求计入单后台准备槽；它属于前台召回且有等待上限。
- [x] 运行上述测试及 typecheck，记录检查点；此阶段不执行真实供应商请求。

## 任务4：有权限的混合检索与异步上下文

**Files:** 新增src/memory/retrieval.ts；修改src/memory/context.ts、src/memory/organize.ts、src/app.ts、src/directors/narrative.ts、personal.ts、world.ts、school.ts、src/output/expression.ts的模型调用options透传；新增tests/memory-v3-retrieval.test.ts；更新tests/shared-scene.test.ts、memory.test.ts、turn.test.ts及review-fixes.test.ts的显式预算夹具；新增scripts/check-memory-retrieval.ts、tests/fixtures/memory-retrieval-labels.json。

**Interfaces:**
- 消费 `MemoryStore.selectCandidates(request)`、`MemoryIndex.query(text, signal?)`。
- 产生 `MemoryRetrieval.build(request: RetrievalRequest): Promise<RetrievedContext>`，构造注入 store/index；现有 ContextBuilder.build 改为 `build(request: RetrievalRequest): Promise<RetrievedContext>`，buildForMemory 改为 `buildForMemory(request: RetrievalRequest): Promise<{details: MemoryCandidate[]; retrieved: MemoryCandidate[]}>`。src/app.ts 内叙事／个人上下文分别 await，src/memory/organize.ts 内整理上下文 await；阶段可见性沿用原门禁。
- 结构化 lookup 的权限来源于调用时的可见主题；不能由 lookup JSON 自行授予。memory_consolidation 使用快照，不调用这个入口。
- 产生 `MemoryRetrieval.lookup(request: LookupRequest, base: RetrievalRequest): Promise<RetrievedContext>`，合并本次 query／申请范围并验证 base.permissions；调用者闭包固定 base，不允许模型改阶段权限。
- Retrieval实例注入ContextLimits；RetrievalRequest.budget默认null，调用方需要预算时显式传值，整理不统计未使用字段。alwaysInclude默认完整提供，不能把原800合计上限改成单条上限继续使用。
- RRF前先判相关：key／明确别名独立精确入口，其他词法路去通用叙事词并按有效词覆盖度标定筛选，不沿用score>0；空有效词不返回全库，短查询不机械要求多个词。向量路保持标定门槛。显式longItemsLimit仅在按需longTerm＋learned去重合并排序后统一裁一次，alwaysInclude独立。

- [x] 写隐藏输入测试：未看私聊的回忆字样不能开启普通主叙事档案；共同场景／可见个人导演允许实际明确回忆，普通当前手机查询不能混入旧手机历史。
- [x] 写到期测试：把后台与向量都阻住，七天边界短期全文退出、preview 仍按词法命中；90天边界退出 current，合法 archive 仍可检索；merged 和旧索引两路都不泄漏。
- [x] 写默认不限测试：相关细节>12、短期>12、长期>8、每路>24、alwaysInclude合计>800、历史>8000时均完整提供；近期原文窗口仍为30，key／别名优先及RRF60顺序正确，缺省／null不触发裁剪。（历史验收口径，已由提示词／上下文V0.1的完整4段窗口替代，见新实施日志。）
- [x] 写完整性与弱命中测试：100条合格相关候选全部返回、无关负例剔除且尾部／来源完整；31条已看输入／已发输出只取最新30条。通用词弱命中、空有效词不误召；短姓名／事实key可召回；RRF不能将不合格词法候选救回。preview向量就绪但retainedFrom未到仍不返回。（历史验收口径，已由提示词／上下文V0.1的完整4段窗口替代，见新实施日志。）
- [x] 写显式可选上限测试：用户主动设置条数／字符上限才按低相关完整条目裁剪，当前来源／状态不裁且正文不截半条；整理只对实际details/retrieved等所用字段计算，默认不采用旧8000。
- [x] 写longItemsLimit统一测试：按需longTerm和learned混合候选只共享一次显式上限，不分别各裁一遍；alwaysInclude稳定认识完整独立，null返回全部合格项。
- [x] 写turn.test.ts间接回归：叙事／个人的async上下文不改变模型调用顺序及未看输入门禁；正文>8000、摘要>120字不会因新增Zod／输出token上限被拒绝。标注负例检查通用叙事词误召。
- [x] 写10,000条及三／六个月固定样本检索测试／基准，输出 SQL 候选耗时、端到端离线耗时、召回／误召；不对供应商延迟作离线结论。
- [x] 运行 `npm test -- tests/memory-v3-retrieval.test.ts tests/shared-scene.test.ts tests/memory.test.ts tests/turn.test.ts tests/review-fixes.test.ts`，确认新增规则未实现导致失败。
- [x] 将所有 ContextBuilder 调用改为 async 权限请求，按词法与就绪向量混合检索；超时用词法，所有候选再次校验当前 owner 状态和版本。各前台 runModel 透传本阶段 lookup 闭包，世界／学校只允许当前事实；无需补查的表达／看图调用传 null，不回退到旧全局历史入口。
- [x] 实现标注验证脚本：事实与经历分组，训练／验证分离，验证集观察切分点按F1选阈值、同分选高阈值；报告带配置签名。未真实标定 semantic-only 关闭，允许报告“待标定”，不能把假向量分数当真实 Qwen 阈值。
- [x] 在同一标注报告记录词法有效词表／覆盖度规则及事实／经历阈值；覆盖度在观察切分点按F1选门槛、同分选高门槛，先离线标定词法，再允许其作为向量未标定／超时的fallback，不能用score>0无门槛过渡。两路先筛选再RRF60，不用固定Top K掩盖误召；离线统计规模不能替代真实模型容量错误比例。
- [x] 运行上述测试和 typecheck，记录检查点。在线模型标定如需发送项目内容，另按既有授权范围确认实际数据范围；本次文档不扩大此前固定在线测试授权。

## 任务5：持久化后台协调器及逐单元应用

**Files:** 新增 src/memory/maintenance.ts；修改 src/memory/store.ts、src/model/contracts.ts、prompts.ts、src/recovery.ts；新增 tests/memory-v3-maintenance.test.ts、tests/memory-v3-recovery.test.ts。

**Interfaces:**
- 消费 MemoryLifecycle、MemoryIndex.prepare、带 signal/lookup=null 的 ModelRunner；构造注入 store、这些依赖、clock 及通知宿主的 onReady 回调。
- 产生 `MemoryMaintenance.startOne(now: string): boolean`（仅启动，不 await远程）、`applyOneReady(now: string): 'applied'|'stale'|'none'`（同步）、`nextDeadline(now: string): string|null`、`stop(): Promise<void>`。
- 协调器管理压缩及索引共用的一槽，回调只保存 ready／错误待办并通知；ready索引提交同样由 applyOneReady 校验 owner revision／配置后完成。

- [x] 写批次测试：默认最多20条、batchCharacters=null且单条>12000完整；显式设置12000软目标时只减条数、超额单条独占批次不截正文；可重试压缩／索引按createdAt、jobId公平取最早。
- [x] 写固定周期测试：cutoff之后到期的内容不混入当前周期但preview按时可见；重启恢复已有cutoff，无周期时用恢复now补办一次，完成后设下一未来04:30，不逐日补造周期／依赖时间watermark。
- [x] 写后台 deferred Promise 测试：startOne 立即返回，不第二次启动；完成仅变 ready，owner 不变；ready 应用每次只处理一个不重叠单元。
- [x] 写三个单元测试：准备后更新第二个 owner 的 stateVersion，第二单元 stale 且不覆新值，第一／第三仍应用；冲突候选仍合格才重新准备。索引仅正文revision变化使结果作废。
- [x] 写stale重准备测试：旧job只记staleUnitKeys，合格单元转新pending job；任何时刻至多一个computing，ready／pending不被误判占槽，默认先处理ready。
- [x] 写文件重开测试：computing退pending、ready不重调用LLM、已应用单元不重复；故意使事务提交失败时正文与 appliedUnitKey 同时回滚。维护失败保留preview、不改变全局paused。
- [x] 写后台容量错误测试：transport抛出容量错误，待办及后台错误保存、preview不变、全局paused不变；不发缩小输入的第二次模型请求，仍按5分钟retryAt正常待办，不把错误当格式修补。
- [x] 写索引恢复测试：索引写入及IndexJob.done同事务，失败一起回滚；重开跳过done，completionReason记录applied/stale，不向IndexResult加应用身份字段。
- [x] 运行 `npm test -- tests/memory-v3-maintenance.test.ts tests/memory-v3-recovery.test.ts`，确认失败后实现闭合快照合同与 disjoint units 校验。
- [x] 实现120秒后台超时、5分钟 retryAt、stateVersion readSet、日期／grant 合并、常驻结果应用；每个单元正式变更、索引待办与应用标记同事务。压缩只读取快照，禁止额外补查绕开readSet。
- [x] 实现 stop 中止后台并等待收尾，禁止关闭库后回调；完成后立即通知宿主，但不在回调应用正式状态。运行上述测试和 typecheck，记录检查点。

## 任务6：宿主前台优先与真实事件循环让位

**Files:** 修改 src/host/runtime.ts、scheduler.ts、src/app.ts；新增 tests/memory-v3-host.test.ts；扩展 tests/scheduler.test.ts、input.test.ts、recovery.test.ts。

**Interfaces:**
- SerialHost 依赖一个任务5协调器；维护 Promise 不纳入 `active`。新增可注入 `yieldToEvents: () => Promise<void>`，生产默认 `setImmediate`，测试可控制让位时机。
- pump、armTimer、pause/resume/stop/status 仍由 SerialHost 负责；Scheduler 继续决定原世界→学校→故事顺序，后台不改其业务优先级。
- host.stop统一拥有停止责任：置stopped／清timer后立即发起maintenance.stop，等待前台active和后台收尾均完成才返回；dispose随后storage.close，不先等待前台才发Abort。collectReady只返回故事／环境轮，nextDeadline合并可运行维护截止。
- 本任务测试通过host.acceptInput或InputBuffer建立真实pending批次并闭合。tests/helpers.ts的saveInput保留用于直接指定请求，不能用它证明真实队列让位。

- [x] 写“未释放后台仍完成故事”测试：后台 deferred 不 resolve；acceptInput 后立即有落库输入，推进15秒执行前台，断言 outbox confirmed／turn done，再释放后台；先释放后台才通过的测试不合格。
- [x] 写真实让位测试：ready有两个单元，首单元后 `yieldToEvents` 让待输入完成落库；测试同时用真实 setImmediate 走一次，不只 mock collectReady。第二单元必须在静默截止和相应故事完成后应用。
- [x] 写启动排序测试：unfinished旧故事→已到期世界→学校→故事→维护；openBatch时既不启动新后台也不应用ready，不改变15秒静默截止。
- [x] 写暂停／定时测试：pause期间无新后台／正式应用；已到期维护在computing时不造成0ms反复唤醒；resume继续ready；stop后台Abort后等待收尾才关库。
- [x] 写停止所有权测试：前台尚未结束时后台已收到Abort，stop等两者完成后才允许close；即使取消后计算返回也不写ready／触发wake，原ready保留；pause仍允许保存ready。
- [x] 运行 `npm test -- tests/memory-v3-host.test.ts tests/scheduler.test.ts tests/input.test.ts tests/recovery.test.ts`，确认当前宿主缺上述行为而失败。
- [x] 按细化第7.2节改 pump：每个维护单元后 `await yieldToEvents()`，重新 closeReady／检查旧轮／collectReady；不要将一次批次作为必须结束的“旧故事”。
- [x] 定时取前台截止与可运行维护截止中的最早项；paused只保留原合批所需截止，在途后台靠结果通知wake、不把past maintenance deadline重复上报。status增加维护积压／在途／ready／retry／lastError及进程内检索／降级概况，不新建监控体系。
- [x] 运行上述测试和 typecheck，记录检查点。若后台挂起仍能形成前台真实发送记录，才算通过聊天优先验收。

## 任务7：配置装配、核心背景和交付核对

**Files:** 修改 src/settings.ts、config.ts、index.ts、app.ts、examples/ 下实际示例、config.local.json、runtime/ 下需要变化的实际部署配置、package.json；新增 scripts/prepare-character-background.ts、tests/memory-v3-deployment.test.ts；更新 README.md、REMAKE_V0.2_MEMORY.md、REMAKE_V0.2_INTERFACES.md、REMAKE_V0.2_IMPLEMENTATION.md、REMAKE_V0.2_RECOVERY.md、REMAKE_V0.2_LIFE.md、REMAKE_V0.2.md、docs/DOCUMENT_AUDIT.md、docs/IMPLEMENTATION_LOG.md 及本计划实施记录。保留 DSH 审核快照。

**Interfaces:**
- 装配唯一 store/lifecycle/index/retrieval/maintenance 实例，ModelClient 生产构造不传默认 lookup，分别将每次调用 lookup 闭包交给 runModel，将 onReady 接到 host.wake。
- 增加 `memoryEmbedding`、`memory_consolidation`、上述初始参数及阈值配置签名；新增 npm 离线入口 `memory:migrate`、`memory:check`、`memory:background`，对应迁移、召回标注、背景摘录脚本。
- memory_consolidation加入modelRoles／Zod配置／启动校验，通过现有connectionFor的通用models[task]路径路由，不新增无用特判；ContextLimits按默认null装配，本地旧historyBudget=8000要显式改null。网页字符配置不装入记忆类型，移交搜索计划任务5；在该任务完成前保留当前V0.2网页入口并明确其尚未改造，不把记忆完成当作搜索完成。
- 背景脚本产生 core 摘录、稳定 details 初始化差异和来源映射；不直接覆盖作者文件。候选文件置于 runtime/data/ 下，仅在审阅通过后切换生产背景入口。

- [x] 写配置测试：11项模型（modelRoles十项及独立贴图描述一项）各自可设Flash/Pro，压缩high，memory仍high，其余原配置保留；记忆Embedding改模型不会偷偷改表情配置／向量。
- [x] 写长度及路由装配测试：样例／实际配置默认null不恢复旧配额；memory_consolidation通用路由取本角色Flash/high；不新增webMaterialCharactersLimit；模型HTTP请求不新增max_tokens／max_completion_tokens，status统计不含正文。网页>12000尾部完整验收归搜索任务1、5，不在这里写另一个字符裁剪器。
- [x] 写新库初始化测试：initial runtime有nextMaintenanceAt；无到期待办为下一04:30，有到期按now补办，仍使用nextWorldAt／nextSchoolAt。写前台容量错误测试：未完成轮保留、paused=true及lastError记录，原记忆不变，无缩小输入的第二次请求；与任务5后台行为对照。
- [x] 写装配与背景测试：使用人工构造的角色夹具，核心保留、手机／室友等事实进入details；不能靠真实作者私密内容出现在测试快照中。检查源映射与可变旧值不会在core和details重复生效。
- [x] 运行 `npm test -- tests/memory-v3-deployment.test.ts tests/deployment.test.ts tests/model-settings.test.ts tests/plugin.test.ts`，确认新增配置缺失后实现装配和脚本；迁移脚本要求服务停止及无未完成旧轮。
- [x] 离线生成本地真实角色摘录与细节差异，记录需用户检查的具体变化；在摘录审核前保持生产入口，不以关键词自动删掉背景段落。迁移及生产开关的实际执行另记准确状态。
- [x] 完成全文档同步：将实施事实与草案区分，更新合同、调度优先级、暂停／恢复、迁移步骤和实际测试统计，不复制旧78测试结论为新验收。
- [x] 运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run smoke --prefix runtime`、`./start-hdsi.cmd --check`、`./start-snowluma.cmd --check`。后两条仅检查依赖，不新建长期进程。
- [x] 执行临时库迁移／检索检查，核对基准和未标定项；生产库迁移只在上述前置条件满足后进行。供应商真实在线验证与正式服务运行分开记录。
- [x] 更新实施记录的验收矩阵、实际命令／结果、未解决项。完成只指已实际验收部分；背景切换／Qwen阈值／生产迁移若仍待处理，应明确列出。

## 计划自检与交付范围

覆盖关系：身份／版本／SQL迁移→任务1；每轮来源、预备摘要、7／90／3／30与合并→任务2；并发调用／向量→任务3；权限／召回／预算→任务4；持久化批次／冲突／恢复→任务5；聊天优先／让位／暂停／退出→任务6；配置／背景／脚本／文档及全量验收→任务7。

实施时每项先证明新行为失败，再实现并通过相应检查；最终完整检查只在有代码后执行。本计划生成时尚未运行；本次执行已完成离线验证和正式空故事库schema3迁移，未新增供应商调用、未启动正式服务。

建议用户／DSH重点检查细化第7节的调度规则，以及第3节“预备摘要”是否符合七天后的简要长期预期；执行计划主要供实施和复盘使用。

第四／第五轮已接受澄清及最新网页查阅来源已实际折入正文；用户最新长度偏好覆盖历史800／8000等参数，不需要为同一澄清再次启动DSH审核。此前文档审核时用户要求先不改代码；本次已授权实施并完成记忆离线核心，接着执行搜索计划。语义阈值真实标定、背景摘录切换、生产迁移、具体搜索适配器及在线验证的实际状态分别记录，未完成项不冒充上线。

