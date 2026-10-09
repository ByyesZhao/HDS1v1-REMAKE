# ASTRA 审核后业务修复细化（F1～F4、D1）

日期：2026-10-09。状态：**已实施；本文件保留实现合同，实际结果见[交付](../records/ASTRA_FIX_DELIVERY_20261009.md)。**

依据：[独立审核](../reviews/ASTRA_REVIEW_20261009.md)、[复现证据](../reviews/AUDIT_EVIDENCE_20261009.md)、[SOL 核验回复](../reviews/CODEX_RESPONSE_ASTRA_REVIEW_20261009.md)。源码核对基线为 `73774bfc6502eefa7bffc23dbb0fa9f873c44494`。执行入口见[统一执行计划](ASTRA_FIX_EXECUTION_PLAN_20261009.md)，后台与性能见[流程细化](ASTRA_FIX_OPERATIONS_IMPLEMENTATION_20261009.md)。

## 1. 核验结论与范围

SOL 的回复没有需要反驳的实质问题，两项范围说明应保留：F2 只影响显式个人提醒中“已知计划、尚未独立获知实例”的路径，默认机构提醒不受影响；F4 是晋升后具体事件失去检索入口，原记录仍在库中。

| 编号 | 修复结果 | 保留的业务规则 |
| --- | --- | --- |
| F1 | 前一活动遗留未读不被下一活动重新归属 | 旧活动身份、普通批次首次可见、活动全文、普通四段各自的规则 |
| F2 | 已知公开计划能确定推导某次课时，个人提醒可发布 | 未知安排、未读更正、取消／失效实例仍不能提醒 |
| F3 | 现场旧课次不覆盖已读的新计划 | 历史课次快照与持续计划知识同时存在 |
| F4 | 具体事件依据和抽象认识均可命中同一认识候选 | canonical 身份、容量、保留与唤醒机制 |
| D1 | 文档写清未入库与已入库提醒的区别 | 已入库且合法的提醒允许延迟发布，不新增积压合并规则 |

本轮实现保持 Node.js `>=22.13.0`、现有 TypeScript／SQLite JSON／Zod／Koishi 栈，不新增依赖或模型。普通合批 15 秒；活动默认 60 秒推进、约第 10 轮软收尾、20 轮上限；普通上下文默认四段、15 分钟断段；记忆 7／90／3／30、容量 100／1000／500／90、深度整理空闲 15 分钟均沿用配置与现有语义。不新增模型输入字数或 token 截断，不启用尚未标定的 semantic 或未装配的搜索。

数据协议继续为 memory=3、memoryCapacity=1、sharedActivity=1、environment=1、dialogueContext=2、模型上下文=1。派生依据和后台任务的兼容字段不构成重做这些迁移的理由。不得自动猜测并修补已经被旧代码改错的历史活动 ID；本次解决后续流转及可以从 canonical 原记录确定重建的记忆投影。

## 2. F1：活动开始只迁移真正普通输入

### 2.1 正常触发链

A 的结束输出已确认，但后处理尚未完成。其间普通邀请 B1 到来；16 秒后的输入创建 B2。A 后处理把末轮没有看见的 A 输入放入 B2。下一轮消费 B1 并开始活动 B，现有 `finishSharedTurn` 又把 B2 中所有未读迁入 B，覆盖旧活动 ID。它不是需要构造损坏库才能出现的问题。

### 2.2 迁移算法

修改 `src/host/shared.ts:finishSharedTurn` 的 start 分支，继续在 `src/recovery.ts:finishPostprocessing` 的 B 事务内执行：

1. 只选择 incoming、`seenTurnId === null`、带普通 `batchId`、`sharedActivityId === null` 的消息。非空活动 ID 绝不覆盖；旧版字段缺失走既有升级／一致性规则，不用 `!sharedActivityId` 擅自把它等同现代普通输入。
2. 对实际迁移的消息调用既有 `chat.acceptMessage`，写入新活动 ID，清 `batchId` 与 `chatEpisodeId`，让原普通段按已有算法 reconcile。
3. `affectedBatchIds` 仅收集实际迁移者的原批次。迁移后，逐批检查是否仍有 incoming、未读、同 `batchId` 消息，**不按活动 ID 过滤残留**。
4. 仅清理已经迁空的 open／pending 批次。有残留的 pending 保持原队列位置；open 保持原 ID 和 `readyAt`，不提前就绪、不重新计 15 秒。无关批次不动。
5. 新活动 `lastInputAt` 只取实际迁入者与时钟已有值的真实时间最大值。已有值可能来自开始确认后到达的本场输入，不能倒退；旧活动残留的时间不能延长本场等待。

现有 shared 调度已经按当前 activity ID、`batchId === null` 隔离输入，应保留。B 进行时，A 的旧批次可正常从 open 转 pending，但不进入 B 的输入、可见消息、活动全文或活动记忆原文，也不被标记已读。旧 pending 不得让 `nextDeadline` 持续返回 now，或阻断 B 自身的自动／手动推进。

B 结束后恢复普通调度，A 残留按原 pending FIFO 首次可见；其 `seenTurnId` 只登记一次。消息仍保留 A 身份，不进入普通四段，也不进入 B 全文。B 自身结束遗留按现有 end 分支处理，不覆盖旧 pending。

`finishPostprocessing` 最后对本轮已选 `turn.batchIds` 的消费不是本次批量重写对象；复现中的残留在未选 B2。不得借此改变睡眠、不可读或已选批次的现有语义。

### 2.3 文件与验收

主改 `src/host/shared.ts`；`src/host/input.ts`、`src/host/scheduler.ts`、`src/recovery.ts`、`src/dialogue/chat-episodes.ts`、`src/dialogue/activity-context.ts` 由集成用例保护，只在证据需要时局部调整。

新增 `tests/shared-v3-cross-activity.test.ts`：

| 测试名 | 必须证明 |
| --- | --- |
| `mixed_open_batch_keeps_old_activity_and_deadline` | 上述 A→B1→B2→B 时间线；A 身份、未读和 B2.readyAt 不变，只有普通 B2 输入迁入 B |
| `mixed_pending_batches_preserve_fifo` | 混合 pending、纯旧场 pending、迁空纯普通 pending 同时存在，只移除迁空者 |
| `activity_clock_uses_only_its_inputs` | 旧场晚输入不影响 B；确认后真正 B 输入形成的更晚时钟不被覆盖 |
| `old_activity_waits_until_new_activity_ends` | B 自动与手动推进、旧 open 到期、deadline、B 结束后首次读取、四段与全文隔离全部贯通 |
| `start_and_end_transfer_replay_atomically` | 确认后／B 前重启、B 事务失败、B 后重复恢复，消息／批次／时钟与一次成功一致 |
| `serial_host_preserves_cross_activity_identity` | 真 `SerialHost`、固定时钟、可控 send／memory Promise 跑合法交错，不只直接调用迁移函数 |

## 3. F3：统一学校知情版本选择

F3 先于 F2 实施，为个人提醒和个人上下文提供同一已知投影。

### 3.1 选择规则

`school_knowledge` 仍保存每次实际获知的历史记录。按 `[entityKind, entityId]` 分组，在确实获知的候选中依次比较：

1. `snapshot.value.deliveryRevision`，公开版本较大者优先。
2. `snapshot.revision`，同公开版本中已获知的记录版本较大者优先。
3. `acquiredAt` 的 epoch 时间，较晚者优先。
4. 完全相同的排序键按稳定输入顺序，后项覆盖。

持久候选保持存储 rowid 顺序；即时候选先持久记录，再按原 observations 数组顺序加入本轮快照，时间取 `happenedAt`。提交也沿用该顺序，保证提交前后投影一致。

plan_item 与 instance 使用不同键；不同课次 ID 独立保留。现场 V1 的历史实例及其 `sourceSnapshot` 不能改成 V2；持续计划则继续展示确实已读的 V2。客观表中未读的 V3 不参与选择。

### 3.2 接口与调用

新增 `src/school/knowledge.ts`，拟新增接口：

```ts
export interface SchoolKnowledgeCandidate {
  snapshot: SchoolEntitySnapshot;
  acquiredAt: string;
}
export function selectKnownSchoolSnapshots(
  candidates: readonly SchoolKnowledgeCandidate[]
): SchoolEntitySnapshot[];
```

纯函数不接受 Storage，不读取客观最新版。`calendar.ts:knownSchoolSnapshots(storage)` 保留外部门面，委托此选择器；`context.ts:personalSchoolContext` 将持久与即时候选一起送入选择器，之后再做 query／可见键过滤。`observedKey` 只表示本轮触及该实体必须可见，不赋予低版本覆盖权。`progress.ts` 继续保存真实观察及经历，不删除旧计划记录。

新增 `tests/world-school-knowledge-version.test.ts`，核心场景为 09:00～11:00 旧课次、09:15 更正未来安排、09:20 读 V2、09:30 现场看见 V1：

| 测试名 | 必须证明 |
| --- | --- |
| `onsite_old_instance_preserves_new_known_plan` | prepare 的 visibleSnapshots、即时个人上下文、提交后 knownSchoolSnapshots 都为计划 V2＋实例 V1；原始旧知识确实保留 |
| `unread_correction_remains_unknown` | 客观 V2 未读时个人、补查、expression 均不出现新信息 |
| `same_turn_projection_matches_committed_projection` | 更正和现场观察两种数组顺序、同／不同时间均不回退；同公开版本按已知 revision 选择 |
| `historical_instances_remain_distinct` | 同源多个课次及旧地点仍独立；新计划不抹除历史 |
| `knowledge_replay_is_atomic` | B 失败回滚、重启、重复 finish 投影一致；至少一项真实 App 用例检查个人、lookup、expression 的实际模型输入 |

## 4. F2：用已知计划确定推导个人提醒资格

### 4.1 方案取舍

采用“资格判断时从已知计划推导目标课次”，不在读 issue 时预写全部实例知识。后者会膨胀知识台账，也把未实际观察的实例变成获知记录。发布资格检查只读；真正读 reminder 后，仍由既有观察提交写入 plan／instance 知识。

### 4.2 资格矩阵

机构渠道继续沿用现有合法性判断，不增加个人知情要求。个人提醒的每个 payload 快照必须满足以下规则：

| 快照 | 可以通过的依据 | 不能通过的替代品 |
| --- | --- | --- |
| plan_item | 已知同 entityId、同 deliveryRevision 的计划 | 客观最新版、仅同 revision、未读更正 |
| instance | 已知同 instance ID／sourceItemId／deliveryRevision，且具体开始、结束时间一致 | 只匹配 ID 或公开版本 |
| 尚未独立已知的 instance | 已知同 sourceItemId、同 deliveryRevision、status=open 的计划，可确定推导出该 occurrence 与时间 | 目标实例自带 sourceSnapshot、客观计划、含糊时间 |

记录 `revision` 与公开 `deliveryRevision` 必须区分：内部 stageInfo 变更不使原公开知识失效。

推导复用现有 calendar 时段算法，比较 `sourceItemId`、`target.baseOccurrenceKey ?? target.occurrenceKey`、`startsAt`、`endsAt`。时间按 epoch 比较，null 结束时间需一致。

- once：精确开始／结束时间，基础键 `[itemId,'once']`。
- deadline：必须有非 null 的精确 `at`，基础键 `[itemId,'deadline']`，结束为 null；只有 date／note 不足以推导。
- weekly：使用目标 `weekStart` 定位周，按**配置 timezone**从已知 slotKey／weekday／start／end、startsOn／endsOn 重新计算；基础键 `[itemId,slotKey,weekStart]`。`end <= start` 按原算法跨午夜。
- tentative：不能推导精确实例。

历史保护生成的 future successor 使用基础 occurrence 键比较，不要求 successor 的 ID 等于最初实例 ID。错周、错 slot、错时间、超出日期范围、未读公开版本均不通过。

客观记录只用于否决已失效提醒：取消、当前公开版本不一致、实例非 active／待重新展开、开始时间已过，不能借客观数据补知识。保留既有 `< now` 过期边界，即 `now === startsAt` 不额外改成过期。

### 4.3 接口与文件

新增 `src/school/timing.ts`，从 calendar 提取现有私有 occurrences 及所需日期计算，不重写算法：

```ts
export function schoolItemOccurrences(
  item: SchoolPlanItem, weeks: string[], now: string, timezone: string
): RequiredOccurrence[];
```

在 `src/school/notices.ts` 新增纯辅助函数（可以导出供测试使用）：

```ts
export function knownPlanCoversInstance(
  knownPlan: SchoolPlanItem, target: SchoolInstance,
  now: string, timezone: string
): boolean;
```

四个现有导出 `releaseSchoolNotices`、`selectSchoolNotices`、`schoolNotificationEligible`、`schoolNoticeDeadline` 均增加第三个必需参数 `timezone: string`。生产调用在 `src/host/scheduler.ts` 统一传 `this.config.timezone`；更新直接调用的测试。四个入口共用同一个人资格 helper，避免发布已修复、deadline 却不唤醒。F6 的同调度只读上下文复用在后续步骤添加，不在此引入长期缓存。

新增 `tests/world-school-personal-reminder.test.ts`：

| 测试名 | 必须证明 |
| --- | --- |
| `v1_issue_unlocks_derived_personal_reminder` | 真实 V1 环境展开→读 issue 仅登记 plan→到期发布／选择／eligible／deadline 一致，资格检查本身不写 instance 知识 |
| `known_timing_must_match_target_occurrence` | once、精确 deadline、weekly 正向；日期描述／tentative、错身份或时间均拒绝；等时不同 ISO 偏移允许 |
| `weekly_uses_configured_timezone_and_midnight_rules` | 非默认 timezone、跨午夜、startsOn／endsOn 边界及 successor 基础键 |
| `public_revision_controls_knowledge_eligibility` | 内部 revision 改而公开版本未改仍可用；未知事项／未读更正不能解锁；机构通知仍可先告知 |
| `invalid_or_elapsed_instances_do_not_remind` | 取消、待展开、旧公开版本、开始后不提醒，等于开始时刻保留原边界 |
| `reading_derived_reminder_commits_instance_once` | 真正阅读后才写知识，事务失败及恢复不重复 |

正向入口必须走 `runEnvironmentStep`／V1 `resolveSchoolWeekText` 与真实观察提交，不能只用 V0 fixture 或手工插 knowledge 代替完整链。

## 5. F4：同一认识候选承载结论与规范事件依据

### 5.1 选定方案

继续排除 durable long 的普通检索候选，继续以 learned 候选承载晋升结果。晋升时立即填充现有 `projectionBasis`，词法命中也包含该依据。这样事件独有词和抽象结论都能找回同一个 learned ID，模型同时得到结论与有来源的事件依据。

不采用“把 durable long 全部重新加入候选”：那会引入同一 canonical 的 long／learned 双重呈现，以及容量、唤醒归属的额外处理。也不新增第二类检索 facet、不把所有认识改为 alwaysInclude。

### 5.2 晋升、同步与检索合同

1. `MemoryLifecycle.promote` 在保存 learned 前，解析主 canonical long，填 `projectionBasis={content,sourceIds,revision}`。保留 learned.content 的抽象结论；stable_understanding 不被具体事件内容覆盖。
2. 同时规范 canonical／evidence 引用及 `evidenceVersions`，版本取本次晋升后实际保存的 owners（包括主事件转 durable 后的 stateVersion）。正文依据只来自**主 canonical**；其他 evidence 继续保留原生命周期，本次不扩成“所有关联事件永远可召回”。
3. `synchronizeProjections` 与初次晋升使用同一投影计算规则。主事件真实内容变化后同步依据；merged 链解析到规范身份，不能制造第二份 learned。
4. learned 的词法文本使用现有 `memoryIndexText`，因此与向量索引包含相同依据。detail 的直接 key／alias 路由及非 learned 的原词法文本保留；不要顺手改变检索门限或事实路由。
5. 索引正文真正变化才增加 `revision` 并排新向量；仅 source／状态元数据变化只按既有规则增加 `stateVersion`。`memoryIndexText` 已支持 projectionBasis，本次不改模板签名，不全库重嵌入。
6. 返回上下文保留有标签的 `content` 与 `projectionBasis`，沿用 `memoryOwnerData`，不剥掉依据。一个结论同时命中两条路线只呈现一次，且不同时返回其 durable 原 long；不同 stable_understanding 即使共享 canonical，也不能粗暴合并掉不同结论。
7. 检索和兼容补齐不写 awakening／retention grant、不刷新 expiresAt，不把 durable 主事件重新计入普通长期容量。semantic 仍可为 null；F4 必须在纯词法下修复。

### 5.3 旧库已晋升记录的兼容补齐

新增幂等方法 `MemoryLifecycle.repairLearnedProjections(at: string): ProjectionRepairReport`，报告包含 `changedOwnerIds: string[]`、`reindexedOwnerIds: string[]`、`missingCanonicalIds: string[]`。扫描 active learned，比较其主 canonical 所派生的依据，只写有差异的记录；修复与相应 queueIndex／queueDirty 在同一事务完成。兼容补齐只修依据及真实证据引用，不借用完整同步逻辑改写旧 durable_experience 的既有表述。

补齐由串行 Host 的进程内 `projectionRepairPending = true` 控制，每次启动只扫描一次；不增加永久版本键。调用位置在旧轮恢复完成、`this.recover = false` 之后，`scheduler.collectReady()` 之前，要求**无未完成前台轮、无正在运行的后台 prepare**。事务成功后关闭进程标记，重启再幂等检查一次。`maintenance.inFlight` 为真时不补齐，依靠完成回调下一次 pump 重试；paused 时等 resume。启动存在旧未完成轮时先用原冻结输入恢复，不能为了补齐重建该轮提示。不要因补齐待执行而阻断新用户输入的接收。

已保存 ready 或已开始后退回 pending 的整理任务不改 snapshot／readSet／cutoff／网页 checkpoint。补齐改变其依赖版本时，旧结果按既有应用门禁判 stale 并重排最新 dirty；不能偷改 readSet 使旧结果通过。新索引使用新 revision，旧向量自然不再匹配；正确依据及向量不重复失效。已有同 job ID 的 done 向量任务不会挡住正文变化后的新 revision 任务。

主 canonical 缺失或 merged 链无法解析时，不编造来源、不生成替代事件；将该 ID 写入兼容报告与启动告警，本次启动不无限重复扫描。执行验收把这种已有数据异常单独列为未解决项，不将它宣称为 F4 已全部补齐。正常完整旧库必须首次补齐成功、再次执行零变更。该处理不是新增全库数据清洗项目。

主改 `src/memory/lifecycle.ts`、`src/memory/retrieval.ts`；按需要补 `src/memory/types.ts` 的报告类型及 `src/host/runtime.ts` 的一次性兼容调用。`src/memory/store.ts` 复用现有正文、队列、canonical 接口，不取消 durable 排除。

新增 `tests/memory-projection-retrieval.test.ts`：

| 测试名 | 必须证明 |
| --- | --- |
| `promotion_keeps_event_and_conclusion_lexically_retrievable` | 30 个有效模拟日期晋升、alwaysInclude=false、semantic=null，晋升前后同一事件独有词可命中；结论词也命中同 learned；无 durable long 重复 |
| `projection_text_and_vector_revision_change_together` | 事件更新后依据和索引正文一致；仅状态／来源更新不重嵌入；旧 revision 向量不匹配 |
| `canonical_merge_preserves_one_projection` | merged 主身份、evidence 引用与版本规范化，不多造 learned，不把所有 evidence 永久化 |
| `legacy_projection_backfill_is_idempotent` | 已晋升旧记录无 basis→补齐可召回；二次零变化；容量、唤醒、保留时间不变 |
| `backfill_preserves_frozen_turn_and_ready_job` | 未完成前台先恢复；后台 inFlight 时延期；ready／恢复 pending 输入不改，版本过时结果按原门禁处理 |

## 6. 文档同步与完成边界

实现各项时同步对应 V0.5 子系统文档与实现映射，明确 F1 身份保留、F2 推导资格、F3 公开版本优先、F4 结论与依据同候选。学校旧细化中仅按获知时间投影的规则应加“被本次版本选择规则取代”的定位说明，历史验收数字保持原样。

D1 在导演／调度文档中补一句明确例外：**未保存且已错过发布时间的提醒不再补建；已保存、仍合法的提醒保留延迟发布与重放，因此可能同时变为可用。** 运行既有 `already_committed_reminders_keep_delayed_publication_and_replay_state` 回归，不实现新合并策略。

本方案制定时未修源码、未执行正式库补齐、未运行新回归。实施完成需满足统一执行计划中的离线、集成、恢复及性能验收，再单独记录实际结果。
