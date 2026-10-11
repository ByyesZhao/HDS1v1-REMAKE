# 运行时、调度与恢复审核

审核日期：2026-10-11。Git 基线：`ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`。本子任务开始时 `git status --short` 无输出；结束时源码基线未变，新增本次审核目录。未修改产品代码、未访问正式库或私有配置、未启动或停止服务、未调用供应商模型或网络。

范围：`src/app.ts`、`src/host/`、`src/directors/`、`src/environment/`、`src/recovery.ts`，以及部署运行／浏览器／停止生命周期。先按 `docs/v0.5/README.md` 阅读总架构、导演与环境、调度、共同活动与恢复合同，再对照代码及相关既有测试。本报告只列非安全、非通用防御性编程问题。

## 结果

确认 2 项 P2 缺陷，另有 2 项可量化的性能改进建议。复现均使用内存 SQLite、仓库真实 `HdsiApp`／`SerialHost`／`Scheduler`，模型使用仓库 `ScriptedModels`，仍执行真实 `task.parse` 与正式提交流程。

| 编号 | 类型 | 结论 | 首要代码位置 |
| --- | --- | --- | --- |
| RT-1 | P2，已确认 | 前台候选选择后未复查暂停，已暂停仍可开始新一轮／接管等待轮 | `src/host/runtime.ts:80–89`；同类 `66–69` |
| RT-2 | P2，已确认 | 到期预约只修改描述也被当成重新排期，立即触发额外故事轮 | `src/memory/organize.ts:61–72` |
| RT-O1 | 优化建议 | 热调度反复读取全部历史任务，未使用已有 pending 索引 | `src/host/scheduler.ts:81,141`；`src/app.ts:145` |
| RT-O2 | 优化建议 | 终态环境步骤持续保留完整准备／检索快照，现有载荷压缩未覆盖 | `src/environment/runtime.ts:56`；`src/environment/scheduler.ts:16` |

## RT-1：候选选择与暂停交错时，暂停后仍开始新的故事工作

**合同。** 调度说明 §1 明确暂停后仍保存与合批输入，但不另开新故事；暂停也阻止新环境与维护派发／提交。当前已经开始的故事继续完成，与“候选已选中但尚无 TurnRecord／模型调用”是不同状态。

**触发。** 一个前台请求已经由 `collectReady` 返回 Promise，但 Host 尚未从 `await` 恢复；此时调用 `host.pause()`。`pump` 在第63行检查的旧暂停值已经失效，第81行只检查 `stopped`，随后第89行直接 `app.runTurn(ready)`。环境准备分支第83–84行会重读暂停状态，普通前台分支没有同等门禁。等待轮的 `collectWaitingContinuation`／第67–69行有同一个缺口。

**最小证据。** [`runtime-probe.ts`](evidence/runtime-probe.ts) 的 `pauseSelectionRace` 保存一个已到期预约，依次调用 `host.start()`、`host.pause()`，最后等待两者完成：

- 暂停调用点：模型调用0次、故事轮0条；`pausedImmediately=true`。
- 完成后：`runtime.paused` 仍为 `true`，却已运行 `narrative`、`personal_chat`，新建并成功提交一轮，预约变为 `completed`。
- `pauseWaitingSelectionRace` 从合法 `replyFreshness.state=waiting` 出发，暂停点仍是0次模型调用；随后也在暂停中切成 `scope=event` 并完成。

**后果与限定。** Host API 层 `paused=true` 后仍产生新模型请求、推进状态并消耗预约；如果个人导演选择回复，代码也会进入输出路径。本探针选沉默分支，因此直接证实的是新调用与提交，未实测平台发送。当前两个 collect 方法内部没有 await，窗口准确地说是 Host 等待已解决 Promise 时产生的微任务边界，不是等待网络期间。真实 Koishi 暂停命令是否能到达这一窗口、发生频率如何，本次均未复现；不能将直接 API 交错描述为已在线观测到的暂停失效。

**修复方向。** 在上述两个异步选择返回后、实际开始／继续生成之前重新读取暂停门禁。保持正在执行整轮的既有完成语义；可沿用环境分支已经采用的选择后复查模式。

## RT-2：预约的非时间修改错误地阻止完成，立即再次触发

**合同与边界。** 到期预约触发个人判断；真正改期可以覆盖默认完成。模型提示 `src/model/prompts.ts` 的 `personalRules` 明确要求已有任务使用 ID `update/cancel`，并要求 `update` 只填改动字段。`taskChange` 也允许 partial 更新。已有 `tests/tasks.test.ts` 覆盖“明确更新为将来的时间”优先于完成，符合合同。`tests/review-fixes.test.ts:24–28` 特意允许创建 `at=NOW` 的预约，因此这里**不主张给全部预约套未来时间限制**。

**触发。** 本轮已到期预约进入 `candidate.completedTaskIds`；个人导演合法地只修正 `description`，没有修改预约时间。例如 `update appointment {description:'正在赴约，地点改为门口'}`。`applyTasks` 第61–64行把所有 `update` 一律算作重新排期，跳过本轮完成；第72行又无条件将更新后的任务写回 `status:'pending'`。原来的到期 `at` 保持不变，于是下次 `Scheduler.foreground` 第81行立即再次选中同一预约。

**最小证据。** 探针 `dueAppointmentDescriptionUpdate` 连续实际运行3轮，每轮提交后预约仍是 `pending`，`nextDeadline=NOW`。第二个探针 `appointmentAutomaticHostRepeat` 不手动调用下一轮，只调用一次真实 `host.start()`：前三次个人输出只改描述，第四次特意返回无任务变更以结束复现。Host 自动连续完成4轮、4次主叙事与4次个人调用；无新输入、4个 `turn.at` 全是同一 `NOW`。这是被当前 schema 接受的业务更新，并非无效 JSON 或虚构存储损坏。

**可见后果。** 一次描述修改至少造成额外一次无新事件的故事轮；若模型持续补充／重写说明，Host 会持续重复该预约，增加模型成本、可能重复回复，并反复刷新自主周期。探针证明连续重复，不宣称任何实际模型必然无限循环。

**修复方向。** 区分“修改预约元数据”和“显式改变执行时机”。已被本轮处理的预约在仅描述更新后仍应完成；只有确实选择再次执行／改期时才维持 pending。保留创建当前时刻预约及显式未来改期的原合同，不把修复变成全局时间禁令。最小回归应覆盖：description-only 更新、明确未来改期、当前时刻创建三类情形。

## RT-O1：用待办工作集替代重复读取历史任务

`foreground`、`nextDeadline`、等待轮和 `app.generateTurn` 都通过 `storage.all('tasks')` 再在 JavaScript 中筛选 pending。普通空闲路径还会通过 `autonomousEligible → foreground` 重复计算。历史 completed/cancelled 任务一直保存，因此输入唤醒、状态查询与定时调度成本随总历史增加；`Storage` 已有 `task_due(status, at)` 表达式索引，却没有被这些读取使用。

`taskHistoryCost` 合成1000／10000条已经完成的消息检查，无待办，记录5次 `collectReady + nextDeadline`。每组共调用20次 `all('tasks')`，即每次调度／截止组合完整物化历史4遍。

| 已完成历史任务 | 每次组合物化行数 | 5样本耗时范围 |
| --- | ---: | ---: |
| 0 | 0 | 0.76–1.03 ms |
| 1,000 | 4,000 | 10.74–13.87 ms |
| 10,000 | 40,000 | 100.31–110.79 ms |

同一内存库按索引筛选 pending，10000历史样本返回0行，单次查询约0.0175 ms。这只是可移除的历史读取证据，不是声称完整调度优化后一定达到0.0175 ms。计时受本机其他测试影响；物化行数不受计时噪声影响。

建议新增 pending/due 查询并在单次调度评价中复用待办快照。按 epoch 比较时间，避免把不同时区的 ISO 字符串字典序当作时间；保留历史任务行即可，不需要删数据或改变业务容量。优先处理 Host 热路径，再处理环境周计划和共同活动结束的任务筛选。

## RT-O2：压缩终态环境准备快照

`freezeEnvironmentSnapshot` 保存完整环境输入、school 读视图及检索候选；`freezeEnvironmentRetrieval` 第56行还会把候选的可用向量转换为普通数组持久化。提交时 `commitEnvironmentResult` 第56行扩展整个旧 step，跨日 supersede 第16行也保留整个 step，因此 `inputSnapshot`、`preparationSnapshot` 和 `frozenResult` 均不会因为终态消失。每日每阶段重复采样，长期保留的恢复正文会持续累积。

探针 `terminalEnvironmentPayload` 使用100条合成 detail、无向量、无网页、无模型联网。世界步骤成功 `committed` 后仍有100条检索候选，单行 JSON 为579,820字节。调用当前 `compactCompletedPayloads` 后仍为579,820字节、`totalUpdated=0`。现有 compactor 覆盖 memory jobs、post jobs 和终态 web checkpoint，未覆盖 environment step 正文。这不是生产库大小测量，也不能据此断言真实每日增长率。

建议增加终态环境载荷压缩：保留阶段身份、日期、attempt/generation、结果摘要与必要依据指纹；在原子提交／终结后移除只为恢复而存在的完整准备正文，旧数据可按现有停服分批压缩机制处理。必须保留 pending/running/ready 完整恢复载荷和版本0兼容合同。该建议改变存储策略，当前不列作直接功能缺陷。

## 执行证据与未覆盖范围

复现命令：

```powershell
npx tsx docs/v0.5/reviews/comprehensive-audit-20261011/evidence/runtime-probe.ts
```

原始输出：[`runtime-probe-output.json`](evidence/runtime-probe-output.json)。探针断言的是本基线已观察到的问题状态，exit 0 表示成功重现与采证，不表示产品合同通过；后续修复后应按修复目标调整回归断言。只写了本报告与独立证据文件，没有改审核索引。仓库现有全量测试由主审核任务统一执行，本子任务未重复全量运行。

已检查冻结生成→首次发送→后处理的候选换代、共享活动开闭路由、环境重试／依据失效／跨日／lease、睡眠与预约以及部署停止主路径；除上述项目外未在本轮确认新问题，不能据此宣称没有缺陷。没有真实QQ、供应商长延迟／质量、数月持久运行、真实进程停止或生产性能测量。跨日环境 web cache/checkpoint 释放路径已通知主审核协调其他范围，没有以未完成验证的候选充作本报告缺陷。
