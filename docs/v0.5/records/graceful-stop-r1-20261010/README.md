# SDD ledger — plan: docs/v0.5/reviews/freshness-graceful-stop-20261010/FIX_PLAN.md

Spec: original shutdown contract and ASTRA R1 review. BASE fefbb65. Single task; no shared task interfaces.
Task 1: in progress. Failures must reach HTTP controller; draining observed before lifecycle queue waits; no interface changes.
Workflow adaptation: Windows PowerShell uses this tracked process record in place of Bash workspace helpers; preserves plan identity, RED/GREEN, review and completion evidence.
Engineering fixtures are isolated. Formal stop/deploy occurs separately under user's explicit authorization of this turn.

## R1 修复与验证

2026-10-10，沿用原装配队列，排队前创建 graceful close Promise 的同一步观察拒绝并保存 fatal；队列等待已观察的 drain、随后检查 fatal，停止回调最后向控制端再次抛出。同一失败不自动重试收尾，不释放 current 引用，不强制退出。

- 原代码：新文件五项中四项失败、一项成功边界通过（all-red.txt）；页面关闭实际抛错，但 HTTP 为200而非500；断连后同样出现错误成功退出。首次测试加载错误单列 test-fixture-import.txt，不作为业务RED。独立探针 probe-red.txt 同样因200≠500退出1。
- 修复后：7文件25项通过（focused-green.txt）；页面仍活着时关闭失败、启动队列阻塞时拒绝、并发与后续重复失败、正常门控成功及失败断连均通过。Vitest无unhandled error。关闭工作共享缓存Promise，收尾标记只代表合成夹具位置，不称真实库验证。
- 审核探针退出0：healthy=200/true/exit1；failed=500/false/exit0；失败时页面关闭位置后的标记未执行，browser=failed。原审查日志未覆盖。
- 类型检查、隔离构建、demo和双场景插件smoke退出0。正式服务仍在运行，未以测试操作它。

原回复新鲜度 T1～T5 无改动，无数据库／配置／依赖／公开接口修改；没有真实QQ、真实模型或断电验收。

Task 1: complete — 7 files /25 focused tests; probe and typecheck exit0. Full suite188 files/1009 tests exit0,129.19s; build/demo/double-scenario smoke exit0. Document247 local links missing0; diff-check exit0. Logs are scoped to this worktree and this revision. Final independent review pending; formal deployment pending.

## 独立复核与一次补修

[独立审查](INDEPENDENT_REVIEW.md)审查59db942，Important一项为排队拒绝测试时序屏障过早成立，无产品缺陷及Minor。已等actualCloses===1、drainSettled=true后检查事件循环；旧回调回放 queued-rejection-red.txt 退出1，实际捕获 synthetic page close failure 的 unhandledRejection，另有 PromiseRejectionHandledWarning，证明监听延迟。恢复修复回调后7文件25项及类型检查再次退出0，focused-final.txt无unhandled。首轮all-red只证明HTTP错判，不冒充这个新增时序RED。原独立审查结论保留，关闭由执行者证据证明，无第二次独立复审。

Final: Ruling: 正式部署独立于只读审查执行；QQ／模型、断电和长期运行不借离线测试认定已验收 — 范围符合用户授权及测试隔离 — 若据此作运行质量承诺会夸大证据。
Final: Ruling: 本轮保持基线falsy拒绝值语义，修复真实页面槽的Error传播 — 用户要求局部补修且不做极端防御扩展 — 若非Error拒绝值实际出现，既有truthiness错误判定风险仍需另处理。
Final: fixed reviewer timing barrier — queued-rejection RED→GREEN; final suite pending.

Final: fixed timing barrier — queued-rejection-red exit1 (actual unhandled Error) → focused-final 25/25 exit0; final suite188 files/1009 tests exit0,130.62s. Independent Important closed by executor evidence; no further product changes or re-review. No deferred minors.
