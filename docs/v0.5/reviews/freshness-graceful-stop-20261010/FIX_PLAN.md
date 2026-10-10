# R1：安全停止失败传播修复执行方案

> **For agentic workers:** 按任务使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 实施。复选框为待办；本次交接给 SOL，审核会话没有实施产品修复。

**Goal：**浏览器运行实例关闭失败时，停止调用者收到失败，控制端返回 HTTP 500／`stopped:false`，不打印停止成功、不调用成功退出。

**Architecture：**沿用现有立即 graceful drain、串行生命周期队列及共享关闭 Promise。立即记录 drain 的失败，最终向停止入口传播；队列仍可负责状态与日志，不把队列吞错后的完成当成成功。

**Tech Stack：**现有 TypeScript、Node.js、本机 HTTP、Vitest；无需新依赖、数据库升级或协议变更。

**Spec：**[本次 R1 审核与复现](REVIEW.md)及[原安全停止合同](../../records/graceful-stop-20261010/README.md)。基线 `086cd07`；状态：**未实施**。

## 全局约束

- 保留「双击 stop-hdsi.cmd 后不接收新输入、不启动新任务」以及当前整轮／在途阶段保存规则。
- 保留「未启动后续链、静默等待和未来预约留待重启」。不改变普通回复 T1～T5。
- 保留「重复有效请求共享一个 shutdown Promise」；失败后重复请求继续报告该次失败，不新增自动重新关闭策略。
- 保留插件卸载／服务撤回的原取消语义；失败不得改成成功、强杀或人为增加等待超时。
- 不修改模型、搜索或正式配置，不读取真实停止凭据，不运行正式 `stop-hdsi.cmd`。工程测试使用独立临时目录；部署按项目 README 的停服、备份、构建流程另行进行。

## 重点回归

1. 页关闭抛错且页仍存活：真实槽位 dispose 的拒绝必须穿过浏览器装配抵达控制端。
2. 生命周期队列正在等待启动、graceful close 先拒绝：必须立即处理拒绝，不能产生 unhandled rejection。
3. 连续／并发停止请求遇到同一次失败：共享关闭工作，每次返回失败，不调用成功退出。
4. 正常 graceful close 尚未完成：停止请求持续等待；完成后才成功，首个关闭选项仍为 `{graceful:true}`。
5. 请求客户端断开：保留已修复的成功 drain 仍退出行为；失败 drain 不得因断连而转为成功退出。

## 单一任务：修复浏览器装配层的停止错误传播

**文件：**

- 修改 `src/deployment/browser-runtime.ts`：当前第 32 行的停止回调；只在需要复用错误记录时提取同文件局部函数。
- 新增 `tests/browser-graceful-stop-failure.test.ts`：R1 组合回归与排队拒绝场景。可复用 [审核探针](probe-browser-stop.ts) 的离线夹具思路。
- 复用 `tests/graceful-stop-control.test.ts`、`tests/graceful-stop-process.test.ts`、`tests/browser-web-plugin.test.ts` 及 `tests/browser-web-plugin-extra.test.ts` 的现有回归。
- 交付记录放在 `docs/v0.5/records/graceful-stop-r1-20261010/`，更新版本／审核索引指向关闭证据；保留本次 RED 原样。

**接口：**消费 `PluginRuntime.close(options?: {graceful?: boolean}): Promise<void>`、`installStopControl(ctx, shutdown)`、`startStopControl(file, onStop, {exit, log})`。不增加或改动公开接口。实现后 `shutdown` 在关闭失败时拒绝，在所有实际关闭工作成功时才成功完成。

- [ ] **1. 新增实际失败回归。**用 managed provider、假页面和真实 `installBrowserRuntime()` 建立运行实例；`page.close()` 抛出 `Error('synthetic page close failure')`，`isClosed()` 为 false、浏览器仍 connected。通过捕获的安装回调接到独立 `startStopControl()`，以 exit spy 替代进程退出。先断言错误确实来自页面关闭，再断言 HTTP **500**、body 的 `stopped` 为 **false**、exit 次数 **0**、没有「HDSI停止完成」日志、浏览器 `state='failed'`。关闭位置标记仍为 false；不要将标记称为真实库验证。

- [ ] **2. 运行并保留 RED。**运行新文件和审核探针；旧代码应因实际 HTTP **200** 不符合 **500** 而失败，不能以导入、定时器、权限或浏览器启动错误代替缺陷复现。日志分别保存，不覆盖 `logs/browser-stop-red.txt`。

- [ ] **3. 增加拒绝时机与重复请求用例。**用 gate 阻塞 `host.start()`，确认已取得 current runtime 后请求停止，让共享 close Promise 在 gate 释放前拒绝；跨过一轮事件循环后再释放 gate，断言没有未处理拒绝、最终仍报告失败。失败期间两次请求使用同一次实际关闭工作，两次响应均为 500，exit 仍为 0。不要用每调用一次就执行一次收尾的假 close：夹具必须像真实 runtime 一样缓存 Promise。

- [ ] **4. 修改停止回调。**继续在排队前立即调用 `current.runtime.close({graceful:true})`，并在创建 Promise 的同一步附加 rejection handler。可将错误记入现有 `fatal`，让 handler 本身正常完成；队列等待该已被观察的 drain 后，检查并报告 fatal，最终停止回调再抛出同一错误。成功路径继续走现有 `closeCurrent()` 完成引用清理。失败路径保留 `current` 和 failed 状态，不越过失败宣布资源已关。不要直接 `.catch(() => {})` 而丢失错误，也不要在晚到的队列任务才开始监听 drain 拒绝。

  推荐保留现有 `enqueue()` 的服务更新日志语义，局部修复停止回调即可。若选择让 `enqueue()` 返回可拒绝的任务结果，需要同时证明所有现有服务注入／撤回调用者正确观察拒绝，不能把本次局部修复扩大成未验证的队列重构。

- [ ] **5. 验证成功与断连边界。**正常 close 用 gate 暂停时，响应与 exit 都不能提前发生；释放后 HTTP 200、`stopped:true`、实际收尾一次、exit 一次，首次 close 选项为 `{graceful:true}`。失败请求客户端提前断开时不退出；保留现有控制器与真实子进程的成功断连测试，防止重新引入旧 I1。

- [ ] **6. 跑定向 GREEN。**以下命令全部退出 0。排队拒绝用例还必须没有 Vitest unhandled error；审核探针应变成失败场景 500／false／exit 0，对照仍为 200／true／exit 1。

```powershell
node node_modules/vitest/vitest.mjs run tests/browser-graceful-stop-failure.test.ts tests/browser-web-plugin.test.ts tests/browser-web-plugin-extra.test.ts tests/graceful-stop-control.test.ts tests/graceful-stop-process.test.ts tests/graceful-stop-host.test.ts tests/incoming-media-assets.test.ts
node --import tsx docs/v0.5/reviews/freshness-graceful-stop-20261010/probe-browser-stop.ts
node node_modules/typescript/bin/tsc --noEmit
```

- [ ] **7. 完成整批验证与提交。**在隔离执行环境完成全量测试、构建、demo 和项目现有双场景插件 smoke；记录确切文件／用例数、退出码与实际范围。构建及 smoke 按项目原脚本执行，正式部署单列，不借测试操作正式服务。提交只包含 R1 的产品代码、回归及交付资料，建议信息 `fix: propagate browser graceful stop failures`。

- [ ] **8. 关闭记录。**记录修复提交、旧代码 RED／新代码 GREEN、排队拒绝及重复请求结果，并由独立复核检查本次差异。更新索引为「R1 已修」时链接实际关闭证据；原报告仍保留 `086cd07` 的观察，不将原始失败输出改写成成功。未实际执行的在线、断电与长期运行验证继续注明。

## 完成判定

R1 的 HTTP 组合回归与审核探针通过，失败不退出，成功仍等待全部既定关闭工作；原 I1、浏览器服务替换、前台整轮、后台阶段及取图停止回归均保持通过。修复仅改变失败传播，不额外承诺资源关闭失败后自动恢复或重新接收业务。
