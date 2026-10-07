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
| 4 合同 | 待执行 | |
| 5 流水线与恢复 | 待执行 | |
| 6 升级 | 待执行 | |
| 7 回归与交付 | 待执行 | |

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
