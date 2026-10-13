# 记忆重试与起床时间边界：交付记录

日期：2026-10-13。版本0.5.1。状态：M1、W1独立复核通过；M1／M2／W1及两项P2补修完成，a4e781f完整离线验收与独立最终复核通过。正式安全停服、一致备份、构建与配置部署、只读检查已完成；源码和离线验收记录已推送origin/main，部署详情见交付页。服务保持停止、原暂停状态保留，未启动服务、未人工resume。

返回[记录索引](../README.md)／[版本索引](../../README.md)。[交付范围与验收](DELIVERY.md)记录工程和现场事实，[R1～R4关闭映射](REVIEW_CLOSURE.md)对应原计划问题；[原计划](../../plans/memory-retry-waking-20261013/README.md)与[原审核](../../reviews/memory-retry-waking-20261013/REVIEW.md)保持原内容、日期和基线，不把旧58项探针改写成新验收。

本批规则：整合／audit限时600000ms，首次失败后最多2次自动重试，默认等待300000ms，索引仍120000ms；维护attempt、失败、周期和暂停归属持久保存。第三次失败整体暂停，每周期最多一次自动通知尝试；人工resume仅重开记录的周期，保留同jobId、runId、repairLimit2与网页20／40预算。ready归档／提交失败复用结果；存储故障停止派发。模型错误和清理前checkpoint不可变留存，含最后无效响应；起床叙事保留原睡眠区间与合法睡前阅读。

产品源码修正基线367747a6ca9c587e18d0eb069af8e474b479fd4a；最终离线验收基线a4e781f0d671bb122e9d42684f76a32ca2222fa8仅补旧测试断言，产品行为相同。首次完整回归223文件1478通过／4失败／2跳过及兼容诊断、两项P2和修正范围保留在[交付](DELIVERY.md)与[修正报告](evidence/task-2-fix-report.md)；最终整批离线验收完成：223文件1491项通过、0失败、2项既有跳过（总1493项）；typecheck／build／demo通过，插件合同2文件10项通过，双场景smoke各四阶段提交通过。实际部署／Git和未启动／未resume范围见交付。公共证据由主任务汇入本目录evidence／logs，原报告内容保持其基线含义。私有配置、数据库、历史响应／正文、认证及备份不入Git；部署仅记录经批准的参数摘要、指纹和检查结果。不记录token用量，不改模型／强度，不提升持久协议版本。

从仓库根目录运行node docs/v0.5/records/memory-retry-waking-20261013/check-docs.cjs检查本批Markdown本地链接；仅在公共证据尚未复制时用--allow-pending，输出明确区分待生成证据与坏链接。脚本仅检查当前docs／历史docs与src／tests链接，不运行产品测试，不读取私有配置或数据库。

离线日志：[typecheck](logs/final-typecheck.txt)、[build](logs/final-build.txt)、[全量tests](logs/final-tests.txt)、[demo](logs/final-demo.txt)、[插件合同](logs/final-plugin-contract.txt)、[双场景smoke](logs/final-plugin-smoke.txt)。smoke使用假provider，empty_week与required_notice均实际完成四阶段committed，不作为在线模型／QQ验收。

公共 .txt 验证日志仅去除末尾多余空行；完整原始日志随私有工程证据备份保留，JSON测试结果未改写。
