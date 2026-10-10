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
