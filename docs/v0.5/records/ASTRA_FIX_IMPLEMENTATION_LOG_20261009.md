# ASTRA 修复实施过程记录

计划：../plans/ASTRA_FIX_EXECUTION_PLAN_20261009.md；细化：业务与流程两份；基线：73774bf。
隔离分支：codex/astra-v05-fixes。起始源码无未提交变更，主目录 README、plans/reviews 和 DSH-review 待提交资料保留。
测试仅用离线固定模型、合成库；不读密钥、私有背景、配置或正式库，不连接 QQ。

## 执行状态

T1～T13：待执行。仅有对应新证据才标完成。

## 预检与接口

- T3→T4→T12：已知快照选择器→带 timezone 的通知资格→同次调度复用；依次修改。
- T5→T7→T8：补齐带来的 revision/dirty→startedAt 三分法→索引队位及清理续调度；保留已开始任务冻结。
- T2、T9、T10→T11：活动残留归属、纯窗口和 SQL 查询→共享判定及全部消费边界；最后切换日常检查。
- T6 修改 Host 当前 owner，与 T5/T8/T11 串行合并。
- T13 最终回归，基准按工作量衡量，不使用固定毫秒承诺。

Ruling: Windows 下 skill 的 shell 记账脚本及本计划 T1 标题形式不直接匹配，使用同格式持久 Markdown 记录任务、测试、裁决与差异；日志在 .superpowers/sdd/ASTRA_FIX_EXECUTION_PLAN_20261009。保留记录而不在结束时删除，满足用户复盘要求；若记账失真会影响后续审查，故每项附实际命令与结果。

## T1

待开始：先取得现有 smoke 失败，再写协议／等待行为测试。
T1: complete — smoke 正确行为旧实现 RED（expected four steps, received 3）；协议/等待/V1测试5项 GREEN；实际两场景 smoke 退出0，empty 3次生成、required 4次生成，各Embedding1、repair0、四步committed。完整回归108文件625项通过（55.80s）。首次测试因Vitest已移除旧options位置报错，修正后重新取得业务RED；工具错误未作为缺陷证据。
证据：t1-red.log、t1-green.log、t1-smoke.log、t1-suite.log。
T2: in progress — 正式跨活动复现旧A变B RED；筛选显式普通并按残留保留批次后首次GREEN，继续扩展Host/恢复回归。
