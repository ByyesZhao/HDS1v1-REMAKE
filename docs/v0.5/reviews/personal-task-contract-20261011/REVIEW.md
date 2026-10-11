# 个人导演任务合同方案审核

日期：2026-10-11。源码基线：`9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78`（0.5.1）。范围：[原方案](../../plans/personal-task-contract-20261011/README.md)、[原设计](../../plans/personal-task-contract-20261011/DESIGN.md)与相关当前代码。状态：**审核完成，建议采用[V2方案](../../plans/personal-task-contract-20261011/PLAN_V2.md)，尚未实施**。

## 结论

方案B方向可采用：app已统一维护真实未读检查与reply=later复议，模型再直接修改check_messages确实有职责重叠。收窄个人任务输出、Schema／parse使用同一预约快照、保留经历和学校观察触发，均有代码依据。不需要扩大历史消息权限、删掉个人阶段或增加修补次数。

发现1项需要修正的P2方案问题：恢复兼容按“有无冻结结果”二分过粗，会让实施者保留本该重生成的旧候选，并误判本次失败轮恢复时使用的时间。另补充相关恢复用例，未据此宣称存在新的生产代码故障。

## R1（P2）：保留旧候选的条件不是仅有frozenResult

原[设计§6](../../plans/personal-task-contract-20261011/DESIGN.md#6-兼容与恢复边界)第79行概括“已冻结轮”不重算；[原T3](../../plans/personal-task-contract-20261011/README.md#t3验证有限修补与旧轮磁盘恢复)第90行也禁止给全部已冻结结果增加新Schema重验。原设计第90行进一步写恢复依冻结轮时间。T3只举有confirmed输出的旧candidate，因此发现不了全pending分支。

实际代码：

- [app.ts:74](../../../../src/app.ts:74)的resumeUnfinishedTurn在outputComplete=false且无发送尝试时调用discardUnattempted；并非仅在frozenResult为空时调用。
- [recovery.ts:135](../../../../src/recovery.ts:135)清候选／未尝试输出和post，将turn.at改成clock.now()后重生成。当前合同会用于新个人结果，原始旧candidate不直接交给新parse。
- [reply-freshness.ts:11](../../../../src/host/reply-freshness.ts:11)把任意非pending outbox或firstAttemptAt都视为尝试；只有retry、没有confirmed也必须保留候选。outputComplete=true的零输出沉默轮同样不重生成。
- [现有恢复测试](../../../../tests/recovery.test.ts:24)明确验证未尝试冻结轮在恢复时刻重生成，与原方案的宽泛表述冲突。

影响：若照原方案把所有frozenResult都当旧结果豁免，可能继续发送未尝试旧稿、直接应用旧check任务；若按“保留旧轮时间”构造恢复测试，会漏掉恢复时查看资格和个人角色变化。应改计划及断言，不能把现行恢复代码改成原稿描述的行为。

V2以尝试证据、outputComplete和replyFreshness状态组成矩阵，分别规定新合同重生成、冻结续发和后处理；T3新增全pending、首项retry、沉默封口和推进时钟的分支。

## 需要补强的验收细节

1. **恢复中个人角色可以改变。** 合成混合学校轮先因personal_life非法检查耗尽修补；10分钟后重新叙事为可读，实际调用personal_chat。同一个非reply personal stage仍复用runId、repairCount=2及原repair.original。依据[phases.ts:9](../../../../src/web/phases.ts:9)、[store.ts:20](../../../../src/web/store.ts:20)、[client.ts:31](../../../../src/model/client.ts:31)。V2增加文件库重开及角色切换回归，不允许为方便测试重置预算。
2. **学校fixture要在发布后实际观察。** 通知releasedAt由调度释放时刻决定，观察经历不能更早。依据[progress.ts:23](../../../../src/school/progress.ts:23)。本轮探针初稿即因时间夹具不满足该边界未到达个人失败，修正合成观察时间并加失败阶段断言后通过；不是产品修复。
3. **确认与未知发送分开。** 旧结果兼容既要证明confirmed不重发，也要证明仅retry即禁止重生成；不把单次假sender的成功次数扩大为QQ绝对一次保证。V2保留旧投影行为，不新增迁移。

## 已执行的核对

| 验证 | 结果／含义 |
| --- | --- |
| 既有5文件：recovery、tasks、review-fixes、web-recovery、personal-stage-preparation | 39项通过；包括旧权限仍开放及现有调度／恢复行为，不是新合同验收 |
| 既有reply-freshness-recovery | 11项通过；真实临时文件重开覆盖pending候选、首次未知发送、已确认尾段和沉默后处理 |
| [合成恢复探针](evidence/recovery-time-probe.ts)及[结果](evidence/recovery-time-probe.json) | 内存库协议2，混合输入／学校通知，真实ModelClient、假Transport／sender、关闭web；失败时10:00:15，恢复并提交时10:10:15（合成2026-10-07上海时间），life→chat，原runId和repairCount=2保留，无故事发送 |

测试使用工作区TEMP／TMP，6文件50项无失败、无跳过；结果摘要及文档验证见[evidence/verification.json](evidence/verification.json)。探针并未验证磁盘重开、Host.resume或待实现的新Schema；相应V2回归仍未实施。没有运行全量测试、构建、部署、服务启停或在线模型／搜索，没有读取正式库、私有配置或聊天正文，也未重新核实原故障日志。

复跑探针：`node --import tsx docs/v0.5/reviews/personal-task-contract-20261011/evidence/recovery-time-probe.ts <新的报告路径>`。它只使用合成内存库；报告路径须显式提供。历史来源README／DESIGN保持原文，入口指向V2，不改现行子系统说明冒充实现。
