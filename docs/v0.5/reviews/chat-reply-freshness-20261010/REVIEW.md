# 普通回复跟进新消息：方案审核

**日期：**2026-10-10。**状态：**审核完成，改动未实施。**核对基线：**`3fb4e1c71c5b82ba4408f75e581a0cdc4021ca35`；SOL 方案基线为 `6a88b9d`，两者的产品代码相同。返回 [V0.5 索引](../../README.md)。

## 结论与交接

**需要补充 review，保留方案 B，不必推翻重做。**“未开始发送时重新合并；有发送尝试后保留冻结”的方向正确，原调查对 15 秒、消息归属和历史证据的表述也有分寸。下面 4 项是实施前必须补齐的合同，不是对尚未实现功能报已有 BUG。

SOL 执行顺序：先读[原方案](../../plans/chat-reply-freshness-20261010/README.md)，再读本报告与[细化执行方案](EXECUTION_PLAN.md)。原方案没有定下来的选择，以执行方案中的明确裁决为准。此次只审核并写交接材料，没有实现该功能。

| 编号 | 级别 | 需要定下来的问题 | 本次裁决 |
| --- | --- | --- | --- |
| R1 | Important | 等待轮会占住唯一前台槽；普通轮与混合事件轮边界未定 | 保留单一未完成轮，等待时可将它改绑为到期事件；限定普通资格，事件接管不顺带消费聊天 |
| R2 | Important | 旧阶段 checkpoint／网页材料／本人查阅可能进入新候选 | 给业务候选增加 generation，隔离阶段身份；记忆仅取最终代际的本人查阅 |
| R3 | Important | “重建 visualContext”可能破坏图片终态冻结 | 保留既有附件终态，重新构建当前阶段的可见视图；仅对新获准附件准备观察 |
| R4 | Important | 等待结束后直接拼 batchIds，可能遗漏暂存未读或绕过睡眠／查看资格 | 由调度重新选完整普通未读集合，重新判资格；期限查询与选择使用同一决策 |

这里的 Important 指“实施前需采用具体约束并补回归”，不表示需要上线应急处置。

## R1：等待不能把预约等事件一起挡住

原方案 §4.2 要求归还前台执行权，§4.5 又保留旧轮为未完成事项。当前 [SerialHost](../../../../src/host/runtime.ts:64) 仅在恢复标记存在时继续未完成轮；[Scheduler](../../../../src/host/scheduler.ts:16) 和 [HdsiApp](../../../../src/app.ts:37) 均阻止另开前台轮，[nextDeadline](../../../../src/host/scheduler.ts:85) 也直接返回 null。只为等待补一个 15 秒计时器，仍然不能满足“事件保持原调度语义”：连续消息可以不断推迟到期预约。

分类也不只看 `entryMode` 或 `triggerKinds`。[scheduler.ts:28](../../../../src/host/scheduler.ts:28) 会给纯 input 请求附加 `schoolNoticeRefs`，第 53～65 行会合并预约、起床、检查消息和普通输入。共同活动开始则要到个人导演返回才知道，不能在入口一律按活动轮排除。

**裁决：**不引入多个活跃故事轮，也不全局放宽 `unfinishedTurn()`。增加等待专用的调度决策：只允许一个确实在等待、未尝试发送、未冻结无输出决定的轮接受新请求。到期事件可接管同一个 turn ID，原聊天仍保持未读；事件结束后重新走普通选择。普通资格包括 input／check_messages，排除预约、起床、学校通知、自主生活、活动及环境事件。学校通知还必须检查 refs。纯聊天产生的“开始共同活动”候选在首段尝试前仍可废弃，避免用户刚说“先别开始”却仍发开始通知。

验收必须覆盖持续追加期间预约执行一次、等待重启后起床接管、通知 refs、共同活动开始首段边界。只测“新消息使旧表达不发送”不能关闭 R1。

## R2：业务重选不是原阶段的故障重试

[discardUnattempted](../../../../src/recovery.ts:127) 只重置候选、outbox 和 post job，保留原输入、绑定、图片等。[WebSearchStore.openStage](../../../../src/web/store.ts:18) 按 owner＋stageKey 复用阶段；[ModelClient](../../../../src/model/client.ts:30) 更新 input 时仍保留 `privateLookupResult`、修补原稿、待办工具操作及 `toolResults`，并提供该会话全部网页材料。

本次合成探针确认：用同一阶段调用新输入，旧 private lookup、网页正文和工具结果仍会进入请求。这个行为是现有故障恢复合同；如果将其直接用于“用户问题已经改变”的重算，便混淆了两种恢复。

仅换 stageKey 还不够。[currentSelfWebReads](../../../../src/memory/organize.ts:16) 按 turnId 收集本人查阅；同一 turn ID 的旧代际来源仍会被最终记忆看见。

**裁决：**同一业务请求的故障恢复保持同一 generation；真正因新输入重新绑定或改绑事件时增加 generation，使用新的业务阶段键。旧阶段材料只作为主体内公开缓存，不能自动注入新阶段。保存当前个人导演的 runId，基础记忆／post job 仅接收该 runId 的本人查阅。图片观察是独立附件任务，其阶段身份不随聊天 generation 变化。

额度裁决也必须写入交付：每个新业务代际的阶段仍为 20 成功／40 失败；同代际工具续调、修补及崩溃恢复不刷新额度。历史计数保留。新输入导致重新生成会增加调用成本，这是本规则的代价，不以改键偷偷重置同一请求的额度。

## R3：重建可见视图不等于删除图片冻结结果

[IncomingMediaService](../../../../src/input-media/service.ts:29) 优先使用当前 turn 的 `ready/unrecognized` 终态；已有回归 [incoming-media-turn.test.ts](../../../../tests/incoming-media-turn.test.ts) 明确保留“本轮未识别”，不在恢复时因资源或配置变化再猜一次。

原方案 §4.5 的“重建 visualContext”容易被执行成整列清空。本次探针确认：保留原终态时仍为 unrecognized；清空后会改用后来出现的已确认观察，变为 ready。这会让同一待回复中的旧图理解发生变化。

**裁决：**保留同一 turn 的附件冻结记录，按新阶段 `resources.messages` 重新投影视图；[hydrateVisualContext](../../../../src/input-media/context.ts:6) 已按消息身份限制注入。新图片只有进入新一代实际可见／复议集合后才识别。仍在 pending 的旧观察保留原素材和原阶段；已确认全局观察可以保留，但不能因此给不可查看阶段增加消息权限。

验收检查真实 DTO 的消息引用和 `visualObservations`，不仅检查 `prepareForTurn()` 的调用参数。

## R4：重选必须经过当前调度资格，不能只拼待办批次

[Scheduler](../../../../src/host/scheduler.ts:20) 在睡眠时清空 `pendingBatchIds`；不可读暂存也会清空索引并建立检查消息任务。消息正文仍在，且未读。[Storage.unreadMessages](../../../../src/storage.ts:117) 排除开放合批，不能单独用它判断生成期间是否来了新消息。

若等待到期直接拿旧 batchIds 重生成，跨入睡眠时 [generateTurn](../../../../src/app.ts:100) 会生成空候选，随后 [finishPostprocessing](../../../../src/recovery.ts:107) 消费旧批次而没有标看见这些消息。若改绑事件又丢掉旧 batchIds，事件完成后也可能只剩没有调度触发的未读正文。

**裁决：**普通输入版本负责判旧，开放批次负责静默期限，完整普通未读查询负责选内容，三者职责分开。到期重判睡眠／可查看资格；睡眠交给起床，不能查看交给原检查消息机制。可读且没有开放批次时，暂存未读本身可以触发一次普通处理，不依赖 pending 索引仍有记录。期限必须来自可执行决策，不能对不能执行的过期 check_messages 一直返回 now。

## 原方案已合理的部分

- 最新输入比较与首次 `sending` 落库应在一个同步事务内完成，并置于分段等待之后。任一 sending／retry／confirmed 都锁定原稿，不能以“没有确认”为由重算。
- 无输出决定在冻结事务中做相同检查；冻结成功后新消息交下一轮。不能让一个空 outbox 的后处理轮被事件接管。
- 不取消在途 HTTP；在阶段返回后停止过时的后续工作。普通换代不得设置 paused、lastFailure 或发送 error。
- 重算叙事仍从已提交 `narratedUntil` 开始；未发草稿、旧意图、任务、概率计数和经历不正式提交。原始消息及 batchId 不合并改写。
- 没有证据要求改变 15 秒、4 段窗口、模型参数或强迫角色回复。

## 核对证据与边界

1. 静态核对原方案、调查记录、输入／调度／宿主、生成／发送／恢复、聊天绑定、图片冻结、网页 checkpoint 和记忆来源。另有独立只读复核，重点核查等待／事件／恢复；本报告合并的是已再次核对的意见。细化方案完成后又复查接口衔接，补清事件接管后的恢复不再受普通新输入门禁影响，并加入 T5 磁盘测试要求。
2. [本次探针](probe-current.ts) 的 [原始成功输出](logs/probe-current-final.txt) 复现旧批次提前选择、生成期间新消息不替换旧答复，并验证现有未完成轮阻挡、阶段复用、图片终态差异。全为内存库、脚本模型及假发送器，无 QQ／供应商／网页访问。
3. 基线回归 **8 个文件、35 项通过**，见 [原始日志](logs/baseline-tests.txt) 和 [JSON 结果](evidence/baseline-tests.json)。覆盖 scheduler、tasks、recovery、chat flow／recovery、web recovery、incoming media turn、environment async host gates。
4. 探针首次执行因审查脚本尝试 structuredClone 含函数对象失败，已只修探针捕获字段，原失败保留于 [日志](logs/probe-current-first-attempt.txt)。不是产品失败，也不计为功能红绿测试。

以上通过证明的是**当前基线及审查依据**，不是新功能已通过。本次没有全量测试／构建／在线验收，没有读取或改写正式库，没有操作服务、配置、模型参数或用户聊天。SOL 原调查证据未覆写。
