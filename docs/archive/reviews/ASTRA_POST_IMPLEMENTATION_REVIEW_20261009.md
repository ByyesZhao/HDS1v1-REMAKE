# ASTRA 实施后复核：eb5b29e

日期：2026-10-09。复核对象：`73774bf..eb5b29e` 的实现、[交付记录](../records/ASTRA_FIX_DELIVERY_20261009.md)、[实施过程](../records/ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)及三份修复方案。

> 后续状态：R1已于同日按计划修复并补验关闭（b398699），详见§6及[补验记录](../records/ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md)。以下§1～5保留eb5b29e修复前复核结果，原失败日志与用例未改。

## 1. 结论

**本轮主要修复和性能结果有依据。发现 1 项 P2 后台恢复遗漏，建议补一笔修复再关闭对应验收项。**

四项原业务缺陷 F1～F4 的主要修复路径成立；未发现确定的新引入业务回归。已独立复跑完整 **121 份测试文件、681 项测试**，以及 typecheck、build、demo、双场景 smoke 和性能探针，均通过。

新增独立复核用例 9 项，8 项通过，1 项按“应保留恢复上下文”的正确期望失败，确认下述 R1。因此，原测试通过与仍有恢复遗漏可以同时成立；原测试没有覆盖这个真实失败组合。

R1 的清理语句在修复前 `73774bf` 已存在，**不是 SOL 本次改坏的代码**。但 F5／T7 方案明确要求已开始任务保留 checkpoint 恢复，本次交付将 T1～T13 标为完成，这项合同尚未兑现。建议把 T7 的这一条验收补齐，而不是撤销其余已验证的修复结论。

本次只新增 review、隔离证据和索引，未修生产源码。复核构建刷新了忽略的 `lib` 产物；所有运行使用临时／内存库及离线模型，没有访问正式故事库或调用真实 QQ／模型。

## 2. R1［P2］后台准备失败后，无条件清理 checkpoint，重试丢失格式修补上下文

### 位置与根因

- [src/memory/maintenance.ts](../../../src/memory/maintenance.ts)，第 152～153 行：catch 将失败任务保存为 pending；随后 finally 对所有维护任务调用 `compactOwnerCheckpoint`，没有区分准备成功和仍需重试。
- [src/model/client.ts](../../../src/model/client.ts)，第 30、48、62～63 行：ModelClient 从 checkpoint 恢复修补记录；checkpoint 为空就从 `repairCount=0`、无 repair 的新会话状态开始。
- [流程细化](../plans/ASTRA_FIX_OPERATIONS_IMPLEMENTATION_20261009.md)，§2.1、§2.4：已开始任务应保留输入、身份、cutoff、checkpoint；`started_and_legacy_pending_keep_frozen_input` 包含失败重试的 checkpoint 不变要求。

startedAt 的新分类正确阻止了业务 snapshot 被刷新，但它没有保护 ModelClient 的阶段 checkpoint。任务层输入与模型阶段恢复进度是两份数据，必须分别保留。

### 正常触发过程

1. 一个整理任务首次派发，`startedAt` 已保存。
2. 模型返回不符合合同的 JSON。ModelClient 保存 `repairCount=1`，记录原响应和格式错误，然后发出修补请求。
3. 修补请求发生临时传输失败。维护任务进入 pending，安排下一次重试。
4. `prepare` 的 finally 把这项任务的 checkpoint 清为 null。
5. 重试仍使用相同 job／snapshot／cutoff，但新请求已经没有上次的 repair 内容，修补次数也从零开始。

这条路径不要求启用网页搜索。复现使用默认关闭搜索的 WebSearchService；该服务仍承载 ModelClient 的阶段 checkpoint，与当前装配方式相同。

| 检查点 | 应有结果 | 实际结果 |
| --- | --- | --- |
| 首次修补请求 | repair 含原响应和错误 | 正常存在 |
| 临时失败后 pending | checkpoint 保留 repairCount=1 及 repair | checkpoint=null |
| 下次派发 | 继续同一修补上下文 | `CompletionRequest.repair === undefined` |

实际影响是丢失已经完成的修补进度和失败反馈，重试变为从原任务重新生成，可能重新经历相同格式错误及额外调用。现有 snapshot/readSet 和应用版本门禁仍在；本证据没有显示记忆被删除或旧结果覆盖新事实，也没有测量真实网页供应商重复调用次数。

### 复现证据

[memory.test.ts](postfix-evidence-20261009/memory.test.ts) 中：

`F5 contract gap: a started maintenance retry must retain its saved model repair checkpoint`

使用真实 MemoryMaintenance、ModelClient、WebSearchService 和内存 SQLite，只替换最外层模型传输。传输依次返回非法结果、抛临时请求异常、返回合法结果；没有伪造失败后的 checkpoint。

```powershell
node node_modules/vitest/vitest.mjs run --config docs/v0.5/reviews/postfix-evidence-20261009/vitest.config.mts --configLoader native --pool threads docs/v0.5/reviews/postfix-evidence-20261009/memory.test.ts
```

当前结果为 **3 通过、1 失败，退出 1**，失败差异是：

```text
checkpointAfterFailure: null
retryRepair: undefined
```

完整输出见 [memory-repro.log](postfix-evidence-20261009/memory-repro.log)。该失败测试位于独立复核目录，不属于根目录现有 `tests/**/*.test.ts` 套件；因此现有 681 项继续通过并不矛盾。

### 建议修复范围与验收

将 checkpoint 压缩与明确的准备完成状态绑定：结果已成功保存为 ready，或任务已确定终结时可以压缩；网络失败／超时后仍要重试的 pending，以及停止后仍需恢复的 computing，应保留原 checkpoint。finally 继续清定时器和监听器，checkpoint 清理则依据数据库中的最新状态执行，不能无条件销毁恢复依据。

已补充[可直接执行的 R1 修复计划](../plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md)，状态为待实施，供 SOL 确认复现后执行。计划确定最小代码改动、状态判据、C1～C6 回归、命令和关闭条件；新增正式测试文件 `tests/memory-maintenance-checkpoint.test.ts`，使用真实 ModelClient，而不只手工放入一个 started pending 后比较 snapshot：

1. 上述“非法结果→修补请求中断→重试”保留相同 repair 内容和计数，独立复现转绿。
2. 中断后重建维护对象／重开临时数据库，仍使用原 checkpoint 与冻结输入。
3. 成功保存 ready 后能够压缩 checkpoint；应用失败继续重试 ready 结果，不重新发模型请求。
4. 原索引合并、公平性、dirty 预留、状态版本门禁及 stop 恢复回归保持通过。

这是一项局部恢复流程补齐，不需要修改任务业务输入、开启搜索、扩大模型预算或重做主架构。

## 3. 已确认的修复与未发现问题的范围

| 范围 | 本次复核结果 |
| --- | --- |
| F1 活动身份 | 显式普通输入迁移、旧活动残留 FIFO／readyAt、本场时钟、开始确认与 B 事务、结束后首次可见均与方案对应；专项通过 |
| F2 个人提醒 | V1 读计划→推导实例→发布／选择／deadline 链路成立；公开版本与内部 revision 区分、跨午夜／时区／successor、失效边界均有回归 |
| F3 学校知识 | 即时与持久投影共用选择规则，已读新计划与历史旧课次共存，实际个人／表达／lookup 输入已有验证 |
| F4 晋升召回 | 除既有回归，新增真实 30 日期唤醒→晋升→canonical 合并测试通过；具体词命中一个 learned，原 durable long 不重复呈现 |
| F4 兼容补齐 | 新增真实后台完成回调→Host 自动重试延期补齐用例通过，补齐不依赖额外手动 wake |
| F5 索引／整理 | 未开始与 started／unknown 分类、请求前索引合并、纯状态变化、队位、dirty 版本等主要实现成立；新增失败索引重试保留旧文本且新版随后应用用例通过；R1 单独保留 |
| F6 对话／SQL | 新增独立旧算法 oracle、523 条分块 ID 与时区排序、首次输入全检、历史来源重新保护、第二未完成轮检查，5 项全部通过 |
| F7 状态 | 同规模重跑得到 153／155／157 字符，汇总与 raw 不变断言通过；SQL 汇总耗时仍可随历史增长，交付没有承诺它恒定 |
| F8 smoke | 实际 Koishi 入口两场景均四步 committed；生成分别 3／4 次，各 Embedding 1 次、repair 0 |
| D1 文档 | 当前导演说明已区分未保存过时提醒与已保存合法提醒的延迟发布，旧延迟发布回归仍通过 |

没有把最终测试名称与计划名称不同、已明确声明的离线范围、或原有 `ChatEpisodes.recent()` 全历史检索成本单独列为缺陷。F6 本轮的增长承诺针对固定工作集的日常输入检查，不是所有检索和所有 SQL 的恒定耗时承诺。

## 4. 本轮重新执行的证据

环境 Node.js v24.21.0／Windows，当前源码 `eb5b29e`。

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| npm test | 121 文件、681 项通过，退出 0，76.78 秒 | [suite-rerun.log](postfix-evidence-20261009/suite-rerun.log) |
| npm run typecheck | 退出 0 | [typecheck.log](postfix-evidence-20261009/typecheck.log) |
| npm run build | 退出 0 | [build.log](postfix-evidence-20261009/build.log) |
| npm run demo | 退出 0，普通及活动离线演示完成 | [demo.log](postfix-evidence-20261009/demo.log) |
| npm run smoke --prefix runtime | 双场景通过，退出 0 | [smoke.log](postfix-evidence-20261009/smoke.log) |
| node scripts/bench-chat-status.cjs --output docs/v0.5/reviews/postfix-evidence-20261009 | 工作量／状态增长断言通过，退出 0 | [benchmark.json](postfix-evidence-20261009/benchmark.json)、[输出](postfix-evidence-20261009/benchmark.log) |
| 独立复核配置运行 | 2 文件、9 项：8 通过、R1 的 1 项失败，退出 1 | [review-regressions.log](postfix-evidence-20261009/review-regressions.log) |

首次默认 npm test 在加载 Vitest 配置时遇到沙箱 `spawn EPERM`，未进入业务测试，保留 [suite.log](postfix-evidence-20261009/suite.log)。随后按工具授权在沙箱外运行同一命令，取得上面的完整通过结果；没有把环境错误计为产品缺陷。

性能重跑的固定工作集输入均为 **67 次查询、46 次 JSON 解码、46 条 data 返回行**；1k／10k／50k 的输入中位数约 **3.28／4.19／3.50 ms**。full audit 仍随历史增长，约 **5.66／52.68／411.89 ms**。这些是此次合成运行值，不能用两次不同耗时直接推断性能回退；可比较的硬门槛是工作量、查询计划和状态增长断言。

全部新增复核用例重跑：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/v0.5/reviews/postfix-evidence-20261009/vitest.config.mts --configLoader native --pool threads
```

修复 R1 前应看到 8 通过、1 失败；修复后应是 9 项全通过，再运行项目正式完整回归。

## 5. 交付判断

可以接受已验证的四项业务修复、主要性能优化和验收工具。建议 SOL 以 R1 为一个独立补丁，补真实阶段恢复回归，并在交付记录中增加补验结果；不需要重新执行全部 T1～T13 或再制定一轮大范围实施方案。

真实模型／QQ 连续运行、正式旧库补齐结果、数月数据规模和真实搜索质量仍属于原交付明确保留的验证边界。本 review 没有补做或代替这些验证。


## 6. R1修复后的关闭依据

唯一生产改动为MemoryMaintenance.prepare.finally：查询最新持久MaintenanceJob，ready/done才清checkpoint；pending/computing保留，计时器/监听器清理不变。源码补丁b398699已合入本地main，正式新增C1～C6展开12项覆盖真实修补中断、超时/stop和晚到、文件库重开、ready应用事务回滚、prune终结、跨后台重试额度累计。

同一原独立配置9项现全通过，其余8项保持；正式完整122文件693项通过，typecheck/build/demo/双场景smoke及diff检查退出0。单次独立源码复核Critical/Important/Minor均0。新证据路径为r1-fix-evidence-20261009/，详见[补验](../records/ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md)与[过程](../records/ASTRA_R1_CHECKPOINT_FIX_IMPLEMENTATION_LOG_20261009.md)。这些结果关闭R1/T7阶段checkpoint缺口，不改写上面原121/681和8/1历史，不新增线上/正式库结论。
