# ASTRA 审核后修复执行计划

> **For agentic workers:** 执行时使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，逐任务验证与记录。本文件现为已执行计划；复选框依据本轮新日志勾选，见[交付](../records/ASTRA_FIX_DELIVERY_20261009.md)与[过程](../records/ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)。

**Goal：** 修复 F1～F4 的业务逻辑，减少 F5～F7 的无效工作与历史量开销，恢复 F8 的离线 smoke，并补齐 D1 文档口径。

**Architecture：** 保留串行 Host、公开确认／B 事务、冻结恢复和当前数据协议。业务修复使用活动身份筛选、共用学校知情投影、已有记忆 projectionBasis；性能分为快照复用、SQL 条件查询、工作集检查和有界状态展示，分别验收。

**Tech Stack：** Node.js `>=22.13.0`、现有 TypeScript／SQLite JSON／Zod／Koishi／Vitest，不增加依赖或模型。

**Spec：** [业务细化](ASTRA_FIX_BUSINESS_IMPLEMENTATION_20261009.md)、[流程与性能细化](ASTRA_FIX_OPERATIONS_IMPLEMENTATION_20261009.md)。开始执行前读两份全文；[SOL 核验](../reviews/CODEX_RESPONSE_ASTRA_REVIEW_20261009.md)和[原始证据](../reviews/AUDIT_EVIDENCE_20261009.md)用于追溯，不替代本计划的正确行为断言。

日期：2026-10-09。源码核对基线：`73774bfc6502eefa7bffc23dbb0fa9f873c44494`。**T1～T13已实施，完整离线验收通过；正式部署不在本轮范围。**

## 全局约束

- 普通合批 15 秒；活动默认 60 秒推进、约第 10 轮软收尾、20 轮上限；普通上下文默认四段、15 分钟断段，保留用户已有配置。
- 记忆 7／90／3／30、默认容量 100／1000／500／90、深度整理空闲 15 分钟不变；查询、补齐不得制造唤醒或续期。
- memory=3、memoryCapacity=1、sharedActivity=1、environment=1、dialogueContext=2、模型上下文=1；不新增整体迁移或全库向量重建。
- 不新增模型输入字数／token 截断，不启用未标定 semantic 或未装配搜索；不以删历史、减少活动全文解决性能问题。
- 仅修改本计划对应源码／测试／文档。执行开始记录 `git status --short`；保留现有未提交审核文档、`DSH-review/` 和运行材料，不用 `git add .`。
- 测试用临时库、合成数据、固定时钟、假模型／Embedding；不读 key.txt、人物私有背景、正式配置或正式故事库，不发送真实 QQ。
- 新旧字段只处理已有正式／legacy 语义，不把本轮扩大为安全加固或任意非法数据防御。
- 旧 evidence 是历史证据：其中一些测试在断言错误现状，修复后不应继续要求其原断言通过。新增正式回归采用相反的正确预期，保留旧证据文件。

## 审查重点

| 容易遗漏的条件 | 预期 | 对应任务 |
| --- | --- | --- |
| 公开开始已确认、B 事务尚未完成时又来输入 | 身份与时钟不串场，恢复结果等同一次提交 | T2 |
| 本轮同时读更正和旧现场，或 weekly 跨午夜／非默认时区 | 计划不回退，个人提醒仅覆盖可精确推导实例 | T3、T4 |
| 旧前台未完，后台 ready 或失败后 pending | 原冻结输入和 checkpoint 不被补齐／优化覆盖 | T5、T7、T8 |
| 远古 orphan 被新任务／记忆引用，或原普通段被迁空 | 原有门禁仍有效，必要时回退完整审核 | T11 |
| HTTP 已返回但环境／索引尚未提交，环境步骤不在 turns 表 | smoke 不早报成功，状态不漏当前环境 owner | T1、T6 |

## 任务顺序、依赖与提交方式

| 任务 | 可独立交付的结果 | 前置 |
| --- | --- | --- |
| T1 | 两场景真实 Koishi 离线 smoke | 无 |
| T2 | F1 跨活动归属修复 | T1 提供验收入口 |
| T3 | F3 学校知情版本投影 | 无；建议接 T2 |
| T4 | F2 个人提醒推导、D1 | T3 |
| T5 | F4 晋升召回与旧投影补齐 | 无；建议接 T4 |
| T6 | F7 有界状态与诊断分离 | 可独立；与 Host 改动串行合并 |
| T7 | F5 整理任务的空闲冻结／恢复分类 | T5 |
| T8 | F5 索引合并与公平调度 | T7 |
| T9 | F6-A 单次完整审核快照复用 | 可独立 |
| T10 | F6-B SQL 查询等价替换 | T2、T9 |
| T11 | F6-C 工作集检查与消费边界 | T5、T8、T10 |
| T12 | 学校一次调度资格复用 | T3、T4 |
| T13 | 合成性能、完整回归、交付记录 | T1～T12 |

推荐按表顺序执行，共享 `host/runtime.ts`、memory 和 school 文件的任务不要并行改同一工作区。可并行编写独立测试或检查不同模块。执行时如需要隔离，使用新 worktree／分支 `codex/astra-v05-fixes`，起点必须包括用户当前已确认代码及需要的审核材料；实际使用隔离实现分支并在完成后集成本地main。

每项验证通过后形成独立提交或等价的可审查差异；建议提交名写在各任务末尾。只显式暂存本任务文件。若用户未要求提交，可保留分任务日志与差异，不把提交命令当业务验收。

下文“同步 V0.5 文档”的准确文件映射如下；只更新相关段落，不提前把待实施能力写成当前行为：

| 主题 | 文件 |
| --- | --- |
| 导演／学校 | `docs/v0.5/subsystems/REMAKE_V0.5_DIRECTORS.md` |
| 调度 | `docs/v0.5/subsystems/REMAKE_V0.5_SCHEDULING.md` |
| 共同活动 | `docs/v0.5/subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md` |
| 上下文 | `docs/v0.5/subsystems/REMAKE_V0.5_CONTEXT.md` |
| 记忆 | `docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md` |
| 恢复 | `docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md` |
| 搜索 | `docs/v0.5/subsystems/REMAKE_V0.5_WEB_SEARCH.md` |

以下命令从 `D:\HDSI-remake` 执行。新增文件的测试命令只在创建后运行；FAIL 应来自目标行为而非导入错误或测试环境失败。若本机 Vitest 进程被沙箱阻挡，应按实际限制调整运行方式并记录，不能把 EPERM 记成回归失败或成功。

---

## T1：恢复 F8 的 smoke

**文件：** 修改 `runtime/plugin-smoke.cjs`；新增 `runtime/plugin-smoke-fixtures.cjs`、`tests/plugin-smoke-contract.test.ts`；如入口说明有变化同步 `README.md`。

**接口：** 消费现有模型 envelope／EnvironmentStep V1；产出流程细化 §1 的 `parseEnvelopeRequest`、`mockEnvironmentResponse`、`waitForEnvironmentBatch`、`runScenario` 四个 CJS helper。

- [x] 写协议与等待失败测试：正确的嵌套 stage 可解析；旧顶层 stage 不算成功；week 缺／重复 key 或 V0 输出不通过；HTTP 已达数量但四步未 committed 时 Promise 仍 pending；失败终态带阶段诊断。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/plugin-smoke-contract.test.ts`，记录对应旧行为失败；另运行当前 `npm run smoke --prefix runtime` 保存原失败，作为脚本修复前证据。
- [x] 按流程细化 §1 实现两个独立临时场景、固定时钟／sleep、fake fetch、按同 batch 四步终态等待、索引独立等待与 finally 清理。
- [x] 重跑 helper 测试；运行 `npm run build` 后 `npm run smoke --prefix runtime`。预期两个场景均退出 0，分别四步 committed／生成 3 与 4 次、Embedding 各 1 次、repair 0。
- [x] 记录实际 batch/step 终态摘要及 fake 请求分布；建议提交 `test: repair offline environment smoke contracts`。

关键验收不是 `requests === 4`，而是先 `batch.status === 'committed' && steps.every(s => s.status === 'committed')`，再检查调用数。

## T2：修复 F1 跨活动输入与批次

**文件：** 修改 `src/host/shared.ts`；新增 `tests/shared-v3-cross-activity.test.ts`；更新 V0.5 共同活动／上下文文档。scheduler／recovery 仅在集成证据要求时局部改。

**接口：** 消费既有 `finishSharedTurn`、`chat.acceptMessage` 与 open/pending 数据；不新增持久字段或对外接口。

- [x] 写业务细化 §2.3 的六项回归，至少一项真 SerialHost＋可控发送／后处理延迟。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/shared-v3-cross-activity.test.ts`；预期旧 A 消息被改成 B 或残留批次被清除等目标失败。
- [x] start 筛选显式普通输入，迁移后按全部残留判断批次是否清空；只用真迁入消息更新 lastInputAt，保留 FIFO／readyAt／B 事务边界。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/shared-v3-cross-activity.test.ts tests/shared-v3-input.test.ts tests/shared-v3-flow.test.ts tests/shared-v3-scheduler.test.ts tests/shared-v3-recovery.test.ts tests/activity-context.test.ts tests/chat-flow.test.ts tests/chat-recovery.test.ts`，全部通过。
- [x] 同步身份／窗口说明，建议提交 `fix: preserve unread messages from previous activities`。

核心断言：`old.sharedActivityId === 'A'`、`old.seenTurnId === null`、`open.readyAt === before.readyAt`；B 期间各可见／全文集合不含 old；B 结束后普通轮仅首次标 seen。

## T3：修复 F3 学校知情投影

**文件：** 新增 `src/school/knowledge.ts`、`tests/world-school-knowledge-version.test.ts`；修改 `src/school/calendar.ts`、`src/school/context.ts`；同步 V0.5 导演／上下文说明及旧 `docs/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md` 的版本选择定位说明。

**接口：** 产出 `SchoolKnowledgeCandidate`、`selectKnownSchoolSnapshots(candidates: readonly SchoolKnowledgeCandidate[]): SchoolEntitySnapshot[]`；`knownSchoolSnapshots(storage)` 保持签名。

- [x] 写业务细化 §3 的五项回归，涵盖 prepare／即时／提交后投影以及至少一次实际个人／lookup／expression 模型输入。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/world-school-knowledge-version.test.ts`；预期“读 V2 后现场 V1”在即时或持久结果回退。
- [x] 实现纯选择器：公开版本→记录 revision→epoch 获知时间→稳定输入顺序；持久和本轮候选合并后再筛可见键，不触碰客观最新版或历史实例。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/world-school-knowledge-version.test.ts tests/world-school-perspective.test.ts tests/world-school-story.test.ts tests/world-school-integration.test.ts`，全部通过。
- [x] 同步最新规则与历史被取代说明，建议提交 `fix: retain newer known school plans after onsite observations`。

核心断言：计划 `deliveryRevision === 2`，旧实例仍 `deliveryRevision === 1`，未读 V2 的场景只见 V1；提交前后投影相等。

## T4：修复 F2 推导个人提醒并补 D1

**文件：** 新增 `src/school/timing.ts`、`tests/world-school-personal-reminder.test.ts`；修改 `src/school/calendar.ts`、`src/school/notices.ts`、`src/host/scheduler.ts` 及直接调用通知函数的测试；更新 V0.5 导演／调度文档。

**接口：** 消费 T3 已知投影；产出 `schoolItemOccurrences(item, weeks, now, timezone): RequiredOccurrence[]`、`knownPlanCoversInstance(knownPlan, target, now, timezone): boolean`。四个通知导出增加必需第三参数 timezone，返回类型保持原样。

- [x] 写业务细化 §4.3 的六项回归；正向用生产 V1 下发→读 issue→到期 reminder，加入配置 timezone／跨午夜／successor／内部 revision 与公开版本分离。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/world-school-personal-reminder.test.ts`；预期只知 plan 的合法个人提醒仍 scheduled、eligible=false 或 deadline=null。
- [x] 提取现有时段算法，共用资格判断，透传 `config.timezone`；保留机构通知和实际读后才记知识的流程。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/world-school-personal-reminder.test.ts tests/world-school-notices.test.ts tests/world-school-calendar.test.ts tests/world-school-review14-calendar.test.ts tests/world-school-review14-time.test.ts tests/school-week-text-contract.test.ts tests/school-week-contract-recovery.test.ts`，全部通过。
- [x] 写清 D1 已入库合法提醒可延迟发布，保留并通过既有 delayed publication 回归；建议提交 `fix: derive personal reminders from known public schedules`。

核心断言：到期后 release／select／eligible／deadline 一致，`knowledge.length` 不因资格检查增加；未读更正仍不通过，institution 正常。

## T5：修复 F4 记忆事件依据的召回

**文件：** 修改 `src/memory/lifecycle.ts`、`src/memory/retrieval.ts`、`src/memory/types.ts`、`src/host/runtime.ts`；按需要调整 `src/deployment/memory-runtime.ts` 装配顺序；新增 `tests/memory-projection-retrieval.test.ts`；同步 V0.5 记忆／恢复文档。

**接口：** 产出 `ProjectionRepairReport`（changedOwnerIds／reindexedOwnerIds／missingCanonicalIds）与 `MemoryLifecycle.repairLearnedProjections(at: string): ProjectionRepairReport`；复用既有 `memoryIndexText`、projectionBasis／canonical／queueIndex。

- [x] 写业务细化 §5.3 的五组回归，并补同 canonical 不同稳定结论均保留、durable_experience 旧表述不被兼容补齐重写。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-projection-retrieval.test.ts`；预期晋升后事件独有词无命中，或旧记录补齐／恢复顺序失败。
- [x] 晋升初存即填主事件依据与真实证据版本；learned 词法使用已有索引正文；实现进程一次性幂等补齐，先恢复旧前台，保留后台冻结输入。只在文本变化时增 revision／排向量。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-projection-retrieval.test.ts tests/memory-v3-lifecycle.test.ts tests/memory-v3-retrieval.test.ts tests/memory-v3-index.test.ts tests/memory-v3-recovery.test.ts tests/memory-capacity-lifecycle.test.ts tests/memory-capacity-retrieval.test.ts tests/review17-identities.test.ts tests/review17-promotion-audit.test.ts`，全部通过。
- [x] 记录补齐报告／两次执行差异与冻结恢复证据，建议提交 `fix: retain event evidence in promoted memory retrieval`。

核心断言：semantic=null、alwaysInclude=false 时事件词／结论词命中同 learned；basis 含原事实；原 long 不重复；再次补齐 changed=[]；capacity/grants/awakenings/retention 均不变。

## T6：实现 F7 有界网页状态

**文件：** 修改 `src/web/types.ts`、`src/web/store.ts`、`src/web/service.ts`、`src/host/runtime.ts`、`src/memory/maintenance.ts`；新增 `tests/web-status.test.ts`，扩 `tests/web-host.test.ts`；同步 V0.5 搜索文档。

**接口：** 产出 WebOwnerRef／WebStatusSummary、Store／Service 的 `statusSummary(currentOwners)`，以及 `MemoryMaintenance.currentWebOwner(): WebOwnerRef | null`；完整 operationalStatus 留作诊断。

- [x] 写流程细化 §6 的增长／额度／只读测试，增加正在执行 environment step 时普通 turns 为空仍可显示该 owner 的用例。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/web-status.test.ts tests/web-host.test.ts`；先通过现有 Host.status 验证旧输出随历史线性增大，取得目标失败，再逐步补新摘要接口的断言。
- [x] SQL 聚合 totals、owner 条件受限投影；Host 跟踪当前 environment step，维护 current prepare owner，渲染最多 3×6 阶段／2,048 字符网页摘要，不删除记录。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/web-status.test.ts tests/web-store.test.ts tests/web-host.test.ts tests/web-recovery.test.ts tests/web-session.test.ts`，全部通过；10→1000 轮固定条件网页文本增长 ≤64 字符。
- [x] 记录输出增长与 raw 记录无变化，建议提交 `perf: bound operational web status output`。

## T7：实现 F5 整理任务的预开始刷新

**文件：** 修改 `src/memory/types.ts`、`src/memory/store.ts`、`src/memory/maintenance.ts`；新增 `tests/memory-pending-refresh.test.ts`；同步 V0.5 记忆／恢复文档。

**接口：** 产出 job `startedAt?: string|null`、`releaseDirtyVersion(owner: OwnerVersion): void`；maintenance 私有 `buildSnapshot(rows: MemoryCandidate[]): MemoryCandidate[]` 与 `refreshUnstarted(job: MaintenanceJob, now: string): MaintenanceJob | null`。消费 T5 的正常 dirty／revision 行为。

- [x] 写流程细化 §2.4 中 idle_wait、dependency_closure、started/legacy、post_dispatch、daily_cutoff 回归；包括 t=0/5/20 分时间线及新旧 dirty 精确预留。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-pending-refresh.test.ts`；预期 0 分已建旧 snapshot 或后续首次请求仍使用旧版。
- [x] 分离到期登记与空闲冻结；新任务显式 null；dispatch 同事务刷新完整闭包、更新预留、持久 startedAt；旧 unknown／重试／ready 输入保持。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-pending-refresh.test.ts tests/memory-idle-consolidation.test.ts tests/memory-idle-policy.test.ts tests/memory-idle-recovery.test.ts tests/memory-idle-host.test.ts tests/memory-v3-maintenance.test.ts tests/memory-v3-recovery.test.ts tests/memory-capacity-prune-race.test.ts`，全部通过。
- [x] 记录 t=20 首次请求新版且仅一次、旧任务恢复零改写，建议提交 `perf: freeze maintenance snapshots when work starts`。

## T8：实现 F5 索引合并与公平调度

**文件：** 修改 `src/memory/store.ts`、`src/memory/maintenance.ts`；仅续调度需要时改 `src/host/runtime.ts`；新增 `tests/memory-index-coalescing.test.ts`，扩 `tests/memory-idle-fairness.test.ts`。

**接口：** 消费 T7 startedAt 分类；queueIndex 原签名、startOne 原 boolean 返回保持。产出明确未开始 pending 的合并／预检规则及 20 项清理后 nextDeadline 续调度。

- [x] 写 r1/r2/r3、纯 stateVersion、开始后变化、旧 pending checkpoint、冷热 owner 公平和超过 20 项清理回归。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-index-coalescing.test.ts tests/memory-idle-fairness.test.ts`；预期旧 revision 多发 Embedding，或旧任务占位导致目标公平断言失败。
- [x] 合并未开始同 owner／签名任务、调用前筛 revision／状态／签名；保留未服务队位、已服务后新版本重新排队；bounded housekeeping 不计 backendRequests 并让出事件循环。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/memory-index-coalescing.test.ts tests/memory-idle-fairness.test.ts tests/memory-v3-index.test.ts tests/memory-v3-maintenance.test.ts tests/memory-v3-recovery.test.ts tests/review7-maintenance.test.ts tests/review17-capacity-cost.test.ts`，全部通过。
- [x] 记录请求计数、实际服务顺序及无孤立 reserved，建议提交 `perf: coalesce unstarted memory indexing jobs`。

## T9：实现 F6-A 完整审核快照复用

**文件：** 新增 `src/dialogue/chat-window.ts`、`tests/chat-window-snapshot.test.ts`；修改 `src/dialogue/types.ts`、`src/dialogue/chat-episodes.ts`、`src/dialogue/window-consistency.ts`。

**接口：** 产出流程细化 §3 的 ChatWindowSnapshot／ChatEligibility／recentFromSnapshot；外部 recent 与 checkWindowConsistency 签名保留。

- [x] 写旧算法 oracle 差分与每表读取次数断言，覆盖两资格、跨偏移、40+条单段、outbox 排序及活动排除。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/chat-window-snapshot.test.ts`；旧实现一次 full audit 的 messages 全读次数 >1，目标计数失败。
- [x] 提取纯窗口选择；full audit 一次读各表，建 Map，两资格各算一次，无跨调用缓存。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/chat-window-snapshot.test.ts tests/chat-episodes.test.ts tests/chat-consistency.test.ts tests/chat-upgrade.test.ts tests/review24-dialogue.test.ts`，全部通过。
- [x] 记录结果等价与读取次数，建议提交 `perf: reuse dialogue audit snapshots`。

## T10：实现 F6-B 条件查询

**文件：** 修改 `src/storage.ts`、`src/dialogue/store.ts`、`src/dialogue/chat-episodes.ts`、`src/dialogue/activity-context.ts`、`src/host/scheduler.ts`；用同接口替换 `src/memory/organize.ts` 的 turn 输出全扫；新增 `tests/storage-queries.test.ts`。

**接口：** 产出流程细化 §4 的 unfinishedTurns／unseenIncomingMessages／unreadActivityMessages／messagesByIds／messagesByTurn／messagesByChatEpisode／messagesByActivity／openChatEpisodes；原 outbox／unreadMessages／unfinishedTurn 保持签名和排序。

- [x] 写现代＋已有 legacy 的旧算法 oracle、返回数组顺序及解码行数断言；覆盖显式 null／缺失、旧活动普通批次、open 不存在、不同 ISO 偏移。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/storage-queries.test.ts`；先证明现状目标热点解码无关记录，或新方法搭出等价基线后计数失败。
- [x] SQL 筛选、rowid 稳定取回、JS epoch 排序；替换明确热点调用；按 EXPLAIN QUERY PLAN 仅补所需索引，不泛改 Storage API。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/storage-queries.test.ts tests/storage.test.ts tests/chat-episodes.test.ts tests/chat-consistency.test.ts tests/activity-context.test.ts tests/shared-v3-cross-activity.test.ts tests/scheduler.test.ts tests/recovery.test.ts`，全部通过。
- [x] 保存查询计划及 oracle 结果，建议提交 `perf: filter dialogue hot queries in sqlite`。

## T11：实现 F6-C 日常工作集检查

**文件：** 新增 `src/dialogue/active-consistency.ts`、`tests/chat-active-consistency.test.ts`、`tests/chat-input-cost.test.ts`；修改 `src/dialogue/window-consistency.ts`、`src/dialogue/types.ts`、`src/host/runtime.ts`、`src/host/input.ts`、`src/dialogue/chat-episodes.ts`、`src/dialogue/activity-context.ts`、`src/app.ts`、`src/recovery.ts`、`src/memory/organize.ts`、`src/memory/lifecycle.ts`、`src/memory/maintenance.ts`、`src/memory/retrieval.ts`；同步 V0.5 上下文／恢复文档。

**接口：** 消费 T10 查询、T9 共享判定与 T2 迁移行为；产出 `ActiveWindowScope`／`checkActiveWindowConsistency(storage, options, scope): WindowConsistencyReport`，完整 checkWindowConsistency 继续可用。

- [x] 写流程细化 §5.3 的全部场景，特别是旧 orphan 经六类引用重新 protected、两种 unfinished、confirmed opening、迁空普通段 fallback；控制输入 `【推进】` 和重复平台输入不得被当不存在的新 message。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/chat-active-consistency.test.ts tests/chat-input-cost.test.ts`；旧路径在 1k/10k/50k 固定工作集下全量读取／解码的计数断言失败。
- [x] 先提取共同判定并接入 §5.2 全部写入／消费边界；required 与非消息 source 分开；startup/resume/首次 acceptInput 和稀有破坏窗口证据的变更保留 full audit。完成接入后才切换日常 acceptInput。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/chat-active-consistency.test.ts tests/chat-input-cost.test.ts tests/chat-consistency.test.ts tests/chat-flow.test.ts tests/chat-recovery.test.ts tests/chat-upgrade.test.ts tests/shared-v3-cross-activity.test.ts tests/activity-memory-context.test.ts tests/web-memory-sources.test.ts tests/review24-dialogue.test.ts`，全部通过。
- [x] 日志列明各生产边界的真实函数名、fallback 原因及固定工作集读取计数；建议提交 `perf: check active dialogue state on routine input`。

此任务未通过时允许保留 T9/T10 的等价优化，但必须把 F6-C 标为未完成，不能宣称完整性能目标达成。不得通过减少保护集合让计数测试变绿。

## T12：复用一次学校调度的资格视图

**文件：** 修改 `src/school/notices.ts`、`src/host/scheduler.ts`；新增 `tests/school-notice-evaluation.test.ts`。

**接口：** 消费 T3 已知投影和 T4 timezone 资格；产出 `SchoolNoticeEvaluationContext` 与 `createSchoolNoticeEvaluationContext(storage)`。四个通知函数新增可选第四参数 context，前三参数不再变更。

- [x] 写 K 个提醒、多快照的读取计数／结果等价用例，release 后立即 select 必须看到新 available；未读更正和 institution 结果与逐条判断相同。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/school-notice-evaluation.test.ts`；预期重复读取 school_knowledge 超过一次。
- [x] 单次 collectReady／nextDeadline 共用 known/items/instances 只读 Map，不缓存 notices 状态、不跨 await；缺 context 的直接调用自行构造。
- [x] 运行 `node node_modules/vitest/vitest.mjs run tests/school-notice-evaluation.test.ts tests/world-school-personal-reminder.test.ts tests/world-school-knowledge-version.test.ts tests/world-school-notices.test.ts tests/world-school-integration.test.ts`，全部通过。
- [x] 记录每次调度 school_knowledge 全读 ≤1，建议提交 `perf: reuse school notice eligibility within scheduling`。

## T13：最终验收与交付记录

**文件：** 新增 `scripts/bench-chat-status.cjs`、`docs/v0.5/records/ASTRA_FIX_DELIVERY_20261009.md`（若实际执行日期不同，文件日期随执行日调整）；修改 `docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md`、`docs/v0.5/README.md` 及尚未同步的子系统文档。

**接口：** benchmark 消费 build 后 lib 和 T6/T9/T11 行为；`node scripts/bench-chat-status.cjs --output runtime/astra-fixes-acceptance-20261009` 输出合成性能 JSON 与查询计划。不改变运行服务配置。

- [x] 按流程细化 §7 实现临时合成库探针，固定活跃工作集，分别验证 full audit 读一次、active input 不全量解码、状态输出增长；预热一次、每规模至少五次采样，排除建库时间。
- [x] 依次执行下列命令，每项记录退出码与新结果；任何失败先定位，不修改历史 evidence 来遮蔽：

```powershell
npm test
npm run typecheck
npm run build
npm run demo
npm run smoke --prefix runtime
node scripts/bench-chat-status.cjs --output runtime/astra-fixes-acceptance-20261009
git diff --check
```

- [x] 根据本次执行重新填写数量／耗时，不复制旧 620 项数字；核对 F1～F4 正确行为、F5 调用计数、F6 工作量和 F7 状态增长、F8 双场景终态及 D1 原回归都有证据。
- [x] 整理实际文件变化、兼容补齐报告、旧 pending unknown 保留的成本边界、查询计划与原始数据路径。文档链接和代码对应检查通过后，把最新现状说明更新为已实现；原审核／SOL 回复作为历史材料保留。
- [x] 对最终差异做一次整体复核，确认共享 Host／memory／school 改动组合后没有接口漂移、重复扫描或恢复输入改写；建议提交 `docs: record astra fixes and validation evidence`。

### 最终交付表必须包含

| 项目 | 记录内容 |
| --- | --- |
| 业务结果 | F1、F2、F3、F4 各自修复的实际行为及主要回归名 |
| 恢复 | 前台确认／B 事务、知识提交、记忆补齐、started pending／ready 的结果 |
| 请求成本 | 整理 t=0/5/20，索引 r1/r2/r3，stateVersion-only，公平顺序 |
| 历史量成本 | 1k/10k/50k 的 full/active 读取与解码行数、查询次数、计划、耗时中位数 |
| 状态体积 | 10/100/1000 轮字符数、汇总准确性、raw 记录未改变 |
| smoke | 两场景 batch／四步 committed，3／4 次生成、各 1 次 Embedding、repair=0 |
| 范围 | 离线是否全部通过；真实模型、正式 QQ、正式库是否实际验证，不混写 |

## 后续部署边界

本计划可以交给 SOL 直接实施到本地可审查代码与离线验收完成。没有要求开启真实服务、自动编辑正式库或补发 QQ。若后续部署，新构建首次安全 pump 才幂等补齐已有 learned；旧未完成前台先恢复、后台冻结输入保留，见业务细化 §5.3。无法解析的 canonical 需报告为实际缺口，不能假定数据已删除或自行编造历史。

复选框依据实际任务验证、最终回归与独立复核更新；详细证据见过程和交付，不以文档勾选代替测试。
