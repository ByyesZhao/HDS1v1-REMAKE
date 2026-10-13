# V0.5 实施合同入口

返回[版本索引](../README.md)。

当前已审核、待实施：[existingLongId 引用权限原计划（2026-10-13）](existing-long-reference-20261013/README.md)。[审核](../reviews/existing-long-reference-20261013/REVIEW.md)保留分离操作权限的方案B，要求补齐discarded目标最终校验、恢复权限发送投影及直接源码复现；执行者按[审核后实施细节](../reviews/existing-long-reference-20261013/EXECUTION_PLAN.md)顺序落实。7文件51项既有回归及探针是审核基线证据，产品尚未修复；原计划和诊断不改写，未部署。

当前已实施并完成离线验收：[记忆整合重试与起床时间边界修复（2026-10-13）](memory-retry-waking-20261013/README.md)。本批实现整合限时600秒、最多2次自动重试后报错停止，保留历史错误／checkpoint并修复起床通知获知边界；不记录token用量。[计划审核](../reviews/memory-retry-waking-20261013/REVIEW.md)提出4项P2修订并附验收要求，原方案正文保留原基线；修订要求已纳入实现／回归，M1／M2／W1及两项P2补修已完成，a4e781f整批离线验收与独立最终复核通过，见[新交付](../records/memory-retry-waking-20261013/DELIVERY.md)及[R1～R4映射](../records/memory-retry-waking-20261013/REVIEW_CLOSURE.md)。本轮不执行启动或人工resume。

当前已实施：[个人导演任务合同V2](personal-task-contract-20261011/PLAN_V2.md)及[细化步骤](personal-task-contract-20261011/EXECUTION_PLAN.md)，T1～T4离线验收通过。实际结果与现场状态见[交付](../records/personal-task-contract-20261011/DELIVERY.md)；[原方案](personal-task-contract-20261011/README.md)与[审核](../reviews/personal-task-contract-20261011/REVIEW.md)保留历史含义。

前次已实施离线合同：[综合审核整改执行包（2026-10-11）](comprehensive-remediation-20261011/README.md)。错误修复、流程／性能优化、Q1/Q2评估及Q3离线工具已完成；条件语义在线实验未执行，暂保留执行包路径供后续使用。实际验收与部署状态见[交付](../records/comprehensive-remediation-20261011/DELIVERY.md)。

此前已执行合同：[普通聊天回复跟进新消息](chat-reply-freshness-20261010/README.md)。[审核](../reviews/chat-reply-freshness-20261010/REVIEW.md)保留方案 B，补齐等待与事件接管、业务代际、图片冻结和资格重选 4 项合同；对应的[细化执行方案 T1～T5](../reviews/chat-reply-freshness-20261010/EXECUTION_PLAN.md)现已实施，见[交付](../records/chat-reply-freshness-20261010/DELIVERY.md)；15秒和4段参数不改；原调查见[记录](../records/chat-reply-order-20261010/README.md)。

此前实施合同：[查看消息资格与专注场景](phone-access-20261010/README.md)。普通专注活动默认可读但允许沉默，明确不可读活动强制结束时间；含旧状态部署处理。代码与工具已实施，交付及现场部署状态见[记录](../records/phone-access-20261010/DELIVERY.md)。

该计划的[审核结论](../reviews/phone-access-20261010/PLAN_REVIEW.md)为可沿原方案实施；当时提出的1处非阻断恢复措辞及当前协议回归／现场查询接点已纳入实施，原审核不改写为新验收。

[图片输入理解与本地网页搜索](image-input-local-search-20261009/README.md)已按 I1～I6、S1～S5执行，见[图片交付](../records/image-input-20261009/DELIVERY.md)与[搜索交付](../records/local-browser-search-20261009/DELIVERY.md)。后续交付复核发现项已[修复关闭](../records/image-search-post-review-fixes-20261010/REVIEW_CLOSURE.md)；为保持追溯链接稳定，此合同暂留原路径，后续目录整理时按[目录原则](../../DIRECTORY_POLICY.md)归档。原任务勾选框、旧探针及“待实施”正文只代表计划编写时状态。

此前图片／搜索批次的修复来源为[图片／搜索交付后复核](../reviews/image-search-post-implementation-20261010/REVIEW.md)的4项P2与1项P3；已执行[随review附带的修复方案](../reviews/image-search-post-implementation-20261010/FIX_PLAN.md)，无需重做I1～I6／S1～S5。见[新交付](../records/image-search-post-review-fixes-20261010/DELIVERY.md)；保留合同原路径用于复核追溯，后续目录整理再归档。

环境E1～E5及交付后修复已归档；见[环境交付](../records/environment-async-20261009/DELIVERY.md)、[后续修复](../records/environment-post-delivery-fixes-20261009/DELIVERY.md)。图片／搜索正式配置随后已启用，见[启用记录](../records/feature-enablement-20261010/README.md)；真实图片模型质量验收不由静态文档证明。此前安全停止R1修复合同在[随审核保存的方案](../reviews/freshness-graceful-stop-20261010/FIX_PLAN.md)，已按该方案修复并部署，见[交付](../records/graceful-stop-r1-20261010/DELIVERY.md)。本入口的已执行计划保留原基线状态；新的existingLongId计划单列为已审核、待实施。
