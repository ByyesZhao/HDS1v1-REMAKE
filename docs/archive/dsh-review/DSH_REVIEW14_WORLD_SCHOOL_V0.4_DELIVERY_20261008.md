# 世界与学校规划 V0.4 实施交付复核（DSH）

日期：2026-10-08。对象：任务 1～8 的实现（本地 Git `1466701`）。依据：[实施日志](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_LOG_20261008.md)、[真实模型验收报告](WORLD_SCHOOL_PLANNING_V0.4_REAL_STORY_ACCEPTANCE_20261008.md)、两份执行依据与 `src/`、`tests/`。

方式：只读源码、文档、Git 与审计产物，**没有运行测试或服务，没有重放真实模型请求，没有修改任何文件**。正式库只做了只读查询。

结论：**核心设计落地良好；本轮先修 4 条，其余为口径统一与测试补齐。** 我核对的关键机制（每日批次与逐步让位、失败隔离与重试、通知版本与更正规则、角色已知投影、研究进展来源、升级与门禁、终审三项日历修复）都与设计一致；正式库升级与备份的真实状态良好。

**本文件已按 CODEX 的回应修订**（`CODEX_REBUTTAL_WORLD_SCHOOL_V0.4_DELIVERY_20261008.md`）：**撤回 §3.1**（`SchoolInstance` 确实有 `deliveryRevision`，我的类型依据错了）、**把 §3.2 降级为说明**（不可读时不会开通知轮，"钳到 now"的建议本身也是错的）、**更正 §5.1 的后果描述**（是热循环与定时器饿死，不是进程卡死）、**更正 §1.1 的正式库推断**（那 4 步从未开始）。修订后的清单以第 6 节为准。

**先修这四条**：① 批次日期两套时区口径导致的无进展热循环（§5.1）；② "必需键"与"不可覆盖"两个时钟导致的当天 `school_week` 失败循环（§4.1）；③ 被取代的周摘要不失效（§4.2）；④ 周覆盖记录形同虚设（§4.3）。四条的修复口径 CODEX 都已接受并做了有价值的补充。

---

## 1. 我实测与核对确认的部分

### 1.1 正式库与备份（只读实测）

| 项目 | 实测结果 |
| --- | --- |
| `environmentPlanningVersion` | `1`（已升级） |
| `sharedActivityVersion` | `1` |
| `paused` | `false` |
| `nextWorldAt` / `nextSchoolAt` | 均为 `null`（退役字段已被清空） |
| `nextEnvironmentAt` | 已写入（下一批次 06:00 截止） |
| 新表 | `environment_batches`、`environment_steps`、`school_plans`、`school_plan_items`、`school_instances`、`school_notices`、`school_knowledge`、`school_weeks`、`school_progress` 全部存在 |
| 批次／步骤 | 1 个批次、4 个步骤，**四步全部 `pending`、`attempt=0`、起止时刻均为 null**（由升级事务在 2026-10-08 15:04 的只读核对确认，见下） |
| 未完成轮 | 0 |
| 备份 | `runtime/environment-upgrade-backups/environment-20261008054344875-…/`（库 + WAL + SHM）、`reports/world-school-v4-{before,after}.json`、升级前配置副本 `config.local-before-world-school-v4.json` |
| 工作树 | 干净，只有 5 份未跟踪的 DSH 审核文件 |

**更正**：我最初把"1 批次 / 4 步骤"读成"首建链已经在正式库跑过一次"，这是错的。CODEX 用 `DatabaseSync(readOnly:true)` 直接查了两张表，确认那 4 步**从未开始**（`attempt=0`、`startedAt/completedAt` 均为 null），批次是**升级事务自己创建的**（`environment-upgrade.ts:56-57`），不是跑出来的。所以正式库上**还没有任何环境步骤真实执行过**，实施日志"正式服务未启动、未在线写正式学校计划"与证据一致，也没有可补写的完成时刻。这一点很重要：它意味着**正式链第一次运行就是"首次真实执行"**，值得在开机后专门看一眼。

### 1.2 终审三项修复确实在代码里

- **删除时段退出旧未来课次**：`calendar.ts:64` 把"上游已无对应、仍 active 且尚未开始"的旧实例推入 `requiredOccurrences`（`status:'cancelled'`），`calendar.ts:70-71` 用 `supported` 判断基础课次是否仍受支持；`changes.ts:33` 在上游条目变更时把**未来**实例标 `needsExpansion`（已开始的实例不在其中）。
- **重展开前剔除失效客观安排**：`context.ts:8` 的客观投影只取 `!needsExpansion && status!=='cancelled'`，所以失效安排在重新展开前不会进入主叙事视角。
- **已开始课次保留、未来后继新建**：`calendar.ts:118` 的实例 ID 为 `old?.id ?? stableId('school-instance', occurrenceKey)`——已开始的历史实例保留原 ID，改到新时段的未来课次拿到新 ID。
- 对应回归变体存在：`world-school-calendar.test.ts:60` 的 `retire_removed_future_occurrence_%s_without_ghost_class`（`remove_slot`／`shorten_range`／`tentative` 三例）与 `:69` 的 `started_occurrence_remains_historical_and_successor_future_move_keeps_new_id`。终审提交 `3ac2b1b` 动了 4 个源码文件与 2 个测试文件（+34 行测试），与"新增 6 个回归变体"一致。

### 1.3 其他已核对的机制

- **每日批次**：`environment/scheduler.ts:8-24` 按本地日期建唯一批次（`batchIdentity` 用时区＋日期），`environmentDailyAt` 只作为 `scheduledAt` 与下一次 `nextEnvironmentAt` 的来源；跨日时旧 active 批次与未提交步骤被标 `superseded`；`selectEnvironmentStep` 严格按 stage 顺序取第一个非 committed 步骤，前序未提交就不会放下游。
- **重试不空转**：`environmentDeadline` 的候选是"下一批次时刻"与"当前步骤的 `retryAt ?? now`"，排序取最早；未到期重试返回未来时刻，不会产生 0 ms 循环。
- **旧截止已退役**：全仓检索确认 `nextWorldAt`／`nextSchoolAt` 现在只有三处写入（`index.ts` 初始化、升级脚本、验收脚本）、一处旧代码写入（`recovery.ts:98-99`，属旧环境轮路径），**没有任何调度读取**；调度只读 `nextEnvironmentAt`、`environmentDeadline`、`schoolNoticeDeadline`（`host/scheduler.ts:106-107`）。- **版本门禁**：`index.ts:41` 在打开库之前检查 `environmentPlanningVersion !== 1` 并拒绝启动，报错文本给出 check／apply 命令；因此"旧配置能解析"不会绕过数据库门禁。
- **发布点**：`host/scheduler.ts:17` 在 `collectReady` 内以短事务调用 `releaseSchoolNotices`，不调用模型、不消耗共同轮、不重排自主；`schoolNoticeDeadline` 与 `environmentDeadline` 一起进 `nextDeadline` 的候选集合（`:106-107`）。**但它的位置在暂停门禁之后、且 §4.2 会说明这里与冻结口径存在顺序差异**（第 17 行本身在门禁之后，我先前把它描述成"每次扫描都发布"并不准确，以 §4.2 为准）。
- **通知与已知版本**：`calendar.ts:51` 的通知身份是 `stableId` 对 `(sourceItemId, occurrenceKey, weekStart, kind, reminderKey, deliveryRevision)` 的编码，改期不改身份；`:57` 的 `windowOpen`（`due(issuedAt)` 或已有发布／已读或已知）保证远期条目**当天可下发**而不被周窗口挡住；`:88` 的周摘要只覆盖已 due 或有发布／已读或已知的条目，未公开草案不会进摘要。
- **两套投影确实分开**：`context.ts:7-13` 主叙事拿客观实例与已发布通知快照；`context.ts:14-24` 个人只拿"已知快照 + 本轮实际观察"，且 `personalEnvironmentEvents` 只从**已知快照**里还原学校事件——未读安排不会经由这条路径回来。
- **测试规模**：61 个测试文件；归档的 `task-8-suite.log` 记录 `61 files / 330 tests`，终审新增 6 个变体后为 336，与报告口径自洽。

### 1.4 真实模型验收的诚实之处

报告保留了不利证据：50 次请求、7 次格式修补、1 次格式终态失败（旧实例版本连续误用）、两次因**合法未读**而停止场景、真实语义漂移（"参数／小实验"被后续写成"数据划分／指标"、导师描述泛化为方法依据）、静默共同轮关卡编号跳跃。它明确写了"测试用虚拟时钟及分场景起点，不能当成数月连续运行或模型选择必然相同的保证"，也没有把离线修复说成再次在线多轮。这种保留原始失败的做法与前几轮一致，我认可。

---

## 2. 一处建议修改的小遗留

**`recovery.ts:98-99` 仍在写已退役的 `nextWorldAt` / `nextSchoolAt`：**

```ts
const next = nextDaily(completedAt, turn.environmentKind === 'world' ? d.config.worldTimes : d.config.schoolTimes, d.config.timezone);
if (turn.environmentKind === 'world') runtime.nextWorldAt = next; else runtime.nextSchoolAt = next;
```

这是旧"单环境轮"路径的残留。它目前**不可达**（环境轮已改由 `environment_steps` 驱动，不再产生 `environmentKind` 的故事轮），所以不会造成功能问题。但执行计划当时要求"旧字段在升级后应清理或仅作明示兼容投影，不能作为第二套截止来源"——现在的状态是"升级时清空、代码里仍有一处会重新写回"，将来若有别的路径复用这段逻辑，就会重新出现第二个截止来源。

建议把这两行删掉（连同 `nextDaily(..., worldTimes/schoolTimes)` 的调用），或在上面加一行注释说明"此路径已退役，仅保留历史兼容"。同时 `config.ts` / `settings.ts` 里 `worldTimes` / `schoolTimes` 的默认值与 schema 也可以标注为弃用——它们现在只被这段死代码引用。

---

## 3. 知识投影、通知轮与研究进展专项审核（含 2 处需修缺陷）

由专项线程交回，我逐条回源码确认。**两处缺陷都成立，建议修完再开始正式使用。**

### 3.1〈已撤回〉~~带 instance 快照的"个人提醒"永远无法交付~~

**本条撤回。** `SchoolInstance` **确实有 `deliveryRevision`**（`school/types.ts:17`：`{id, sourceItemId, sourceRevision, deliveryRevision, …}`），它与 `sourceRevision` 并列存在，`calendar.ts:118` 创建实例时两者同时赋值。所以 `personalKnown` 比较的不是 `undefined === <number>`，提醒可以正常发布、选择与贡献截止。专项线程把类型定义读错了，我又没有独立核对类型就采信，这是我的失误。

CODEX 还指出我连带的一个误判：`personal_reminder_requires_known_version` 并**不是**真空测试——`expand` 在 `helpers.NOW`（10-07 10:00）运行，此时提醒时刻（10-09 12:00）在未来，通知**确实被创建**；12:00 只是随后 `release/select` 的检查时刻，我把两个时刻混用了。该用例确实缺少"已知可交付"的正向断言，但那只是覆盖不足。

### 3.2〈降级为说明，非缺陷〉暂停期间到期、恢复后一次唤起

**本条不再算缺陷。** `schoolNotificationEligible`（`notices.ts:22-25`）是先调 `selectSchoolNotices` 再判 `due(nextWakeAt)`，而 `selectSchoolNotices` 已经要求 `canRead && !isSleeping` 且共同活动中返回空——所以"不可读时开通知轮"根本不会发生；"可读且已到期时唤起一次"正是设计意图。而"把过去 `nextWakeAt` 钳到 `now`"这个建议**是错的**：钳位后仍满足 `due`，行为不变；反过来要求 `nextWakeAt` 必须在未来，会让通知真正到期时失去资格、破坏正常调度。

保留一条小建议：测试可以补断言"暂停期间 `releasedAt` 仍为 null"（现有用例断言了状态仍为 `scheduled`，但没有断言未发布）。

### 3.3〈已知限制，但值得写明具体通道〉"现场获知"缺少公告依据

`school/progress.ts:26-28` 接受 `via:'onsite'` 的条件是：实例在 `narrativeSchoolContext().objectiveInstances` 里、`instance.startsAt <= happenedAt`、经历的 `relatedEventIds` 含该实例 ID、且角色未睡眠。而 `objectiveInstances`（`context.ts:8-10`）是**整个未取消、未待重展开的日程**，包含从未公告过的事项。

所以主叙事只要写一句"她跑进教室听说了 X"并带上 `relatedEventIds:[隐藏实例ID]`，就能为一件**从未发布过**的安排建立真实的 `school_knowledge`，进而进入个人投影与记忆（`context.ts:14-23`、`organize.ts:26,31`）。细化自己也承认"程序不假装能审核全部自然语言泄漏"，所以这是**已接受的语义边界**，不是回归。我把它写在这里，是因为它比"自然语言可能泄漏"更具体：**这是隐藏安排进入角色知识的唯一确定性路径**，将来若要收紧，起点就是给 `onsite` 加一条"该实例必须曾出现在已发布通知中"的前置条件。

### 3.4 该专项确认成立的部分

- **两套投影确实分开**：`app.ts:101-103` 把主叙事的通知快照收窄到冻结 refs，`personalSchoolContext` 只合并已知快照 + 本轮已验证观察，`personalEnvironmentEvents` 只从**已知**快照还原学校事件；`relatedEventIds` 受白名单校验（`contracts.ts:54`）且本身不产生知识。测试 `world-school-story.test.ts:29-37` 断言隐藏字符串与隐藏学校事件不出现在个人／表达／记忆输入中，而 lookup 仍返回旧位置。
- **通知轮是真的独立触发**：`school_notification` 在 `TriggerKind` 中，选择时输入与任务都为空，`contactEligible=false` 由构造保证；纯通知轮不改变 `allowSimulatedUserActions`，晚到通知沿用冻结 refs，睡眠／不可读只暂存。
- **段 B 原子性**：观察必须指向已提交的经历，已读要求同 `deliveryRevision` 的冻结 ref，重试以 `readTurnId` 幂等；测试注入库写入失败证明"通知已读 + 经历 + 知识"一起回滚。
- **研究进展绑经历**：`SchoolProgress` 带 `experienceId/turnId/happenedAt`，`progress.ts:17,33,50` 三处都拒绝没有对应已提交经历的草稿；校园／课题组合同直接拒绝 `researchProgress`。真实报告里"首次请教没等到回复就不造 feedback"与之一致。
- **提示词边界与 `currentOnly`**：`basis='fiction'` 为默认且 `fiction` + 非空 `sourceUrls` 被拒；`retrieval.ts:15` 的 `currentOnly` 覆盖三个新角色与旧 `school`，归档／细节历史被强制关闭。它还**只读交叉核对了验收产物**：六次运行的 `summary.json` 合计 50 请求 / 7 修补 / 0 失败，报告引用的 experience／turn ID 全部对得上。

---

## 4. 日历、周展开与通知版本专项审核（含 2 处需修缺陷）

我逐条回源码确认。**两条缺陷都成立，且都属于"修一次就好、但会真的发生"的类型。**

### 4.1〈需修〉必需键与启动不变式用了两个时钟，会形成自相矛盾的硬失败

这段链路串起来看（行号我都实测过）：

- `environment/runtime.ts:26`：步骤第一次生成时冻结 `inputSnapshot`（内含 `schoolExpansionInput(now)` 与 `at`），**重试时不再重建**（`step.inputSnapshot ?? environmentInput(...)`）；
- `school/calendar.ts:43-75`：必需集合是用**冻结时那个 `now`** 算的——`:75` 只要"该 occurrence 没有实例／`needsExpansion`／`deliveryRevision` 不符／起止时刻变了"就把它推入 `requiredOccurrences`；
- `school/calendar.ts:103`：模型必须为每个必需键给出候选，缺一即 `ModelFormatError`；
- `school/calendar.ts:117`：解析时却用**当前时刻**判断——`if(old && old.startsAt <= now) throw new ModelFormatError('already-started instance cannot be overwritten')`；
- `environment/runtime.ts:29-32`：`ModelFormatError` 被降级为 `pending + retryAt = now + environmentRetryMs`（默认 300000）；
- 于是下一次重试**复用同一份冻结输入**、再用新的当前时刻去撞同一条不变式——**每次都以同样理由失败，直到跨日**（`environment/scheduler.ts:12-16` 才会把批次标 superseded）。期间每 5 分钟一次模型调用。

**触发条件**：某个 occurrence 在"冻结输入之后、解析之前"这段时间里开始。两条现实路径：① 06:00 上游变更给"今天即将开始的课次"打上 `needsExpansion`，而周模型调用跨过了它的开始时刻；② 白天重启恢复一个 `running` 步骤，而它的输入是几小时前建的（`isNew === false` 会保留 `inputSnapshot`）。

**影响**：那一天的 `school_week` 永远不提交——实例、提醒、更正全都没有，还附带每 5 分钟一次调用。

**修法建议**（择一，都不需要改架构）：解析时对"冻结后已经开始"的 occurrence 采用**保留已开始实例、跳过覆盖**而不是抛错；或让必需集合的判定与 `:117` 使用同一个时刻（把 `input.at` 传进 `resolveSchoolWeek` 用于这条不变式）；或在 `runtime.ts:26` 的重试路径上，当冻结输入已明显过时（例如已跨到下一个选择点）时重建输入快照。**我个人倾向第二条**：让"必需集合"和"不可覆盖"用同一个时钟，从根上消除自相矛盾，也不会牺牲终审刚加上的"已开始课次不被回写"保护。

### 4.2〈需修〉被取代的周摘要不会失效，可能一条旧摘要和它的后继一起发出

`school/calendar.ts:89-91` 计算周摘要时，`previous` 取的是该周 `digestRevision` 最大的一条（**不看状态**），`covered` 要求"上一条非 invalidated 且本周每个条目都有同 `deliveryRevision` 的快照"。于是**当周加入一个新条目**时 `covered === false`，程序会生成 `deliveryRevision + 1` 的**新**摘要（新 ID）。

问题是**旧的那条没有任何人被作废**：`school/changes.ts:31-34` 只在"某个条目的 `deliveryRevision` 变化"时才作废与**该条目**相关的通知——新条目的到来不触发这个分支；`resolveSchoolWeek` 也只写自己的行（`calendar.ts:120-128`）。而 `notices.ts:13-21` 会把所有 `available + legal` 的通知都交出去，旧摘要仍然 legal（它声明过的条目 `deliveryRevision` 没变）。

**结果**：同一场故事里可能先收到"缺了新条目"的旧摘要，再收到包含它的新摘要。触发条件是"角色在第一份摘要送达前没有读它"——婉拒、睡眠、或当轮没有通知轮，都很常见。

**修法建议**：生成新摘要时，把同一周、`kind === 'week_digest'` 且仍 `scheduled/available` 的旧行一并置为 `invalidated`（`readAt` 已读的保留，符合"已读历史不静默替换"）。

### 4.3〈与文档不符〉覆盖记录没有参与任何程序判断

`coveredVersions`（`calendar.ts:49`、`types.ts:37`）**被算出来但从未被读取**；`validateWeekCoverage` 只校验"模型报告的那些版本等于当前条目 revision"（`calendar.ts:111`），所以 `weekChanges: []` 或只报一部分 `sourceVersions` 都能通过。而细化 §3.2 与计划任务4 要求的是"周记录须被写入／刷新"的**双判据**。

好消息是**反遮蔽方向是成立的**（覆盖记录永远不会压掉一个必需键——这本来就是接受回应最在意的那一点），坏消息是"双判据"实际只实现了一半：记录对判断的贡献为零。建议要么让程序至少在无变化时仍刷新 `checkedAt`／`sourceVersions`，要么在细化里承认"覆盖记录仅作审计"。**测试强度提示**：`calendar.test.ts:26` 的 `toThrow(/required/)` 实际是被"必需 occurrence 缺失"分支满足的（`:25` 的 `deliveryRevision` 提升会给未来实例打 `needsExpansion`），所以 `calendar.ts:103` 的"必需通知缺失"从未被单独断言过。

### 4.4〈与文档不符·次要〉默认提醒模板按条目类型而非时间类型

`contracts.ts:20` 给的是"`course` ⇒ 前 60 分钟，其余 ⇒ 前 1 本地日 + 前 120 分钟"；而细化 §5.2 的措辞是按时间类型（"once 前 1 本地日 + 前 120 分钟；weekly 前 60 分钟及一次周摘要"）。结果是一次性课程只拿到 60 分钟提醒，而每周的组会却拿到 once 风格的两档提醒。提示词（`prompts.ts:24`）是按类型写的，所以这是**文档／提示词／代码三方不一致**，建议统一到一方并写明。

### 4.5 该专项确认成立的部分

身份与复用（`occurrenceKey` 的两种编码、实例 ID 复用、周窗口=本周＋周五起含下周）、版本语义（`deliveryRevision` 与 `revision` 分离、内部备注不重发、`week` 合同 strict 使模型无法改写通知策略）、必需集合（缺键抛错、额外候选抛错、已有合法身份不重建、非法化不算覆盖、重复候选拒绝）、**更正规则**（`windowOpen` 由 issuedAt／已发布／已读／已知推导，与"有无失效未读"无关；`read_only_old_version_requires_correction_and_candidate_commit_covers_not_week_marker` 与 `onsite_known_and_previously_released_invalidated_notice_keep_correction_obligation` 两条用例正好覆盖我第十二轮提出的两个分支）、生命周期（只 `scheduled → available`、知识行只追加、`knownSchoolSnapshots` 只回已知版本、已读不可重复读）、终审三项修复与**六个回归变体**（`calendar.test.ts:60` 的 `it.each` 三例 + `:69` 一例 + `perspective.test.ts:38` 的 `it.each` 两例）都对得上。

另外几处"可改进"也记录在此：`addNotice` 把"任何非 invalidated 行"当作覆盖（规范措辞是"合法行"，未发现可达的不一致）；周记录用 `stableId('school-week', weekStart)` 覆盖写，历史 `digestRevision/checkedAt` 不保留；实例没有归档清扫，`archived` 目前只由升级脚本产生，所以历史课次永远停在 `active`，只靠时间过滤；"已开始的长时段安排被上游取消"既不退休也不标 `needsExpansion`（`calendar.ts:64,68` 与 `changes.ts:33` 都只筛未来），所以取消通知发出后，客观投影在剩余时段内仍会看到它。

**测试强度提示（不是缺陷，但会掩盖回归）**：① `calendar.test.ts:26` 的 `toThrow(/required/)` 实际被"必需 occurrence 缺失"分支满足，所以 `calendar.ts:103` 的"必需通知缺失"从未被单独断言；② **没有任何测试调用 `resolveSchoolUpstream`**——所有用例都直接预置 `deliveryRevision` 再调 `applySchoolChanges`，所以"公开变化提升 dR、内部备注不提升"这条规则目前只有阅读证据，`calendar.test.ts:14` 还是把 `stageInfo` 直接写进存储来绕开它；③ 周五分支（`weekday >= 5`）与"已存在下周记录"分支（`calendar.ts:45-46`）无用例；④ 没有断言 `checkedAt`／`digestRevision` 的刷新。

---

## 5. 环境批次与调度专项审核（含 2 处需修缺陷 + 1 处需裁定）

### 5.1〈需修〉批次日期用两套时区口径，改时区后进入无进展热循环

- `environment/runtime.ts:22,31,36` 用 **`batch.timezone`** 判断"是否已跨日"；
- `environment/scheduler.ts:10,12` 的 stale 判定用 **`config.timezone`**。

两者不一致时：runtime 认为"已跨日"→ 调 `ensureEnvironmentBatch` 请求换批；而 ensure 看到 `existing` 存在、`stale` 为空（按新时区算，日期仍等于 `batch.localDate`）、且 `nextEnvironmentAt` 未到期 → **直接 `return null`，既不换批也不推进**。回到 pump：环境步被再次选中 → `runEnvironmentStep` 走日期分支**正常 return 而不抛错**（`runtime.ts:22`）→ 让出 → 再选同一步。**该步永远无法推进，而选择器会一直选中它。**

**我先前对后果的描述需要更正**：Host 用的是 `node:timers/promises` 的 `setImmediate`（`host/runtime.ts:6`），它**让出事件循环**而不只是 microtask 队列，所以其他 Node 事件仍能被处理、进程不会"卡死"；循环也没有无限期——当新时区的日期也翻过一天后 `stale` 成立，或配置再次变化、或人工暂停，循环都会退出（实测可达窗口约 7.5 小时）。准确的说法是：**pump 在这段时间里持续空转、反复查库并消耗 CPU，而 Host 回不到自己的 `armTimer`，因此定时唤醒与消息处理都被饿住**——表现为"机器人不响应几个小时"，而不是"必须重启"。严重度仍高，但不是我最初写的"进程卡死、只能重启"。

**修法**：让 stale 判定与 runtime 使用同一口径——例如 ensure 把 `b.localDate !== localDate(now, b.timezone)` 的 active 批也视为 stale，或在选择侧加"本步所属批次日期已翻"的守卫。

### 5.2〈需修〉未装配环境生成器时会退化成 0ms 唤醒循环

`app.ts:33-38`：

```ts
33: if(request.environmentStepId){
34:   if(!d.generateEnvironment)throw new Error('environment generator not assembled');
35:   this.busy=true;
36:   try{await runEnvironmentStep(...);}
37:   catch(error){ ...paused:true... ;throw error;}
```

抛错在第 35 行的 try **之前**，所以它不会进入"暂停"路径。同时 `environmentDeadline` 对该 pending 步返回字面 `now`（`environment/scheduler.ts:35`），于是 `armTimer` 排 0 ms → wake → 再次选中同一步 → 再抛 → 每条循环一条 onError 日志。生产入口总会装配（`index.ts`），`demo.ts` 与验收脚本各自把 `nextEnvironmentAt` 钉在未来，所以**当前不可达**；但两个脚本与任何未来入口只要漏装配就会空转。修法：把第 34 行移进 try，或对"未装配"显式 `paused` 并停止排定时器。

### 5.3〈需裁定〉跨日替代会让当天链在午夜后立刻起跑

`environment/scheduler.ts:12-14`：只要存在 stale 批，就**跳过到期判定**直接建当天批（`:19-22`），而批一建即 active、步即 pending。于是若前一天批仍有未提交步骤，新一天的链会在**日期刚变的第一个选择点**（例如 00:05）就开始，而不是 06:00。

这与"当地 06:00 单一起点"（细化 §1、计划 Global Constraints）存在张力；影响是当天的世界更新与通知时间戳可能落在 00:0x，且不会重复建批。**需要一次裁定**：要么把建批推迟到 `environmentDailyAt`（先只把旧批标 superseded），要么在文档里明确"跨日替代从日期变更起即生效"。

### 5.4 该专项确认成立的部分

06:00 单入口且无"完成时间+24h"漂移（`nextEnvironmentAt` 只在建批时写为次日本地 06:00）；批次 id 用"时区+日期"稳定编码；严格按 `environmentStages` 顺序、前序未 committed 时下游永不入选（包括"前序等 retry、后序 pending"时投出的是**前序的 retryAt** 而非后序的 now）；普通 `openBatch` 未到 15 秒时不新开环境步；全仓只有**一个**调度定时器；仅捕获 `ModelFormatError`/`ModelRequestError` 且落 `retryAt`、不写 `paused`、不建 `TurnRecord`（所以不堵前台）；`ready` 重启只应用不重生成；跨日只终结未提交步骤、保留 `frozenResult` 与已提交变更；**网页会话与 20/40 额度跨日不重置也不跨日合并**（新日期新 `step.id` → 新会话 0/0）；升级只读检查在 `new Storage` 之前、幂等、保留 `paused/lastError`、不动普通／共同未完成轮；`normalizeSchoolModels` 在 schema 之前且不写文件。它另外核对了一件我没做的事：`git show 690a5ed:src/host/scheduler.ts` 确认旧调度对环境轮总是写 `environmentKind`，所以迁移的筛选条件与真实旧库一致。

**可改进项**：`selectEnvironmentStep`／`environmentDeadline` 对步行用 `find(...)!`，一旦缺行会在 `armTimer` 内抛错且无人 catch（unhandled rejection 可能直接崩进程）；失败路径未 `releaseOwner`（无害，但内存缓存滞留）；每次选择与每次 `armTimer` 都全表 `storage.all()`（当前 4 步/天无影响）；`TurnCandidate.environmentChanges/nextEnvironmentAt` 与 `recovery.ts:97-100` 已是死代码（`app.ts:32` 先抛、迁移已终结），可清理；环境门禁只有"Storage 之前"一次（shared 有两次），当前唯一开库入口使二者等价。

**测试强度提示**：任务1 的 `loader_no_write` 没有"回读文件断言未改"（只能靠阅读证明）；`running_restart_keeps_attempt_and_ready_blocks_later_steps` 从未构造 running 步，所以"running 重启沿用 attempt、不重置修补、复用快照"只有阅读证据；`shared-v3-scheduler.test.ts:14` 断言 `nextDeadline === nextWorldAt` 已成**偶然通过**（调度器已不读该字段，只因夹具把两个日期串设成同一个值），应改写或删除。

---

## 6. 缺陷汇总与建议顺序

三路专项审核共发现 **5 处可证缺陷 + 2 处需裁定的口径张力**，我逐条回源码确认过。按严重度排序：

| # | 位置 | 后果 | 建议 |
| --- | --- | --- | --- |
| **1** | `environment/runtime.ts:22,31,36` 用 `batch.timezone`、`environment/scheduler.ts:10,12` 用 `config.timezone` | **改时区后无进展热循环**：runtime 认为已跨日 → 请求换批，ensure 认为未 stale → 返回 null 不推进，而该步仍被反复选中；`runEnvironmentStep` 正常 return 不抛错，pump 让出后立刻重选，**Host 回不到 `armTimer`**，定时唤醒与消息处理被饿住数小时（详见 §5.1） | 统一 stale 判定与 runtime 的时区口径，或在选择侧加"批次日期已翻"守卫 |
| **2** | `school/calendar.ts:75`（必需集合用冻结时刻）vs `:117`（不可覆盖用当前时刻），`environment/runtime.ts:26,29` | 冻结输入后开始的 occurrence 变成"程序必需、程序又拒绝"的候选 → 当天 `school_week` 永不提交，**每 5 分钟一次模型调用直到跨日**（详见 §4.1） | 让两处用同一个口径，但需同时守住"已开始历史不被覆盖"与"新 attempt 期间已开始"两种情况（CODEX §3.1 的补充我认可） |
| **3** | `school/calendar.ts:89-91` + `school/changes.ts:32` | 新周摘要建立时旧摘要不作废 → **同场故事可能先收到缺新条目的旧摘要**，再收到新摘要（详见 §4.2） | 建新摘要的同一事务里把同周 `scheduled/available` 旧摘要置 `invalidated`（已读保留） |
| **4** | `school/calendar.ts:49,111`（`coveredVersions` 被算但从未读取） | "双判据"只实现了一半：`weekChanges: []` 或部分覆盖都能通过，无变化时也不刷新 `checkedAt`（详见 §4.3） | 要求每个 `weekStart` 都有完整覆盖记录并刷新 `checkedAt`（CODEX 已接受） |
| **5** | `app.ts:34` 抛错在 `:35-38` 的暂停 try 之外 + `environment/scheduler.ts:35` 对 pending 步返回 `now` | 未装配环境生成器时退化为 **0 ms 唤醒循环**（当前生产入口总会装配，故不可达；详见 §5.2） | 把 `:34` 移进 try，或对未装配显式 `paused`；优先级低于前四条 |

**需要裁定的两处，CODEX 都给了具体建议且我认可**：

- **跨日替代的起跑时刻**（§5.3 / D1）：建议"跨日先终结旧日未提交结果、保留已提交内容，正常次日链等 06:00 启动；首次建档／显式升级允许立即建档（已有 05:00 bootstrap 测试），06:00 之后上线只补当前日期"。这既保住了"06:00 单一起点"，也不误删首建例外——比"二选一"更完整。
- **已开始的长时段安排被取消**（§4.5 末）：CODEX 指出"保留历史"与"更新客观投影"**不是互斥选项**——保留取消前的实例快照／已提交经历／旧 `SchoolKnowledge`，同时把客观有效区间在取消时刻截断，剩余安排退出有效投影；取消也不等于程序替角色结束行为、更不自动让她知道。这个口径我认可，比我列的两选一更好。

**其余不阻塞的建议**：`recovery.ts:98-99` 删掉对已退役字段的写入（§2）；归档补一份"修复后全量"日志、把计划点名的用例名与实际测试对齐（§7）；以及三项各自列出的可改进项（`addNotice` 的覆盖判断、周记录覆盖写、实例无归档、`find(...)!` 的 unhandled rejection 风险、失败路径不 `releaseOwner`、全表扫描、死代码清理）。

**测试强度提示（合并三路，CODEX 已接受其中大部分）**：`loader_no_write` 无回读断言；`running_restart_keeps_attempt_and_ready_blocks_later_steps` 从未构造 running 步；`shared-v3-scheduler.test.ts:14` 对已退役字段的断言已成偶然通过；`calendar.test.ts:26` 的 `toThrow(/required/)` 被另一分支满足，使"必需通知缺失"从未被单独断言；**没有任何测试调用 `resolveSchoolUpstream`**，所以"公开变化提升 dR、内部备注不提升"目前只有阅读证据。（"周五分支无用例"这条我说错了——`friday_next_week_monday_confirm_same_slot_same_week_id_no_duplicate` 就是它；只有"提前已有下周记录"那个子分支还没有。）

---

## 7. 证据链补记建议

1. **归档里没有"修复后"的全量通过日志。** `execution/` 只有 `final-red.log`（`6 failed | 13 passed`），`task-8-suite.log` 是修复前的 330 项。数字能对上（330 + 6 = 336，且 `3ac2b1b` 确实新增 6 个变体），但直接证据缺失。**CODEX 已在本轮补跑并保存 `runtime/environment-upgrade-backups/review14-evidence/full-suite-1466701.log`（61 文件 / 336 项通过）**，并说明这是事后补验、不冒充交付时的输出——处理得当。
2. ~~正式库 4 个步骤的完成时刻建议记进日志~~ —— **撤回**：那 4 步从未开始（见 §1.1 更正），没有可记的完成时刻。
3. **若干"计划点名的用例名"与实际测试名不一致。** 例如计划任务4 写的 `reschedule_requires_correction_notice`、`read_only_old_version_requires_correction_notice`、`cancel_requires_cancellation_notice`、`notice_deadline_reaches_host_timer`，任务7 写的 `notice_during_shared_and_resume`、`old_config_upgraded_db_plugin_start`，在 `tests/` 里都搜不到同名用例。**但行为本身有覆盖**——更正与取消就在 `world-school-calendar.test.ts:23`（`read_only_old_version_requires_correction_and_candidate_commit_covers_not_week_marker`）与 `:31`（`cancel_requires_cancellation_disabled_policy_not_forced`），截止接线在 `world-school-notices.test.ts:12`。所以这是**标识符对不上**，不是行为缺失。建议补一份"行为 → 实际测试名"的映射表，而不是为改名重写业务测试。

---

## 8. 本次复核的边界

**没有做**：运行测试／构建／demo／smoke；连接模型或 QQ；重放任何在线请求；修改文件；升级或写入正式库（只做只读查询）。

**因此无法验证**：336 项测试的实际通过情况；50 次真实请求的原始记录内容（我只读了报告摘要）；数月连续运行的稳定性；真实 QQ 收发；以及叙事细节漂移在长期使用中的实际影响。报告已把这些登记为待办，我的静态复核不能替代。
