# SDD ledger — plan: docs/SHARED_ACTIVITY_V0.3_EXECUTION_PLAN_20261007.md

日期：2026-10-07。实施依据：共同活动实施细化及执行计划，已合入第九轮接受项。开始提交：eaf0b53。隔离目录由Codex原生工具创建，服务、在线验证和正式库升级不在本次执行范围。

## 预检与裁定

- Task 1→2/3：活动身份、clock、唯一scene任务与控制表供路由／选择共同使用；字段按细化固定。
- Task 3→4/5：sharedMeta固定轮号、权限和消费集合；ordinary原文不能混入shared队列，恢复不得改选择。
- Task 4→5：共同合同新增previousOutline，个人仅接sharedMeta；生成和恢复均透传。
- Task 5→6/7：确认边界和段B是唯一正式提交；旧活动不猜测升级，离线与真实语义验收分开。
- Ruling: 使用原生隔离工作目录执行，再将验证后的提交整合回用户项目；文档和日志随代码提交保留。— 原目录含用户未提交的审核文件，不触碰它。— 若整合发现新冲突，保留当前内容后处理。
- Ruling: 技能附带的sdd脚本是POSIX脚本；Windows直接用本日志、任务小节和测试输出文件维护等价记录，不为账本安装新Shell。— 项目既有日志可持久追踪。— 必须逐任务记下RED/GREEN和提交范围。

## 任务状态

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1 状态与时钟 | 完成 | 4/4目标测试，204/204全套，typecheck通过 |
| 2 输入控制 | 完成 | 8/8目标测试，209/209全套，typecheck通过 |
| 3 调度 | 完成 | 新7项及维护／调度测试通过，216/216全套 |
| 4 合同 | 完成 | 13/13目标测试，221/221全套，typecheck通过 |
| 5 流水线与恢复 | 完成 | 42/42目标测试，244/244全套，typecheck通过 |
| 6 升级 | 完成 | 9/9目标测试，248/248全套，CLI临时库check/apply通过 |
| 7 回归与交付 | 完成 | 任务结束248测试全绿；最终复核修正后250测试全绿、typecheck/build/smoke通过；demo/runtime check已通过；真实语义待办 |

## 后续真实多轮验收

必做但尚未执行：目标／结束条件语义漂移、稳定设定、静默代写及自然收尾、动作主体与用户返回纠正。离线通过不等于真实语义通过。

## 任务1证据

基线：`npm test` 42文件／200测试通过，`npm run typecheck`通过。
RED：`npm test -- tests/shared-v3-state.test.ts` 四项失败（缺配置及新时钟模块）。
GREEN：同命令4/4通过；全套43文件／204测试通过；typecheck退出0。测试导入调整为NodeNext动态导入要求的`.js`后缀。
Task 1: complete（从eaf0b53开始，提交`feat: add shared activity state and clocks`）。字段／表、配置快照、唯一节点和持久锚点基础已落实；流水线边界在任务5接入。

## 任务2证据

RED：`npm test -- tests/shared-v3-input.test.ts tests/input.test.ts tests/plugin.test.ts` 新5项失败、旧3项通过。
GREEN：同命令8/8通过；全套44文件／209测试通过；typecheck退出0。维护测试的Promise<void>回调适配新返回类型，不改变断言。
Task 2: complete（从d0fd98b开始，提交`feat: route shared inputs and advance controls`）。实际QQ入口使用固定systemReply，控制不成为角色消息；确认发送集成留任务5。

## 任务3证据

RED：`npm test -- tests/shared-v3-scheduler.test.ts tests/scheduler.test.ts tests/memory-v3-host.test.ts tests/review7-maintenance.test.ts` 新7项失败、旧14项通过。
GREEN：调度／维护目标21项及全套45文件／216测试通过；typecheck通过。
Ruling: 旧“环境先于输入”和“预约合并自主”断言被已确认规则替代；恢复旧轮、维护让步断言保留。原自主截止检查改为纯选择检查，统一重排行为由任务5集中测试。— 防止把旧策略当回归目标。— 若覆盖遗漏，任务5及整体验收需补。
Ruling: task3选轮需要合法clock，而真实发送集成属task5；旧start集成测试暂在选轮前显式建立已确认clock夹具，task5移除该夹具并用真实send回调验证。— 不提前分散实现发送接口。— 此时不能声称确认边界已真实集成。
Task 3: complete（从6e108c5开始，提交`feat: schedule shared turns with foreground priority`）。环境截止保留；共享／合批抑制自主，合法活动豁免旧睡眠计划；维护单元让步复用旧测试。

## 任务4证据

RED：`npm test -- tests/shared-v3-contracts.test.ts tests/model-call-context.test.ts tests/shared-scene.test.ts` 新5项失败、旧8项通过。
GREEN：同组13/13通过；全套46文件／221测试通过；typecheck退出0。共同夹具补合法身份／meta和新outline／simulatedUserActions；旧“个人可创建scene_step”断言改为允许预约，独占节点由新合同测试覆盖。
Task 4: complete（从1fb3a8f开始，提交`feat: constrain shared narration and final closure`）。严格拒绝模型nextStepAt，wrap_up原字符串集合包含和final空线索／公开结束约束已落实；共享meta固定在轮记录并透传两个模型。提示词词项测试只确认任务指令存在，不声称文学／语义验收通过。

## 任务5证据

RED：`npm test -- tests/shared-v3-recovery.test.ts tests/shared-v3-flow.test.ts tests/turn.test.ts tests/recovery.test.ts tests/shared-scene.test.ts tests/tasks.test.ts` 新21项失败、旧20项通过；非法final暂停项已有任务4合同，原先即通过。
GREEN：补普通睡眠控制门禁后同组42/42通过；全套48文件／244测试通过；typecheck退出0。临时文件恢复覆盖partial/post/committed，不重发确认项、不重复计数和消费；普通／共同未尝试稿均留存一次180分钟抽样。
开始／结束时真实send回调建立／关闭clock；移除任务3临时start选轮clock填充，仅直接活动夹具保留。末表情确认22:31:30→截止22:32:30，post到22:31:45不挪可见截止；后续输入仍可延后。静默20轮假故事，17收束、20公开结束，无21；不是文学验收。
Ruling: 普通待看查询按“活动关联且batchId=null”排除，共同结束后保留出处但按普通批次交付。— 细化§4.2明确不能因旧关联永久排除。— 若改错将漏交付活动末尾输入，已用真实结束／晚到输入测试覆盖。
Ruling: 既有表情概率夹具新增一个前台间隔抽样并预设作息；概率公式、三次文字机会和跨轮计数断言不变。旧无限期不可读检查的null截止改为成功narrative后180分钟自主截止。— 本次统一前台周期明确替代旧行为。— 随机抽样顺序变动时须保持业务机会测试明确。
一条新记忆测试曾误写成不应存在模拟摘要；MemoryLifecycle确实合并eventSummary，纠正为肯定断言，并保留合法outgoing来源及outline意图区检查。
Task 5: complete（从2a4127e开始，提交`feat: commit and recover bounded shared activities`）。正式服务未启动，正式库未写入；所有Sender／模型为离线替身。

## 任务6证据

RED：目标新4项失败，入口明确因旧实现不拒绝启动；先修复Vitest对Koishi loader的变换不兼容，用native CJS加载实际Koishi，再修复失败清理，避免把工具错误当业务RED。
GREEN：`npm test -- tests/shared-v3-upgrade.test.ts tests/deployment.test.ts tests/plugin.test.ts` 9/9通过；全套49文件／248测试通过；typecheck退出0。
CLI：隔离目录`data/shared-cli-fixture.sqlite`（完全虚构普通库）运行`shared:migrate --check`报告null/canInitialize=true；运行`--apply --stopped --backup-dir data/shared-cli-backups`报告version1及唯一备份目录。备份可只读打开且仍为旧版本；测试验证普通消息／预约／未完成轮保留、重复apply字节不变。旧共同库明确列出old、old-scene及3个提交轮，拒绝猜测并保持字节和schema不变。
Task 6: complete（从f850e0a开始，提交`feat: inspect and migrate shared activity state`）。入口先只读查版本，才打开Storage；旧库不因加载新代码自动填版本。本次没有check/apply正式库。

## 任务7证据（2026-10-08）

最终顺序检查：`npm test` 49文件／248测试通过；`npm run typecheck`、`npm run build`均退出0；`npm run demo`离线普通对话及共同首节点／手动／60秒末轮完整结束（仅演示maxSteps=3，正式默认20）；`npm run check --prefix runtime`模块加载通过；`npm run smoke --prefix runtime`真实Koishi Context装配、环境初始化、命令及共享版本／控制表通过。所有模型／HTTP／QQ均为固定替身，临时库与正式库隔离。

样例和受影响根文档已同步当前代码；原V0.2历史测试记录明确保留日期，不能据其旧断言解释新行为。runtime/check先只读查版本再打开Storage，旧正式库不会因check自动建共享表。共同细化／执行计划更新离线完成状态，真实多轮验收未勾成已通过。

Review Focus映射：

| 项 | 实际离线断言 |
| --- | --- |
| 1 公开边界 | shared-v3-flow的begin_publish_before_post、end_publish_and_late_input；shared-v3-recovery的begin_publish_before_post（未确认开始）；开始／结束真实send回调阻塞post后接收新输入。 |
| 2 忙时合并 | shared-v3-flow的late_inputs_survive_frozen_commit、deadline_uses_last_send_confirmation；shared-v3-scheduler的manual_and_due_share_one_selection；冻结集合与晚到集合分开，确认锚点独立于post。 |
| 3 旧作息 | shared-v3-flow中旧sleep/wake区间内、过期、新推迟作息三类；调度无伪wake，结束睡眠清自主或完成时重排。 |
| 4 20轮／公开记忆 | shared-v3-flow的silent_20_steps_natural_close（成功收尾／非法final暂停两例）、life_and_shared_memory及合同测试；文学、goal/endingCondition语义与稳定设定仍需后述真实模型验收。 |
| 5 持久恢复／升级 | shared-v3-recovery的partial/post/committed文件重开、未尝试稿间隔复用；shared-v3-state静默锚点；shared-v3-scheduler被抑制定时资格；shared-v3-upgrade只读、拒绝旧活动、停止备份普通库及启动门禁。 |

提交索引：任务1 d0fd98b；任务2 6e108c5；任务3 1fb3a8f；任务4 2a4127e；任务5 f850e0a；任务6 73d3c48；任务7使用提交主题`docs: record shared activity delivery and validation`（本段随该提交保存）。

Task 7: complete（从73d3c48开始）。最终diff检查无私有配置、key、角色背景、正式数据库或构建产物；独立最终代码复核结论随后记录。正式库尚未check/apply，正式服务未启动，真实故事尚未联调。

## 最终独立复核及唯一修正批次

Final review: 独立代码审核代理静态只读审查eaf0b53..b00f3c7，五项Review Focus已检查；原结论Critical/Important无，Minor一项，Ready to merge=Yes。完整结论及处理见[最终复核记录](SHARED_ACTIVITY_V0.3_FINAL_REVIEW_20261008.md)。

Final: Ruling: 审查原Minor“已升级库正常准备／环境轮误报旧活动”重评Important — 重复apply被正常未完成状态阻断，违反计划幂等升级；进入唯一修正批次，而非顺带润色。— 若低估会误导用户以为需人工接续，正常升级检查／重复操作失败；修正以两项业务RED→GREEN验证。

Final: fixed 已升级库正常未完成轮误判旧活动 — version_one_unfinished_preparation_is_not_legacy / version_one_unfinished_environment_is_not_legacy RED→GREEN，目标6/6，suite 250/250（49文件）。命令npm test -- tests/shared-v3-upgrade.test.ts、npm test、npm run typecheck、npm run build、npm run smoke --prefix runtime均通过。夹具重复close已在业务RED之前排除；没有第二次审核。

Final: Ruling: 真实模型语义质量不由静态审查判定 — 按计划登记必做真实多轮验收，本次不启动在线模型或服务。— 若后续跳过会遗漏目标漂移、稳定设定放大或不自然收尾。
Final: Ruling: 正式库升级兼容性不由临时库结果冒充 — 正式启动前实际check、停止备份/apply，旧活动另决策，本次未碰正式库。— 若跳过，版本门禁阻止启动，旧活动接续也不能自动保证。
Final: Ruling: QQ送达但未本地确认的跨系统去重沿用基线 — 已确认跳过、未知可重发，没有扩展平台幂等协议。— 确认丢失时恢复可能重复消息。
Final: Ruling: 本地整合回原项目，不再展示技能的分支菜单 — 用户已授权在该项目实施，隔离是本次执行选择；将验证提交快进到原main满足交付，不上传远端。— 若原目录发生并行改动，快进失败即保留后处理；不覆盖用户审核文件。

Final: minor (deferred): 无。

## 本地整合与收尾（2026-10-08）

原目录main保持起点eaf0b53且只有用户未提交的DSH_REVIEW9文件；将dbe857f快进整合回D:\HDSI-remake，未上传远端。原审核文件原样保留。原目录复验npm test：49文件／250测试通过；npm run typecheck、npm run build均退出0，lib已更新供后续手动运行。没有执行原目录runtime check、正式库check/apply、服务启动或任何在线调用。

逐任务代码、最终复核和全部裁定已保存在本地Git及本文；隔离工作树通过Codex原生archive保存可恢复快照后回收，临时假库、模拟数据及测试运行文件不作为正式运行数据搬入原目录。最终复核修正提交dbe857f；本段以文档收尾提交保存。

## 第十轮后续完成状态（2026-10-08）

上述尚未正式check/apply、未在线验收为本日志原交付时点的历史状态。后续已完成公开正文约束与小维护项、正式库共享版本1备份升级及幂等核对、隔离20节点故事（含请求超时恢复）、6节点动作/纠正/结束及3节点新版收束；程序用冻结权限选择静默双方动作或有输入禁新增用户动作的互斥提示。最终51文件265项、类型/构建及Koishi离线检查通过，正式服务仍停。过程、版本、失败与质量限制见[第十轮记录](REVIEW10_FIX_LOG_20261008.md)，不把有限补验当未来语义保证。
