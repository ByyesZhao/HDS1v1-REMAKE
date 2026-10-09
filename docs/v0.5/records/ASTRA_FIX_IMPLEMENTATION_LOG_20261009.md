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
T9/T10: complete — 全检messages读取由6次降至1次，chat_episodes/turns各1次；纯窗口两资格、42条整段、outbox/时区次序通过。SQL显式null/缺失/open无值/旧活动残留/done兼容与旧JS oracle相等，热查询不调用all解码历史。T9指定5文件44项，T10指定8文件38项；完整118文件661项通过（59.84s）；typecheck通过。查询计划将在T13合成探针保存，仍不宣称全检O(1)。日志t9-count-red/green、t10-red/green/types、t910-suite。

T11: complete — 首次/启动/恢复全检，普通输入使用当前工作集；满1k/10k/50k合法已读历史，输入不调用all(messages/turns/chat_episodes)，JSON.parse次数完全相同。14项新增回归覆盖旧orphan重新成为task/memory/detail/learned/visible/reconsider/post来源、required缺失、全部unfinished、confirmed opening、事务回滚、控制及重复输入、迁空段full fallback。指定10文件73项后新增3项通过；首次全回归发现旧夹具版本/绑定与关闭时钟不全，已按真实状态补齐，原ActivityContextError保留。完整121文件677项通过（65.99s），类型检查通过。

| T11边界 | 真实接入函数 |
| --- | --- |
| 输入 | SerialHost.checkDialogue(false)、InputBuffer.acceptInput、ChatEpisodes.acceptMessage |
| 新轮/冻结 | HdsiApp.runTurn、generateTurn、freezeTurn |
| 活动全文/恢复 | selectActivityContext、activityContextMessages；finishSharedTurn迁移经ChatEpisodes.reconcile完整fallback |
| 输出/hold | sendFrozen事务末、ChatEpisodes.confirmOutput/releaseReply |
| task/post | applyTasks、finishPostprocessing 保存结果前及B事务内 |
| memory/details/learned | MemoryStore.saveOwner覆盖MemoryLifecycle/MemoryMaintenance所有owner写入；applyUnit显式来源复核 |
| recent/lookup | ChatEpisodes.recent、MemoryRetrieval.build |

来源只针对实际messages记录，经历/self-web-read不误当缺失消息；冻结required IDs仍必须存在。参数改变首次重新全检；旧V1不切换此路径。工作集不截断未读、活动全文或未完成轮。稀有迁移后段窗口证明可能失效，保留full检查。外部升级/数据库修改后的进入必须start/resume全检，不支持监视外部数据库的缓存。
证据t11-cost-red/expanded/cost-green/regression-green/types-final；t1112-suite。

T12: complete — 同次collectReady/nextDeadline只建一次known/items/instances只读Map，不缓存notice状态。15个个人提醒的school_knowledge读取15→1，发布后select即时见available，直接调用结果相同；指定5文件17项通过，联合全量121文件677项通过，typecheck通过。日志t12-count-red/green/types、t1112-suite。
