# 普通聊天回复错位调查

日期：2026-10-10。基线：`6a88b9d`（产品`5566507`）。状态：诊断完成，改动方案待审核；本次没有产品实施。返回[记录索引](../README.md)。

结论：15秒对本次各合批执行正确，消息没有缺失。生成轮固定输入，后到消息分轮排队；没有“尚未首次发送时因新输入重新合并”的规则。旧回复在新答案到达后才输出，最新3条又在下一轮无确认输出，导致错位观感。完整历史模型请求已清理，不能断言当时模型的具体reply枚举或原提示内容。

## 证据与重跑

- [正式只读时间线](evidence/formal-timeline.json)：3轮、输入与发送时刻、已看归属、完整候选已清理的边界；不包含完整聊天、背景、密钥或图片。
- [合成离线复现结果](evidence/offline-reproduction.json)：15秒刷新正确；普通多就绪批只选较早批；生成期间新消息到达仍发送旧稿；下一轮上下文含新输入及上一轮输出，允许看见而不回应。
- [新开放合批复现结果](evidence/pending-open-reproduction.json)：最新输入刚到0毫秒，旧就绪批仍可被选择；新输入不提前变已读。
- [离线执行日志](logs/offline-reproduction.log)、[开放合批日志](logs/pending-open-reproduction.log)。这两个探针固定原实现的行为，不是新功能已通过的测试。

```powershell
npx tsx docs/v0.5/records/chat-reply-order-20261010/reproduce-current.ts
npx tsx docs/v0.5/records/chat-reply-order-20261010/reproduce-pending-open.ts
```

两份[探针](reproduce-current.ts)与[补充探针](reproduce-pending-open.ts)使用内存库、测试时钟、脚本模型和发送替身，不使用正式配置／数据库，不连接QQ或供应商。当前3组主探针及1组补充探针断言通过；没有重跑全量或以此前954项宣称新功能通过。

## 建议与未执行范围

[改动方案](../../plans/chat-reply-freshness-20261010/README.md)：旧候选未开始发送时，发现新输入就等最新消息满15秒后重新合并生成；已尝试发送继续原冻结恢复。涉及前台持久等待和阶段快照，需要审核后细化，不能只加一句提示词。

未证明：真实模型一定理解每句、最新无输出具体来自none还是其他合法路径、QQ客户端发送到服务端接收的延迟。没有通过重放真实聊天调用在线模型，也没有增设强制回复或改变15秒／4段参数。
