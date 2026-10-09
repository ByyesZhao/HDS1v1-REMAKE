# 环境异步交付复核与修复实施方案

> 后续关闭：R1／R2已按本方案完成，见[修复／正式升级交付](../../../records/environment-post-delivery-fixes-20261009/DELIVERY.md)及[差异复核](FIX_DIFF_REVIEW.md)。以下审核基线、原失败证据和未勾选清单保持产生时内容，不表示今天仍待做。

> **执行者 SOL：**按 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐项实施下列任务。复选框表示尚待执行，不能用本次审核通过的旧测试代替修复验收。

**日期与状态：**2026-10-09；复核已完成，R1／R2 修复未实施。  
**源码基线：**`cc963f8e43677016921f9dd6e20ac8a431689af8`，审核 E 阶段 `272437f..cc963f8`；审查开始时工作区干净。  
**目标：**修正环境任务的提交／启动门禁竞态，以及迁移检查的新旧任务计数。  
**实现选择：**保留现有环境准备槽、持久 ready、同步提交事务及调度器接口。Host 在 `await collectReady()` 返回后复核执行条件；迁移检查根据准备版本分类，不改变迁移结果。  
**技术栈：**TypeScript、Node.js 同步 SQLite、Vitest；沿用项目 Node.js `>=22.13.0` 要求。  
**依据：**[E1～E5 合同](../../../../archive/plans/environment-async-20261009/04_ENVIRONMENT_ASYNC.md)第 4～6 节、[交付记录](../../../records/environment-async-20261009/DELIVERY.md)、[前轮关闭记录](../../../records/environment-async-20261009/REVIEW_CLOSURE.md)，以及下列独立探针。

## 结论与执行顺序

主体实现与 E1～E5 方案相符。冻结检索、学校只读视图、实际使用来源检查、四阶段依赖、网页额度接续、旧任务兼容及显式迁移未发现新的实质缺陷。旧／新测试分别保留协议 1／2、补齐非消息来源存在检查、正式库不随代码合入自动升级，这三项实施裁决合理。

本次确认 **1 项 P2 和 1 项 P3**。建议先完成 R1，再顺手完成 R2，然后进入下一批工作。无需重做 E 阶段设计，也没有迁移破坏或数据丢失的证据。

| 编号 | 级别 | 结论 | 处理要求 |
| --- | --- | --- | --- |
| R1 | P2 | Host 等待调度返回后未重新检查门禁，暂停／合批／停止可被已选中的环境任务越过 | 本轮修复并补回归后再关闭 |
| R2 | P3 | 协议 2 的异步 ready／running 被算入 `legacyUnfinished` | 非业务阻断，建议同批修正 |

## R1 环境任务在门禁生效后仍可执行

**位置：**[src/host/runtime.ts 第 71～73 行](../../../../../src/host/runtime.ts)，主要是 `await this.scheduler.collectReady(...)` 与后续 `startOne/applyReady` 之间的边界。

`collectReady()` 内部目前没有真正的异步操作，但其返回类型是 Promise。Host 的 `await` 仍会让出一个微任务边界。候选选中之后、Host 继续之前，`pause()` 会同步设置 paused，`acceptInput()` 会同步建立 openBatch，`stop()` 会同步设置 stopped。Host 恢复执行时直接使用旧候选，未复核这些条件。`applyReady()` 检查业务依据和阶段顺序，但不承担 Host 门禁检查。

以下复现使用正常夹具及公共 Host API，没有替换调度器、修改产品源码或构造损坏数据：

```ts
// 前置：正常生成并持久化一个含新增事件的 world ready。
const starting = host.start();
const pausing = host.pause(); // 必须与上一行同轮调用，不能先 await starting。
await Promise.all([starting, pausing]);
```

| 调度时状态 | 紧接调用 | cc963f8 实际结果 | 期望 |
| --- | --- | --- | --- |
| ready | pause | paused=true，ready→committed，events 0→1 | 保持 ready，不提交 |
| ready | acceptInput | openBatch=true，ready→committed，events 0→1 | 保持 ready，等待合批和前台处理 |
| ready | stop | stop 发起后仍 ready→committed，events 0→1 | 保留 ready 供重开消费 |
| pending | pause | 模型入口观察到 paused=true，仍调用 1 次并保存 ready | 不启动、不冻结 |
| pending | acceptInput | 模型入口观察到 openBatch=true，仍调用 1 次并保存 ready | 不启动、不冻结 |
| pending | stop | 保持 pending，模型调用 0 次 | 已正确，保留回归 |

这是**窄微任务竞态**，不意味着每次暂停或普通下一次消息事件都会触发。当前 Koishi 入口没有直接成对调用上述 API；普通 I/O 事件通常在微任务排空后才执行。本次证明的是公共 API 同轮／微任务交错下的合同缺口，未据此推断线上触发频率。影响是业务提交顺序及后台启动时机，不是并行 SQLite 事务或必然的数据损坏。

原 E 合同第 4.2、5、8 节明确要求暂停／openBatch 时 ready 等待。现有测试覆盖了“先暂停，再结束环境请求”，没有覆盖“调度已选中，再同步改变门禁”。

## R2 升级检查重复计算新任务

**位置：**[src/deployment/environment-async-upgrade.ts 第 19 行](../../../../../src/deployment/environment-async-upgrade.ts)。

`legacyUnfinished` 当前只判断 inputSnapshot、running、ready，没有排除 `preparationVersion===1`。新建协议 2 库正常把 world 准备到 ready 后，四个步骤全部为 preparationVersion 1，检查仍输出：

```json
{"version":2,"legacyUnfinished":1,"unstarted":3,"asyncUnfinished":4}
```

这里 `legacyUnfinished` 应为 0。该错误只影响检查报告的解释：`asyncUnfinished` 及降级门禁使用独立条件，本次未发现迁移结果或降级判断被它改变。另外，当前报告的旧任务判定漏掉 `attempt>0`，与实际升级使用的判定不一致；修正时应一并统一。

## 全局实施约束

- 本轮只修复上述两项；不调整环境并发槽数量、四阶段依赖、重试间隔、检索能力或网页配额。
- 保持 `Scheduler.collectReady(...): Promise<TurnRequest|null>` 接口，不借此批次全面改写同步／异步 API。
- Host 承担调度门禁；保留 `EnvironmentPreparation.applyReady` 的底层复用合同。离线串行包装和工作量脚本可直接调用它，不能简单把 Host 的 pause 条件塞进该方法。
- 门禁检查到 `startOne/applyReady` 之间不能再新增 await；数据库事务内保持无 await。
- 不要求正式库升级、不启动正式服务、不修改私有配置。新增验证仅使用内存库或独立临时库。
- 原审核日志和失败证据保留原样；修复证据另存，最后更新当前导航的未关闭状态。

## 任务一 修复 R1 并验证等待后的恢复

**文件：**修改 `src/host/runtime.ts`；新增 `tests/environment-async-host-gates.test.ts`。现有 `tests/environment-async-host.test.ts`、`tests/environment-async-slots.test.ts`、`tests/environment-async-recovery.test.ts` 保留。

**接口：**继续使用 `SerialHost.start/pause/resume/stop/acceptInput/wake`、`Storage.runtime/unfinishedTurn`、`EnvironmentPreparation.startOne/applyReady`；不新增公共接口或持久字段。

- [ ] **1. 写失败回归。**从 [findings.cjs](evidence/findings.cjs) 的 `hostGate` 转成 Vitest 表驱动测试，覆盖上表 6 组。使用 `asyncFixture()`；ready 必须经过 `EnvironmentPreparation.startOne()` 和 `wait()` 正常生成，包含一个实际新增事件。后续阶段使用 `ModelRequestError` 固定结束，避免模型夹具把四步自动跑完。

  精确断言：ready 三组均保持 status=ready、events.length=0、原 frozenResult 创建 ID 不变；pending 三组均保持 status=pending、attempt=0、inputSnapshot=null、模型调用 0 次。pause 组检查 paused=true，input 组检查 openBatch 存在。两次 API 调用之间不 await。每组 finally 中等待 stop 再关闭 Storage。

- [ ] **2. 运行 RED。**执行 `npx vitest run tests/environment-async-host-gates.test.ts`。在本基线应有 ready 三组和 pending 的 pause/input 两组失败；pending+stop 应通过。保存实际输出，不接受只有 mock 断言的假失败。

- [ ] **3. 加最小门禁。**在 Host 的 preparationVersion 1 环境分支内、调用 startOne/applyReady 前，读取最新 runtime，按下列逻辑退出当前 pump 迭代：

  ```ts
  const runtime = d.storage.runtime();
  if (this.stopped || runtime.paused || runtime.openBatch || d.storage.unfinishedTurn()) break;
  // 后接现有 try / startOne / applyReady；中间无 await。
  ```

  使用 `break` 让现有 finally／armTimer、acceptInput 的 wake、resume 或重开负责续跑。不能在门禁仍存在时无条件 `continue`，否则可能立即反复选取；不能把 ready 改成 stale、清快照、递增 generation/attempt 或重新调用模型。原 `applyReady` 内的业务依据检查和同步事务保持原样。

- [ ] **4. 补恢复断言。**ready+pause 在 `await host.resume()` 后只提交一次；ready+input 推进测试时钟 16 秒并 `await host.wake()` 后，消息所属聊天回合完成、world 提交一次；ready+stop 先等待旧 Host 停止完成，保持 Storage 打开，再使用同一库新建 Host 并提交一次，不能 resume 已停止的旧 Host。三组都复用原创建 ID，world 不再次调用模型；调用次数按 world 阶段统计，后续学校阶段可触发夹具约定的 ModelRequestError。pending+pause/input 解除门禁后才允许启动。普通重复 wake 不得在门禁存在时冻结或启动。

- [ ] **5. 验证原并发行为。**执行下列定向集，确认聊天仍能在环境请求未返回时完成、三个槽仍能共存、stop 仍等非合作请求收尾：

  ```powershell
  npx vitest run tests/environment-async-host-gates.test.ts tests/environment-async-host.test.ts tests/environment-async-slots.test.ts tests/environment-async-recovery.test.ts tests/environment-async-boundaries.test.ts
  ```

- [ ] **6. 单独形成 R1 提交。**只提交本项源码、回归和对应实施记录；建议标题 `fix: recheck environment host gates after scheduling`。

## 任务二 修复 R2 并统一报告判定

**文件：**修改 `src/deployment/environment-async-upgrade.ts`、`tests/environment-async-upgrade.test.ts`；命令行脚本参数和报告字段名称保持不变。

**接口：**保持 `inspectEnvironmentAsyncUpgrade(path, targetVersion?)`、`upgradeEnvironmentAsync(path, options)` 及 `EnvironmentAsyncUpgradeReport` 类型。新增文件内私有 `hasStartedPreparation(step: EnvironmentStep): boolean`，同时供报告和升级使用。

- [ ] **1. 写失败回归。**在独立临时文件库中正常把协议 2 的 world 准备到 ready；期望 `legacyUnfinished=0, asyncUnfinished=4, unstarted=3`。另覆盖 preparationVersion 1 的 running，仍不得计入 legacy。原 [findings.cjs](evidence/findings.cjs) 的 `upgradeCounts` 可直接参考。

- [ ] **2. 补分类边界。**旧库中 preparationVersion 缺失的 ready/running、带 inputSnapshot 的 pending、attempt>0 的 pending 均算旧待继承任务；显式 preparationVersion 0 的未终态步骤算 legacy；preparationVersion 1 只算 async；committed/superseded 不计入任何未完成数。新旧混批分别核对两项数量。

  `unstarted` 继续表示 pending、无 inputSnapshot、attempt=0 的未开始数量，它可与 async 重叠，不将这三个指标强改成总和互斥的分区。

  单独用只有一个步骤的夹具断言：准备版本缺失、pending、inputSnapshot=null、attempt=0 时，检查结果为 `legacyUnfinished=0, asyncUnfinished=0, unstarted=1`；升级后该步骤标记 1。

- [ ] **3. 运行 RED。**执行 `npx vitest run tests/environment-async-upgrade.test.ts`；新协议 2 ready/running 计数用例在本基线应失败。保存输出。

- [ ] **4. 统一条件。**`hasStartedPreparation` 的返回条件是“有 inputSnapshot，或 status 为 running/ready，或 attempt>0”，与原升级逻辑相同。报告只在未终态步骤中统计：`preparationVersion===0`，或“准备版本缺失且 hasStartedPreparation 为 true”。明确排除 preparationVersion 1。升级中原 `legacy` 判断改为复用 helper，其余写入、备份、幂等及降级行为保持原样。

  报告的完整版本分类不能直接替换升级的 legacy 判定；升级只复用 helper，避免改变原有写入规则。

- [ ] **5. 运行 GREEN 并核对迁移无回归。**定向测试应全部通过；同一夹具 check 前后主库字节不变，重复 apply 仍不写业务数据，含未终态异步任务时降级仍拒绝。可额外运行下列独立探针，其输出应为 passed=true：

  ```powershell
  node docs/v0.5/reviews/environment-async-20261009/post-delivery/evidence/upgrade.cjs
  ```

- [ ] **6. 单独形成 R2 提交。**建议标题 `fix: distinguish legacy environment upgrade counts`。

## 合并验收与关闭条件

重点复核五类输入：ready 下的三种门禁、pending 下的三种门禁、门禁解除后的原结果复用、新旧混批统计、停服／重开后的提交与降级限制。对应任务已列出具体测试，不能只看最终通过数。

- [ ] 先构建，再完成全量与公开离线验收。精确命令如下；不使用 PowerShell 字面通配符替代测试文件选择。

  ```powershell
  npm run build
  npm test
  npm run typecheck
  npm run demo
  node runtime/plugin-smoke.cjs
  node docs/v0.5/reviews/environment-async-20261009/post-delivery/evidence/findings.cjs
  ```

  最后一项在本基线退出 1，表示缺陷存在；两项都修复后应退出 0、所有 results.passed=true。其 baseline 字段标识发现缺陷的原基线，修复验收记录应另写实际修复提交 SHA。脚本只使用合成数据，在 `.tmp/post-environment-async-review/` 下建立计数夹具。

- [ ] 确认没有把 pause/openBatch 的等待处理成业务 stale，没有清除 ready 结果或增加环境模型调用；确认迁移版本仍是 1→2、没有变成自动升级。
- [ ] 在本目录增加修复交付／关闭记录及新的日志，逐项给出 R1/R2 状态、提交、RED/GREEN、全量测试实际数量。更新 [版本索引](../../../README.md) 和 [审核索引](../../README.md) 的待修状态。原交付、前轮 review 与本报告作为各自基线证据保留。
- [ ] 完成一次修复差异复核后再标记关闭。正式库停服备份升级依旧是后续显式部署操作，不属于本次 review 修复验收。

## 本次独立验证证据

| 检查 | 本次结果 | 证据 |
| --- | --- | --- |
| 全量测试 | 146 文件／804 项通过，88.27 秒 | [tests-full.log](logs/tests-full.log) |
| 类型／构建 | 均退出 0 | [typecheck](logs/typecheck.log)、[build](logs/build.log) |
| 演示／插件 | 合成演示和两个插件场景均通过 | [demo](logs/demo.log)、[plugin-smoke](logs/plugin-smoke.log) |
| 工作量脚本 | H=0/90/180，各 5 组，15/15 聊天先完成；状态查询未读环境大快照 | [原始数据](evidence/workload.json)、[日志](logs/workload-full.log) |
| 快照及业务依据 | 8 组独立探针通过 | [脚本](evidence/snapshot.cjs)、[结果](evidence/snapshot.json) |
| 迁移及旧合同 | 只读 check、备份还原、标记、幂等、混批恢复、降级、旧 week 合同通过 | [入口](evidence/upgrade.cjs)、[探针](evidence/upgrade.ts)、[结果](evidence/upgrade.json) |
| 本次问题复现 | R1 五组缺陷、一个正确对照；R2 新库计数错误 | [脚本](evidence/findings.cjs)、[结果](evidence/findings.json)，退出 1 符合当前缺陷状态 |

全量测试和工作量脚本首次在受限环境中因子进程 `spawn EPERM` 未能启动；提升执行权限后运行同一命令通过。[原测试失败](logs/tests.log)及[原工作量失败](logs/workload.log)保留，不作为产品失败。其他检查未要求更改执行权限。

15 组合成样本冻结约 11.92～17.27 ms、提交约 9.67～12.73 ms；只证明本次样本的响应顺序及工作量，不代表真实模型或 QQ 延迟。本次没有调用真实供应商、启动正式服务或升级正式库。产品源码未修改，本报告中的修复仍待 SOL 执行。
