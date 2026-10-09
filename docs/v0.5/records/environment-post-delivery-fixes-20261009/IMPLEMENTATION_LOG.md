# 实施过程

2026-10-09：保存ASTRA新增报告及导航为a935209；原生工作树environment-post-delivery从该提交建立。当前产品cc963f8。复用本地依赖，先构建再全量146文件804项通过（85.65秒）。

Pre-flight：R1修改Host门禁，R2修改迁移统计，无共享改动接口。共同约束：Host门禁不下移到applyReady；统计helper不得改变迁移写入规则。

根因核对：collectReady返回Promise，Host await让出微任务后直接使用选中候选，缺少最新pause/openBatch/stop/unfinishedTurn检查；报告legacy过滤仅按输入／状态，未排除preparationVersion1且漏attempt>0。两项成立，不需要rebuttal。

部署授权：用户明确要求修好后升级正式库，覆盖原计划不做正式迁移的范围条款。只读计数确认67表情包、0消息／故事轮／记忆，1环境批次4步骤，环境规划1、普通窗口2。服务进程检查需提升只读权限，检查未发现明确HDSI Koishi进程。保留全部现有数据，验收后再备份升级。
R1：六组同轮公共API回归RED复现5失败1对照通过。加最新Host门禁后恢复均成功；首次恢复断言误取event.id（实际创建ID在change.id），纠正测试字段并保留该失败日志。GREEN五文件22项及typecheck通过；ready ID／generation保持，门禁解除后一次提交且world不重调，pending未冻结且重复wake不越门禁。
R2：正常协议2 ready/running及分类矩阵RED共6失败10通过；helper共享有输入／running／ready／attempt>0判定，报告额外按缺失／0／1分类，迁移只复用开始判定。GREEN16项、typecheck及ASTRA升级探针passed=true；旧合同0/1、备份还原、幂等和严格降级均通过。
完整验收147文件824项通过（94.40秒），build/typecheck/demo/双场景插件均退出0；ASTRA findings脚本7组全部passed=true，原baseline字段保留cc963f8。独立差异复核7文件40项通过（10.60秒），Critical/Important/Minor均无新发现。正式迁移尚待主目录合入后执行。
正式迁移已在fbb6843成功执行，1→2；备份DB/WAL/SHM可读且原数据指纹匹配，67图库及全部非协议字段保持。随后runtime/check.cjs真实只读检查失败：MemoryStore构造器安装缺失aux索引。新增合成旧索引库真实子进程回归2项RED；检查器改为Storage.get读取memory_schema_version，不创建可写Store；正式运行仍由可写Store安装索引。schema3可通过、schema2仍给迁移指引，检查前后字节不变且不新增索引。GREEN与smoke定向及typecheck通过。此额外修复是实际部署启动阻断，非防御性扩展；独立R1/R2复核未覆盖此后发现。
只读启动检查附加修复后，worktree全量148文件826项通过（101.69秒），重新build/demo/双场景smoke通过。正式迁移只执行一次；即将把954a23e及本验证证据合入主目录，检查原正式库而不再次升级。
最终主目录7821918全量148文件826项（96.96秒）、build/typecheck通过。正式配置/插件/67图库只读检查退出0；检查后与升级摘要对比，全部规范化表数据/结构不变。postcheck首次受限Git子进程未启动（status=null），保留原失败日志，提升权限后的同脚本只读检查通过。正式库没有再次迁移；未启动服务或联网。

最终文档收尾：当前V0.5全部30份Markdown（含根／docs入口）检查276个本地链接，无失效目标；证据见evidence/document-link-check.json。修正根入口旧的正式库未改措辞，并区分原文档核对与后续真实离线启动检查。全部过程日志与公开升级摘要保存，私有正式库／备份不入Git。本次原生工作树准备归档，主目录保留完整交付。
