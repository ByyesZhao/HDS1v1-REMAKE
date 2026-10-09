# T1～T9整分支独立复核与关闭记录

日期2026-10-09。复核代码c9e4599..e45c3ac，加上当时未提交的T9说明。复核者只读代码及文档，没有修改工作区；独立重跑9文件47项通过，核对136文件761项全量日志。结论：无Critical，未发现已确认的正常输入业务回归；两项Important为计划验收矩阵缺口，补齐后可以交付。

## 原始发现与处理

1. Important：环境历史规模只覆盖deadline、metadata、batchSteps，遗漏已有身份ensure、兼容full select、正式提交完成检查、固定旧active supersede。
   已补进scripts/check-scheduling-queries.cjs；每种H=0/90/180均独立计数。已有身份读活动查询与当前身份各一次、无写入或步骤全文；full select额外只读取1份主键步骤正文；实际runEnvironmentStep ready提交后仅1条metadata返回4行标量，只有全部committed才写batch；过期active只改3个未提交步骤，原committed正文及无关历史字节保持。捕获实际SQL计划。共24个环境样本，加学校／相关知情8样本，总32。
2. Important：新compactCompletedPayloads入口缺环境和maintenance恢复状态参数矩阵，以及operations/materials/self-read保留断言。
   已新增tests/memory-payload-recovery-matrix.test.ts共15项；实际调用有限回收入口，覆盖environment pending/running/ready/committed/superseded、maintenance pending/computing/ready/done、turn未完成/完成、index pending/computing/ready/done。非终态载荷完全保留；终态只按合同清载荷，身份、计数、metrics、已应用／过期／剪除键、操作、完整网页资料及真实self-read来源保持。回收重复执行0更新。
3. Minor：firstMs在首次真实API调用之后才测，实际上是首个热样本；环境缺耗时样本。
   两个探针改为对首次真实入口调用计时，再调用5次记录hotMs及中位数。首次样本包含探针记录开销，表示该夹具中入口首次调用，不称为进程冷启动；耗时只观测，不作为性能门槛。环境只读入口均输出同口径；提交／supersede改变数据，仅记录一次计数和计划，不伪造重复同状态耗时。

复核修补未改变生产规则。初跑新增脚本缺一个闭合括号已修正；矩阵夹具由afterEach管理数据库，去掉手工重复close后全部通过。4个定向文件22项通过，typecheck退出0；规模工具32＋6样本通过。最终主目录全量、构建、演示和插件结果见DELIVERY.md。

## 裁决及剩余范围

上述三项全部处理，没有拒绝或延期的复核问题。按executing-plans规定执行一次修补，不再次委派整分支复核；以定向与主目录完整回归关闭。环境异步E1～E5、在线供应商、正式库升级、真实QQ及数月运行仍为原计划明确排除的独立范围，不冒充已验收。

本次用户已授权实施与保留本地Git记录；代码合入主目录属于使交付可运行的必要本地步骤，保留原有未提交文档，不追加合并许可流程。
