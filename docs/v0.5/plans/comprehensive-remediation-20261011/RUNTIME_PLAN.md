# 运行时整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务执行；所有步骤使用未勾选复选框跟踪。执行者先读本计划和所引用审核，不能把审核探针的“成功复现旧错误”当作修复验收。

**Goal:** 修复已消费预约因元数据更新而重复触发及暂停选择窗口，减少任务历史物化，并在保持恢复能力和审计身份的前提下压缩新协议环境终态准备载荷。

**Architecture:** 预约状态使用一份纯投影规则，同时服务睡眠规划和事务提交；Host 在异步选择返回后重新检查暂停。调度使用每次评价内的 pending 工作集，环境正文仅在终态且无同一步骤在途执行时压缩；旧数据经显式停服分批工具处理，网页 owner 收尾由 [WEB_MEDIA_PLAN.md](WEB_MEDIA_PLAN.md) 的 WM-O3 接续。

**Tech Stack:** TypeScript 6、Node.js `>=22.13.0`、`node:sqlite` JSON 表、Vitest 5、现有 `tsx` CLI；不新增依赖。

**Spec:** [综合审核](../../reviews/comprehensive-audit-20261011/README.md)、[运行时审核 RT-1/RT-2/RT-O1/RT-O2](../../reviews/comprehensive-audit-20261011/RUNTIME_AUDIT.md)、[本批总计划](README.md)。当前业务规则仍以 [V0.5 入口](../../README.md) 链接的调度、恢复和环境说明为准；本页显式列出的状态裁决是拟实施变更。

日期：2026-10-11。状态：**未实施**。审核及本页源码复核基线均为 `ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`，编写时没有产品源码漂移；工作区已有审核报告和导航文档变更，不属于本页实现。编写本页仅静态读源码，没有运行产品测试、访问正式库或启动服务。

## Global Constraints

- 本批只先交付实施方案。未来实现也不自动授权正式启停、部署、私有配置读取、真实数据库压缩、迁移或供应商调用。
- 预约 `create at=NOW` 合法；不添加所有预约必须在未来的 schema 限制。`check_messages` 原有 `at > turn.at`、来源 ID 与程序拥有 `scene_step` 的校验不变。
- 暂停阻止尚未开始的新故事、等待轮接管及新的后台派发／提交；已经开始的一轮完成原有生成、发送和后处理，不因 pause 被中断或另设取消信号。
- B4 的证据是 Host API 在已解决 Promise 的微任务边界交错；没有真实 Koishi 命令到达该窗口的线上复现证据。
- 不删除任务历史，不改变前台优先级、睡眠、共同活动、查看资格、学校通知、容量、提示内容预算或时间戳的时区语义。
- `pending/running/ready` 环境步骤、停止后待恢复执行、格式修补和已确认网页操作必须保留恢复载荷。`preparationVersion=0` 或缺省的旧协议终态也不在本批清正文。
- 新增的终态摘要不替代历史审核证据；不修改原始审核探针、JSON、日志及旧交付结论。未来新证据放 `docs/v0.5/records/comprehensive-remediation-20261011/`。
- 新库使用现有环境版本2；本批不升环境协议版本，不要求新库跑迁移。旧库也不在启动时全表压缩；旧环境载荷只能显式选择停服工具处理。
- 构建使用独立输出目录；本计划的验证不覆盖部署 `lib/`。Windows 测试可设置工作区 TEMP/TMP，权限失败不得记成产品失败或通过。

## Review Focus

- 同一瞬间的不同 UTC offset、description-only、改到过去或本轮时刻，不应重新打开已消费预约：R1 状态矩阵与真实 Host 一次启动断言。
- 模型等待期间时间前进，真实未来改期最终已经到期：R1 必须比较冻结 `turn.at`，不能拿提交时刻否定重排。
- pause 恰在候选已选好、等待轮尚未接管的边界到达；以及 pause 到达时模型已开始：R2 分别断言零新增调用和整轮继续完成。
- 单次调度中 `stashPending`／共享时钟写任务后，缓存不能遗留旧结果；同 epoch 不同 offset、历史顺序也不能变：R3 的写后失效与差异测试。
- 跨日 supersede 尚在执行、旧协议恢复、终态插件 smoke 读取被冻结字段、压缩中断：R4 的在途保留、读者适配、事务回滚及磁盘续跑矩阵。

---

## 文件责任与执行顺序

| 任务 | 可独立交付结果 | 主要文件 | 依赖 |
| --- | --- | --- | --- |
| R1 / B1 | 预约元数据修改不再重新挂起；规划和提交一致 | 新 `src/host/task-projection.ts`；`src/memory/organize.ts`、`src/recovery.ts`、`src/app.ts` | 无；优先交付 |
| R2 / B4 | 两个异步选择边界都遵守暂停 | `src/host/runtime.ts` | 无；可以和 R1 并行，合入后测真实 Host |
| R3 / RT-O1 | 热路径只物化 pending 工作集并局部复用 | `src/storage.ts`、`src/host/scheduler.ts`、`src/app.ts`、`src/host/shared.ts`、`src/environment/runtime.ts`、`src/environment/snapshot.ts` | 合入 R1 后编辑 `app.ts`；保留 R2 门禁 |
| R4a / RT-O2 | 新终态压缩、审计摘要、恢复与终态读者兼容 | 新 `src/environment/payload-compaction.ts`；环境 types/runtime/preparation；终态读者与测试 | 与 R3 共享环境文件，顺序执行；V0先提供隔离smoke构建路径 |
| R4b / RT-O2 | 显式旧环境载荷检查／备份／分批压缩 | 现有 memory payload compactor、deployment wrapper、CLI 与测试 | R4a 的纯压缩 helper |
| WM-O3 | 等网页 owner 在途操作结束后统一收尾 | 由网页计划负责 | R4a 提供 `compactTerminalPayload`；本页不重复实现网页锁 |

`R4a`、`R4b` 是 R4 的两个 commit 边界。依赖是单向 `R4a → W7/WM-O3`：R4a只有同步payload压缩，不调用尚未提供的`finalizeOwner`，可以独立通过；W7再把同一生命周期调用点合并为异步owner收尾。R4b只依赖R4a纯helper，可在W7前后独立完成，最终合并验收必须覆盖两者。当前功能文档、CLI 说明和索引统一由 [DELIVERY_PLAN.md](DELIVERY_PLAN.md) 的D1收口；每个任务必须向D1提供实际改变的规则与验证结果，不在实现前把拟定行为写成当前能力。

## 统一运行约定

以下命令从仓库根目录运行。初次准备临时目录后，同一 PowerShell 会话继续使用：

```powershell
New-Item -ItemType Directory -Force -Path .tmp/comprehensive-remediation-20261011/tmp | Out-Null
$env:TEMP = (Resolve-Path .tmp/comprehensive-remediation-20261011/tmp).Path
$env:TMP = $env:TEMP
git rev-parse HEAD
git status --short
```

先记录实现开始的 HEAD 和已有变更；如果审核涉及源码已变化，先做对应差异复核再实现。每任务先跑新测试确认失败原因是该缺陷／缺失接口，再写实现、跑绿、提交。所有命令成功条件是退出0且相关断言通过，不能用审核探针 exit0 或类型检查替代产品回归。全量、隔离构建、demo 和最终资料核对统一按总计划执行，避免每个子任务重复整套验收。

## R1：预约状态投影，消除元数据更新的立即重复触发

**Files**

- Create: `src/host/task-projection.ts`、`tests/task-projection.test.ts`、`tests/appointment-update-host.test.ts`。
- Modify: `src/memory/organize.ts` 的 `applyTasks`；`src/recovery.ts` 的 `finishPostprocessing`；`src/app.ts` 的睡眠 `plannedTasks` 计算；`tests/tasks.test.ts`、`tests/chat-active-consistency.test.ts`。
- Reuse: `tests/helpers.ts`、`tests/review-fixes.test.ts`、`tests/review-recovery.test.ts`。不要改旧审核证据。

**Interfaces**

```ts
// src/host/task-projection.ts；纯函数，不读 clock、不访问 SQLite、不改变输入。
export function projectTaskChanges(
  tasks: readonly ScheduledTask[],
  changes: readonly TaskChange[],
  completedTaskIds: readonly string[],
  turnAt: ISOTime,
): ScheduledTask[];

// src/memory/organize.ts；仍只由故事提交事务调用。
export function applyTasks(d: Dependencies, candidate: TurnCandidate, turnAt: ISOTime): void;
```

`projectTaskChanges` 保持已有输入任务顺序，新增 create 按 changes 顺序追加；保留终态行，不在 helper 内过滤 pending。`applyTasks` 按 `completedTaskIds ∪ 非 create change.id` 逐 ID 读取旧行，投影后仅写相关结果，不能借此 `all('tasks')`。`src/app.ts` 用同一 helper 投影已有 `allTasks`，最后 `.filter(t => t.status === 'pending')` 供 `arrangeSleep`。提交传 `current.at`，不用 `completedAt`、当前 clock 或可选默认值；测试调用点显式传 NOW。

### 确定的业务语义

以**提交前原始任务**判断重排，不能先把默认完成写入数据库再从 completed 行判断。消费指 `candidate.completedTaskIds` 包含该 ID，pending 指原始状态为 pending。

| 原始状态／本轮变更 | 结果 |
| --- | --- |
| create appointment，`at=NOW` | 新任务 pending，仍通过现有 schema |
| pending、未消费，仅 metadata／同 at／不同 at 更新 | 保持 pending，合并字段；不因本轮没有消费而擅自完成 |
| pending、已消费、无变更 | completed |
| pending、已消费、update 没有 `at`，包括空 patch／description／只改 kind | 合并字段，completed |
| pending、已消费、patch 提供 `at`，但与旧 at 的 epoch 相同 | 合并字段，completed；不同 offset 的同瞬间也是此类 |
| pending、已消费、patch 提供不同 at，但 `final.at <= turnAt` | 合并字段，completed；不拒绝 schema 合法的预约 JSON，也不立即再消费一次 |
| pending、已消费、patch 显式提供不同 at，且 `final.at > turnAt` | 合并字段，pending；这是再次执行／改期 |
| cancel pending，不论是否已消费 | cancelled，取消优先于默认完成 |
| 旧 completed／cancelled 被 update 命中 | 可以合并原有可更新字段，但保留原终态，不重新 pending；正常模型上下文只提供 pending，因此无权限以旧 ID 重开 |
| 旧 completed／cancelled 仅出现在 completedTaskIds | 保留原终态，不把 cancelled 改写成 completed |
| 旧 completed／cancelled 被 cancel 命中 | 保留原终态；取消不会把已完成历史改成另一种执行结果 |

非 create 更新仍不能改变 `id/status`（TaskChange schema 不含这些字段）。`kind` 沿用当前 schema 的最终任务校验，不新增“种类不可改”限制：appointment→check_messages 需要最终 `checkReason/messageIds` 和 `at > turnAt`，自然满足未来改期才保持 pending；check_messages→appointment 若已消费且只改种类／同 at 则 completed，显式未来不同 at 才 pending。`scene_step` 仍为程序拥有，模型 create/update/cancel 继续被拒绝。不要把“只改 kind”解释成隐式重新执行。

冻结时 `turnAt=10:00`，模型明确改到10:05、10:06才提交：仍应 pending，下一次调度可正常处理这次真正改期；只有和冻结时刻比较才能保留这一语义。description-only 的任务也不得再进入本轮 `arrangeSleep` 的预约列表，避免睡眠规划与落库结果矛盾。

**旧轮恢复裁决：** 本修复不增加TaskChange协议版本。旧未done轮已经有frozenResult／post.result时，保持原候选、原输出、原抽样、原turn.at和已完成发送状态，直接用新`projectTaskChanges`完成尚未提交的任务状态；不为“换规则”再请求模型。旧候选nextState已经冻结，不能恢复时重跑arrangeSleep或改写它；新生成轮使用统一规划投影。已done轮仍由`finishPostprocessing`早退，不回写历史。此差异是有意修复尚未提交的任务生命周期，不是迁移全部旧预约。

- [x] **Step 1 — 写纯投影失败回归。** `task-projection.test.ts` 表驱动覆盖上表所有行。固定 `turnAt='2026-10-07T10:00:00+08:00'`，旧预约 at=该值，同 epoch 替换为 `'2026-10-07T02:00:00Z'`；过去09:59、同刻10:00、未来10:05分别断言 completed/completed/pending。旧 cancelled 的 completedTaskIds 和旧 completed 的未来 update 均不变成 pending；输入数组深比较不变。
- [x] **Step 2 — 写真实调用链失败回归。** `appointment-update-host.test.ts` 采用 `setup`、真实 `HdsiApp/SerialHost`、`ScriptedModels`，个人输出只更新 description；模型 stub 超过第二轮立即抛错，使旧实现的循环有界。一次 `host.start()` 后断言预约 completed、description 已更新、`turns.length===1`、`narrative/personal_chat` 各一次，无新输入、无预约导致的 NOW deadline。关闭自主/环境非本用例调度或断言 deadline 大于 NOW，不能因正常自主 deadline 非空误报。
- [x] **Step 3 — 写规划／恢复边界失败回归。** 在 `tasks.test.ts` 断言消费后 description-only 预约不参与 `arrangeSleep`，显式未来改期参与；在投影／提交测试中将提交 clock 推进到10:06仍断言10:05改期 pending。保留 `review-fixes.test.ts` 的 create NOW 和未来 deferred 检查，并测试最终 kind 改变时上述规则。磁盘恢复夹具保存旧frozenResult及非null post.result、注入提交前失败，重启后任务只提交一次并按新状态矩阵完成，候选nextState/输出/turn.at逐字不变、模型调用0增量；已done的`finishPostprocessing`不再写任务。
- [x] **Step 4 — 跑红。** `npx vitest run tests/task-projection.test.ts tests/appointment-update-host.test.ts tests/tasks.test.ts`；期望新 helper 缺失／状态为 pending 而非 completed 的定向失败，记录实际失败原因。
- [x] **Step 5 — 实现纯投影并接线。** 先按原始行保存 Map，用 completed 集合得默认状态，再应用 patch 的显式未来重排判定；cancel覆盖默认完成。改 `applyTasks`、`finishPostprocessing`、睡眠投影和直接测试调用签名；保留 `assertMessageSources`，不改模型 schema。不要用更新先后顺序隐式表达消费规则。
- [x] **Step 6 — 跑绿。** `npx vitest run tests/task-projection.test.ts tests/appointment-update-host.test.ts tests/tasks.test.ts tests/review-fixes.test.ts tests/review-recovery.test.ts tests/chat-active-consistency.test.ts`；确认新 Host 回归完成且未触发限轮保护。
- [x] **Step 7 — 单独提交。** 仅暂存本任务列出的源码与测试（不暂存其他工作者文件），`git commit -m "fix: complete consumed appointments after metadata updates"`。向 D 交接表中的已消费更新规则；本 commit 不依赖性能优化或数据迁移。

## R2：暂停后再次检查异步选择边界

**Files:** 修改 `src/host/runtime.ts`；新增 `tests/host-pause-selection.test.ts`；复用 `tests/reply-freshness-host.test.ts`、`tests/environment-async-host-gates.test.ts`、`tests/graceful-stop-host.test.ts`。

**Interfaces:** 不新增公开 API。保持 `SerialHost.pause(): Promise<void>`、`resume(): Promise<void>`、`Scheduler.collectReady(...)` 与 `collectWaitingContinuation(...)` 签名。两个 await 返回后，进入 `continueWaitingTurn`／`runTurn` 前执行 `if (this.stopped || d.storage.runtime().paused) break`。此检查到调用之间不插入新的 await；已经进入 app 的处理不再次用 pause 中断。

- [x] **Step 1 — 写两个选择窗口失败用例。** 用与审核相同的确定性交错：保存到期预约；`const starting=host.start(); const pausing=host.pause(); await Promise.all([starting,pausing]);`。断言调用 pause 时模型0次／新故事0条，之后仍0次／0条、预约pending；`resume()`后只消费一次。等待轮用合法 `replyFreshness.state='waiting'` 夹具，pause后保留原 ID、generation、scope、quietUntil，既不切 event也不普通续算；resume后恰好接管一次。
- [x] **Step 2 — 写在途与输入保留正向用例。** 在 narrative 已进入的 deferred gate 上暂停，gate释放后原轮完成生成／发送／后处理，新增到期预约或新输入不另开轮；暂停期间 `acceptInput` 保存并合批，resume后按原规则消费。等待轮已进入 `continueWaitingTurn` 后 pause同样允许当前续算完成。断言 pause 不调用模型 abort，保留既有环境 ready暂停不提交测试。
- [x] **Step 3 — 跑红。** `npx vitest run tests/host-pause-selection.test.ts`；旧实现应在“暂停后新增模型调用／generation变化”断言失败，正向在途合同不能以取消请求来修绿。
- [x] **Step 4 — 添加两处门禁。** 在 `pump` 的等待续算和普通 `collectReady` 后统一复查 paused/stopped，保留现有环境 openBatch／unfinished 门禁以及已开始恢复的执行行为。
- [x] **Step 5 — 跑绿。** `npx vitest run tests/host-pause-selection.test.ts tests/reply-freshness-host.test.ts tests/environment-async-host-gates.test.ts tests/graceful-stop-host.test.ts tests/appointment-update-host.test.ts`。测试说明明确这是 API微任务交错，不能写成已复现QQ暂停命令竞态。
- [x] **Step 6 — 单独提交。** `git add src/host/runtime.ts tests/host-pause-selection.test.ts`，`git commit -m "fix: recheck pause before starting selected host work"`。

## R3：pending 工作集与单次调度复用

**Files**

- Modify: `src/storage.ts`、`src/host/scheduler.ts`、`src/app.ts`、`src/host/shared.ts`、`src/environment/runtime.ts`、`src/environment/snapshot.ts`。
- Create: `tests/task-queries.test.ts`、`tests/scheduler-task-workset.test.ts`、`scripts/check-task-scheduling.ts`。
- Reuse: `tests/scheduler.test.ts`、`tests/shared-v3-scheduler.test.ts`、`tests/reply-freshness-scheduler.test.ts`、`tests/tasks.test.ts`、`tests/world-school-batch.test.ts`。

**Interfaces**

```ts
// Storage，新接口；保持 Storage.all('tasks') 给明确的历史／审计读者使用。
pendingTasks(): ScheduledTask[];
sceneTasksForActivity(activityId: string): ScheduledTask[];

// src/host/scheduler.ts 内部接口，不跨公开方法或 await 暴露。
type TaskEvaluation = {
  pending(): readonly ScheduledTask[];
  invalidate(): void;
};
```

`pendingTasks` 查询 `SELECT data FROM tasks WHERE json_extract(data,'$.status')='pending' ORDER BY rowid`，使用既有 `task_due` 的 status前缀。**不要**用原始 ISO字符串 `at <= ?` 或 `MIN(at)` 算到期；待办集中复用 `due()`／`milliseconds()` 即可，不必在本批增加时间索引或 task协议迁移。`ORDER BY rowid` 保留现有并列候选顺序。

`sceneTasksForActivity` 限定 `kind='scene_step' AND (id=? OR sharedActivityId=?)`，参数为 `scene:${activityId}` 和 activityId，返回 rowid顺序；这里**不筛 pending**，因为现有共同活动收尾会将匹配的已完成 scene任务也标 cancelled。本批先保持这个既有行为，仅减少 JS物化范围，不借优化改写历史状态合同。

每次 `collectReady`、`collectWaitingContinuation`、`nextDeadline` 创建一个惰性工作集，`foreground`／`waitingDecision`／`autonomousEligible`／`stashPending` 接受该对象或它返回的数组。普通 idle一次方法调用最多查一次pending；一次 `collectReady + nextDeadline` 是两次独立评价，最多两次查询，不能跨两次调用缓存。

`autonomousEligible` 使用本次已得到的前台判定，不再重新调用 `foreground`。`stashPending` 和 `refreshSharedStep` 如写任务，随后 `invalidate()`，下次读取再查一次；同一评价内共享时钟刷新只执行原分支实际需要的一次，不能为复用而把 eventsOnly路径提前刷新。保留 Runtime／character 的原来重读点，不能让 task缓存掩盖状态变化。`app.generateTurn` 的 pending行只在该次生成起点读取，环境 week输入和 businessBasis各在其既有冻结／验证点读取，二者不共享跨阶段缓存。

- [ ] **Step 1 — 写 SQL与时区失败回归。** `task-queries.test.ts` 放10000个completed/cancelled任务和3个pending（含不同offset同epoch）；断言只返回3个、顺序同原 `all(...).filter(...)`、原历史数据完全不变。`EXPLAIN QUERY PLAN` 应含使用 `task_due` 搜索status；不要把SQLite完整计划文本写死。scene query只返回对应activity的scene任务，包含终态但排除同activity预约。
- [ ] **Step 2 — 写调度差异与工作量失败回归。** `scheduler-task-workset.test.ts` spy `all('tasks')` 和 `pendingTasks`，基线 H=0/1000/10000、P=0/3；普通无写评价要求 `all('tasks')===0`、每公开评价pending查询≤1，H增长不增加返回历史行数。加入前台输入／预约／sleep／共享场景／不可读活动／quiet等待／学校通知，逐项断言 request、taskIds、deadline与既有合同一致。deadline按epoch比较，专门用 `'2026-10-07T10:00:00+08:00'` 与 `'2026-10-07T03:00:00Z'` 防止字典序错误。
- [ ] **Step 3 — 写写后失效回归。** 不可读输入触发 `stashPending` 后，同一评价的deadline可见新check；共同活动的 `refreshSharedStep` 替换scene任务后，结果使用更新值且刷新不重复；两次公开方法之间写入新预约，第二次必见。app传给个人导演的tasks仍包含全部pending未来预约，不能只传due任务；week冻结和businessBasis仍能检测预约改变。
- [ ] **Step 4 — 跑红。** `npx vitest run tests/task-queries.test.ts tests/scheduler-task-workset.test.ts`；旧路径应因缺方法／历史物化计数失败。
- [ ] **Step 5 — 实现查询与局部复用。** 按接口加入Storage查询，替换限定的 pending读取；把shared收尾改成activity查询。保留全历史API；不缓存到Scheduler实例字段，不在Node进程内建立长期task镜像。检索 `rg -n "all\('tasks'\)" src`，逐个说明剩余调用者是否确需历史，而非盲目替换。
- [ ] **Step 6 — 跑绿及写确定性成本证据。** `npx vitest run tests/task-queries.test.ts tests/scheduler-task-workset.test.ts tests/scheduler.test.ts tests/shared-v3-scheduler.test.ts tests/reply-freshness-scheduler.test.ts tests/tasks.test.ts tests/world-school-batch.test.ts`。新增离线 `scripts/check-task-scheduling.ts`，支持 `--output <json>`，使用内存库、H=0/1000/10000、P=0/3，每档7次；记录待办查询次数、物化行数、7次原始耗时、median，任何模型／网络调用即失败。
- [ ] **Step 7 — 运行成本探针。** `npx tsx scripts/check-task-scheduling.ts --output docs/v0.5/records/comprehensive-remediation-20261011/evidence/task-scheduling.json`。硬验收为 H=10000/P=0 的 `collectReady + nextDeadline` 不物化历史任务、查询≤2，P固定时物化量不随H变化；时间只与同机相同夹具基线比较并披露原始样本，不承诺0.0175ms或固定倍率。
- [ ] **Step 8 — 单独提交。** 暂存本任务查询、调用点、测试及探针，`git commit -m "perf: reuse pending task worksets during scheduling"`；保留R1投影和R2门禁回归通过证据。

## R4a：新协议环境终态审计摘要与在线压缩

**Files**

- Create: `src/environment/payload-compaction.ts`、`tests/environment-payload-compaction.test.ts`。
- Modify: `src/environment/types.ts`、`src/environment/runtime.ts`、`src/environment/preparation.ts`、`runtime/plugin-smoke.cjs`；按读者实际断言调整 `tests/environment-async-phases.test.ts`、`tests/environment-async-recovery.test.ts`。
- Reuse: `src/environment/snapshot.ts` 的稳定 `digest` 语义，但不要引入 payload模块→snapshot→runtime→payload 的运行时环；将稳定digest移到新 `src/environment/digest.ts` 并从snapshot重导出旧名字，或在独立小模块共用，保持既有调用兼容。
- Inspect without weakening: `tests/school-week-contract-recovery.test.ts`、`tests/world-school-batch.test.ts`、`tests/world-school-review14-contracts.test.ts`、`tests/world-school-review14-calendar.test.ts`、`runtime/plugin-smoke-fixtures.cjs`。

**Interfaces**

```ts
export interface EnvironmentTerminalAudit {
  version: 1;
  compactedAt: ISOTime;
  input: { modelContractVersion: 0 | 1 | null; requiredNoticeIds: string[] | null };
  basis: { businessBasis: string | null; retrievalSignature: string | null;
           usedBasisDigest: string | null; inputDigest: string | null;
           preparationDigest: string | null; resultDigest: string | null };
  result: { stage: EnvironmentStage; entityIds: Record<string, string[]>;
            counts: Record<string, number> } | null;
}
// EnvironmentStep 新增可选 terminalAudit?: EnvironmentTerminalAudit。
// null = 不适用或已压缩，不应再次UPDATE；调用者负责确认无同step在途执行。
export function compactTerminalEnvironmentStep(step: EnvironmentStep, at: ISOTime): EnvironmentStep | null;

// EnvironmentPreparation内部方法，给WM-O3统一收尾接续。
private compactTerminalPayload(stepId: string, now: string): void;
```

`entityIds/counts` 的key是固定集合，不允许把任意模型字段直接展开进摘要：world 为 `createdEvents/updatedEvents/cancelledEvents`；campus/group为 `plans/items`；week为 `instances/notices/weeks`。ID按冻结结果顺序保存，count等于对应数组长度。`input.requiredNoticeIds` 仅 school_week＋modelContractVersion1 从 `requiredNoticeKeys[].id` 取得；非适用为null，合法空week为[]。摘要只保存字符串ID、个数、版本和SHA-256，不保存通知正文、记忆正文、完整结果对象或向量。

### 保留与清除清单

| 对象 | 行为 |
| --- | --- |
| v1 `committed`，业务变更已在当前事务应用 | 同事务生成审计摘要，再设 `inputSnapshot=null, preparationSnapshot=null, frozenResult=null` |
| v1 `superseded`，没有对应在途execution | 生成摘要并清上述三字段；没有结果的步骤result为null，不伪造“已提交”结果 |
| v1 `superseded`，旧execution／网页操作尚在结束 | 先持久化superseded并使lease失效；恢复正文保留到同step execution settle；网页checkpoint由WM-O3等待owner操作后收尾 |
| `pending/running/ready`（包括paused、retry、stop、依据失效后pending） | 不压缩，完整保留恢复正文；invalidate本来合法丢弃旧generation的行为不扩大 |
| `preparationVersion=0`或缺省，任何状态 | 本批helper返回null、原正文不变；不依据input的modelContractVersion猜测环境准备版本 |
| step身份、阶段、batchId、status、attempt、generation、startedAt/completedAt/retryAt、staleReason、lastError | 保持已有值；只增加terminalAudit，不因压缩抹除失败或废弃原因 |
| environment_batches、events、school正式表、school知识、消息／故事／outbox | 不由压缩器修改 |
| web materials/operations/计数/来源URL | 不由本helper删除；网页checkpoint及临时cache按WM-O3既有所有权合同收尾 |
| 已有terminalAudit且三正文为空 | 返回null；重复收尾0UPDATE、compactedAt不变 |

摘要的 `preparationDigest` 可覆盖整个已冻结准备结构，`usedBasisDigest`覆盖usedBasis；不要为生成摘要重新查询实时数据库或再跑检索。这样审计指纹对应原冻结内容。结果对象已写入正式表后才允许清；若任一正式表写失败，同事务 rollback也撤销状态、摘要和压缩。

### 收尾接口与时序

1. `commitEnvironmentResult` 仍在调用者业务事务中应用结果；用即将保存的 `status:'committed'` 行调用纯helper并保存，v0自然走原存储路径。`EnvironmentPreparation.applyReady`若同step execution尚active则返回`'none'`，待finally触发Host唤醒后再提交，避免外部直接调用恰在ready写入与promise settle之间清在途正文；不阻止其他已安全ready的步骤。
2. `ensureEnvironmentBatch` 的跨日动作先保持原事务：标superseded，不在这个无execution信息的层强行清正文。`EnvironmentPreparation`用本进程`observedStepIds:Set<string>`记录startOne的step和reconcile/applyReady见过的active批次step IDs；reconcile每次对这些ID重新读状态，不能只找当前firstActiveBatch（Scheduler可能已先把旧批次supersede）。完成supersede／abort后，对非active terminal ID调用`compactTerminalPayload`并移出集合；active ID到其execution.finally清空active后调用。集合只追踪本进程遇到的对象，不扫描历史终态；崩溃遗留由R4b处理。
3. `applyReady` 跨日early return也需执行上述收尾；不要只覆盖正常commit路径。R4a的同步压缩在`runEnvironmentStep` v1分支原有`await preparation.wait()`之后完成，不引入未观察异步任务。W7增加异步网页收尾时，由W7在临时preparation的`applyReady`后及finally显式等待工作／收尾排空，避免实例返回后丢失promise错误。
4. W7/WM-O3后续将这些点统一成 `private finalizeTerminalOwner(stepId:string):Promise<void>`：确认仍为terminal且无同step active；先调用本页 `compactTerminalPayload(stepId,d.clock.now())`，再 `await d.web?.finalizeOwner('environment',stepId)`。其公开网页接口为 `finalizeOwner(ownerType: ModelRunRef['ownerType'], ownerId: string): Promise<void>`；tracked promise队列、web锁与stop/wait排空由网页计划实现。普通pause/stop/重试不能误终结仍可恢复owner。R4a的测试只要求持久正文安全压缩，网页cache/checkpoint最终收尾是W7交付断言。

- [ ] **Step 1 — 写helper矩阵失败回归。** `environment-payload-compaction.test.ts` 覆盖所有stage×terminal状态，固定100条4KiB detail和向量的合法snapshot；断言三正文null、审计ID/计数/指纹准确、业务身份字段深等、未知附加审计字段不被抹去。重复调用返回null。pending/running/ready、版本0、缺省版本的JSON逐字不变；注意modelContractVersion1不等于preparationVersion1。
- [ ] **Step 2 — 写原子性／在途／磁盘恢复失败回归。** 在正式world event或school提交注入写异常，断言step仍ready、完整冻结结果仍在、无半提交摘要；移除异常恢复时模型0额外调用、实体ID恰好一次。注入ready已保存而active promise尚未settle的边界，直接`applyReady`返回none且保留正文，settle后再调才提交。跨日supersede时用deferred模型和网页stub卡住旧execution，断言其settle前正文保留、旧响应不得重新ready／写正式表，settle后终态三正文被清。中途进程结束留下旧superseded全文可安全保留并由R4b续处理，不在启动自动扫描。
- [ ] **Step 3 — 逐个标记终态读者并写新断言。** `environment-async-phases.test.ts` 的本阶段输入关系在applyReady前读取断言，提交后断言摘要和正式表；`environment-async-recovery.test.ts` 的ready重启先断言冻结结果保留，applyReady后断言resultDigest等于重启前结果、模型没有再次调用。旧协议测试仍读原input/frozen正文，不能一刀切改为允许null。
- [ ] **Step 4 — 适配插件验收。** 先合入DELIVERY_PLAN的V0（`HDSI_TEST_LIB_DIR`路径分派），本步骤只更新业务断言。`runtime/plugin-smoke.cjs` 对v1终态要求terminalAudit.version1、input.modelContractVersion1；empty_week要求requiredNoticeIds=[]且result.counts.notices===0；required_notice比较summary.requiredNoticeIds与捕获的模型输入keys，并继续 `validatePersistedNotices(keys, school_notices)`，校验正式school_instances。新增断言摘要notice IDs和实际表ID一致；不能以“压缩了”为由删掉业务验收。
- [ ] **Step 5 — 跑红。** `npx vitest run tests/environment-payload-compaction.test.ts tests/environment-async-phases.test.ts tests/environment-async-recovery.test.ts`；新压缩／摘要断言应失败，记录原因，不修改旧审核探针。
- [ ] **Step 6 — 实现摘要、纯helper及生命周期接线。** 增加可选字段与独立digest模块；按上述事务和settle边界接线。只清明确列出的三字段，保留旧字段其余值；纯helper不持有service，不读取live资料。`compactTerminalPayload`再次读取最新行，并确认step不是同ID在途执行，然后以事务保存helper返回值。
- [ ] **Step 7 — 跑绿并检查全部读者。** `npx vitest run tests/environment-payload-compaction.test.ts tests/environment-async-phases.test.ts tests/environment-async-recovery.test.ts tests/environment-async-host-gates.test.ts tests/environment-async-boundaries.test.ts tests/school-week-contract-recovery.test.ts tests/world-school-batch.test.ts tests/world-school-review14-contracts.test.ts tests/world-school-review14-calendar.test.ts`。再运行 `rg -n "inputSnapshot|preparationSnapshot|frozenResult" src/environment src/deployment scripts runtime tests -g '*.ts' -g '*.cjs'`，把终态消费者逐项归为已适配／旧协议／提交前，留下清单。
- [ ] **Step 8 — 单独提交。** 提交本任务helper、生命周期接线、smoke适配和测试，`git commit -m "perf: compact terminal environment preparation payloads"`。隔离构建后的插件双场景smoke由总计划主验收执行，不能直接require已部署lib来代表本commit。

**R4a验收指标：** 固定100条4KiB正文＋向量夹具，v1终态JSON字节下降≥95%，且追加检索候选正文／向量不再增加压缩后行大小；摘要ID增长可以随实际业务变更数增长。测试同时验证正式事件／school行数和内容一致、0重复模型调用、0重复提交；不是正式库压缩率承诺。

## R4b：显式旧环境载荷分批工具

**Files:** 修改 `src/memory/payload-compaction.ts`、`src/deployment/memory-payload-compaction.ts`、`scripts/compact-memory-payloads.ts`、`tests/memory-payload-compaction.test.ts`、`tests/memory-payload-compaction-cli.test.ts`、`tests/memory-payload-recovery-matrix.test.ts`。复用R4a helper。CLI说明由DELIVERY_PLAN的D1统一更新README与恢复说明（对应审核D2）。

**Interfaces**

```ts
// src/memory/payload-compaction.ts：默认行为保持原记忆／web范围；环境正文需显式选择。
type PayloadCompactionOptions = { includeEnvironment?: boolean; at?: ISOTime };
countCompletedPayloads(db: PayloadConnection, options?: PayloadCompactionOptions): CompletedPayloadCompactionReport['updated'];
compactCompletedPayloads(db: PayloadConnection, limit?: number, options?: PayloadCompactionOptions): CompletedPayloadCompactionReport;
installPayloadIndexes(db: PayloadConnection, options?: Pick<PayloadCompactionOptions, 'includeEnvironment'>): void;
// updated追加 environmentSteps:number；totalUpdated计入它；limit是所有类别共用上限。

// src/deployment/memory-payload-compaction.ts
inspectCompletedPayloads(path: string, options?: Pick<PayloadCompactionOptions, 'includeEnvironment'>): CompletedPayloadCompactionReport['updated'];
compactMemoryPayloads(path: string, options: {
  stopped: boolean; batchSize?: number; maxBatches?: number;
  backupDirectory?: string; includeEnvironment?: boolean;
}): { before: CompletedPayloadCompactionReport['updated'];
      after: CompletedPayloadCompactionReport['updated']; batches: number;
      totalUpdated: number; hasMore: boolean; backupPath: string | null };
// CLI增加boolean --include-environment，不新增自动迁移，也不改命令名称。
```

没有 `--include-environment` 时原命令范围不变，report.environmentSteps=0；有该选项时只处理 `preparationVersion===1 AND status IN ('committed','superseded')` 且三正文任一非null的行。count只执行SQL计数，不为dry-run加载全部JSON；apply每批只解析剩余额度内的eligible行，调用纯helper后写回。工具wrapper为一次调用生成同一ISO compactedAt传入；includeEnvironment=true但底层未提供at须明确报错，不能隐式使用不可控制时钟。缺少environment表的旧库environmentSteps=0，不创建表或升级协议。

原四类处理和environment处理共用一个batchSize预算；前类用完额度后下一批再处理environment，`hasMore`检查包含已选择的全部类。为避免每批重扫已压缩历史，可在显式apply的 `installPayloadIndexes` 增加 `environment_payload_residual` partial index（仅当includeEnvironment=true且表存在）；dry-run不建索引。MemoryStore启动／capacity迁移原调用默认不包含environment，不能因此变成自动旧载荷清理。

- [ ] **Step 1 — 写工具失败回归。** 夹具混合7个v1 terminal、版本0/缺省terminal、pending/running/ready、非环境memory残余和无environment表旧库。默认dry-run不改字节、不含环境eligible计数；加选项计数准确，apply无`--stopped`拒绝；batchSize3/maxBatches2的总更新≤6，hasMore正确；第二次续跑处理剩余，第三次0更新且不新建备份。
- [ ] **Step 2 — 写恢复和审计断言。** apply前备份包含原database/WAL/SHM存在的全部文件；从备份只读可见完整正文；旧协议／在途行的JSON字节不变，摘要指纹等于原冻结内容，正式school/events/tasks/messages表一致。第二批触发SQL异常，断言本批完全rollback、首批仍保留；移除故障再次运行正常续跑，不重复改compactedAt。现有memory/web压缩矩阵继续通过。
- [ ] **Step 3 — 跑红。** `npx vitest run tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts tests/memory-payload-recovery-matrix.test.ts`，新增选项／计数／环境压缩断言应失败。
- [ ] **Step 4 — 扩展CLI和分批逻辑。** 仅按新签名和显式选项扩展，不重命名既有工具；备份创建成功后才打开写库，每批BEGIN IMMEDIATE/COMMIT，异常ROLLBACK。每一环境行原子写terminalAudit与清三正文，不用SQL直接置null而跳过摘要。index只在显式apply安装。
- [ ] **Step 5 — 跑绿。** 同Step3命令及 `npx vitest run tests/environment-payload-compaction.test.ts`；检查所有 report解构／精确相等测试已包含environmentSteps且没有削弱原断言。
- [ ] **Step 6 — 在隔离合成库实际跑CLI。** 先用正式测试同构夹具写 `.tmp/comprehensive-remediation-20261011/environment-payloads.sqlite`，关闭所有连接，再执行下方三个命令；保存JSON到本批records，确认exit0、分批和no-op结果。

```powershell
npm run memory:compact-payloads -- .tmp/comprehensive-remediation-20261011/environment-payloads.sqlite --dry-run --include-environment
npm run memory:compact-payloads -- .tmp/comprehensive-remediation-20261011/environment-payloads.sqlite --apply --stopped --include-environment --batch-size 3 --max-batches 2 --backup-dir .tmp/comprehensive-remediation-20261011/payload-backups
npm run memory:compact-payloads -- .tmp/comprehensive-remediation-20261011/environment-payloads.sqlite --dry-run --include-environment
```

- [ ] **Step 7 — 单独提交。** `git commit -m "feat: add explicit batched environment payload compaction"`，只提交本任务源码与测试，不提交合成库、完整备份或正式数据。向DELIVERY_PLAN的D1交接参数、备份、hasMore续跑和恢复说明。

### 新库、旧库与恢复的交付要求

- 新建库无需运行迁移或compactor：正常v1终态提交时直接写摘要，superseded在途结束后收尾；版本字段仍保持原协议。
- 旧库部署代码后，可以继续读取有全文或已压缩的终态v1行；在途/旧协议完整恢复不变。历史终态全文不会因普通启动被自动清理。
- 用户以后明确执行旧库清理时，先确认实际服务已停止；`--stopped`只是操作者声明，不是进程探测。dry-run可只读检查，apply必须带`--include-environment --stopped`，原备份保留。此计划不替用户执行正式操作。
- 每次 `hasMore:true` 可按相同参数续跑，已清行幂等；中断后只有最后未提交批次回滚。若需恢复完整旧正文，停服并恢复工具产生的完整database/WAL/SHM备份组，不把压缩后的库同旧WAL混配，不从摘要“重建”模型输入。
- 本批不运行VACUUM；JSON逻辑载荷减小不保证SQLite文件立即缩小。物理文件体积及正式数月增长率另作测量，不据合成夹具宣称已改善。

## 本页交付门槛

- [ ] R1/R2正式回归证明缺陷修复；R3工作量证明历史物化被移除；R4新终态与显式旧库工具均满足恢复矩阵。
- [ ] 每个commit记录实际测试命令、结果和新增测试数；原审核基线和原探针保持原样。
- [ ] WM-O3合并后重跑跨日／旧execution settle／临时preparation／stop收尾用例，确认两个计划的精确签名一致且无未观察promise。
- [ ] 总计划完成隔离类型／构建、双场景插件smoke、必要全量与最终当前文档更新后，才把本页任务标已交付；不把实施完成等同于正式库已压缩、服务已部署或线上窗口已复现。
