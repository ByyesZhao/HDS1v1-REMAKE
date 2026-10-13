# 记忆整合重试与起床时间边界：计划审核

日期：2026-10-13。状态：**计划审核完成，4项P2待修订，产品未实施**。

审核对象：[SOL修复计划](../../plans/memory-retry-waking-20261013/README.md)。源码基线：`b73023971d4050fddde0be0ec22779c316143399`，版本0.5.1。原计划保持不变，其SHA-256为`91b0b90b221c11f7a29c73e41dfcad1859daec958d28764cfbd6722e89150561`。返回[审核索引](../README.md)。

结论：可以保留“整合／audit限时600秒、首次执行后最多重试2次、耗尽暂停整个HDSI、人工恢复、历史错误与checkpoint留存、不记录token用量”的方向。建议先将下面4项纳入实施合同，再交给SOL执行。问题集中在并发失败、归档异常、睡前阅读权限及历史记录标识；无需重做整体方案。

本次对照源码并运行合成验证，未重新读取正式库验证原计划中的现场调查。原计划对“疑似120秒超时”和“保存的修补稿并非最后一稿”的证据限制应继续保留。

## R1 · P2：维护暂停的归属不能只放在lastFailure中

**计划位置：** §2.2、M2接口（第56～61、120行）。

计划允许已在途前台轮收尾，同时以`lastFailure.stage='maintenance'`及jobId／retryCycle识别人工恢复对象。但当前[前台失败处理](../../../../src/app.ts:103)会直接覆盖整个lastFailure；[Host恢复](../../../../src/host/runtime.ts:123)随后清除该字段并解除暂停。后台请求在途时，Host仍可处理前台输入，不能假定两类失败互斥。

具体交错：后台第三次失败，写入failed任务及维护暂停 → 在途叙事随后失败 → lastFailure变为generation，丢失jobId／cycle。按原计划“其他阶段暂停不改整合计数”恢复，就可能解除全局暂停，却留下本次应人工重启的failed维护任务；若改为扫描所有failed又会误清其他任务的预算。

合成探针注入计划规定的维护终态，再让真实`HdsiApp`前台失败：最终仍paused，但lastFailure为generation、无jobId，维护任务仍failed。这里只验证现有前台覆盖行为，未把尚未实现的M2宣称为已复现产品缺陷。

**要求修订：**

1. 为本次维护终态保存独立、持久的暂停归属，例如jobId＋retryCycle的事件／引用；lastFailure可用于显示最近错误，不能作为唯一恢复凭据。前台catch必须保留该归属，两类错误均可查询。
2. 将同一job／cycle的报告状态持久化。`takeError()`内存队列只能作唤醒信号；重启后仍须发现未处理终态，反复wake不得重复通知。建议明确“每周期最多一次自动发送尝试”，在发送前可靠记录尝试；外部发送与SQLite无法共同提交，不能把它写成跨崩溃必达且恰好一次的保证。发送失败保留原错误，并由status说明通知状态。
3. 人工resume以持久暂停归属选中本次failed任务，原子完成开启新周期与解除对应暂停；只存在前台失败时仍按旧合同恢复。若两类失败并存，一次明确的resume可恢复前台并开启被记录的维护周期，但不得清零其他failed任务。重启不消费这个人工恢复动作。
4. M2修改清单补入`src/app.ts`，或以经验证的独立状态设计证明前台处理不会覆盖维护归属。

**新增验收：** `foreground_failure_preserves_maintenance_pause_owner`、`terminal_notice_is_not_resent_after_reopen`、`resume_with_both_failures_reopens_only_recorded_cycle`。在真实Host交错中覆盖后台耗尽后前台失败／前台成功、通知失败、关闭重开文件库；断言两个失败仍在、周期仍为原值，人工resume后只重启被记录的维护任务。

## R2 · P2：归档失败需要纳入后台执行的错误处理

**计划位置：** §3第2～3条、M1归档接口及`archive_write_failure_keeps_live_checkpoint`（第72～73、108、112行），与M2衔接。

归档与清理同事务是必要条件，但仅测事务回滚不足。当前维护[成功后清checkpoint](../../../../src/memory/maintenance.ts:160)发生在`prepare`的finally中，位于其catch之外；[后台派发](../../../../src/memory/maintenance.ts:134)只将这个Promise保存到active，Host不等待它。加入会抛错的历史写入后，原路径会出现“模型成功、ready已保存、onReady已调用，但finally拒绝”的状态。

在该清理入口注入归档异常，探针确认：active拒绝，job仍ready、lastError=null、runtime未暂停，checkpoint保留，且onReady已触发。事务保住现场，并未把错误送入有限重试／Host报告；真实调用方还可能产生未处理的Promise rejection。探针主动接住了该拒绝，没有制造进程崩溃。

**要求修订：**

1. 明确归档属于哪一执行阶段及失败预算，不把持久化写入留在无保护的finally。可以由已有ready结果提交阶段承接归档，或保存可重试的归档待办；finally仅保留不会失败的资源收尾。
2. 归档失败后保存已生成的ready结果和原checkpoint，后续仅重试归档／提交；不得退回pending重新请求模型，也不得把未可靠留档的任务宣告完成。更新结果、归档、清理和onReady的顺序应形成明确合同。
3. 这类失败必须进入M2的统一失败处理，同一执行attempt只结算一次；若后续又执行归档／提交重试，则记录新的执行尝试。数据库本身无法再写入时，应显式报告存储故障并停止派发，不能把“已可靠记账”当作成功结果。
4. 后台active拒绝、Host消费和安全停止排空必须有完整的错误传播路径；不能靠无人等待的Promise传错，也不能用空catch吞掉错误。

**新增验收：** `archive_failure_after_prepare_preserves_ready_result`、`archive_retry_does_not_call_model_again`、`archive_failure_reaches_host_without_unhandled_rejection`。注入“模型成功后归档失败”和“ready提交事务内归档失败”，检查checkpoint／结果都在、计数只增加一次、重试不再次请求模型、耗尽确实暂停；再覆盖graceful stop等待时发生归档异常。已有“归档失败事务回滚”用例继续保留。

## R3 · P2：wakeAt不能成为整段叙事的统一阅读下界

**计划位置：** §4第2、4条（第84、86行）。

“通知获知不得早于wakeAt”及“睡眠前……仍拒绝”会禁止合法睡前阅读。起床轮的`from～at`可能跨过睡前清醒时间、睡眠时间和醒后时间；waking只描述本轮终点，不能把前面所有经历都当作睡眠中。

当前[睡眠判定](../../../../src/host/state.ts:7)拒绝半开区间`[sleepAt,wakeAt)`内的阅读；[学校校验](../../../../src/school/progress.ts:8)还检查发布／释放时刻、经历范围和手机权限，允许符合条件的睡前阅读。合成区间为23:00～次日08:01:00.008，通知23:00已释放，睡眠00:06～08:01：23:50阅读通过，00:30拒绝，08:01:00.000通过。按计划文字新增统一wakeAt下界会改变这个正确行为。

**建议替换为：**

> 起床轮保留原睡眠区间。阅读经历必须处于本轮from～at内、不早于通知publishAt及releasedAt，并通过既有手机权限校验。普通非shared状态下，不允许在[sleepAt,wakeAt)内阅读。睡前已经满足条件的阅读仍合法；醒后阅读最早为wakeAt，不要求等于带毫秒的turn.at。waking不授权提前醒。

**新增验收：** `waking_round_preserves_valid_presleep_notice_reading`。与原计划的睡眠内拒绝、精确wakeAt放行、未发布／未来／phoneAccess=false等用例成组，避免只覆盖08:00:40这一现场输入。

本次同时复现了原计划要修的输入不一致：[narrative生成前](../../../../src/app.ts:160)已清除内存state.sleep，而学校校验读到的正式character仍保留原睡眠。保留睡眠事实、生成后再清已结束区间的方向正确，无需为了这个输入问题放宽学校权限。

## R4 · P2：失败记录ID缺少前台调用与恢复调用的唯一身份

**计划位置：** M1接口（第108～110行）。

计划要求保存全部模型解析失败，却规定“失败ID由attemptId＋调用内序号区分”，同时executionAttempt只由M2传入。主叙事、个人导演等前台调用有持久runRef，但没有维护attemptId；“无runRef时临时诊断runId”的分支不能解决它们的标识。

[ModelClient](../../../../src/model/client.ts:26)可在同一业务runId上被多次调用，[阶段身份](../../../../src/web/phases.ts:4)与repair预算在恢复时复用。如果以runId或空attemptId代替、再从零开始计序号，恢复后的失败会与先前记录碰撞；覆盖会丢历史，忽略冲突会漏新错误，直接插入会把模型错误变成数据库错误。

合成验证：同一个前台runId第一次调用返回3份无效响应，repairCount耗尽为2；第二次调用继续沿用同runId和预算，仍可收到第4份无效响应。当前checkpoint只保留第2份修补原文。原计划已打算补存最后一稿，但还须能区分两次调用，才能同时保存第3、4份。

**要求修订：** 每次`runModel`建立独立的诊断invocationId／callId，例如UUID；failure记录按该ID＋响应序号＋记录类别生成唯一ID，维护retryCycle／attemptId作为附加关联字段。业务runId／stageKey和repair预算不因此更换。一次记录写入重试复用既定recordId，实现幂等；不同调用／响应不能合并。网络／超时等执行者记录也须有明确的唯一身份。

**新增验收：** `foreground_resume_keeps_all_invalid_response_records`、`history_record_identity_survives_reopen`。无维护executionAttempt、web搜索禁用、同runId先3次失败后恢复再失败1次，断言4条解析失败记录各自保留raw，第3和第4稿均存在；关闭重开库后也不碰撞。不为取证新增token用量字段，不改变repairCount=2。

## W1的两处验收澄清

这两项并入W1修订，不另计缺陷：

- 第135行应明确恢复的是**narrative阶段**已耗尽的checkpoint。合法新叙事可以继续到个人导演；再次返回非法叙事应在首个响应后失败，不再获得2次修补。只断言“个人流程完成／非法个人响应暂停”不能覆盖本次起床故障的预算。
- 清除的是已经结束的睡眠区间。现有[睡眠安排](../../../../src/app.ts:248)会在起床轮尾部生成下一晚的计划；应断言personal输入不带已结束sleep、正式状态仅按原B事务提交，不要断言最终candidate.nextState.sleep永远为null。本次探针最初使用后一断言，核对源码后改为检查下一晚计划仍在，未将其列为产品错误。

## 可直接并入实施文档的交接清单

| 任务 | 执行前补充 |
| --- | --- |
| M1 | R4调用标识；R2归档异常的处理合同及故障注入测试，不能只实现归档存储层 |
| M2 | R1持久暂停归属／通知尝试状态／并发恢复测试；承接R2归档与提交失败计数 |
| M2检索点 | 将failed纳入“保留占用”而非“可派发”的筛选；核对ensureCycle、ensureIncremental、metadataWork、nextDeadline及MemoryStore引用查询，避免统一替换status列表造成failed重新执行 |
| W1 | R3分段时间权限；补合法睡前阅读；以narrative阶段验证原失败恢复；保留下一晚睡眠安排 |
| V1 | 逐项关闭R1～R4，记录新回归实际数量；本审核的58项只代表旧代码基线 |

原计划关于600秒与索引120秒分开、首次＋2次重试、repair预算独立、computing中断持久去重、ready结果复用、failed占用保护、只读打开不DDL及正式恢复另列的要求均保留。当前代码没有这些新增能力，本报告不是交付验收。

## 验证与证据

现有定向回归：**8文件58项全部通过**。原始结果见[Vitest报告](evidence/baseline-tests.json)。本次无产品代码改动，未跑全量构建、完整测试或正式插件启动。

| 测试文件 | 通过数 |
| --- | ---: |
| memory-maintenance-checkpoint.test.ts | 12 |
| memory-idle-host.test.ts | 6 |
| memory-idle-recovery.test.ts | 3 |
| memory-capacity-prune-race.test.ts | 5 |
| web-persistence-v2.test.ts | 14 |
| world-school-review14-time.test.ts | 4 |
| world-school-personal-reminder.test.ts | 1 |
| model-settings.test.ts | 13 |

独立合成探针见[源码](evidence/plan-boundary-probe.ts)及[结果](evidence/plan-boundary-probe.json)。只使用内存库、假模型与假sender，验证现有集成边界；不调用在线模型／搜索或真实QQ，不读取正式数据。`passed=true`表示这份审核探针的断言成立，**不表示待实施修复通过**。文档与范围检查见[验证清单](evidence/verification.json)。

从仓库根目录复跑；若复跑发生于后续基线，应改用新输出文件名，不覆盖本次证据：

```powershell
$reviewTemp = Join-Path (Get-Location) '.tmp/memory-retry-waking-review-rerun'
New-Item -ItemType Directory -Force -Path $reviewTemp | Out-Null
$env:TEMP = $reviewTemp
$env:TMP = $reviewTemp
node node_modules/vitest/vitest.mjs run tests/memory-maintenance-checkpoint.test.ts tests/memory-idle-host.test.ts tests/memory-idle-recovery.test.ts tests/memory-capacity-prune-race.test.ts tests/web-persistence-v2.test.ts tests/world-school-review14-time.test.ts tests/world-school-personal-reminder.test.ts tests/model-settings.test.ts --reporter=json --outputFile=.tmp/memory-retry-waking-review-rerun/baseline-tests.json
node --import tsx docs/v0.5/reviews/memory-retry-waking-20261013/evidence/plan-boundary-probe.ts .tmp/memory-retry-waking-review-rerun/plan-boundary-probe.json
```

本次交付仅为review、合成证据及索引更新；原计划正文、产品代码、配置和正式运行状态未改，未执行部署、resume或Git提交／推送。
