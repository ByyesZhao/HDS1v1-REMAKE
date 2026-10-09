# 共同活动 V0.3 实施细化

日期：2026-10-07；交付更新：2026-10-08。状态：任务1～7及第十轮正文／维护修正已实施，正式库已备份升级到共同版本1，真实模型多轮语义验收执行中。当前证据见[第十轮记录](REVIEW10_FIX_LOG_20261008.md)。实施起点为`eaf0b53`；原设计基线`880b6ad`保留为历史。原始逐任务证据见[实施日志](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md)。

设计依据：[共同活动方案](SHARED_ACTIVITY_V0.3_PROPOSAL_20261007.md)及已接受的[第八轮回应](../../dsh-review/CODEX_REBUTTAL_SHARED_ACTIVITY_20261007.md)、[第九轮回应](../../dsh-review/CODEX_REBUTTAL_SHARED_ACTIVITY_PLAN_20261007.md)。第九轮接受项已经回填到本文和[执行计划](SHARED_ACTIVITY_V0.3_EXECUTION_PLAN_20261007.md)，不需要实施者再从回应拼接规则。本文固定字段、合同和提交时序；方案保留决策理由。已实施的记忆 V0.3、搜索、来源约束和冻结恢复继续有效。

## 1. 范围与实现路径

复用 `SerialHost → Scheduler → generateTurn → freezeTurn → sendFrozen → finishPostprocessing`。共同活动使用同一串行故事槽；不增加独立执行器、即时反应轮、前置自主生活轮、已读回执或动作语法解析器。

新增一个 `src/host/shared.ts`，集中维护活动身份、计时和唯一节点。其余在现有输入、调度、模型合同、生成及恢复模块内接入，不顺带重构记忆／搜索系统。所有时间仍为 ISO 时刻，比较使用既有 `milliseconds`；配置时区沿用现有设置。

固定行为：普通私聊合批 15 秒；共同活动静默窗口默认 60 秒；首节点立即；普通共同活动以约 10 个成功提交轮自然收尾为提示词软目标，默认最多 20 轮为程序硬上限；每次成功前台故事完成后重新抽样安排 150～210 分钟自主间隔。后台环境、维护和工具调用不单独计轮或重置自主时间。

### 1.1 实施参考顺序

直接依据是本文与共同活动执行计划：先读规则，再按任务1～7落地。共同活动方案用于理解产品决策；审核与回应是历史依据，不是另一套执行入口。

现有 `src/` 及根目录 `REMAKE_V0.2*.md` 是已实现基线；其中本次明确替代的旧计时、调度、自主或睡眠行为按本文改造，其他行为继续保留。涉及记忆时参照[记忆细化](../memory-v0.3/MEMORY_V0.3_IMPLEMENTATION_20261007.md)／[记忆计划](../memory-v0.3/MEMORY_V0.3_EXECUTION_PLAN_20261007.md)，涉及工具调用时参照[搜索设计](../web-search/WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)／[搜索计划](../web-search/WEB_SEARCH_EXECUTION_PLAN_20261007.md)，不重新执行这两套已交付任务。

## 2. 共享类型、配置与存储

新增／扩展类型统一放在 `src/types.ts`；模型 JSON 仍由 `src/model/contracts.ts` 定义，不让模型填写程序字段。

| 类型／位置 | 固定字段及含义 |
| --- | --- |
| `SharedOutline` | `goal: string`、`openThreads: string[]`、`endingCondition: string`；未来活动走向，不是已发生经历。 |
| `Scene.shared` | `activityId: string`、既有 `title/progress/lastPublicNode`、`completedSteps: number`、`maxSteps: number`、`idleSeconds: number`、`outline: SharedOutline \| null`、`nextStepAt: string \| null`。进入时计数 0、outline null；结束后整个 shared 为 null。 |
| `SharedClock` | `activityId: string`、`mode: 'shared_online' \| 'shared_offline'`、`status: 'active' \| 'ended'`、`startedAt: string`、`lastInputAt/lastOutputAt/lastSilentCompletedAt: string \| null`。startedAt 使用开始标志发送确认时间。 |
| `Runtime` | `sharedActivityVersion: 1 \| null`、`sharedClock: SharedClock \| null`；保留原有所有字段。旧存储缺版本按 null 识别，不能被新默认值遮蔽。新库初始化为 1/null。 |
| `Message` | 可选 `sharedActivityId?: string \| null`，旧行缺失视为 null。仅记录活动关联；不改变 incoming 原文或行为主体。 |
| `ControlRequest` | `id: string`、`activityId: string \| null`、`receivedAt: string`、`platformMessageIds: string[]`、`status: 'pending' \| 'consumed' \| 'cancelled'`、`consumedTurnId: string \| null`。活动外记录 cancelled，activityId null；不能以后生效。 |
| `SharedTurnMeta` | `activityId: string`、`stepNumber/maxSteps/idleSeconds: number`、`advanceReason: 'initial' \| 'manual' \| 'automatic' \| 'appointment'`、`phase: 'opening' \| 'ongoing' \| 'wrap_up' \| 'final'`、`controlRequestIds: string[]`、`sceneTaskId: string`、`allowSimulatedUserActions: boolean`。 |
| `TurnRequest/TurnRecord` | 增加 `sharedMeta?: SharedTurnMeta \| null`；普通轮为 null。TurnRecord 的该字段在 done 后保留，用于审计及恢复；不能随 frozenResult 清空。 |
| `TurnRecord` 抽样留存 | `autonomousIntervalMinutes?: number \| null`；第一次 freeze 时同时保存候选抽样，缺失表示尚未冻结过抽样。discardUnattempted 也保留，重生成不得再抽；done 后保留审计。 |
| `ScheduledTask` | 可选 `sharedActivityId?: string`，程序生成的 scene_step 必填。一个活动只使用任务 ID `scene:${activityId}`。 |
| `TurnCandidate` | 继续使用 `autonomousIntervalMinutes`；由每个实际运行角色主叙事的前台轮填写一次，其他轮为 null。开始所需活动 ID 及配置快照保存于 nextState.shared。 |

`src/storage.ts` 新增 JSON 表 `control_requests`，接入现有读写和事务；不混入 messages、近期原文、未读、记忆来源或网页来源。只需现有 JSON 存储能力，不另建消息队列系统。

`src/settings.ts`、`src/config.ts` 增加：

| 配置 | 默认／校验 | 生效方式 |
| --- | --- | --- |
| `sharedIdleSeconds` | 60；正整数 | 开始准备轮冻结到活动的 idleSeconds。 |
| `sharedMaxSteps` | 20；1～20 的整数 | 开始准备轮冻结到活动的 maxSteps；不能配置超过 20。 |

普通 15 秒规则不变。运行中调整配置不改变已开始活动的快照；下一活动使用新值。无新增字符／token 预算，无模型、思考强度或搜索额度变更。

## 3. 活动身份和公开边界

区分“公开标志确认后接收哪类输入”和“段 B 已提交哪些故事事实”。这是输入路由所需的短暂阶段，不新增第二套故事状态。

1. 普通准备轮的个人导演合法确认 start 后，生成 activityId 并冻结活动字段；不能因收到推进命令自动 start。
2. `【共同活动开始】` 是准备轮第一个 outbox 项。确认发送的事务内，建立 Runtime.sharedClock active。此后收到的输入／推进命令立即绑定该活动，即使该轮记忆后处理尚未完成。故事仍等段 B 完成后才可选首节点。
3. 开始标志尚未确认时，普通内容按15秒路由；准备轮段 B 将未消费的普通内容转交该活动。全文精确的推进命令仍按活动外控制处理，保存 cancelled 记录并返回“当前没有共同活动”，不写 messages，也不转成交给首节点的请求。已经本轮看到的输入不能再次交付。
4. `【共同活动结束】` 必须是结束轮最后一个 outbox 项。确认发送的事务内把对应 sharedClock 标为 ended；此后输入按普通私聊路由，推进命令返回活动外提示。
5. 结束段 B 提交后清除对应 sharedClock；尚未处理的该活动输入转回普通合批。结束标志已确认但段 B 未完成时，恢复仍必须完成同一结束轮，不能另开故事。

输入路由优先使用已确认标志对应的 sharedClock；没有这种过渡时使用已经提交且身份合法的 Scene.shared。ended 明确覆盖尚未提交的旧 shared 模式。未确认的冻结 start 不能提前作为活动入口。

所有回调按 activityId 比对；不能让旧活动的结束、请求或节点改动下一活动。发送确认与 clock 记录在同一 SQLite 事务完成；重放已确认项不会重复执行边界转换。

## 4. 输入分类与选轮快照

### 4.1 控制指令

绑定目标私聊入口仍先完成身份检查。“全文”是按原顺序拼接所有text元素后去除首尾空白的文字投影；非text输入沿用既有未支持口径。该投影恰为 `【推进】` 才进入控制分支；正文包含它、`【动作：推进】` 或混合内容都按普通原文保存。

有效命令创建 pending ControlRequest 并唤醒 SerialHost；不更新静默锚点，不创建普通批次。不在活动中则保存 cancelled 审计记录，返回固定系统提示“当前没有共同活动”，不因这条指令创建故事触发；入口wake仍可处理独立到期工作（维护applyOneReady本身不调用LLM，之后startOne可启动准备）；该提示不写角色消息／记忆，不重置活动或自主计时。入口采用返回值告知 index.ts 是否发送系统提示，避免绕过既有角色 outbox 伪装发言。

准备轮已生成 start 候选但开始标志尚未确认，仍属于活动外控制；确认后才绑定活动。这项命令分类先于普通内容合批，不把 cancelled 控制在段 B 当成待转交文字。

选轮时收集当前 activityId 的全部 pending 请求 ID，冻结到 sharedMeta；同一次选择只推进一轮。选轮以后到达的请求保留 pending。只有段 B 成功时将选中的 ID 标为 consumed；失败、暂停、发送恢复均不提前消费。结束段 B 将该活动剩余 pending 标为 cancelled。

### 4.2 普通输入和动作

共同输入立即写 messages，`sharedActivityId=当前活动`、`batchId=null`、`seenTurnId=null`，更新 lastInputAt；不进入普通 openBatch/pendingBatchIds。共同选轮查询限定为当前活动、incoming、batchId null、未看；不能把旧活动遗留或普通 openBatch 内容混进来。

普通模式保持既有合批。开始转交／结束重组时清理相应普通批次引用，并保留每条原文、消息 ID、平台 ID、接收时间与已看标记。sharedActivityId 可保留为出处；普通入轮由批次及普通待看规则判断，不能仅因该关联字段非 null 就永久排除。

线下 `【动作：把水杯递给她】` 是用户行为／尝试，括号外普通文字是发言；混合消息按原顺序交给两个共同模型。线上同样文字结合游戏／虚拟活动理解。没有新增 parser。真实输入不自动证明角色自愿配合，输出主体仍由发送方和 outbox 种类区分。

### 4.3 本轮固定项

Scheduler 选择时固定 inputMessageIds、taskIds、controlRequestIds 和 SharedTurnMeta，并在任何模型调用前保存 TurnRecord。后续输入只落库，不能追加到正在生成的轮。

`stepNumber=completedSteps+1`；不得选择大于 maxSteps 的轮。推进原因按 initial → manual → appointment → automatic 选择展示值；同到期原因仍合并 taskIds。普通输入等待窗口不是另一个推进原因。各类共同轮沿用 `scene_step` 触发种类，sharedMeta 区分手动等原因；不添加 autonomous。

`remainingSteps=maxSteps-stepNumber`。phase：剩余为 0 为 final；剩余 1～3 为 wrap_up；否则第 1 轮为 opening，其余 ongoing。默认 17～19 进入程序 wrap_up、20 终结；配置较小时提前进入相同剩余轮数阶段。这是硬上限阶段，不要求普通活动等到第17轮才开始叙事收束。

2026-10-08用户确认的软节奏规则：共同主叙事与共同个人导演使用同一段提示，普通活动以约10轮自然收尾为目标，目标前2～3轮（约第7～8轮）开始收束，即使phase仍为ongoing。约5轮或更多展开只是一般建议，没有最少轮数要求，也不在第10轮强制end；已完成、用户要求结束或角色合理生活需要均可更早结束，复杂活动可更长。已确认内容与真实经过时间优先，不能为软目标改换目标、谎称完成或不合理压缩时长。20硬上限与既有收尾正文/end合同不变，不新增targetSteps配置或更改SharedTurnMeta。

`maxSteps<10`时在实际冻结上限内组织短活动；`maxSteps=1`的首节点同时为final，同一非空公开正文可兼顾开场与收尾，不要求两段正文。`maxSteps=2/3`的首节点为wrap_up，最后一轮才为final。约10轮是模型节奏指导，不承诺统计平均值恰为10。

静默代写权限固定为：合法共同轮，且选轮时双方没有新输入。现串行结构不允许角色在两轮之间独立发消息，旧轮角色输出已属于旧轮，故实际条件仍为inputMessageIds为空；已看消息的延后回复复议不算新输入，不预测本轮个人导演之后是否开口。真实新输入存在时权限为false；生成后新输入留下一轮。主叙事和个人导演收到同一sharedMeta。历史字段名allowSimulatedUserActions保留，不新增迁移；它同时选择本轮主叙事的行动授权分支。

程序在narrativeTask创建时用已冻结权限选择互斥提示词：true只发送“允许代写双方在已确认活动内行动”的静默分支；false只发送“禁止新增用户动作”的有输入分支。共享生活补齐、走向及公开记忆规则共用，不把两种相反授权同时交给模型判断。格式修补、细节查询续调用及未发送恢复沿用同一分支。

## 5. 唯一节点、60 秒及调度让位

### 5.1 单一计算入口

`src/host/shared.ts` 提供以下同步接口，均不调用模型或网络：

```ts
sharedRoutingActivity(storage: Storage): { activityId: string; mode: 'shared_online' | 'shared_offline' } | null
sharedDeadline(shared: NonNullable<Scene['shared']>, clock: SharedClock): string
refreshSharedStep(storage: Storage, now: string): void
selectSharedMeta(storage: Storage, now: string, inputMessageIds: string[], taskIds: string[]): SharedTurnMeta | null
recordSharedOutput(storage: Storage, turn: TurnRecord, item: OutboxItem, confirmedAt: string): void
finishSharedTurn(storage: Storage, turn: TurnRecord, completedAt: string): void
```

前三者供输入及 Scheduler 使用；recordSharedOutput 由发送确认事务调用；finishSharedTurn 由段 B 事务调用。所有写入辅助函数由调用方包在既有事务中，不自建嵌套事务；Scheduler 独立刷新时提供一个短事务。selectSharedMeta 固定权限、轮号、理由和关联 ID，不消费数据。finishSharedTurn 只管理活动计数、clock、控制记录及 scene_step，不重新调用模型或抽随机数。

首节点 `completedSteps=0` 时立即到期，截止为 startedAt；准备轮段 B 后可直接选。其后：

```text
anchor = max(startedAt, lastInputAt, lastOutputAt, lastSilentCompletedAt 中非空时刻)
nextStepAt = anchor + idleSeconds
```

startedAt 仅为初始兜底锚点。开始标志后的普通准备轮输出不更新共享节点锚点，段B后的首节点仍立即。角色侧每个共同轮已确认 narration/text/action/sticker 更新 lastOutputAt，取最新确认；无可见输出的共同轮在段 B 更新 lastSilentCompletedAt。后台消息、错误、控制指令、日志和状态不更新锚点。

Runtime 的真实锚点由输入／发送更新；`Scene.shared.nextStepAt` 是同一公式的程序投影，`scene:${activityId}` 的 at 必须与它相同。refreshSharedStep 集中刷新这两处，不接受模型时间。正式 shared 尚未建立时只保存 clock，开始段 B 建立后再投影；结束标志确认后不再刷新旧活动。

即使旧轮未完成也允许记下新锚点／更新投影，但 Scheduler 的未完成轮门禁始终优先，不能据此开启第二轮。旧候选不得用冻结的 nextStepAt 覆盖最新锚点，段 B 最后统一刷新。全活动只一条 scene_step 记录，下一窗口复用同一个任务 ID；已选中的 ID保存在 TurnRecord，更新其时间不改变该轮选择。

### 5.2 选择优先级

SerialHost 先恢复未完成轮；否则 Scheduler 按以下顺序选择：

1. 可运行前台：共同首节点、手动请求、共同截止、到期具体预约；或普通可处理消息、预约、待看／复议、起床。共同到期原因合并为一个节点。
2. 无可运行前台时，到期世界／学校更新，保留既有 world 在 school 前的顺序。
3. 无前台待办、无合法共同活动、无普通 openBatch/pendingBatch 时，清醒且到期的自主轮。
4. 无以上可运行工作时，沿用记忆维护准备槽及“应用一个单元后让位”的既有规则。

已开始的模型任务仍串行完成，不中断冻结输出。只改尚未开始工作的选择次序；后台维护异步准备继续使用已有机制。

共同 check_messages 不单独绕过窗口：到期后等下一合法共同节点合并交付，不能在 nextDeadline 中以过期检查任务反复立即唤醒。到期具体 appointment 可以提前触发共同协调，计同一轮，不能直接覆盖场景或另开活动。未来预约不长期抑制自主轮。

nextDeadline 和 collectReady 必须共用上述资格判断：被 shared/openBatch/前台待办抑制的自主截止、活动中的旧 sleepAt/wakeAt、等待下一节点的复议任务，不再贡献过期的立即截止。普通睡眠暂存、不可读消息门禁作用于开始前；成功开始后清醒参与，段B转交的未读在首节点可见且使代写权限为false。普通待看恢复仍有效；暂存输入本身不一直阻止正常私人生活。

nextWorldAt/nextSchoolAt 持续参与 nextDeadline，不被共同等待排除。每次串行空闲判定，无可运行前台就可处理到期环境；连续存在手动／预约等可运行前台时，环境让位到首次出现可用空档，不把活动结束设为唯一入口，也不保证固定最长延迟。20轮限制故事提交次数，不能换算成20×60秒的墙钟时长。

例如最后输出22:31:30确认，共同节点22:32:30，世界更新22:31:40：无其他可运行前台时定时器先选22:31:40并运行world。环境轮不改轮数、活动锚点、共同／自主截止及narratedUntil。环境模型已开始后才收到手动推进，仍等它完成再选前台，不在本次新增中断或并行环境执行器。

重启先完成旧轮，再最多选一个当前到期节点；不按离线时长补跑。后处理超过 60 秒时也只开一轮；生成中收到新消息按最新锚点重算，有 pending 手动请求则直接选。

## 6. 模型合同与叙事职责

共同主叙事结果保留普通 narrative 字段、publicNarration、progress，删除可写 nextStepAt；新增必填 `outline: SharedOutline`、`simulatedUserActions: string[]`。每轮返回当前走向；stepNumber=1必须非空公开开场，即使phase已为wrap_up/final；final必须非空公开收尾。outline按下列阶段规则处理：

| 情况 | openThreads规则 | 程序／模型责任 |
| --- | --- | --- |
| 首节点旧outline=null | 建立走向；若首节点已是final则列表为空 | 不对空旧走向做包含校验，兼容较小maxSteps。 |
| opening/ongoing且已有outline | 可保留、解决或建立必要线索 | 围绕已确认活动，不每轮更换目标。 |
| wrap_up且已有outline | 仅保留或删除旧条目，不新增；保留项使用原文本 | 程序以trim及连续空白折叠作匹配，匹配后保存旧原文；新列表每项仍须属于旧字符串集合，不作语义匹配、不恢复已删条目，不增加线索ID系统；进展写progress/publicNarration。 |
| final | 返回必填outline，但openThreads为空，不新增走向项 | 程序校验空列表；goal/endingCondition保留为活动说明，公开收尾与个人导演end仍必需。 |

goal/endingCondition建立后原则上沿用。确需因真实新输入或明确场景变化调整时要有叙事依据，不能凭静默代写持续改变活动目标；这项语义边界由提示词与真实多轮验收落实，不使用字符串相等冒充含义审核。晚到的新要求可协调留到之后，不绕过轮数上限。

删除线索或final空列表表示本次活动不再挂起它，不自动证明事项已完成。尚未解决、准备下次继续的内容，必须在公开收尾及个人导演后续意图中说明，仍可合理提前结束。

simulatedUserActions 是本轮代写用户行为的显式清单，不是模拟用户消息或记忆新类型。程序校验：权限 false 时清单必须空；清单每个非空文本须原样出现在 publicNarration 中。模型正文不带外层 `【】`，既有发送格式统一包裹。程序不能仅靠这项字符串检查证明散文没有漏报代写，提示词仍约束全部代写公开；不增加语义审计模型。

共同个人导演接收相同 phase/remainingSteps/outline/publicNarration/输入，决定角色接下来的自愿行为、情绪及是否发言。静默分支已公开代写的角色活动动作是本轮经历，不回头重选或否定；有输入分支的角色自愿配合仍由个人导演决定。final 合同要求 `sharedChange.action='end'`；非final可合理提前end，但必须已有本轮非空publicNarration。个人导演不能重写主叙事；空旁白时格式修补可暂不end，用nextPlan安排下一轮公开收尾。持续不合格沿用暂停，不发结束标志、不计数、不消费控制。角色允许 reply none/later，表达按既有意图调用，不能强制台词。scene_step 由程序独占：个人模型不得 create/update/cancel 这种任务；普通预约和检查合同继续使用。

两个合同工厂及 directors 包装函数增加末尾可选 `sharedMeta?: SharedTurnMeta | null` 参数；普通调用兼容原签名，共同调用必传。narrativeTask/runNarrative再在其后追加 `previousOutline?: SharedOutline | null`，app从本轮正式状态传入旧outline，供wrap_up集合校验；个人合同无需previousOutline；personalTask/runPersonal在sharedMeta后另追加publicNarration?: string | null，由app传同一份本轮公开正文，供end校验。轮号、activityId、权限、配置快照不属于模型输出字段。格式不合格继续原任务最多两次修补、同模型／思考强度；仍不合格保留报错／暂停，不自行清场或生成第 21 轮。

提示词固定：

- 先补齐 `[narratedUntil, at]`，不能跳到未来或把一分钟写成三小时；可以没有新经历。
- 真实用户发言和 `【动作：…】` 优先。静默分支允许双方既有活动内行动选择及客观结果，所有代写公开；不替双方新增台词、心理、新长期承诺、活动外重大选择或重大关系决定。simulatedUserActions仍只列用户动作，不收角色动作。
- 代写只延续已确认活动，不能把本轮表现或此前代写归纳成用户新增的稳定性格、能力、偏好或关系设定。沿用用户真实提供的背景及已知习惯；可描述本次具体行动和结果，不据此声称用户“一向擅长／总是喜欢／已经形成新关系”。角色可对本次表现产生感受，不等于修改用户固定属性。
- 有输入分支主叙事不能代替个人导演决定角色是否配合，禁止新增用户动作同时约束publicNarration与experiences，不仅是空清单。静默分支可实现双方活动动作，但角色情绪、台词和后续意图仍留给个人导演。收尾可以暂停、约下次继续，但本次活动有合理结束过程和结果。
- outline、计划和未来预约是意图，不送作已发生的记忆依据；每轮进展不要求必须出现角色台词。
- 已公开代写是共享模拟经历，不推断现实用户做过同样的事或改变真实背景。用户随后纠正时，公开澄清／按提出的剧情修正继续；保留既有发送历史。

不增加“一轮最多一两个动作”的数量配额，不笼统禁止活动内关键行动选择或合理提前完成；代写边界依活动范围、已知事实、实际经过时间和上述设定约束判断。

所有阶段继续各自搜索会话与 20/40 额度；普通 narrative 仍不得接触本轮未看消息正文、派生检索或搜索查询。共同 narrative 可以读本次固定的真实输入。搜索不足、接口超限仍按已确认方案处理，无自动裁历史。

## 7. 生成、发送及段 B 顺序

### 7.1 生成和冻结

1. 按 entryMode 与合法身份判断普通睡眠／接收门禁；合法共同模式视为清醒参与。
2. 主叙事补到 at，更新候选 narratedUntil、场景、体力及活动走向；普通未看输入继续隔离。
3. 个人导演反应、安排任务／作息、决定 start/end；有意图才表达；保持现有表情策略。
4. 实际运行了角色 narrative 的前台轮抽一次 autonomousMinutes，写候选；环境／无 narrative 控制轮写 null。
5. start 生成活动身份、配置快照；共同轮保留已选的 sharedMeta。候选生成期间不消费控制请求或加正式轮数。
6. outbox 顺序：开始标志（如有）→公开剧情→表达／动作及表情→结束标志（如有）。结束标志不能早于最后一个表情。冻结后沿用原序号和发送恢复。

共同选轮号与静默权限在未尝试稿重生成时仍保留；at 可按既有恢复规则更新，不能把新输入塞进该轮。首次 freeze 同时将 autonomousIntervalMinutes 留在 TurnRecord，discardUnattempted 不清此字段，重新生成时复用；普通前台轮也如此。generateTurn 增加末尾可选 `retainedInterval?: number | null` 参数，execute 从 TurnRecord 传入；尚未留存才抽样，实际没有 narrative 的轮仍令候选为 null。已冻结并尝试发送后，故事候选、活动 ID、计数、抽样及 outbox 固定。尚未冻结的失败重跑可以重新生成，但只在最终冻结稿保存一次有效抽样。

### 7.2 发送确认

sendFrozen 在既有确认事务内保存 outgoing Message（带活动关联），调用 recordSharedOutput，更新下一项延迟及 outputComplete。已确认项跳过；失败未确认不能当作共享公开事实。普通系统错误提示不走此回调。

开始／结束标志的身份与类型由冻结结果和 outbox 位置判断，不按任意旁白内容的关键词触发；不能让一段剧情恰好包含“共同活动结束”就改变入口。

### 7.3 段 B 单次提交

继续先取得／保存记忆整理结果，再在既有事务内执行以下顺序：

1. 重读 TurnRecord，done 则直接返回。
2. 读取最新 Runtime；应用合法来源的记忆和经历、候选角色状态、普通任务变更及本轮 visibleMessageIds 已看标记。
3. finishSharedTurn：共同轮计数设置为已固定的 stepNumber（相当于只增一次）；消费选中的控制 ID。开始轮建立 shared、转交未消费输入；结束轮撤销唯一节点、取消该活动剩余请求、转回未处理消息。结束轮的最终计数留在 TurnRecord.sharedMeta，不另建全活动历史表。
4. 共同继续时采用最新 clock 重算节点；无输出轮以 completedAt 写补充锚点。不得把旧候选 Runtime 或 nextStepAt 覆盖新输入／请求。
5. 从 storage 重读已经过 finishSharedTurn 的角色状态，再判睡眠和写自主字段；清醒且 interval 非空则 `nextAutonomousAt=completedAt+interval`，睡眠为 null。不能再次整份写回旧 c.nextState 而覆盖新计数／截止；不恢复旧自主截止，不累加延期。
6. 再次重读最新 Runtime，仅合并本轮批次、概率及环境截止等本轮负责字段；保留辅助函数刚写的 clock 和转交批次，不回写第2步的旧整份对象。标 turn.done/completedAt，清 frozenResult。事务异常全部回滚。

开始转交与结束重组均仅处理未看 incoming：开始将等待的普通输入转为共同队列；结束将剩余共同输入加入普通 openBatch，截止取 `max(completedAt, 这些输入最近 receivedAt, 已有普通窗口锚点)+15秒`。已在结束标志后建立的普通批次合并保留，不能删除。未消费复议任务保留原 messageIds；回归普通模式后按可读／睡眠门禁运行。

没有可见输出不表示没有经历，仍可整理有来源记忆、计共同轮、推进 narratedUntil 及重排自主。只有控制／后台操作不能冒充一次前台生活完成。

## 8. 睡眠、生活补齐与自主周期

`isSleeping`、`canRead`、Scheduler 收集／截止、generateTurn 早退和 waking、段 B 及恢复共用合法活动判断。mode 为 shared 但缺身份／版本的旧行不自动豁免。

普通睡眠规则保留。start 必须来自可运行的普通准备轮；命令不能叫醒、证明用户到场或跳过参与判定。合法共同模式下旧 sleepAt/wakeAt 是计划，不能睡眠早退、清自主截止、触发伪起床或用普通 phoneAccess 拦住参与。角色要睡觉先由共同个人导演 end。

结束轮按个人导演 sleepPreference 与已调整预约安排候选作息；段 B 用 completedAt 判门禁。旧 sleepAt 已过且 wakeAt 尚未来、没有新安排，则结束后入睡，自主为 null；新 sleepAt 仍未来则清醒并重新安排自主。旧 wakeAt 也已过去时，旧计划已失效，清除该过期 sleep，不能额外伪造刚醒；下一普通故事按既有睡眠习惯建立有效新计划。这项清理不在段 B 新抽随机数。新的明确作息优先于旧计划。

普通消息、预约、待看、起床、共享节点、自主轮都先补一次生活。沉默或仅 narrative 的轮也推进正式 narratedUntil 并重置自主机会；睡眠／不可接收的仅暂存、输入接收、环境更新、维护、工具续调用及修补不推进该字段。前台和自主同到期只选前台，不带 autonomous 原因，不抽主动联系机会；未来预约不阻止正常空闲自主。

自主间隔依现有 `autonomousMinutes`：整数 150～210，均匀抽样。sampleOpportunity 的主动联系资格仍只属于真正自主轮；普通聊天／共同轮即使重设自主时间也不算主动联系机会。

## 9. 共享经历与记忆

复用现有 organizeMemory 的 experiences、实际确认 outgoing、首次可见 incoming 及合法查阅来源。`simulatedUserActions` 和公开旁白作为合同上下文说明共享剧情，不能独立制造来源 ID；仍至少引用一个合法本轮来源。outline 可放意图区，不放事实来源区。

成功发送的代写可以形成活动事件／感受记忆并被提起，无已读／在场字段。没有公开依据的代写不能只凭内部 experiences/progress 进入共享事实；提示词及显式清单校验实现边界，不新增审计模型。模拟活动记忆不能自动修改现实用户背景。

用户纠正剧情时按已有后续输出和带来源的记忆变更处理，不能直接改历史 outgoing 或重放旧轮。短期 7 天、长期 90 天、唤醒／稳定认识及向量流程全部继续既有记忆细化，不增加人为长度预算。

## 10. 升级与实施检查

新增 `src/deployment/shared-upgrade.ts`、`scripts/migrate-shared-activity.ts`，package 增加 `shared:migrate`。缺版本的正式库不得因加载新默认值而自动声称已升级。

- 默认 `--check` 只读检查；报告普通／共同模式、缺身份的活动、未完成轮、旧 scene_step 及可重建记录数量，不打印消息正文、背景或密钥。
- `--apply --stopped` 要求服务已停止，先备份数据库及存在的 WAL/SHM 同伴，再执行事务升级；备份路径和结果写入实施记录。
- 无旧活动、无未完成旧共同轮时，初始化 clock/control 表与版本；保留普通轮、消息、任务、记忆和原截止。重复升级不重排现有时间、不改计数。
- 遇到旧活动或未完成旧共同轮，check 给出具体记录范围。可从已提交 turns/outbox 明确重建的，先提供重建报告；无法确认首尾和计数时不静默清空或从零重开，待用户决定具体接续。基础自动升级不执行猜测性重建；因此只在实际遇到此状态时才需用户判断。
- 正式装配入口在启动故事调度前检查版本；旧活动未升级时停止故事启动并给明确诊断，不发送伪结束标志。新临时／开发库直接初始化新版本。

不新增旧故事导入。原始任务先用临时SQLite、假模型和假Sender验证；第十轮已明确获准发送本地角色背景／初始细节／隔离模拟剧情给配置的DeepSeek做真实验收，不启动QQ/SnowLuma。正式库升级和真实故事验证独立记录，不把离线测试当成已联调。

## 11. 验收归属与资料更新

| 验收组 | 执行计划任务 |
| --- | --- |
| 身份、字段、配置快照、唯一节点及 60 秒公式 | 1 |
| 精确控制分类、普通／共同输入、动作原文、边界输入 | 2、5 |
| 首节点、手动／自动合并、预约例外、前台让位、环境窗口及无定时器空转 | 3、5 |
| 收束集合校验、静默代写、动作主体、outline 不是事实 | 4、5 |
| 冻结恢复、最新输入保留、单次计数及自主重排、共享记忆 | 5 |
| 旧库检查、停止备份、幂等升级、旧活动诊断、装配 | 6 |
| 全回归、离线示例／Koishi smoke、文档对齐及实施日志 | 7 |
| 目标／结束条件的语义稳定、连续代写及真实自然收尾 | 任务7登记的后续真实多轮验收 |

任务1～7已运行离线程序测试，未运行在线验证。`REMAKE_V0.2*.md` 中受影响的实际行为说明、README和配置样例已同步；`REMAKE_V0.2_RECOVERY.md` §6.1已更新新轮选择顺序，未完成轮恢复仍最先。旧的记忆／搜索实施记录保留历史日期。新增[实施日志](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md)记录每任务代码提交、RED/GREEN证据、偏差、临时库升级检查及真实故事验收待办。

结构、时序、格式、来源及恢复由离线测试验证；真实动作／代写及收尾不能以mock代验。第十轮已授权完成隔离真实故事：20节点含超时恢复、6节点动作/纠正/结束及3节点新版收束补验，逐轮核对目标、公开正文、动作清单和固定细节。具体版本、失败样本及有限补验见第十轮记录；这不保证未来文学质量或每句语义边界，也不等同正式QQ／真实开始确认／墙钟调度验收。字符串集合校验仍不能替代语义审阅。

隔离在线工具`scripts/validate-shared-story.ts`默认单请求超时为300秒，仍与调用方取消信号合并；仅改变验收工具，不给正式模型调用新增超时或重试。此前120秒超时及恢复证据保留历史原值。quiet夹具约定20关用于硬上限覆盖，不作为普通活动约10轮的统计样本；新软节奏效果须在后续实际故事中观察，不能由离线合同测试替代。


第十轮已接受修正的执行入口：[修正计划](REVIEW10_FIX_PLAN_20261008.md)、[逐项修正／部署验收记录](REVIEW10_FIX_LOG_20261008.md)。选择时的代写权限为冻结快照，生成期间新消息留下一轮。status可刷新确定性投影，但不更新真实锚点、轮数或自主截止。

结束重组普通批次时，readyAt−15000ms只用于恢复既有15秒批次的最近输入锚点；与completedAt及转交消息receivedAt取最大后重排15秒。睡眠旧区间在生成时按at清理与段B按completedAt统一判断职责不同，保留两处，不能合并为一次。
