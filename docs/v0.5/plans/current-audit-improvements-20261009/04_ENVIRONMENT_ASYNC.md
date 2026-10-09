# E1～E5：环境异步准备与串行提交

日期：2026-10-09。状态：**独立后续方案，未实施**。返回[统一计划](README.md)。前置：第一阶段 T1～T9 完成，尤其复用 T3／T4 的检索和 T5 的环境轻量查询；本篇不阻塞前一阶段交付。

## 1. 目标与选择

当前环境步骤由 `HdsiApp.runTurn` 等待模型返回，期间占据 `SerialHost` 前台串行执行槽。改进后，在没有更高优先级前台工作且没有打开的输入合批时冻结环境依据，后台等待环境模型；新聊天可正常生成／发送／提交。环境结果先持久化为 ready，随后在前台串行边界提交客观事件或学校安排。

这里明确改变“已开始的环境请求让聊天等待”的流程。保持四阶段依赖 `world → school_campus → school_group → school_week`，后一步必须等前一步**提交完成**后才冻结；不并行四个环境阶段，不并发整个 `runTurn`，不在模型 Promise 回调中写故事业务表。

新设 **一个环境准备槽**，与已有一个记忆准备槽独立；二者可在等待网络时重叠。所有本地事务仍在当前单进程同步 SQLite 连接执行，事务内部无 `await`。本篇不增加 Worker、多进程、通用任务平台或长期持有的 SQLite 读事务。

主要文件：[环境运行](../../../../src/environment/runtime.ts)、[环境类型](../../../../src/environment/types.ts)、[环境调度](../../../../src/environment/scheduler.ts)、[环境 Store](../../../../src/environment/store.ts)、[Host](../../../../src/host/runtime.ts)、[调度器](../../../../src/host/scheduler.ts)、[学校模型入口](../../../../src/directors/school.ts)、[学校合同](../../../../src/school/contracts.ts)、[学校变更](../../../../src/school/changes.ts)、[周展开](../../../../src/school/calendar.ts)、[模型客户端](../../../../src/model/client.ts)、[入口装配](../../../../src/index.ts)。

拟新增 `src/environment/preparation.ts`、`src/environment/snapshot.ts`、`src/deployment/environment-async-upgrade.ts`、`scripts/migrate-environment-async.ts`。具体职责和任务见下文。

## 2. 状态、身份与持久版本

### 2.1 不更改 ready 结果的业务类型

沿用 `pending/running/ready/committed/superseded` 和现有 `frozenResult: EnvironmentChangeSet|null`。新步骤增加可序列化字段，旧字段保留：

```ts
// 结构示意；各 snapshot 子类型须用现有领域类型声明，不能用 Storage 代替。
preparationVersion?: 0 | 1;
preparationGeneration?: number;
preparationSnapshot?: EnvironmentPreparationSnapshot | null;
staleReason?: string | null;
```

`EnvironmentPreparationSnapshot` 包含：`version:1`、原 `EnvironmentStepInput`、冻结时间／时区、阶段业务只读视图、业务 read basis、冻结的本地检索候选与 ordinary recent、检索配置签名及实际使用的检索依据。向量写成数值数组，恢复时还原 `Float32Array`；不得直接 JSON 序列化 TypedArray 后假定格式不变。

原 `inputSnapshot` 继续保存相同的模型业务输入，避免改变现有状态检查及历史字段的含义。`frozenResult` 继续是解析后的完整变更，创建 ID 在保存 ready 前确定；ready 重开不重新分配 ID，不再次调用模型。

`preparationGeneration` 只在因依据变更而重新冻结业务输入时递增。普通网络重试、停止／重启沿同一 generation 恢复；`attempt` 保留现有环境请求尝试计数。内存额外使用一次执行的 lease/token 区分同 generation 的中断和晚到回调，不能把进程中的 Promise 身份当持久身份。

### 2.2 显式升级，保留旧冻结任务

将运行态 `environmentPlanningVersion` 扩展到 `1|2|null`。新建库使用 2；现有 version 1 库通过新增 `npm run migrate:environment-async` 显式停服、备份后升到 2。旧的 null→1 迁移保持职责，不直接套用新快照逻辑。生产入口只启用已升级的 2；version 1 的兼容辅助入口保留给迁移与旧恢复测试。

升级事务不调用模型、不重开终态批次、不改 nextEnvironmentAt／前台未完成回合／暂停状态：

| 原步骤 | 升级处理 |
| --- | --- |
| committed／superseded | 原样保留，不补生成 |
| ready | 标记 `preparationVersion:0`，复用原 frozenResult 按串行旧合同提交 |
| running，或已有 inputSnapshot 的 pending | 标记 0，保留输入、attempt、retryAt、网页阶段及 checkpoint，按旧串行入口恢复到终态 |
| 从未冻结、从未开始的 pending | 标记 1；被选中时才生成新快照 |

一次日批次可同时含已完成旧步骤和后续新步骤，但仍逐步提交。版本 0 的旧恢复偶尔仍阻塞聊天，这是兼容范围，不把旧输入拼成缺少来源的异步快照。

新工具命令合同：

```powershell
# 以下使用开发夹具路径；不是要求在正式库执行。
npm run migrate:environment-async -- --database .tmp/environment-async-fixture.sqlite --check
npm run migrate:environment-async -- --database .tmp/environment-async-fixture.sqlite --apply --stopped --backup-dir .tmp/environment-async-backups
```

检查报告显示版本、待继承的旧任务数量、未开始任务数量、备份路径及能否升级；重复 apply 到 2 是无业务写入的幂等检查。工具增加 `--target-version 1|2`，默认2；目标1的检查／写入只按第9节条件降级，仍要求 apply/stopped/backup-dir，不提供强制忽略在途任务的开关。旧程序的现有 version 1 门禁会拒绝 version 2，避免旧入口忽略新快照依据直接提交。只新增字段、不设版本门禁不足以提供这种兼容保证。

## 3. 真正冻结模型所读内容

当前 `environmentInput` 只是部分冻结：`schoolCampusTask/GroupTask` 的 parse 会读实时 plans/items，`resolveSchoolUpstream` 会读实时行，`optionsFor.lookup` 会查询实时记忆。不能只把现有 `generateEnvironmentStep(d,input)` 放入不等待的 Promise 就宣称异步安全。

### 3.1 只读视图与纯解析

`snapshot.ts` 在 Host 串行边界捕获所需领域行，形成独立的不可变数据；数据库读取结束后才启动异步工作。合同解析器和 resolver 接受只读视图接口，如按 ID 读取 plan/item、列举 owner 的 plans、查询既有实例；接口实现为冻结数组／Map，无 live Storage 引用。

保留现有对外函数作薄包装，让旧同步调用和旧测试也调用同一个纯解析内核。不能复制一套学校规则：owner／revision、clientRef、默认通知策略、已发布条目时间、公开版本递增、周覆盖、引用 URL 均复用原规则。`providedUrls()` 只读取本次网页阶段确认提供的材料，不属于故事实时视图。

准备中的 `resolveResult` 依据冻结数据、冻结业务时刻构造 `EnvironmentChangeSet`；提交时再按实际时刻执行现有周规范化，并复核已发布条目不能被推回未来的时间约束。例如冻结时尚未发布、等到提交时已发布的条目，不能使用早先时刻放行未来隐藏。此类时点冲突转为过期准备并重新冻结，不作为模型格式修补。

### 3.2 本地 lookup

新建 `freezeEnvironmentRetrieval` 与 `lookupFrozenEnvironment`（可位于 `snapshot.ts`／`memory/retrieval.ts`）：

1. 使用该阶段现有 `makeRetrievalRequest`：current scope，禁止 archive／detailHistory，冻结 at、权限、预算及 limits／calibration／embedding signature。
2. 同步捕获 `selectCandidates` 的当前候选（查询词不参与现有候选资格 SQL），以及该阶段有资格的完整 ordinary recent。仅本地检索需要的数据进入独立快照，不克隆整个故事库，不为此读取全部历史消息正文。
3. 将现有检索的排序／融合／预算部分提取为共享函数，以冻结候选和 recent 执行任意一次合法查询。若语义校准启用，查询向量使用相同配置签名；默认 `semantic=null` 仍不发向量请求。
4. 原本的来源完整性门禁仍执行。捕获相关 source ID 的存在信息供冻结检索校验；只有实际返回的 owner／message／source 被加入提交 read basis。不得为省事让后台 lookup 回到 live retrieval，也不得关闭 lookup 改变模型能力。
5. 新记忆或新消息不自动使整个候选池失效。结果表达冻结时刻已知材料；但实际返回的 owner 若被删除／修改，或引用消息被清理，则该准备不能提交，见下一节。

这是为了并发期间的输入一致性，需要增加每日阶段冻结的一次当前候选复制。它不保证同步冻结耗时为零；E5 单独测量冻结、HTTP 等待、提交三段耗时。若后续数据显示候选复制成为显著瓶颈，再独立优化，不能在本方案中暗换成实时 lookup。

## 4. 提交依据与变化处理

### 4.1 read basis 的范围

对各类依据保存按稳定 ID 排序的成员及关键字段快照／摘要（使用一致的对象字段顺序构造摘要）。在准备开始和尝试提交时计算，不在每次 deadline 中重扫。

| 阶段 | 必须检查的业务依据 |
| --- | --- |
| 全部 | batch ID、batch active、本地日期与配置时区；阶段前驱均 committed；世界／学校设定与所用背景视图的配置签名；实际 lookup 返回 owner 的 revision/stateVersion/status、消息／source 的存在 |
| world | 输入中的 active world events 集合及内容；更新／取消的对象仍与冻结版本一致 |
| school_campus | campus 的 plans/items 集合及完整业务版本／字段，包括首次规划时空集合；输入使用的世界事件 |
| school_group | group plans/items、输入世界事件、campusTiming；**科研 progress 集合及记录内容**，新增 progress／completed／feedback 也算变化 |
| school_week | sourceItems、相关已有实例／weeks、knownSnapshots、待办 appointment 集合及业务字段、所用通知的结构及 invalidated 状态 |

检查集合成员而非仅检查已存在 ID，可发现“原来没有记录，现在新增”的变化。对于当前无 revision 的 progress，比较稳定 ID 及实际内容，不臆造现成版本列。某条无关新聊天本身不令 school_group 过期，只有正式提交出相关科研进展／命中的依据变更才过期。

通知的 scheduled→available→read、releasedAt/readAt/nextWakeAt 是通知生命周期，不单独使周准备过期；提交继续保留现有同 ID 的已发布／已读记录。若变化形成新的知情快照、变更通知业务结构或使其 invalidated，则按上述业务依据过期。不能比较整个通知 JSON 后把正常 release 都视作冲突，也不能把新结果覆盖到已经 read 的通知上。

时钟推进本身不全盘重生成。周展开的已发生实例、过时 reminder、after 身份及取消截止由现有 `normalizeSchoolWeekChanges(..., commitNow)` 再处理；跨本地日期／时区才终结整个旧批次。

### 4.2 过期准备的确定行为

1. 同日依据变化：不应用旧 frozenResult；串行事务把当前步骤回到 pending，清除该 generation 的业务快照／结果，记录简短 staleReason，generation 增一，`retryAt=now+environmentRetryMs`。五分钟后有资格且前台空闲时重新冻结；不使用立即循环重生。
2. 跨日／时区变化：按原规则把旧批次与未提交步骤 superseded，终态身份不重开；终止该准备的网络请求，旧回调无权复活。新批次照常建立并依赖新四步顺序。
3. 高优先级前台正在生成／发送、存在未完成回合、openBatch 或暂停：ready 保持持久化等待，不算 stale，不重调模型。
4. 检查与应用在**同一同步事务**中完成；查到旧依据后不能先退出事务再等待或应用。

这里只对新 preparationVersion 1 使用新检查。旧 version 0 的冻结恢复继续原合同；升级后不能悄悄让旧无 read basis 的 ready 全部重生成。

## 5. 网页身份、重试与停止

继续使用 `ownerType='environment'`、`ownerId=step.id`、`stageKey='generation'`、`taskName=step.stage`。当前 step.id 已等于 `JSON.stringify([batchId,stage])`，装配统一从 step.id 取得，不另拼易错身份。**generation 数字不进入网页 stageKey**，否则每次依据变化都会获得一套新 20／40 额度。

| 场景 | 业务输入 | 网页／模型进度 |
| --- | --- | --- |
| 单次请求中的格式修补 | 相同 | 现有累计修补上限不变 |
| 模型格式／网络失败后定时 retry | 沿同一冻结输入 | 保留网页计数、已确认操作和 lookup；按当前环境规则重置本次新 attempt 的 repair |
| pause | 准备可完成并保存 ready，暂不提交 | 不压缩，不重开 stage |
| stop／重启 | 保留当前 generation 的输入和运行态；中断不伪装成新业务失败 | 保留 checkpoint、修补计数、lookup、待续网页操作；恢复不重置额度或增加中断 attempt |
| 同日依据 stale 后重新冻结 | 新 generation／新输入 | 同一网页 stage、计数与已确认材料继续累计；旧 repair 不用于新输入 |
| committed／superseded | 业务终态 | 原子确认终态后 release owner，再允许压缩 checkpoint；统计及历史 ID 保留 |

重新冻结时处理 private lookup 的具体合同：首次模型请求的 `LookupRequest` 连同 `lookupUsed` 持久化在唯一的网页模型 checkpoint。若 generation 更新且已用过 lookup，程序以**同一个请求**在新冻结检索快照上重新投影，替换 privateLookupResult，`lookupUsed` 仍为 true；模型不能追加第二个查询。不把旧输入的 privateLookupResult 原样带进新输入，也不通过清零 lookupUsed 扩张模型查询次数。

补齐 lookup 本身中断的恢复，不能沿用“先记已使用、返回前丢结果”的空档：

```ts
// WebModelCheckpoint 的向后兼容字段，旧 checkpoint 缺字段沿原规则。
lookupRequest?: LookupRequest;
lookupPending?: boolean;
// 环境冻结查询内部返回，ModelClient 只收到 context。
lookupFrozenEnvironment(snapshot, request): Promise<{
  context: RetrievedContext;
  usedBasis: EnvironmentLookupBasis;
}>;
```

1. 新环境必须装配持久 `WebSearchSession`；provider 关闭依然使用既有 `WebSearchStore` 保存 checkpoint。无 web 注入的离线新模式夹具显式装配 `new WebSearchService(new WebSearchStore(storage), undefined, clock, {enabled:false})`，不回退到仅内存 checkpoint。旧 version 0 辅助调用保持现有可选装配。
2. `ModelClient` 在调用 lookup 前一次保存 `lookupUsed=true, lookupRequest, lookupPending=true`；返回成功后设 privateLookupResult 并清 pending。在恢复时，pending=true 则先以原 request 完成 lookup，再继续模型，不能再次询问模型要查什么。已经完成的 lookup 不重做；旧 checkpoint 没有 pending 字段继续原合同。
3. 环境专用适配器包装给 ModelClient 的 `WebSearchSession.saveCheckpoint`。lookup 闭包暂存返回的 usedBasis；保存 lookup 成功的 checkpoint 时，经过当前执行守卫，在**同一事务**保存 web checkpoint 和最新 step 快照中的 usedBasis。普通修补／工具进度保存不清掉已持久依据。环境快照不再复制 lookupUsed/result 为第二份权威状态。
4. 若在查询后、成功保存前崩溃，持久状态仍为 pending，重开用相同冻结候选和 request 重算；若已保存，则结果与依据二者同时存在。测试覆盖“登记后尚未调用”“lookup Promise 挂起”“已算出但保存前”三个边界。
5. stale generation 在重新冻结的事务中清旧 privateLookupResult／usedBasis，把已经使用的同一 request 标 pending；保留 lookupUsed、网页计数和操作。随后依上面恢复流程计算新投影。后台配置签名不匹配同样先走业务 stale，不临时换向量配置计算旧快照。

新 generation 保留已确认网页 materials/counters/operations；若原有 pendingOperationId 尚未完成，继续同一操作后再生成，不能清掉后重开搜索绕过计数。清除旧 repair 内容，按现有“新 attempt”规则重新开始格式修补。所有这些替换在开始新请求前持久化，并有停止／重开测试。

`stop()` 先标记 stopped，清 timer，并发通知环境和记忆槽 abort，然后等待前台任务及两个准备 Promise 收尾，最后才关闭 Storage。若自定义 transport 不响应 abort，也须等其返回且丢弃结果后关闭，不能让晚回调使用已关闭连接。ModelRunOptions.signal 必须经导演入口传至模型及网页调用；失败捕获先辨别 AbortError／signal，不设置全局 paused。

非 ModelFormatError／ModelRequestError 的真实程序／存储失败仍沿当前暂停及 onError 路径报告；后台 Promise 必须有人接住，不留未处理 rejection。错误事件交回 Host 串行边界处理，不在回调中拿旧 runtime 对象覆盖新前台状态。

## 6. Host 与调度接口

新增 `EnvironmentPreparation`，提供：

```ts
startOne(stepId: string, now: string): boolean; // 同步冻结及持久化，启动 Promise 后立即返回
applyReady(stepId: string, now: string): 'applied' | 'stale' | 'none';
get inFlight(): boolean;
get inFlightStepId(): string | null;
currentWebOwner(): WebOwnerRef | null;
status(): EnvironmentPreparationStatus; // 只读取轻量字段
stop(): Promise<void>;
```

在 T5 的 `EnvironmentStepMetadata` 轻量投影上补 preparationVersion、preparationGeneration、attempt、startedAt、staleReason 的标量，供模式判定及状态显示使用；不把完整 preparationSnapshot 加入元数据。`Scheduler.collectReady/nextDeadline` 增加可选参数 `{environmentInFlightStepId?:string|null}`，Host 每次传入准备槽当前值；独立旧调用省略参数仍可用。环境步骤为新 pending／需要恢复的 running 时，非空 inFlightStepId 表示槽尚占用，跳过此次环境候选并继续原自主判断；ready 则仍按提交门禁择机消费。这样旧日 abort 尚未收尾时，新日 pending 不会反复被选中却无法启动。deadline 同样忽略被占用准备槽阻塞的立即时间，等待完成唤醒／午夜／其他实际截止。

构造注入 store／只读快照工厂／generator／onReady、onError；准备 Promise 只允许写本步骤状态及网页工具数据。抽取当前执行守卫 `canPublish(stepId,generation,lease)`，在写事务中重读最新行，核对 status、generation、执行 lease、batch 状态以及日期／时区。保存 ready、失败转 pending、lookup 结果及 usedBasis、模型 checkpoint 的回调写入均使用该守卫；终态／旧 generation／已主动中断的执行只能收尾，不能回写状态或发布新的业务错误。主动取消先 abort，网页 service 沿现有 signal 检查拒绝晚到写入；包装的会话写入口同样校验 lease。已经确认的工具计数不因取消被擦除。保存 ready 后 `onReady` 唤醒 Host，不直接提交；跨日因守卫未通过时也唤醒 Host，由其协调失效批次。

Host 每次串行迭代依旧先处理恢复及现有 foreground／学校通知优先级。在原环境优先级位置：

- preparationVersion 0 旧任务：走原串行恢复包装，直到完成。
- 新 ready：调用 applyReady，一次最多提交一个步骤，yield 到事件循环后重新检查前台。
- 新 pending 且 retry 到期、环境槽空闲：startOne，yield 后重新扫描。新 running 不再作为前台 TurnRequest 返回，因而自主／聊天可继续。
- 新 running 且进程中没有该 Promise：恢复同一冻结准备；不能当一个新任务重置状态。进程启动后先处理未完成前台回合，再恢复背景槽。

新请求抵达时只做正常合批，不 abort 正在准备的环境 HTTP。若该前台随后改变科研／知情等依据，ready 在实际提交检查时转 stale。

`environmentDeadline` 复用 T5 元数据，不读输入／结果：运行中的准备由 completion callback 唤醒，不能返回 now 导致 0ms 忙循环。依旧保留日批次下一入口，并为活跃准备补上该批次时区的下一本地午夜，以及时处理跨日。ready 因 openBatch 等门禁阻塞时使用现有前台／合批截止唤醒；paused 时不为环境反复设 now。定时 retry 用 retryAt。

`hdsi.status` 区分“准备中／待提交／等待重试／旧任务串行恢复”，显示 stage、attempt、retryAt，不解码大快照。网页当前 owner 来自持久准备槽，即使前台也在运行仍列出 environment owner；不能再只依赖 runTurn 期间的 `currentEnvironmentStepId`。

## 7. E1～E5 逐项实施

### E1：协议与兼容入口

- [ ] 新建 `tests/environment-async-upgrade.test.ts`，先覆盖 version 1 中四种存量步骤及重复升级；确认当前代码缺少新协议而失败。补目标1降级：新非终态任务存在时只读检查拒绝；都已终态时备份、降级可由原version1检查器打开，业务行及nextEnvironmentAt不变。
- [ ] 增加上述可选字段、runtime version 2、检查／升级脚本与 package script；更新生产入口版本检查、新库默认值以及相关状态／迁移测试。
- [ ] 保留旧输入版本 0 的周合同及旧 ready 结果复用；不把 `modelContractVersion` 与 preparationVersion 混成同一字段。
- [ ] 命令：`npx vitest run tests/environment-async-upgrade.test.ts tests/world-school-state.test.ts tests/world-school-upgrade.test.ts tests/school-week-contract-recovery.test.ts`。

### E2：冻结只读依据与解析／lookup 复用

- [ ] 新建 `tests/environment-preparation-snapshot.test.ts`：冻结后修改实时计划，解析仍使用冻结版本；模型没有请求 lookup 时不调用在线检索，请求时所有候选和 recent 来自冻结状态。
- [ ] 提取学校 parse／resolve 所需只读接口，提供 live 包装与 snapshot 实现；加入 `freezeEnvironmentRetrieval` 和共享排名内核，避免两套算法漂移。
- [ ] 核对 empty school_week 仍能直接构造结果而不调用模型，业务字段齐全；冻结结果创建 ID 保持稳定。
- [ ] 命令：`npx vitest run tests/environment-preparation-snapshot.test.ts tests/world-school-models.test.ts tests/world-school-review14-contracts.test.ts tests/school-week-text-contract.test.ts tests/environment-context-view.test.ts tests/memory-v3-retrieval.test.ts`。

### E3：准备槽、ready 与串行 Host

- [ ] 新建 `tests/environment-async-host.test.ts`，使用手控 deferred Promise：环境未返回时，先让一条新聊天完成正式提交，然后再 resolve 环境；该顺序断言在旧实现上应失败。
- [ ] 实现 preparation 类、信号传递、Host 择机准备／应用、scheduler 跳过 in-flight、完成唤醒和无忙循环 deadline；保留前台 busy／unfinished gate。
- [ ] 同一批最多一个准备；上一步 pending／running／ready 时后一步不冻结；上一步 committed 后下一快照能读到其提交值。
- [ ] 兼容直接 `runEnvironmentStep` 的离线调用：preparationVersion 0 保留原路径；preparationVersion 1 使用同一冻结／准备／应用原语组成串行包装，显式等待该准备然后应用，供单元测试使用。需要持久工具会话的新模式测试按第5节装配关闭provider的服务；产品 Host 的新模式不能绕回这个等待包装。
- [ ] 命令：`npx vitest run tests/environment-async-host.test.ts tests/world-school-batch.test.ts tests/environment.test.ts tests/shared-v3-scheduler.test.ts tests/memory-idle-host.test.ts`。

### E4：变化、停止、重开与工具身份

- [ ] 新建 `tests/environment-async-recovery.test.ts`，补下节验收矩阵；在真实文件临时库重开，不只测同一对象的 ready。
- [ ] 实现业务 read basis、原子提交／stale、跨日及时取消、旧／新 preparation 分支、稳定网页身份与已用 lookup 请求刷新。
- [ ] 校验 ready 应用失败后复用结果，未终态不压缩 checkpoint；stop 中断／晚到响应不能把 ready/committed/superseded 复活或回退。
- [ ] 命令：`npx vitest run tests/environment-async-recovery.test.ts tests/world-school-review14-environment.test.ts tests/world-school-review14-calendar.test.ts tests/world-school-review14-time.test.ts tests/memory-maintenance-checkpoint.test.ts`。

### E5：工作量、响应顺序、文档与交付

- [ ] 运行下表及统一计划的全套离线检查，分别保存冻结／等待／提交耗时、前台开始与完成时间及模型调用次数；不把 fake HTTP 延迟当真实供应商性能。
- [ ] 更新导演、调度、恢复、网页、实现映射和根 README：新流程、显式升级、旧恢复例外、快照日期及 lookup 刷新语义；修改旧“环境请求必须等完”的测试，保留原串行模式的兼容断言。
- [ ] 新建 `docs/v0.5/records/environment-async-20261009/` 交付／过程／日志；独立声明 E 阶段完成，不改写第一阶段交付的当时状态。

## 8. 必需验收矩阵

| 场景 | 精确期望 |
| --- | --- |
| HTTP 挂起中到达聊天 | 不释放环境 Promise 的情况下，聊天已正式提交；环境业务表仍未变化 |
| ready 到达时前台尚未结束 | 只保存 ready，前台结束前不写事件／安排；结束后提交一次 |
| 四步依赖与重开 | 依次冻结／提交；ready 重开不再调模型，创建 ID 不变 |
| 科研进展新增／修改 | group 旧 generation 不提交，记录 stale，等待 retry 后新输入含新进展；无关聊天不必重生成 |
| 新 knownSnapshot／appointment 改变 | week 旧输入过期；单纯 scheduled→available/read 不覆盖既有通知、不触发无休止重生 |
| freeze→commit 跨活动开始 | 已发生实例不重写、旧 reminder 不追发、after 身份正确；使用真实 commitNow |
| midnight／时区切换及切回 | 旧批次 superseded、晚结果丢弃、终态 identity 不重开，新批次四步正确 |
| ModelRequestError／ModelFormatError | pending+retryAt；不暂停前台；同快照、网页累计额度和规定修补重试语义保持 |
| stop→重开 | signal abort；未完成网页操作可接续、已确认步骤不重计；停止不额外给 attempt／网页额度；晚 resolve、晚 reject、lookup／网页晚回调均不能覆盖终态或暂停新前台 |
| stale 时已经 lookup／search | 同 runId／owner／stageKey；20／40累计不重置；相同 lookup 请求在新快照重投影，不能请求第二个查询；中断 lookup 可用原request接续，结果和usedBasis同时持久化 |
| 前台／维护／环境同时存在 | 每个槽最多一个，业务提交全部串行；onReady 不绕过 pause、openBatch 或 unfinished |
| 旧 V0/V1 week、旧 ready/running | 升级后仍沿原冻结合同；旧 ready 不调用模型；modelContractVersion 与准备版本独立 |
| timer／status 历史放大 | in-flight 不产生 now 忙循环；status 与 deadline 不读大快照；当前三类 owner 均准确 |

同时覆盖世界、campus、group、week 四类 ready 内容，不能只以无变更 world 的空结果证明整个流程。

## 9. 发布与回退边界

只在临时夹具库完成升级／重开／停止测试后提供发布说明。本任务不要求实施者擅自迁移正式库。升级工具须沿用项目的停服及备份机制；备份后版本迁移是一项明确操作，不能靠启动时静默改写旧库完成。

回退到旧 version 1 程序前，须在新程序下将 preparationVersion 1 的非终态任务提交或按日批次规则 superseded，确认没有异步活动任务，然后停服备份并由专用检查／降级入口把 runtime 版本退回 1；不可手工改一个版本值后让旧代码消费新 ready。若无法完成上述条件，使用升级前备份，同时明确会丢失备份后新故事进度。交付必须提供该检查结果，不宣称可以无条件降级。

E 阶段关闭以响应顺序、数据一致性、恢复、查询工作量和新完整离线验收为准。真实模型质量、真实 QQ 延迟与数月持续运行仍是另行验收范围。
