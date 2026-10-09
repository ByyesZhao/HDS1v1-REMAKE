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

T2: complete — 保留显式旧活动身份、混合open/pending残留队位与readyAt；只真迁入消息计lastInputAt。6组回归含SerialHost交错、B结束后A首次读取及原文隔离、事务失败回滚/重复重放。指定8文件61项GREEN；完整109文件631项通过（55.75s）。同步共同活动/上下文说明。证据：t2-red、t2-expanded、t2-targets、t2-suite。
T3: in progress — 生产V1更正阅读后现场旧课次，即时visibleSnapshots仍为V1的RED已取得。

T3: complete — 共用纯已知版本选择器；生产观察链即刻/持久不回退，真实App个人/表达/lookup输入保持V2＋历史V1。5组回归覆盖未读隔离、顺序/同公开版本记录差异、独立历史实例、重复知识提交。指定4文件20项GREEN；完整110文件636项通过（56.36s），typecheck通过。同步导演/上下文及旧细化被替代定位。补修T1测试CommonJS加载，T1五项重新通过。证据：t3-red、t3-targets、t3-suite、t3-types、t1-cjs-green。
T4: in progress — V1只读plan issue后，personal reminder仍scheduled，正向RED已取得。
T4: complete — V1计划通知实际阅读后推导个人提醒；共用时区展开，覆盖跨午夜、successor、内部/公开版本、取消/待定/日期、精确边界。实际提醒阅读失败回滚与重放幂等通过，资格检查不产生知识。指定8文件47项和阅读事务测试通过；全量112文件640项通过（56.50s）；typecheck通过。验收脚本同步必需timezone参数；D1区分未保存过期提醒与已保存合法延迟发布。日志t4-red/t4-expanded/t4-transaction/t4-types/t4-suite。

T5: in progress — 未标定词法场景中具体事件词不命中晋升记录RED；兼容补齐新增接口测试亦失败，开始修复。
T5: complete — 同候选事件依据与结论可召回，旧补齐幂等/不改durable措辞/无唤醒续期；前台先恢复、后台inFlight延期、ready/started快照保留。指定9文件51项，追加恢复/冻结测试通过。首次全回归发现既有同步接口接受尚未保存的当前owner，已保留该合同，memory-final-review重新通过；最终联合全量114文件649项通过（57.57s）。类型检查通过。日志t5-red/targets/sync-green/types、t56-extra-green/suite。
T6: complete — 历史汇总SQL、3任务各6阶段，2048网页展示，精确统计/完整诊断不变；真实environment step无普通turn时显示当前owner，维护owner随prepare清除。10/100/1000轮增长和raw不变验证；指定5文件21项、追加环境测试通过，联合全量114文件649项通过；类型检查通过。日志t6-red/targets/types、t56-extra-green/suite。T5与T6共用Host改动在上一提交一起落入，未混入无关用户资料。

T7/T8: complete — 空闲前无快照，t5更新重置后t20仅一次新版整理；已开始/unknown输入保留；精确版本释放。r1/r2/r3仅编码r3，stateVersion-only可应用，服务前保持队位、服务后让给B，25项失效任务分20+5续调度且后台请求为0。T7指定8文件42项；T8指定加T7共8文件35项；完整116文件657项通过（59.12s），类型检查通过。日志t7-red/green/types，t8-red/targets/types，t78-suite。测试DTO去重content时改用content或eventSummary断言，未更改生产格式。
