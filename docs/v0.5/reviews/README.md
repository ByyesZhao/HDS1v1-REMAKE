# V0.5 最新审核与证据

返回[版本索引](../README.md)。

[记忆整合重试与起床时间边界计划审核](memory-retry-waking-20261013/REVIEW.md)：2026-10-13，源码基线`b730239`（0.5.1）。保留600秒、首次＋2次重试及耗尽全局暂停方向，提出4项P2修订：并发失败的暂停归属、归档异常传播、合法睡前阅读、失败记录唯一身份。现有8文件58项回归及合成边界探针通过；这是计划审核，产品尚未实施，原计划正文和正式现场未改。

[个人导演任务合同方案审核](personal-task-contract-20261011/REVIEW.md)：2026-10-11，源码基线`9a14ea4`（0.5.1）。保留方案B，修正1项P2恢复边界问题，附[V2方案](../plans/personal-task-contract-20261011/PLAN_V2.md)与[细化实施文档](../plans/personal-task-contract-20261011/EXECUTION_PLAN.md)；现有6文件50项回归及离线恢复时间／角色探针通过。该记录仅表示审核、修订与执行细化时状态。随后T1～T4已实施，见[交付及最终独立复核](../records/personal-task-contract-20261011/DELIVERY.md)。

[综合审核原报告](comprehensive-audit-20261011/README.md)：2026-10-11，源码／文档基线 `ce7e88e`；覆盖文档对应性、代码BUG及非安全方面的性能／流程／逻辑提升。其4项P2、1项P3代码发现及2类文档问题已完成整改，见[交付](../records/comprehensive-remediation-20261011/DELIVERY.md)与[逐项关闭矩阵](../records/comprehensive-remediation-20261011/evidence/closure-matrix.json)。原报告、失败探针与189文件1034项的原基线验收记录保留，不改写为修复后结果。

前次整改的专项复核随[实施记录](../records/comprehensive-remediation-20261011/README.md)保存：[整分支静态复核](../records/comprehensive-remediation-20261011/reviews/FINAL.md)覆盖`9c20a97..f60afa6`，后续Q3工具由[独立复核](../records/comprehensive-remediation-20261011/reviews/Q3.md)覆盖，最终217文件1370项由实施者统一执行。语义工具通过不代表真实Embedding质量已验证，Q2结论仍为keep_current。

此前两批独立代码复核随[导演联网软提示](../records/runtime-web-guidance-20261011/README.md)和[动作限定线下](../records/offline-action-only-20261010/README.md)保存。下列独立报告只覆盖它们标注的基线；当前规则见[版本索引](../README.md)，基线`5b92794`的说明复核见[整改后文档核对](../records/document-post-remediation-sync-20261011/README.md)。配置白名单继续保留原核对日期，不将旧报告写成新代码的完整复核。

此前[普通回复新鲜度与安全停止交付后复核](freshness-graceful-stop-20261010/REVIEW.md)，基线086cd07。新鲜度T1～T5未发现需修复问题；安全停止新增1项P2（浏览器关闭失败仍报告成功并退出）后续已修，见[关闭记录](../records/graceful-stop-r1-20261010/README.md)，原报告附[修复执行方案](freshness-graceful-stop-20261010/FIX_PLAN.md)与HTTP组合探针。既有187文件1004项经全量运行及两组沙箱限制复跑均有通过记录；新增缺陷探针在086cd07为RED；安全停止R1后的原探针转为GREEN，新增回归及最终188文件1009项见[交付](../records/graceful-stop-r1-20261010/DELIVERY.md)。原I1断连修复仍通过，原审核报告与失败日志不改写。

前次[普通回复跟进新消息方案审核](chat-reply-freshness-20261010/REVIEW.md)，源码基线3fb4e1c；保留原方案 B，补齐 4 项重要合同，附[细化执行方案 T1～T5](chat-reply-freshness-20261010/EXECUTION_PLAN.md)。原基线定向回归8文件35项通过，合成探针复核旧行为与重算接点；新功能现已实施，工程验证与独立复核见[交付](../records/chat-reply-freshness-20261010/DELIVERY.md)。原报告不改写为实施验收。

前次[查看消息资格计划审核](phone-access-20261010/PLAN_REVIEW.md)，源码基线a66a89c。审核当时未实施，结论为设计可继续，无阻断问题；1处恢复验收措辞需收窄，附协议2回归及现场查询接点建议。审核当时既有定向回归5文件／23项通过；现已实施，实际交付与部署状态见[记录](../records/phone-access-20261010/DELIVERY.md)。

前次[图片输入与本地搜索交付后复核](image-search-post-implementation-20261010/REVIEW.md)，基线2a2e77e；确认的4项P2、1项P3已按方案修复，见[修复关闭](../records/image-search-post-review-fixes-20261010/REVIEW_CLOSURE.md)与[最终交付](../records/image-search-post-review-fixes-20261010/DELIVERY.md)；原报告保留基线含义，附[修复执行方案](image-search-post-implementation-20261010/FIX_PLAN.md)。真实协议2 App、Chrome页面提取与Koishi启动失败均有离线复现。原173文件／882项均有独立通过记录，其中2项因沙箱限制单独复跑；构建、类型、演示及双场景插件验收通过。主体架构保留；执行者逐项回归已完成，整批175文件920项及类型/构建/demo/双场景smoke通过，一次独立审查补修完成（原报告与TDD关闭分别保留）。

前次[图片输入理解与本地搜索计划审核](image-input-local-search-20261009/PLAN_REVIEW.md)，基线4fe090c，包含源码核对、离线探针与具体修订／测试要求；意见已纳入[修订执行包](../plans/image-input-local-search-20261009/README.md)，随后I1～I6、S1～S5已交付。原计划审核不是新功能验收，交付后发现项的关闭以[最新修复记录](../records/image-search-post-review-fixes-20261010/REVIEW_CLOSURE.md)为准。

前次[环境异步交付后复核与修复实施方案](environment-async-20261009/post-delivery/REVIEW.md)基线为cc963f8。独立重跑146文件804项、类型、构建、演示和双场景插件验收通过；其确认的1 P2和1 P3已按方案修复。后续[独立差异复核](environment-async-20261009/post-delivery/FIX_DIFF_REVIEW.md)7文件40项通过，无新发现；[修复／正式升级关闭](../records/environment-post-delivery-fixes-20261009/DELIVERY.md)包含最终主目录148文件826项、部署后只读启动检查补丁与数据保留验证。原报告未勾选清单与原失败日志只表示原基线。独立差异复核未覆盖此后发现的启动检查补丁及正式部署。

前轮[环境异步E阶段独立复核](environment-async-20261009/INDEPENDENT_REVIEW.md)的代码范围为272437f→2a6b981，确认1 Important来源全文复制和1 Minor非消息来源依据缺口，随后均由实施者修复，见[关闭说明](../records/environment-async-20261009/REVIEW_CLOSURE.md)。前轮独立审核只重跑8文件25项；修复后实施者重跑全量146文件804项。原报告与原失败探针保留，不改写成通过；本次交付后复核有单独基线与证据。

前批[ASTRA T1～T9最终复核](../../archive/reviews/post-t1-t9-20261009/REVIEW.md)及旧ASTRA、R1、DSH材料在[历史审核](../../archive/reviews/)或[历史送审包](../../archive/dsh-review/)。旧缺陷断言按原基线使用。

默认送审材料范围见[版本索引](../README.md)；目录遵循[目录原则](../../DIRECTORY_POLICY.md)，不附本地私有运行归档。
