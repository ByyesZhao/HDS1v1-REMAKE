# ASTRA 审核后流程、性能与验收细化（F5～F8）

日期：2026-10-09。状态：**已实施；本文件保留接口及验收合同，实际计数/成本见[交付](../records/ASTRA_FIX_DELIVERY_20261009.md)。**

依据：[审核](../reviews/ASTRA_REVIEW_20261009.md)、[SOL 核验](../reviews/CODEX_RESPONSE_ASTRA_REVIEW_20261009.md)。与[业务细化](ASTRA_FIX_BUSINESS_IMPLEMENTATION_20261009.md)及其全局约束共同使用，执行顺序见[执行计划](ASTRA_FIX_EXECUTION_PLAN_20261009.md)。新增接口已实现，见对应任务源码和回归。

本轮目标是减少已经可确定无效的工作、重复解码与无界状态输出，同时恢复可用的离线验收。不是安全加固、任意损坏数据防御或整体架构重写。F5 现有版本门禁能挡住旧结果；F6/F7 的合成数据不证明正式运行已经卡顿或 QQ 已发送失败。

## 1. F8：先恢复可验证业务完成的 smoke

### 1.1 真实入口和两个场景

修改 `runtime/plugin-smoke.cjs`；新增 `runtime/plugin-smoke-fixtures.cjs` 放无副作用的协议解析、响应构造和等待 helper，新增 `tests/plugin-smoke-contract.test.ts`。保持 `npm run smoke --prefix runtime` 为入口，继续使用真实 Koishi `Context`、插件注册、`ctx.start()` 和真实 Host。

每个场景单独 mkdtemp／临时数据库／Context，顺序运行：

| 场景 | 上游输入 | 成功业务状态 | 成功后检查的生成 HTTP |
| --- | --- | --- | --- |
| `empty_week` | 两个计划，itemChanges 为空 | 同一 batch committed，world／campus／group／week 四步全部 committed | world、campus、group 各 1；week 0，共 3 |
| `required_notice` | 某计划新增未来 once 事项，announceOnIssue=true | 四步 committed，生产 V1 展开生成实例与通知，文本 key 全对应 | 四阶段各 1，共 4 |

未来事项使用真实 draft 结构：status=open、计划 clientRef、固定 now 的 issuedAt、明确 startsAt／endsAt；最小提醒配置可为空，只要求 issue 通知。不能直接往 school_notices 塞一条记录绕过展开。

固定测试时钟，例如 `2026-10-09T02:00:00Z`，临时 sample 的 initialSleep 覆盖该时刻，使环境仍可展开而不会立刻转入未模拟的前台通知／QQ 发送。只改临时副本，finally 恢复时钟、fetch、环境并停止 Context。使用 `examples/story.sample.json` 与假 key，不读取正式私有配置。模型和 Embedding 全部由 fake fetch 返回，未知请求直接失败，不透传网络。

### 1.2 协议与等待合同

接口（CJS 导出）：

```js
parseEnvelopeRequest(init) // 返回 { envelope, context, stage }
mockEnvironmentResponse(context, scenario)
waitForEnvironmentBatch(inspect, batchId, deadline)
runScenario(scenario) // 'empty_week' | 'required_notice'
```

解析从 `JSON.parse(JSON.parse(init.body).messages[1].content).input.context.stage` 取 stage，并检查实际 envelope 的 resources／roles。不要兼容旧 `input.stage` 使协议漂移静默通过。world 返回自身 changes 结构；campus／group 返回对应 stage／planChanges／itemChanges。

周 V1 响应从**实际模型输入** `context.notices` 和 `context.weekStarts` 生成 `noticeTexts:[{key,text}]`、`weekNotes:[{weekStart,conflictNotes:[]}]`；不是从内部 requiredNoticeKeys 造旧 V0 instanceChanges／noticeCandidates。空周 step 的 `inputSnapshot.modelContractVersion=1`，requiredNoticeKeys 为空，冻结结果也为空通知。

等待器固定捕获第一个目标 batch ID，轮询该 batch 和四个 step 的**提交终态**，每次 `setImmediate` 让 Host 推进。HTTP 数量只在成功后做成本断言，不能作为完成信号。superseded／失败暂停提前报告；10 秒 deadline 仅用于避免测试挂起，不是性能承诺。失败信息包含 batch ID、stage/status/attempt/retryAt/lastError、分阶段调用数，不需要倾倒完整提示。

两个场景均断言四步 attempt=1、lastError=null、没有 repair 请求。repair 必须从捕获的请求判断，压缩后的空 checkpoint 不等于从未修补。有通知分支还核对通知文本、key、实体快照来自冻结的 V1 输入。

初始 detail Embedding 另等目标 memory_index 与 index job 的 applied 终态，再断言恰好 1 次。环境批次完成不代表索引已完成。保留 command 注册、两 school plans、sharedActivityVersion=1、sharedClock=null、control_requests 为空等原 smoke 意图。

helper 单测：旧顶层 stage 拒绝；周 V0 结构／缺 key／重复 key 不通过；HTTP 数已达但 batch 未提交时仍等待；非成功终态和超时给可定位诊断。测试不是新增生产防御逻辑。

## 2. F5：在实际准备时冻结最新任务

### 2.1 pending 与“从未开始”分开

当前构造器会将 computing 恢复为 pending，prepare 失败也会回 pending。因此仅检查 status 会破坏旧输入／网页 checkpoint 的恢复语义。

在 `src/memory/types.ts` 的 IndexJob、MaintenanceJob 增加兼容字段：

```ts
startedAt?: string | null;
```

| 值和状态 | 含义 | 允许操作 |
| --- | --- | --- |
| pending，startedAt 显式 null | 新代码可证明未开始 | 可更新快照／合并旧索引 |
| 非 null | 已开始过 | 保留输入、身份、cutoff、checkpoint 恢复 |
| 字段缺失 | 旧任务，是否开始未知 | 保守沿原恢复路径，不推断为从未开始 |
| computing／ready | 已冻结计算或结果 | 不做本次预开始刷新 |

新建任务显式 null；第一次 dispatch 的同一事务先持久化 startedAt 和 computing，再发请求；retry／重启保留。维护任务还要求 result=null、无已应用单元，才符合未开始条件。此为已有 JSON 任务的兼容字段，不提升整体数据库版本。

### 2.2 深度整理流程

修改 `src/memory/maintenance.ts`，提取 `buildSnapshot(rows: MemoryCandidate[]): MemoryCandidate[]`，让首次创建与刷新共用依赖闭包算法。

1. 到期登记只排 expiry dirty、推进 nextMaintenanceAt；空闲未满足时不 makeJob、不 reserveDirty、不提前冻结完整输入。索引仍不受深度整理 15 分钟门禁限制。
2. 满足空闲再创建任务。若等待其他后台工作后才轮到它，dispatch 前再读取明确未开始任务的当前 selected owners，重建短期→long、learned→证据、detail 冲突等完整依赖闭包。
3. 在一个事务内释放旧 selected 的对应版本预留、保存新 snapshot/readSet、预留当前版本、写 computing／startedAt。沿用该未开始 job ID、createdAt 和队位。
4. incremental 模式 cutoff 取此次实际冻结时间；旧无 idle daily cycle 保持原 cycle cutoff，并按该 cutoff 重评资格，不能把固定批次扩大成滚动批次。
5. selected 全部已失效时结束空任务并释放预留，不发模型请求。请求开始后的变更仍由原 revision＋stateVersion 门禁处理；ready、失败恢复的 pending 均不刷新输入。

在 store 新增 `releaseDirtyVersion(owner: OwnerVersion): void`：仅释放仍对应该版本的 reserved 项，不能释放后来版本／其他任务的预留。读依赖不等于消费其独立 dirty；completeDirty 仍只消费对应 read version。重排保留原 queuedAt，不把刚处理完成的版本反复排入自整理循环。

### 2.3 索引合并与发请求前检查

`queueIndex` 公共签名保留。按 owner＋configSignature 合并**明确未开始**的 pending，同一 owner 多次正文更新只保留最新 revision 的待编码任务，旧 job 写 done/stale 小记录。computing／ready／started pending 不合并。

发请求前重新读取 owner：缺失、merged／discarded、revision 或签名已过时的未开始 job 直接 stale；合法当前 owner 必要时排新任务。纯 stateVersion 变化不重嵌入，现有 apply 层 revision／signature 门禁保留，用来处理发出请求后的更新。

公平性规则固定：合并继承该 owner 尚未获得后台槽的最早 createdAt；一旦旧任务已经获得槽，之后的新 revision 以新到达时间入队，不继承已服务的旧队位。跨索引／整理仍按既有 createdAt、id 排序，retryAt 未到的任务不挡已到期任务。

一次 `startOne` 最多清理 20 个不发请求的旧任务；还有工作时 `nextDeadline=now`，Host 让出事件循环后继续，不能返回 false 后丢掉后续期限。`backendRequests` 只计真实 prepare。这里的上限限制调度占用，不限制模型输入或业务候选。

### 2.4 验收

新增 `tests/memory-pending-refresh.test.ts` 与 `tests/memory-index-coalescing.test.ts`：

| 测试名 | 成功断言 |
| --- | --- |
| `idle_wait_does_not_freeze_old_snapshot` | t=0 startOne=false、job=0、dirty pending；t=5 分更新并重置空闲；t=20 分首次调用只含新版，1 次调用、1 次应用 |
| `unstarted_job_refreshes_dependency_closure` | 等待索引期间 selected 或依赖变化，dispatch 输入全为同次最新闭包；旧预留释放、新预留唯一 |
| `started_and_legacy_pending_keep_frozen_input` | retry、computing 重启、旧缺字段 pending 原 snapshot／cutoff／checkpoint 不变 |
| `post_dispatch_change_uses_existing_stale_gate` | 发出后更新则旧结果 stale；ready 重启不重请求；应用失败保持原 result 与单元进度 |
| `coalesced_index_embeds_only_latest_revision` | r1/r2/r3 请求前合并只编码 r3；stateVersion-only 变化不重编码且能应用 |
| `hot_owner_does_not_starve_waiting_owners` | A 服务前更新保持队位；服务后 A 新版本排 B/C 之后；整理与 retry 公平性不退化 |
| `stale_housekeeping_yields_and_reschedules` | 超过 20 个旧任务可续调度，计数无假请求，不遗留 reserved；空选择／prune／新版本 dirty 不被误标 done |
| `legacy_daily_cutoff_remains_fixed` | 旧 daily cutoff 与活动／睡眠／前台优先规则保持 |

升级前无法证明是否开始的旧 pending 可能保留一次旧成本，应如实记录。F4 补齐产生的新 revision 在 F5 之后可合并未开始索引，但不能以省请求为由改写已冻结任务。

## 3. F6-A：一次完整审核只读取一份快照

### 3.1 接口

新增 `src/dialogue/chat-window.ts` 放纯窗口选择；类型放 `src/dialogue/types.ts`：

```ts
type ChatEligibility = 'ordinary_narrative' | 'with_visible_inputs';
interface ChatWindowSnapshot {
  messages: readonly Message[];
  episodes: readonly ChatEpisode[];
}
export function recentFromSnapshot(
  snapshot: ChatWindowSnapshot,
  options: { eligibility: ChatEligibility; count: number;
    visibleIds: ReadonlySet<string> }
): ChatRecent;
```

`ChatEpisodes.recent(phase, at, count, visibleIds)` 保留现有签名，委托纯函数。`checkWindowConsistency` 一次读 messages／chat_episodes／turns 并建 Map；narrative 算一份窗口，其他四阶段复用 with_visible_inputs 的同一结果，不能把两种权限混成一份。仅本次调用复用，不做跨轮缓存。

### 3.2 等价规则与验收

活动消息不计普通段；段排名按有资格消息的最大真实时间，再按 openedAt 和 ID literal；段内沿用段序、receivedAt、同 turn 的 outboxSeq／ID 规则。保留显式 null 与字段缺失的区别，按配置 count 选最近 N **段并取全文**，不按每段条数截断。

完整检查仍检查所有原有 binding、未完成轮、任务／记忆来源、legacy warning、活动身份和 confirmed opening 特例。sourceIds 可能是 experience 或 self-web-read，不新增“所有来源都必须是 message”条件。

新增 `tests/chat-window-snapshot.test.ts`：两资格差异、不同 ISO 偏移同一时刻、同 turn 多 outbox、单段 40 条以上、活动排除；使用旧算法作独立 oracle，完整结果相等。一次 full audit 的 messages 与 chat_episodes 各仅一次全量读取／解码、turns 一次，两资格各算一次。全检仍为 O(N)，此步不宣称日常成本已与历史量无关。

## 4. F6-B：SQL 先筛选，保持真实时间排序

在 `src/storage.ts` 增加／替换具名查询；`src/dialogue/store.ts` 增加 `openChatEpisodes(): ChatEpisode[]`。新增接口：

```ts
unfinishedTurns(): TurnRecord[];
unseenIncomingMessages(): Message[]; // 含 open 和活动输入，供局部一致性检查
unreadActivityMessages(activityId: string): Message[];
messagesByIds(ids: readonly string[]): Message[];
messagesByTurn(turnId: string): Message[];
messagesByChatEpisode(episodeId: string): Message[];
messagesByActivity(activityId: string): Message[];
```

`unfinishedTurn()`、`unreadMessages()`、`outbox(turnId)` 原公共签名保留。messagesByIds 空数组返回空，参数分块；统一按旧 messages() 的 receivedAt epoch 稳定顺序返回。需要冻结数组原顺序的调用方显式按原 ID 序列取回，不依赖 IN 查询顺序。

| 查询 | 必须保留的现有语义 |
| --- | --- |
| unfinishedTurns／first | `!done && legacyDisposition !== 'superseded'`；合法 boolean 及旧版 null／缺失兼容；rowid 首条。SQL `<>` 不能误丢 null |
| outbox | 仅该 turn，按 seq，等值时 rowid；复用现有唯一 outbox_sequence 索引 |
| unseenIncoming | incoming、seenTurnId **显式 null**；`json_extract IS NULL` 同时匹配缺失，不能直接替代 |
| unreadMessages | 在上项基础上保留原 open 排除与活动条件；无 open 时旧谓词排除 batchId 缺失但保留 null；旧活动有普通 batch 的残留仍可读 |
| unreadActivityMessages | incoming、seen null、batch null、当前精确 activity ID；旧场普通批次不能混入 |
| 消息顺序 | SQL 先 ORDER BY rowid 取候选，JS 稳定按 Date.parse 排；禁止 ISO 字符串字典排序 |

替换 `ChatEpisodes.held/closeDue/nextDeadline/reconcile` 的全表过滤、scheduler 当前活动过滤、activity-context 精确活动读取。对已有 outbox／message_unread 索引先看 EXPLAIN QUERY PLAN；仅为实际热点增加表达式／partial index（turn、chatEpisode、activity、open chat）。此次不新增时间列回填，不把所有存储调用泛化为新框架。

新增 `tests/storage-queries.test.ts`，以旧 JS oracle 做完整数组差分：合法现代记录＋既有 legacy null／缺失，done／superseded、seen、open/pending/batch、当前／旧活动、多个 turn、相同时刻插入序、混 Z/+08:00/-05:00。目标是现有语义等价，不扩展任意非法 JSON 类型的防御测试。

## 5. F6-C：日常输入检查当前工作集

### 5.1 门禁拆分

只有 F1、F6-A/B 与下述调用边界全部通过，才替换每输入全检。保留 `checkWindowConsistency` 为 full audit；新增 `src/dialogue/active-consistency.ts`：

```ts
interface ActiveWindowScope {
  touchedMessageIds: readonly string[];
  requiredMessageIds: readonly string[]; // 冻结/输入等，缺失仍报错
  sourceIds: readonly string[]; // 仅实际消息引用适用消息归属规则
  touchedEpisodeIds: readonly string[];
}
export function checkActiveWindowConsistency(
  storage: Storage,
  options: { idleMinutes: number; recentSegments: number },
  scope: ActiveWindowScope
): WindowConsistencyReport;
```

提取两者共用的 message／binding／activity 判定 helper，避免规则分叉。scope 只是一轮调用参数，不是持久“已检查”缓存。

- start、resume、升级检查／应用后、显式诊断继续 full audit。首次 acceptInput 若早于 start，也必须先全检；旧 dialogue V1 路径暂不做此局部优化。
- 每次输入前检查 runtime／版本／idle 参数、所有 open chat、所有 unfinished turns 及其绑定／outbox／冻结 IDs／post sources、pending task 引用、当前活动全文、所有 unseen incoming。由 SQL 条件查询和批量 ID 取回，无 unfinished 数量截断。
- 输入事务完成前校验本次新增／转移／关段消息，错误仍能回滚。重复平台输入沿原幂等协议处理。
- 不为每条输入重建 recent 两窗口。先前全检已建立基础；常规追加／首次可见维持它，每次使用 recent／visible／activity selection 时检查实际消费集合。

### 5.2 必须接入的正常写入和消费边界

| 边界 | 文件 | 校验范围 |
| --- | --- | --- |
| 输入创建／归属变动 | host/input、dialogue/chat-episodes | touched 消息／段 |
| 冻结新轮、visible／reconsider | app.ts:runTurn、recovery.ts:freezeTurn | required IDs、binding |
| 活动迁移／活动全文冻结与恢复 | host/shared、dialogue/activity-context、recovery | 精确活动 ID 和 required IDs |
| 输出确认／hold 释放 | recovery、dialogue/chat-episodes | 输出消息／绑定段／confirmed opening 特例 |
| task／post result 新引用 | memory/organize.ts:applyTasks、recovery.ts:finishPostprocessing | 新 task IDs、结果中实际消息 sourceIds |
| memory／details／learned 来源新引用 | memory/lifecycle、memory/maintenance 的正式提交路径 | 本次新保护的实际消息；非消息来源沿原业务规则 |
| recent／lookup 消费 | dialogue/chat-episodes、memory/retrieval | 本次选择消息及对应段 |

实现者在交付日志中给出这些边界的实际函数映射；未接入的生产路径保留 full audit fallback，不允许先删全检再留后续 TODO。

旧 orphan 一旦被新 task／冻结／记忆来源重新引用，就从历史 warning 变为 protected，必须按原规则阻挡。只检查新 incoming 不足以等价。明确 null 不能当字段缺失，现代轮缺关联不能降为远古 warning。

还有一个低频例外：recent 会过滤缺 chat ID 的消息，仅检查返回列表不能证明旧 warning 永远安全。删除／重绑普通段、降低 seen 可见资格、变更 recentSegments 等可能破坏原“两个窗口均有 N 个更新段”的证据时，在该变更事务边界保留 full audit；未证明保持该证据的变化不走快路径。F1 reconcile 迁空段属于此类，需要覆盖，不硬追求零全检。外部维护／升级后的重新进入也全检，不引入监视外部数据库的缓存协议。

### 5.3 验收与性能合同

新增 `tests/chat-active-consistency.test.ts`、`tests/chat-input-cost.test.ts`：

- full 与 active 对普通追加、已确认 opening、现代／legacy unfinished 的阻挡结论一致。
- 旧 orphan 原本可警告，后被 pending task、frozen visible／reconsider、post result、memory／detail／learned 来源引用时，消费／写入边界仍阻挡。
- 所有 unfinished 均检查；缺冻结消息、错活动身份、失效 hold 均保留原错误；经验／网页来源不误报缺消息。
- 迁空／重绑段触发低频 full fallback，不能把原 warning 静默变成错误可见资料；普通追加不触发此 fallback。
- 固定活跃工作集，将已完成且无关历史扩为 1k／10k／50k 时，普通 acceptInput 不调用 `messages()` 或 `all(messages/turns/chat_episodes)` 全量解码，返回／解码 JSON 行数与查询次数相同。活跃全文、未读、冻结、待处理引用本身增长时允许对应增长，不截断内容。

上述是数据量和调用次数门槛，耗时记录中位数，不设跨机器毫秒阈值。SQL 汇总／元数据可能仍扫描历史，要提供 QUERY PLAN，不能把“JS 解码行数受限”冒称总耗时 O(1)。

### 5.4 学校资格的一次调度复用

在 F2/F3 定稿后，notices 新增 `createSchoolNoticeEvaluationContext(storage): SchoolNoticeEvaluationContext`，包含本次 knownByEntity、itemsById、instancesById 三个只读 Map。四个通知入口可增加第四个可选 `context`；未传时本函数构造，scheduler 同一次 collectReady 或 nextDeadline 内只构造一份。

context **不缓存 notices 状态集合**；release 保存后，select 读取更新后的状态。不能跨 await、跨一轮持有它，不能从客观 Map 补个人知识。新增 `tests/school-notice-evaluation.test.ts`：K 个提醒多个快照时 school_knowledge 每次调度最多全读一次，发布后即能选中，结果与逐项资格计算一致。该优化不替代 F2 的完整 V1 回归。

## 6. F7：普通状态只显示当前额度与汇总

### 6.1 接口与展示

在 `src/web/types.ts` 定义 `WebOwnerRef=Pick<ModelRunRef,'ownerType'|'ownerId'>`；新增下列结构：

```ts
interface WebStatusSummary {
  enabled: boolean;
  limits: WebSearchCounters;
  totals: { sessions: number; owners: number; successReads: number;
    failures: number; cacheHits: number; providerSearchCalls: number;
    providerReadCalls: number };
  currentOwners: Array<WebOwnerRef & { stageCount: number;
    stages: Array<{ runId: string; stageKey: string; taskName: string;
      counters: WebSearchCounters; metrics: WebSessionMetrics }>;
    omittedStages: number }>;
  omittedOwners: number;
}
```

Store 新增 `statusSummary(currentOwners: readonly WebOwnerRef[]): Omit<WebStatusSummary,'enabled'|'limits'>`；Service 新增同名方法补 enabled／limits。原 `operationalStatus` 留作完整诊断，普通 Host 不再调用它。不需要新用户命令或新增统计表。

Host 提供实际未完成普通轮 owner，以及当前执行的 environment step 和 maintenance prepare owner。环境执行不写普通 TurnRecord，故 Host 在 `ready.environmentStepId` 的 `app.runTurn` 调用前记录进程内 `currentEnvironmentStepId`，finally 清除；不能从 `unfinishedTurn()` 猜出它。maintenance 增加只读 `currentWebOwner(): WebOwnerRef | null`，与 active work 同生命周期；纯 Embedding index 工作返回 null，因为它没有网页阶段会话。不要把所有非空历史 checkpoint 当在途。

展示最多 3 个 current owner，每 owner 最多 6 个最新阶段（rowid 倒序，展示可按原 ordinal 排回）；超出给 omitted 数。额度按**每会话** counters 对 limits 显示，owner 累计不能解释成剩余额度。

Host 渲染中文短句，不 stringify 全诊断。网页部分上限 2,048 字符，显示 ID／阶段名称限定长度、数值用有限宽度格式；完整 ID 和精确计数仍在诊断接口。此限制只作用状态文本，不是模型输入预算。

### 6.2 SQL 与验收

totals 用 SQL COUNT／SUM、owner 字段组合分组完成，旧 metrics 缺项按现有兼容语义为 0。current stages 用 owner 条件＋LIMIT 投影 ref／counters／metrics；不读 body、operations 或 checkpoint。SQL 汇总可能扫描历史元数据，本次不引入需要维护的持久计数缓存。

新增 `tests/web-status.test.ts`，扩原 web-host／web-store 回归：

1. 同样零搜索的 10／100／1,000 轮、每轮四 session，totals.sessions=4*N；数组上限固定，固定其他字段时 10→1000 网页展示长度增长不超过 64 字符，网页部分始终 ≤2,048。
2. search disabled 仍正确显示关闭与历史汇总；当前会话额度、失败、缓存及 provider 次数精确。
3. 每次 status 前后 raw session／operation／counter／checkpoint 完全不变；不通过先取全历史再 slice 字符串达标。
4. 两次成功／一次失败的读取重启后额度相同；已确认子步骤不重复调用 provider；同 stage identity 不新分额度。原恢复测试继续通过。

## 7. 性能证据与范围记录

新增 `scripts/bench-chat-status.cjs`（使用 build 后 lib 与临时合成库），输出参数 `--output <目录>`，仅记录 Node／平台／样本规模、解码与调用计数、QUERY PLAN、状态字符数和多次计时中位数。包含 full audit、固定工作集 active input、状态三组；每组一轮预热＋至少 5 次采样，排除建库时间。不得读正式故事库。

历史审核的 1k／10k／50k 输入检查约 18／173／904 ms，以及 10／100／1000 轮状态约 1.2 万／12.6 万／126.6 万字符，是旧合成基线，不是本方案已达指标。实现后同环境重新跑，保存原始 JSON；硬门槛用上述工作量／输出增长断言。旧 evidence 文件保留审核历史，不修改其断言来伪装修复。

最终记录区分：单元／集成模拟、真实 Koishi 离线 smoke、合成性能、真实模型、正式 QQ／正式库。前四项通过不代表后两项已验证；本轮计划不要求启用在线模型或改正式数据。
