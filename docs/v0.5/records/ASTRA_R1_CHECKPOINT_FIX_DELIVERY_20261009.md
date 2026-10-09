# ASTRA R1 checkpoint 修复补验

日期：2026-10-09。源码基线 `eb5b29e`，生产/正式测试补丁 `b398699`，仅处理已开始维护任务的模型阶段恢复进度。依据[计划](../plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md)和[实施后review R1](../reviews/ASTRA_POST_IMPLEMENTATION_REVIEW_20261009.md)；逐步复现、夹具定位与裁决见[过程](ASTRA_R1_CHECKPOINT_FIX_IMPLEMENTATION_LOG_20261009.md)。

## 修复结论与范围

R1确实存在，原独立9项在基线8通过/1失败；正式C1使用真实MemoryMaintenance、ModelClient、WebSearchService与SQLite，确认失败时checkpoint=null。维护输入snapshot保存与模型checkpoint保存是不同合同。本次没有否定此前四项业务修复和性能结果，也不把已有681项历史验证改写成此次结果。

生产改动只有 `src/memory/maintenance.ts` 的 `prepare()` finally：
- 照旧清理计时器和abort监听。
- 对维护且提供web的任务读回最新持久job，ready/done才压缩checkpoint。
- pending/computing以及已不存在的job不清理checkpoint；索引路径不处理维护checkpoint。

输入、阶段runId、startedAt、cutoff/readSet、dirty、调度和应用事务不改；不新增迁移、依赖、预算或模型调用。repairLimit=2跨后台重试累计，达到上限仍允许一次携带原repair的后台请求，合法则完成、非法不再增加修补次数；不另加永久终结策略。准备结果先落ready再清cp，中间中断最多保留冗余cp，不丢结果。web未提供的执行方式不变。

## 正式 C1～C6 回归

新增 `tests/memory-maintenance-checkpoint.test.ts`，6组展开为12项；仅模型最外层传输是假响应，其余真实组件。每次捕获请求深拷贝。用可观察状态、受控Promise及fake timers等待；临时目录只清理测试创建的范围。

| 组 | 通过的真实断言 |
| --- | --- |
| C1 | 非法→修补传输失败→后台重试，同repair/input、job身份与完整冻结依据；当前owner变化不覆盖旧输入，应用仍判stale；共3请求 |
| C2 | timeout pending/retryAt、stop computing均保留整个cp；晚到成功不推进job或改变cp |
| C3 | pending/computing文件库关闭重开，重新构建组件，runId/cp/startedAt/cutoff/snapshot/readSet保持；更新owner后续用旧repair/input |
| C4 | ready持久结果后cp=null；既有operation/material/counters保留；应用事务注入一次异常后owner/标记回滚，ready结果原样重用，无新增模型请求；含无web分支 |
| C5 | prune唯一选中项使job done，后续成功/失败/stop均清cp、不复活；prune非选中依赖时仍computing，唯一单元失效后prepare保存done并清cp |
| C6 | cp repairCount=2后后台非法仅新增1请求、不重置额度；再合法带同repair完成，总5请求 |

旧finally专项6失败/6通过，新finally12项全通过。旧终态清理场景本来通过，修复后也不能被破坏。初始夹具维护时间不对导致startOne=false的输出仅作夹具诊断；真正R1 RED重新由旧finally取得，未手动补写失败后的checkpoint。

## 新验收证据

全部命令从隔离工作区执行，仅内存/临时库，离线传输，无正式数据或线上副作用。

| 命令 | 结果 | 新日志 |
| --- | --- | --- |
| 原独立配置9项（修复前） | 8通过/1失败，退出1；R1 cp=null/retryRepair=undefined | baseline-independent.log |
| 正式专项（旧逻辑） | 6失败/6通过，退出1 | c1-c6-red.log |
| 正式专项（新逻辑） | 12项通过，退出0 | c1-c6-green.log |
| 原独立配置9项（修复后） | 2文件9项通过，退出0 | independent-green.log |
| 相关既有回归 | 7文件34项通过，退出0 | related-green.log |
| npm test | 122文件693项通过，68.83s，退出0 | final-suite.log |
| npm run typecheck | 退出0 | final-types.log |
| npm run build | 退出0 | final-build.log |
| npm run demo | 退出0，普通/共同活动演示完整 | final-demo.log |
| npm run smoke --prefix runtime | 退出0，空周/必需通知各四步committed；生成3/4，各Embedding1，repair0 | final-smoke.log |
| git diff --check | 退出0 | final-diff.log |

日志保存到 `docs/v0.5/reviews/r1-fix-evidence-20261009/`，原postfix-evidence不修改。重跑原独立命令和正式专项见[计划§5](../plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md#5-命令与通过标准)。本补丁不改调度/查询算法，不重复运行性能探针，不以此新增数月性能或正式库结论。

## 独立复核与本地集成

独立单次复核：Critical/Important/Minor均0，源码与正式12项测试可合入。Declined-to-judge逐项裁决见过程记录。本地main已由eb5b29e快进到b398699。主目录再次通过122文件693项完整回归（65.72s）、原独立2文件9项、typecheck/build/demo/smoke及diff检查，全部退出0，日志为primary-*.log。8份相关文档114个相对链接检查无缺失，更新关闭说明后再检查。用户原README、计划和review先备份到新证据目录original-docs；原postfix-evidence未修改。当前lib构建已更新，服务没有启动。

R1关闭条件全部满足：正式真实阶段恢复/超时stop/文件库重开/ready应用重试覆盖，原独立失败转绿，其余8项不回退，终态仍清cp、未完成不丢上下文，最终完整验收通过。此前121文件681项为原交付与ASTRA复跑的历史记录，本轮122/693单独保存。

## 保留边界

旧版本已经清空的checkpoint无法补回，继续原空cp行为；现存cp得到保护。onReady异常仍沿用原catch语义，不顺带重构。stop computing由重建维护对象转pending，ready应用失败只重试结果，索引/dirty/公平性原测试保持通过。

本轮未读取密钥、正式配置、私人背景或正式故事库，未调用真实模型/Embedding、未连接QQ或启动服务。正式运行中的真实供应商故障、正式旧任务现状和数月稳定性没有此次证据。
