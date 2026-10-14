# 记忆整合对象引用修复与 0.5.3

2026-10-14。前置源码为 `6602cae`（0.5.2）。本文记录本次修复和验证；部署结果由本目录的部署证据单独确认。

## 问题与范围

09:43 启动后的整合已消化 12 个选中对象，另一批 20 个对象在首次执行与两次后台重试中都因 `readOwners: unknown snapshot owner` 失败，10:01:39 全局暂停，另有 1 个待办。失败批次没有应用任何单元。

失败响应的 readOwners 全部引用实际输入的 `resources.owners[].ref`，写入 ids 则使用正确的业务 id。程序原先只接受业务 id，但提示与修复反馈没有明确解释两者。保存的 5 条失败响应仅将这些合法引用映射为同快照业务 id 后均通过原合同。

## 修复

- `model/context-views.ts` 将原 owner ref 计算提为 `ownerReference`，投影和合同复用原来的类型、身份、revision、stateVersion 哈希规则。
- `model/contracts.ts` 只将冻结任务快照内的精确 ref 映射为 readOwners 业务 id，再执行原有写集合、重叠、来源、摘要、合并、晋升及覆盖校验；不查询当前库，也不放宽 ids、targetId、canonicalId 或 sourceIds。
- `model/prompts.ts` 在整合／固定审核中明确 ref 定位正文、输出使用业务 id、历史来源使用 sourceIds。未知对象错误也提供明确修正方法。
- 无数据库迁移、无队列／预算重置；已失败任务在用户恢复后保留 jobId、runId、冻结快照与原格式修补预算。

## 验证与边界

- 全量：228 文件、1554 项通过，0 失败、2 项既有跳过；[全量摘要](evidence/full-test-summary.json)。初次沙箱运行受浏览器与目录联接权限限制，正常本机权限下全量重跑通过。
- 定向：6 文件 74 项通过；[红绿与工程检查](evidence/engineering-checks.json)、[定向摘要](evidence/targeted-summary.json)。类型检查、构建通过。
- [独立产品审查](INDEPENDENT_REVIEW.md)：无 P0–P3 发现。
- [真实 5 条响应源码回放](evidence/saved-response-replay.json)：全部通过。
- [停止后的正式库副本离线恢复](evidence/offline-copy-recovery.json)：保留原 jobId／runId、快照与 repairCount=2，回放最后响应后 10 单元全部应用，0 过期、0 失败；正式库文件不变，未调用真实 API。

新增合同测试覆盖业务 ID／ref 混用、响应不被原地修改、未知与旧版本引用、越权写入、引用混用造成重叠、来源与写入字段禁止 ref、固定信息审核。磁盘恢复测试保留失败状态及 repairCount=2 检查点，在恢复后接受原快照的合法引用并完成提交。

[直接加载源码的离线回放入口](evidence/replay-saved-responses.cjs)仅读取指定数据库，不调用模型、不应用单元。真实响应内容留在私有模型历史，公开证据仅记录计数与校验结果。输入为源码根目录、数据库文件、可选输出 JSON：

```powershell
node docs/v0.5/records/memory-owner-reference-20261014/evidence/replay-saved-responses.cjs D:/HDSI-remake D:/HDSI-remake/runtime/data/hdsi-remake.sqlite
```

原失败任务完成后其快照会回收，此时重放需使用本次停服备份；工具不会替换为当前对象。离线通过不等于正式队列已完成，正式服务由用户手动启动；原全局暂停仍需 `hdsi.resume` 恢复。
