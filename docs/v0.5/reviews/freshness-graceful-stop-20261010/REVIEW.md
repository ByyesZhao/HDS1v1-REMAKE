# 普通回复新鲜度与安全停止：交付后复核

日期：2026-10-10。源码基线：`086cd07372a85540799a98f2c6dcf68013fe26f0`。状态：**审核完成；安全停止 R1 待修复**。

## 结论

| 工作 | 本次结论 |
| --- | --- |
| 普通回复跟进新消息 T1～T5 | 未发现需要修复的新问题，可以接受本批工程实现。15 秒重选、首次发送边界、等待续办、事件接管、业务代际与图片冻结符合细化合同。 |
| 安全停止 | 主体流程合理，原 I1「请求客户端断开后不退出」已修复。另确认 **1 项 P2：浏览器运行实例关闭失败被吞掉，控制端仍报告成功并退出**。建议补修 R1 后关闭此批次。 |

无需重做两套方案。R1 的修复步骤、测试断言和交付要求见[修复执行方案](FIX_PLAN.md)，可直接交给 SOL。此次只新增审核材料与导航，未修改产品源码、测试集、构建产物或正式配置／数据库，未操作正式 HDSI 服务。

## R1 · P2 · 浏览器关闭失败仍被报告为停止成功

**位置：**[browser-runtime.ts](../../../../src/deployment/browser-runtime.ts) 第 32 行，`installStopControl()` 注册的停止回调；同文件第 12 行为吞错的 `enqueue()`。

**触发条件：**使用 browser 搜索装配，当前 `PluginRuntime.close({graceful:true})` 拒绝。例如一次页面操作的 `page.close()` 抛错，而且页面仍未关闭、浏览器仍连接。现有 [BrowserPageSlots](../../../../src/web/browser/slots.ts) 会保留这个资源关闭失败，后续 `dispose()` 拒绝；这是一条实际实现允许发生的错误路径。

**错误链：**

1. 停止回调先取得 `draining = current.runtime.close({graceful:true})`。
2. 队列任务执行 `await draining` 时抛错，跳过后面的 `closeCurrent()`。
3. `enqueue()` 的 catch 仅记录 `state='failed'` 和日志，返回的 Promise 却已成功完成。设置 `fatal` 的逻辑在被跳过的 `closeCurrent()` 中，此时 `fatal` 仍为空。
4. 停止回调因此成功返回。[stop-control.ts](../../../../src/deployment/stop-control.ts) 第 17～22 行返回 HTTP 200／`{stopped:true}`，安排成功日志及 `process.exit(0)`。

**影响：**用户得到「当前工作已保存，HDSI 停止完成」的成功提示，但资源收尾实际失败。[plugin-runtime.ts](../../../../src/deployment/plugin-runtime.ts) 第 134 行在 `managedBrowser.dispose()` 后才调用 `storage.close()`；该路径没有走到数据库正常关闭。不能据此断言此前已提交的 SQLite 数据必然丢失，但这确实违反了现有「失败报告错误、不强制终止」合同，可能留下未关闭的浏览器资源。

**独立复现：**[probe-browser-stop.ts](probe-browser-stop.ts) 使用真实 browser runtime 装配、managed provider、页面槽、Koishi 页面适配和 HTTP 停止控制器；只替换页面与故事运行实例，用标记模拟实际 runtime 的资源关闭顺序，并将进程退出替换成计数器。控制文件位于 `.tmp/freshness-stop-review/`，没有真实模型、QQ、外网页面或正式库。

| 场景 | HTTP / stopped | 退出回调次数 | 是否到达 storage.close 位置 | 浏览器状态 |
| --- | --- | --- | --- | --- |
| 页面正常关闭的对照 | 200 / true | 1 | 是 | stopping |
| 页面关闭抛错且仍存活 | **200 / true** | **1** | **否** | failed |
| 失败场景的预期 | **500 / false** | **0** | 维持现有失败路径 | failed |

运行命令（项目根目录）：

```powershell
node --import tsx docs/v0.5/reviews/freshness-graceful-stop-20261010/probe-browser-stop.ts
```

本次退出码 **1**，失败断言为 `200 !== 500`；完整输出保存在 [browser-stop-red.txt](logs/browser-stop-red.txt)。这是新增缺陷探针的预期 RED，不是既有测试或环境失败。`storageCloseReached` 是模拟关闭位置标记，不是对正式数据库的观测。

**修复方向：**保留立即启动 graceful drain 的行为，但让其拒绝进入停止调用者可见的失败状态。不能依赖只负责记日志的队列 Promise 判断成功。还应在创建 drain Promise 时立即接住拒绝，避免生命周期队列正忙时出现未处理拒绝。无需改变页面关闭失败的既有判定、增加强杀或重写停止协议。

## 已核对的主要合同

| 范围 | 核对结果与证据接点 |
| --- | --- |
| 输入与完整静默窗口 | 普通输入落库原子递增版本；重复、控制及共同活动输入不误计；开放批未满 15 秒时不提前选旧未读。见 [input.ts](../../../../src/host/input.ts)、[scheduler.ts](../../../../src/host/scheduler.ts)。 |
| 首次发送与恢复 | 冻结前及首次 sending 事务内检查最新输入；已经存在发送尝试的轮保持冻结与尾段恢复，未知发送结果未承诺绝对去重。见 [recovery.ts](../../../../src/recovery.ts)。 |
| 等待、预约、睡眠、查看资格 | 等待轮通过专用续办重新选取普通消息或合法到期事件；权限不满足时保留未读；恢复不绕过静默窗口。见 [app.ts](../../../../src/app.ts)、[scheduler.ts](../../../../src/host/scheduler.ts)。 |
| 业务代际与图片 | 新代际隔离业务模型／网页阶段，最终来源按实际个人导演 run 选择；图片终态与已冻结附件身份继续保留。见 [web/phases.ts](../../../../src/web/phases.ts)、[memory/organize.ts](../../../../src/memory/organize.ts)及新鲜度 context／recovery 回归。 |
| 停止派发与后台保存 | host 在异步选取后重查停止状态；前台等待当前 runTurn，环境／记忆只完成当前准备阶段并保存，取图等待在途任务。静默、预约及未开始的后续阶段留待重启。 |
| 停止请求断连 | 成功 drain 后的退出不再依赖请求窗口连接；`graceful-stop-control` 和真实子进程 `graceful-stop-process` 的断连回归通过。原 I1 不重复开单。 |

## 本次验证及限制

- 当前主目录完整运行既有 **187 个测试文件、1004 项测试**：首次 **185 文件／985 项通过**，2 项创建目录连接受沙箱 EPERM 阻止，Chrome 启动失败使 17 项未运行。原始失败完整保留于 [full-tests.txt](logs/full-tests.txt) 与 [JSON](evidence/full-tests.json)。
- 核实上述两组只使用隔离库与本地页面后，在沙箱外限定复跑这两个文件，**2 文件／19 项全部通过**，退出 0，5.36 秒；见 [environment-rerun.txt](logs/environment-rerun.txt) 与 [JSON](evidence/environment-rerun.json)。**合并两次结果，现有 1004 项均有通过记录；没有把第一次全量退出 1 改写为退出 0。**
- 本次 `tsc --noEmit` 退出 **0**；[日志](logs/typecheck.txt)为空属于正常静默成功，执行元数据见[验证摘要](evidence/verification-summary.json)。未重新 build／demo／双场景插件 smoke；这些项目的先前通过结果仍以 SOL 各批交付为准。
- 两份独立代码复核分别检查新鲜度及停止流程；前者另跑五文件 36 项、后者另跑六文件 20 项。主审复跑上述完整测试并补充 R1 的 HTTP 组合探针，不仅依据交付报告作结论。
- 既有测试通过并不能排除 R1：当前控制器测试仅覆盖「直接传入会拒绝的 onStop」，浏览器装配测试只覆盖成功 drain，没有覆盖中间装配层吞错后的组合结果。
- 未执行真实模型语义、真实 QQ 连聊／未知发送、断电或长期运行验收；本次不把这些边界作为已解决事项，也不推断当前正式服务是否运行。

关联：[普通回复交付](../../records/chat-reply-freshness-20261010/DELIVERY.md) · [安全停止交付](../../records/graceful-stop-20261010/DELIVERY.md) · [V0.5 索引](../../README.md)。原报告、原关闭记录及原始日志保留其各自基线含义。
