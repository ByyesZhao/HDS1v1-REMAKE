# 实施过程

2026-10-09：保存ASTRA新增报告及导航为a935209；原生工作树environment-post-delivery从该提交建立。当前产品cc963f8。复用本地依赖，先构建再全量146文件804项通过（85.65秒）。

Pre-flight：R1修改Host门禁，R2修改迁移统计，无共享改动接口。共同约束：Host门禁不下移到applyReady；统计helper不得改变迁移写入规则。

根因核对：collectReady返回Promise，Host await让出微任务后直接使用选中候选，缺少最新pause/openBatch/stop/unfinishedTurn检查；报告legacy过滤仅按输入／状态，未排除preparationVersion1且漏attempt>0。两项成立，不需要rebuttal。

部署授权：用户明确要求修好后升级正式库，覆盖原计划不做正式迁移的范围条款。只读计数确认67表情包、0消息／故事轮／记忆，1环境批次4步骤，环境规划1、普通窗口2。服务进程检查需提升只读权限，检查未发现明确HDSI Koishi进程。保留全部现有数据，验收后再备份升级。
R1：六组同轮公共API回归RED复现5失败1对照通过。加最新Host门禁后恢复均成功；首次恢复断言误取event.id（实际创建ID在change.id），纠正测试字段并保留该失败日志。GREEN五文件22项及typecheck通过；ready ID／generation保持，门禁解除后一次提交且world不重调，pending未冻结且重复wake不越门禁。
R2：正常协议2 ready/running及分类矩阵RED共6失败10通过；helper共享有输入／running／ready／attempt>0判定，报告额外按缺失／0／1分类，迁移只复用开始判定。GREEN16项、typecheck及ASTRA升级探针passed=true；旧合同0/1、备份还原、幂等和严格降级均通过。
