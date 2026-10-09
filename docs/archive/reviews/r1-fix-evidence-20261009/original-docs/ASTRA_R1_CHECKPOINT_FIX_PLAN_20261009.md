# ASTRA R1 维护任务 checkpoint 修复实施计划

> **For agentic workers:** 执行时使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，按下方复选框核实、实施和验收。用户已指定交给 SOL 执行；确认复现与源码相符后，可直接按本计划完成补丁。

**Goal：** 补齐 T7 的恢复合同，让维护任务失败或停止后保留已保存的模型修补进度，并在准备结果落盘或任务终结后清理 checkpoint。

**Architecture：** 保留现有任务状态机，在 `MemoryMaintenance.prepare()` 的清理阶段读取最新持久化状态，仅对 `ready`／`done` 清理 checkpoint。重试沿用原 job、冻结输入及 ModelClient 阶段记录；不增加事务、状态或恢复框架。

**Tech Stack：** Node.js `>=22.13.0`、现有 TypeScript、SQLite、Vitest；不增加依赖。

**Spec：** [实施后 review 的 R1](../reviews/ASTRA_POST_IMPLEMENTATION_REVIEW_20261009.md)及[流程与性能细化 §2](ASTRA_FIX_OPERATIONS_IMPLEMENTATION_20261009.md)。本文件将 R1 的修复边界收敛为具体实现与验收步骤。

日期：2026-10-09。源码核对基线：`eb5b29e`。**状态：待 SOL 核实并实施；本计划不代表修复已完成。** 这是原有恢复遗漏的独立补丁，不重新执行 T1～T13。

## 1. 全局约束

- 只处理维护任务 checkpoint 生命周期；保持索引任务、dirty 预留、应用版本门禁、调度公平性和业务规则。
- `startedAt === null` 才允许未开始任务刷新；非空及旧数据缺失字段继续按已开始／未知处理。本补丁不改变这个分类。
- 生产默认 `backgroundTimeoutMs=120000`、`retryDelayMs=300000`、ModelClient `repairLimit=2` 不变；保留用户配置。测试可使用短超时、假时钟与 `retryDelayMs=1000`。
- 不改变 job／模型 DTO、表结构、阶段身份或模型预算；不启用搜索、不新增模型调用。`web` 未提供时保持原执行行为。
- 全部验证使用内存／临时 SQLite 和离线传输；保留已有未提交文件及旧证据，按具体文件提交，不使用 `git add .`。

## 2. 审查重点

| 条件 | 必须得到的行为 | 新增覆盖 |
| --- | --- | --- |
| 格式修补请求临时失败 | `pending` 保留完整 checkpoint，重试携带相同 repair | C1、C6 |
| 已保存进度后超时或停止 | 超时 `pending`、停止 `computing` 均可恢复；晚到响应不推进任务 | C2 |
| 关闭并重开数据库 | 新对象恢复相同 runId、修补进度和冻结输入 | C3 |
| 成功准备后应用失败 | `ready` 结果继续重用；不再请求模型 | C4 |
| 准备期间所有选中项被清理 | 已经 `done` 的任务保持终结，并清理 checkpoint | C5 |

## 3. 改动位置与状态判据

### 3.1 文件职责

| 文件 | 处理方式 |
| --- | --- |
| [src/memory/maintenance.ts](../../../../v0.5/src/memory/maintenance.ts) | 唯一预期生产代码改动：`prepare()` 的 finally，从无条件清理改为读取最新状态后清理 |
| `tests/memory-maintenance-checkpoint.test.ts` | 新建正式回归文件，覆盖 C1～C6；位于项目现有默认测试范围内 |
| [src/model/client.ts](../../../../v0.5/src/model/client.ts) | 对照 `runModel()` 的 checkpoint 恢复、repairCount 与 abort 检查；本补丁无需修改 |
| [src/web/service.ts](../../../../v0.5/src/web/service.ts)、[src/web/store.ts](../../../../v0.5/src/web/store.ts) | 复用现有 `compactOwnerCheckpoint()`；无需修改接口或 SQL |
| [src/memory/store.ts](../../../../v0.5/src/memory/store.ts) | 对照 `saveJob()`、`pruneOwnerFromJobs()` 和 `compactCompletedPayloads()`；保留现有终结压缩规则 |

### 3.2 以数据库中的最终状态判断

| finally 执行时最新状态 | checkpoint | 后续行为 |
| --- | --- | --- |
| `pending` | 原样保留 | 到 retryAt 后沿用原阶段继续请求 |
| `computing` | 原样保留 | stop 后构造新维护对象，将 computing 恢复为 pending |
| `ready` | 可以清理 | 已有持久化结果，后续只应用结果 |
| `done` | 可以清理 | 已终结，不恢复计算；包括 prune 导致的提前终结 |
| 查询不到该 job | 不清理、不重建 | 保持现有早退行为；不增加无主会话清理策略 |
| 当前 work 为索引任务 | 不处理维护 checkpoint | 保持索引路径 |

以 `store.job<MaintenanceJob>('memory_maintenance_jobs', work.job.id)` 读回的状态为准，不能用派发时的 `work.job.status`，也不能只用“模型 Promise 已返回”“try 没抛错”或 `stopped` 作为成功标志。模型返回后，结果还可能被判为失效，任务也可能已经被清理流程终结。

### 3.3 具体实现

保留现有 `private async prepare(work: Work, controller: AbortController): Promise<void>` 签名、try／catch 和成功保存结果的顺序。finally 先执行原有 `clearTimeout(timer)` 及移除 abort 监听，再按以下逻辑处理维护 checkpoint：

```ts
if (work.table === 'memory_maintenance_jobs' && this.options.web) {
  const current = this.store.job<MaintenanceJob>(work.table, work.job.id);
  if (current?.status === 'ready' || current?.status === 'done') {
    this.options.web.compactOwnerCheckpoint('maintenance', work.job.id);
  }
}
```

这里细化了前次 review 的建议：消除的是 finally 中的**无条件清理**，保留清理位置并使用持久化状态判据即可。这样也覆盖 `current.status === 'done'` 的提前返回，无需分散到多个成功分支。

不需要把保存结果与清理改成新事务：先保存 `ready`，再清理 checkpoint；若进程在两者之间退出，最多留下冗余 checkpoint，恢复仍直接使用 ready 结果。读取状态到清理之间均为同步调用，无需新增并发控制。不要在保存 ready 之前清理，也不要把“模型返回成功”直接等同于“无需恢复”。

现有 `onReady` 处于 try／catch 内；若它抛错，当前 catch 可能把任务退回 pending。本方案按最终持久化状态保留 checkpoint，不顺带改变通知异常处理。`releaseOwner()` 只删除内存缓存，不能代替 checkpoint 清理；也不要删除 session、operations、materials 或计数器。

### 3.4 保留的内容与兼容边界

失败后保留整个 `WebModelCheckpoint`，包括 `input`、`repairCount`、`repair`、`lookupUsed`、`privateLookupResult`、`pendingOperationId` 和 `toolResults`，不重建一个只含 repair 的简化对象。维护阶段身份继续为 `ownerType='maintenance'`、原 job.id、`stageKey='consolidation'`、`taskName='memory_consolidation'`。

同一阶段的 `repairCount` 跨后台重试累计，默认上限仍是 2。计数已到上限时，下次后台重试仍可发送一次带原 repair 的请求；若返回合法结果则成功，若仍非法则不再增加一次格式修补。这个限制不是整个任务的总 HTTP 次数上限，不增加“达到上限即永久终结”的新策略。

旧版本已经清空的 checkpoint 无法从本补丁恢复；这类任务沿用现有空 checkpoint 行为。尚存的 checkpoint 在后续失败／停止中得到保护。无需迁移或重新生成全部任务。

## 4. 单任务实施步骤

**文件：** 修改 `src/memory/maintenance.ts`；新建 `tests/memory-maintenance-checkpoint.test.ts`；验收后新增下述补验记录并更新文档状态。

**接口：** 使用现有 `startOne(now: string): boolean`、`applyOneReady(now: string): 'applied' | 'stale' | 'none'`、`stop(): Promise<void>`、`ModelClient`／`Transport.complete()`、`WebSearchStore.snapshot(runId)`。无新增对外接口或任务依赖。

- [ ] **步骤 1：确认基线与 R1。** 记录 `git rev-parse HEAD`、`git status --short`，核对 `prepare()` finally 的无条件清理。执行 §5 的原始独立复现；`eb5b29e` 预期为 8 通过、1 失败，失败是 R1 的 checkpoint=null／retryRepair=undefined。若代码已有修复，先对照本计划补缺失用例，不重复修改；环境启动失败不算业务复现。

- [ ] **步骤 2：建立真实组件测试夹具并写 C1。** 参考[独立 memory 用例](../reviews/postfix-evidence-20261009/memory.test.ts)，使用真实 MemoryMaintenance、ModelClient、WebSearchService 和 SQLite；仅替换最外层 Transport。默认关闭搜索，Embedding 用离线 `[1,0]`；创建到期 short `s`，不排额外索引任务。捕获请求时深拷贝，避免后续对象变化污染断言。异步测试等待可观察状态／受控 Promise，不使用固定真实睡眠。

  C1 名称：`retains repair checkpoint after transport failure and resumes the same repair`。传输依次返回 `{invalid:true}`、抛 `temporary transport interruption`、返回 `{units:[{unitKey:'keep',action:'retain',ids:['s'],readOwners:['s'],sourceIds:[]}]}`。失败后立即断言 checkpoint；再推进 TestClock 1000ms 派发重试，断言第三次请求：

  ```ts
  expect(jobAfterFailure.status).toBe('pending');
  expect(checkpointAfterFailure).toMatchObject({repairCount: 1, repair: requests[1].repair});
  expect(requests[2].repair).toEqual(requests[1].repair);
  expect(requests[2].input).toEqual(requests[0].input);
  expect(requests).toHaveLength(3);
  ```

  同时比较 job.id、startedAt、cutoff、snapshot、readSet 未刷新，阶段 runId 未改变。后续 owner 内容即使更新，重试输入仍使用原 snapshot；应用版本检查继续按既有规则处理。

- [ ] **步骤 3：先运行 C1 并记录失败。** 使用 §5 正式专项命令的 `-t 'retains repair checkpoint'` 过滤。应在 checkpoint 保留断言上失败，不能通过手动补写失败后的 checkpoint 让测试通过。

- [ ] **步骤 4：落实 §3.3 的状态判据。** 仅修改 `prepare()` 的 finally，保留计时器、监听器清理及既有状态迁移。再运行 C1，预期通过，重试请求总数为 3。

- [ ] **步骤 5：补齐 C2～C6 并通过专项回归。** 下表是确定的测试合同，可按参数化拆成多个用例，不要求固定新增测试数量。

| 编号与测试名 | 构造与断言 |
| --- | --- |
| C2 `preserves repair progress on timeout and stop` | 首次非法响应后挂起第二次修补请求，确认数据库 cp.repairCount=1。分别触发超时与 `stop()`：前者 pending 且 retryAt 生效，后者 computing；两者 checkpoint 与中断前深度相等。释放晚到的第二次响应，任务状态和 cp 不变。超时用假计时器，结束时恢复真实计时器。 |
| C3 `reopens interrupted maintenance with frozen input and the same checkpoint` | 使用临时文件库，参数化“传输失败的 pending”和“stop 遗留的 computing”。保存中断前 job／cp／runId，停止旧执行器、关闭库，再重开并重建 WebSearchService、ModelClient、MemoryMaintenance。computing 自动变 pending；snapshot/readSet/cutoff/startedAt、runId 和整个 cp 不变；更新当前 owner 后重试仍使用旧 input、原 repair。清理测试自己创建的临时目录。 |
| C4 `compacts a prepared result and retries its application without another model call` | 真实修补成功后 job=ready、result 非空、cp=null，session 身份与已有 operations/materials/counters 不因清理改变。应用事务内一次性注入 saveJob 失败，让事务回滚，保证 catch 的重试保存可以成功；断言 owner 与应用标记回滚、job 仍 ready 且 result 不变。推进 retryAt 再应用成功；模型请求总数不增加。另复用不传 web 的夹具确认正常完成。 |
| C5 `cleans the checkpoint when pruning finishes an in-flight job` | 修补请求挂起时调用实际 `pruneOwnerFromJobs()`，清除唯一选中 owner，使任务持久化为 done；参数化随后返回合法结果、抛传输异常、执行 stop，均应清 cp、保持 done，不重新写 ready 或应用结果。另覆盖 prepare 自己保存 done 的分支：冻结快照含选中 owner 与非选中依赖，结果唯一单元读取两者；在途 prune 该依赖，任务仍 computing。释放按原快照合法的结果，单元因 pruned readSet 失效，断言保存 done 且 cp=null。 |
| C6 `does not reset the repair budget across background retries` | 连续两次非法响应，第三次修补请求发生传输失败，cp.repairCount=2。第一次后台重试再返回非法结果：请求总数仅增 1、cp.repairCount 仍为 2、job pending；下一次后台重试返回合法结果：原 repair 被携带、job ready、cp=null。不要把每次后台重试解释为重新获得两次修补额度。 |

- [ ] **步骤 6：独立复现转绿并完成 §5 验收。** 先看专项及独立 9 项，再运行正式全量、类型检查、构建、demo 和双场景 smoke。任一业务失败先定位，不降低原断言或用重跑掩盖失败。

- [ ] **步骤 7：记录补验与提交。** 新建 `docs/v0.5/records/ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md`，记录实际修改、源码基线／补丁提交、命令退出码、测试数、日志路径和验证边界；保留此前 121／681 与独立 8／1 的历史结果。更新本文件状态、review 的 R1 关闭依据及 README §7 链接。按本补丁的具体文件提交；若修改范围超出本计划，说明必要性及相应验证。

## 5. 命令与通过标准

所有命令在仓库根目录执行。先确认原复现，修复后用同一命令补验；只创建新的日志目录，保留原证据。

```powershell
node node_modules/vitest/vitest.mjs run --config docs/v0.5/reviews/postfix-evidence-20261009/vitest.config.mts --configLoader native --pool threads
```

修复前基线为 2 文件、9 项中 8 通过／1 失败；修复后应 9 项全通过、退出 0。

正式专项与相关回归：

```powershell
npm test -- tests/memory-maintenance-checkpoint.test.ts
npm test -- tests/memory-pending-refresh.test.ts tests/memory-v3-recovery.test.ts tests/memory-idle-recovery.test.ts tests/memory-idle-fairness.test.ts tests/memory-capacity-cleanup.test.ts tests/web-recovery.test.ts tests/web-model-tools.test.ts
```

最终交付检查按顺序运行，前一项成功后再进行下一项：

```powershell
npm test
npm run typecheck
npm run build
npm run demo
npm run smoke --prefix runtime
git diff --check
```

全部退出 0；smoke 仍需普通／共同活动两场景完成。正式测试数应在原 121 文件／681 项基础上增加，以实际输出为准，不预填通过数字。本补丁不改查询算法，不要求重跑全套性能探针；若实际实现扩展到调度／查询，再补相应探针证据。

日志建议放到新建的 `docs/v0.5/reviews/r1-fix-evidence-20261009/`；用 PowerShell 管道保存时读取原命令 `$LASTEXITCODE`，不要把日志写入成功当作测试成功。若遇到 `spawn EPERM` 等运行环境限制，区分环境错误与业务失败，记录实际采用的获准重跑方式。

## 6. 关闭 R1 的条件

只有以下条件同时成立才把 R1 标为已关闭：正式测试覆盖真实模型修补中断、超时／stop、文件库重开和 ready 应用重试；原独立 R1 复现转绿且其他 8 项保持通过；终态 checkpoint 可清理、未完成任务不丢上下文；全量交付检查通过并保存新证据。

只删除 finally 的清理调用、只证明 snapshot 不变、只验证手工设置的 pending、或只复用旧 681 项通过记录，均不足以完成此次补验。
