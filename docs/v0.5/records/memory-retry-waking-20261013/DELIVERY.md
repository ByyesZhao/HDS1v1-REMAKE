# 记忆重试与起床修复：交付范围与状态

日期：2026-10-13。版本0.5.1，各持久协议版本保持。主开发目录为隔离memory-retry-waking工作树，W1来自独立waking-time-boundary工作树；产品源码修正基线367747a6ca9c587e18d0eb069af8e474b479fd4a；最终离线验收基线a4e781f0d671bb122e9d42684f76a32ca2222fa8仅补后续测试断言，产品行为与367747a相同。此前c60b204集成M1／M2／W1，随后修复两项P2并更新旧合同回归。最终完整离线验收与独立复核通过；正式部署／Git状态见末节。

## 已实现的行为

- 整合与audit独立限时600000ms，首次失败后最多2次自动重试，失败默认300000ms后按既有资格续办；索引仍120000ms。audit实际ModelTask／连接为memory_consolidation，提示／资料视图为memory_audit；模型、思考强度、repairLimit2、本地补查及Web20／40不变。
- 任务保存周期、执行数、失败数、attempt与结算身份。相同attempt只结算一次；成功准备及中间单元不清失败数。第三次失败failed、retryAt=null，与runtime.paused和独立maintenancePause同事务提交，保留对象预留。前台最近错误不覆盖该归属；人工resume只重开记录的job／周期，保持同jobId、runId及修补／工具预算。
- 终态通知发送前持久登记attempted，之后保存sent／failed，每周期最多一次自动尝试。关闭重开不重新发送已attempted通知；外部发送和SQLite不共同提交，不保证跨崩溃必达。status显示失败job、周期、执行／失败数和通知状态。
- 重启对computing无结果结算一次interrupted，已有结果转ready。旧pending计数使用legacy基线0／0；旧computing无结果仅采用当前观察到的一次执行／失败1／1，旧computing有结果转ready且基线0／0，不补造此前历史。ready归档／提交异常保留结果与checkpoint，后续只重试归档／提交。无法可靠保存计数／历史时显式存储故障停止派发。
- model_run_records不可变留存每次错误、最后无效响应及清理前checkpoint；独立invocationId避免恢复调用覆盖旧记录，重复写入同recordId幂等。归档和清理同事务／SAVEPOINT，失败回滚；四类清理入口统一处理。只读缺表兼容，可写载荷回收apply受控建表、dry-run不建表；不回填旧历史。
- 完整输入、修补、工具材料引用和图片观察保留；原图片资产清理照旧，不保证永久像素。历史不自动检索、不自动过期，无token／计费记录。起床narrative接收原睡眠区间；只拒绝睡眠内及原发布／可读／范围违规，合法睡前阅读仍可。校验后清已结束sleep再送personal，下一晚计划及原B事务保留；narrative恢复保持repairCount2，已尝试／沉默封口候选沿原合同。

维护不可变执行诊断区分prepare／archive／apply／timeout／interrupted，保存有界、脱敏的私有错误详情；未知transport文本不保存。公开job／runtime／status维持通用摘要。Host独立保留storageError，错误队列已消费也必须等全部排空后使stop拒绝，成功ready排空与可靠保存的可重试错误仍可成功停止。

当前规则见[记忆](../../subsystems/REMAKE_V0.5_MEMORY.md)、[导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md)、[恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md)、[参数／实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md)。

## 离线验收及审核

| 范围 | 当前证据与状态 |
| --- | --- |
| M1持久历史 | 独立spec／质量审核通过；实施者稳定定向11文件99项、typecheck／build通过。见[任务报告](evidence/task-1-report.md)／[审核](evidence/task-1-review.md) |
| M2有限周期／Host | 初始稳定定向9文件102项通过；独立审核提出R-M2-1，整批审核另提出F1诊断缺口。两项P2已在367747a修正，修正后稳定定向12文件134项及typecheck通过；最终CODE复查通过，F1／F2关闭；完整工程验收已通过。见[原任务报告](evidence/task-2-report.md)、[原M2审核](evidence/task-2-review.md)、[修正报告](evidence/task-2-fix-report.md) |
| W1睡眠输入／恢复 | 独立spec／质量审核通过，P3尾部空行已修；实施者定向6文件58项及typecheck通过。来源工作树提交49e4247，已集成并保留在367747a；见[任务报告](evidence/task-3-report.md)／[审核](evidence/task-3-review.md) |
| 最终整批 | a4e781f完整流水线全部退出0：223文件1491项通过、0失败、2项既有跳过（总1493项）；typecheck／build／demo通过，插件合同2文件10项通过，双场景smoke各四阶段提交通过；review7定向3项通过。见[全量JSON](evidence/final-tests.json)与[工程检查汇总](evidence/final-checks.json) |
| 一次整批独立审核 | [整批审核](evidence/final-review.md)保留原F1／F2，367747a最终CODE spec／quality APPROVED并关闭F1／F2，a4e781f测试微调亦获批准；完整工程验收已通过；原R1～R4实现映射见[关闭记录](REVIEW_CLOSURE.md) |
| 文档检查 | Markdown本地链接及git diff --check由文档任务执行；13份Markdown本地链接无缺失、无pending，git diff --check通过；最终链接数见文档任务报告 |

首次完整测试在c60b204执行223文件，1478通过、4失败、2既有跳过，原结果保留。4项失败属于旧兼容回归合同：容量升级应保留computing供中断记账；前台恢复测试的partial maintenance stub缺takeError；ready／index事务回滚测试使用过宽saveJob mock，阻断新的attempt／记账写入。修正补足stub并检查Host无错误，使用真实SQLite done-marker trigger验证业务／向量回滚、五分钟期限、磁盘恢复及不重新生成；同时修正两个public lastError旧正文断言。详情见[修正报告](evidence/task-2-fix-report.md)，旧失败没有被删掉或改写成通过。

第二次完整回归在367747a执行223文件，1490通过、1失败、2既有跳过。唯一失败为review7-maintenance.test.ts:22仍断言public lastError原文“apply failure”；当前合同已明确公开摘要通用、私有历史保留详情。后续a4e781f仅修正该测试的公开断言并补私有历史详情断言，review7定向3项通过，产品代码未变；随后a4e781f完整流水线通过，第二次失败仍作为历史证据保留，不覆盖其原结果。

所有已报告回归使用合成库、假模型／sender和离线环境。旧M1全量尝试与正在编辑的理由补丁重叠，其7项失败随后在稳定定向中通过；这不能代替本批稳定整批验收。原计划审核8文件58项也仅代表b730239旧基线。在线模型质量、真实QQ持续收发、历史自动补录、数月运行和断电行为不由本批离线结果证明。

## 部署、Git与恢复

| 项目 | 当前状态 |
| --- | --- |
| 正式安全停止与一致备份 | 用户已授权后续安全停止部署；实际执行和一致DB／WAL／SHM及旧lib／配置备份证据待主任务补充 |
| 正式构建放入与配置参数 | 待执行／补证；计划显式600000／2，原backgroundTimeoutMs120000、retryDelayMs300000保留，私有配置内容不入Git |
| 只读start-hdsi.cmd --check与数据指纹 | 待执行／补证；不把只读check称为可写建表或运行验收 |
| Git提交／推送 | 主任务负责，提交SHA、推送结果待补证；本文档任务未提交 |
| 服务启动／人工hdsi.resume | 未执行，由用户另行手动操作；部署或服务重启不消费resume，也不清暂停／失败周期 |

正式暂停与失败轮应在停服前重新只读核对，不能把原调查时间线当实时状态。首次可写初始化才可创建兼容历史表；若先执行只读check，它不建表。回退必须使用一致备份及配套代码，不删除历史证据。公共部署摘要只收参数白名单、哈希与状态，数据库／备份／原始响应保持私有。
