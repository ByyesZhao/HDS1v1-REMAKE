# R1／R2 修复差异最终复核

日期：2026-10-09。审查范围：`a9352093f08824c930ea50682b48b8722e25b6a5..a72e578efbd1b9ff44eb278ab21d766a090e4922`。依据：本目录原始 `REVIEW.md` 的两项修复、全局约束与关闭条件。仅审查及独立离线定向验证；未改产品、分支或原审核证据。

**结论：修复差异可接受，R1／R2 技术问题均可关闭。Critical、Important、Minor 均无新发现。** 最终交付关闭仍由执行者确认全量、公开离线验收与导航更新；正式库部署不属于本复核结果。

## 逐项判断

| 项目 | 判断及实际用户后果 |
| --- | --- |
| R1 | 已修复。`src/host/runtime.ts:73` 在 `collectReady` 的 await 后重读 runtime，并检查 stopped、paused、openBatch 和 unfinishedTurn；检查至启动／同步提交之间无 await。pause、合批、stop 不再被已经选中的异步环境步骤越过。使用 break 保留 ready／pending，由现有 wake、resume 或新 Host 恢复，无忙循环、误判 stale、快照清除或额外 world 调用。原问题是窄微任务竞态，本次没有外推其线上触发频率。 |
| R2 | 已修复。`src/deployment/environment-async-upgrade.ts:7,20,34` 的私有 helper 与旧迁移开始判定逐项等价；报告仅把版本 0，或版本缺失且已开始的未终态步骤算为 legacy。版本 1 不再重复计入 legacy，attempt>0 不再遗漏；unstarted 仍可与 async 重叠。修正检查报告的解释，不改变升级写入、备份、幂等、降级门禁或自动升级策略。 |

六组新增门禁测试使用真实公共 Host API 同轮调用，ready 经正常 preparation 生成实际事件；验证阻挡时结果／generation 保留、pending 未冻结、重复 wake 不越门禁，以及解除后原 ID 一次提交、world 不重调。input 恢复验证对应聊天回合完成；stop 恢复使用新 Host。升级测试包含正常协议 2 ready／running、旧版本与显式 0、attempt、终态、混批、只读字节和重复 apply 不写入。旧串行分支与底层 applyReady 合同保持不变。

## 独立验证

命令（直接使用本地 Vitest，无网络下载）：

```powershell
.\node_modules\.bin\vitest.cmd run tests/environment-async-host-gates.test.ts tests/environment-async-host.test.ts tests/environment-async-slots.test.ts tests/environment-async-recovery.test.ts tests/environment-async-boundaries.test.ts tests/environment-async-upgrade.test.ts tests/environment.test.ts
```

结果：退出 0，**7 文件／40 项通过**，10.60 秒。实际日志：[targeted-tests.log](fix-diff-logs/targeted-tests.log)。覆盖 R1 六组、R2 十六项，以及聊天与未返回环境请求共存、三个槽、非合作请求 stop 收尾、持久 ready 恢复及旧环境路径。未重复主任务全量。

核对既有 RED 证据：R1 为 5 失败／1 对照通过，R2 为 6 失败／10 通过；本复核未重放 RED 或改写原日志。首次受限命令未能创建指定日志目录，测试未执行；权限提升后上述同一离线测试正常完成。整段 `git diff --check` 仅报告六个原始测试日志的末尾空行，产品与测试源码无差异空白问题；按证据保留约束不改写日志。

## 未作结论的行为

- 全量、构建与公开离线总体验收：由主任务执行，本报告不以定向结果代替。
- 正式库停服、备份、升级及其运行结果：由主任务按已有用户授权执行；本复核未读取正式库或私有配置。
- 旧串行环境／普通前台分支是否另有同类门禁竞态：本次改动和 R1 合同针对 preparationVersion 1；旧路径原样保留并运行兼容回归，未扩展成全局调度器重设计。

无最小修正建议；完成既定交付验收后即可关闭本轮修复。
