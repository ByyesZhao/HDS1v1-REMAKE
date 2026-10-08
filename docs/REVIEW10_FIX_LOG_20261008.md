# 第十轮修正、部署与真实验收记录

日期2026-10-08；起点3df5cbf。用户已接受回应并授权按§6顺序实施。执行依据见[修正计划](REVIEW10_FIX_PLAN_20261008.md)。

Ruling: 继续原生隔离工作树开发、验证后本地快进；已授权顺序执行，不再开设计确认 — 保留原目录用户审核文件 — 若原目录并行变化则停止快进，不覆盖。
Ruling: Windows用本文代POSIX账本工具，逐任务保存真实RED/GREEN和提交 — 无需安装额外Shell — 缺记录时不能声称完成。

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1 正文约束 | 完成 | 835725d；259测试、typecheck通过 |
| 2 文档口径 | 完成 | 同步细化／执行计划／接口／README |
| 3 小维护项及复核 | 待执行 | |
| 4 正式升级／真实隔离验收 | 待执行 | |

## 任务1过程

基线npm test：49文件／250项通过。新增review10-public.test.ts先跑：6失败／3通过，失败为首节点20/3空正文、提前end空正文、应修补却直接结束、应暂停却直接完成。max1的final非空及中间静默原先即受支持，保留作为边界。
最小修正：narrative以stepNumber=1要求公开开场；personalTask/runPersonal末尾增加publicNarration上下文；shared end要求当前正文非空，错误明确个人不能改主叙事、可延后end。app透传同一份旁白。目标36/36通过，typecheck通过。
首次全量258通过／1失败：web-phases旧首节点夹具仍给null旁白；仅改为合规开场，搜索阶段身份／来源断言全部保留。
Ruling: 首／末约束替代旧“只有标志即可结束”夹具；同步20轮样例开场及跨睡眠提前end正文 — 用户已接受公开正文要求 — 若漏同步夹具，会把旧策略误当回归，但不得删除恢复／搜索断言。

任务1最终：50文件／259项通过，typecheck退出0。提交主题fix: require public shared opening and closure。任务2同步口径，任务3再做小维护项。

## 任务2过程

同步text拼接全文、活动外wake、普通开始门禁与转交、准备轮锚点范围、冻结权限和status投影口径；个人合同追加publicNarration，首节点/提前end约束以现实现为准。历史审核不改；正式部署与在线验收尚未执行，不提前写成通过。

## 任务3过程

新增两项业务测试先失败：wrap空白差异拒绝；不匹配clock仍返回旧活动截止。实现仅trim/连续空白折叠匹配，返回旧原文，不做语义匹配、不恢复已删项；nextDeadline加入活动身份条件。第一次GREEN检查发现测试误写了“没有任何截止”，而夹具有合法未来world截止；更正为保留该环境截止，未改环境逻辑。提示词用明确shared参数组装，不再按字面replace；场景资格与投影仅补说明。

全量50文件/261项通过；typecheck、build、demo、runtime check/smoke退出0。新增validate-shared-story.ts为显式在线验收工具，独立随机目录数据库、记录Sender、虚拟时钟，从已确认活动种子开始，不验证真实开始确认/QQ/墙钟调度；只保存输出与场景种子，报告在ignored runtime/data内，不提交密钥或背景。类型检查通过。

## 任务4过程（待真实验收）

正式库只读check：version=null、mode=null、无旧活动/未完成共同轮，canInitialize=true、requiresUserDecision=false。尚未apply。

首次在线启动被自动审批拒绝，未执行模型调用：现有授权未明确涵盖向DeepSeek发送角色背景等上下文。已询问具体数据范围，继续独立本地复核/部署；不绕过拒绝。
