# 记忆容量与空闲整理 V0.4 交付复核入口

日期：2026-10-08。实施基线：`9e24b0d`，逐任务提交见实施日志及本地Git。任务1～8与最终复核修正完成；后续主目录集成结果另记。

## 审核依据

1. [实施细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)：实际字段、容量／归档口径、删除面和门禁。
2. [执行计划](MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md)：任务1～8及验收矩阵。
3. [实施日志](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_LOG_20261008.md)：各任务红灯、通过检查、裁定及正式库状态。

建议DSH先核对以上三份与源码差异，再按执行计划Review Focus检查迟到回调、引用闭包、输入重置、公平队列、只读升级。历史rebuttal无需重新拼装成规范。

## 已交付行为

短期100、普通活跃长期1000（含preview）、归档500，归档90天；每项容量／期限可独立设null关闭。容量转层和物理清理为程序规则，优先保护仍被活跃短期或稳定认识引用的经历，暂时超量显示保护原因。最终删除会清正文、向量、唤醒／grants及派生任务副本；原始消息、公开剧情、具体事实、作者背景和学校计划仍保留。

基础提取与具体事实每轮生效；合并、深度整理和固定信息审核等最新真实输入／输出／非环境故事完成／活动变化后15分钟。共同活动和未实际结束的普通活动阻挡，睡眠例外可配置。索引不等15分钟。清理／应用每单元让出事件循环，前台优先；一个后台网络槽、一个Host计时器。

`merge_short`使用最早创建时刻＋稳定ID主身份和非空合法来源，不凭整理时间续期。固定信息冲突只存审核建议，稳定认识证据至少两个不同canonical事件，不自动修改作者文件或向用户发送审核任务。

## 验收

已运行：最终79个文件、435项测试全部通过；`npm run typecheck`及`npm run build`通过。任务8初验428项，最终复核新增7项回归。新增混合Host验收实际完成普通输入→共同活动→结束→15分钟深度整理→容量压力→清理穿插输入→重开数据库；最终100／1000／500，重开后一致，派生副本无泄漏，原始来源保留，保护解除后继续清理。

工具命令：`npm run validate:memory-capacity -- --db <新的隔离库路径>`。有限在线验证可加`--online --config <本地配置>`，单请求300秒；只接受新隔离数据库，禁止覆盖现有库或正式库同名文件。初验及在线报告位于`runtime/memory-capacity-acceptance-20261008/final-1855/isolated.sqlite.report.json`；最终修正后独立离线复验报告在`runtime/memory-capacity-acceptance-20261008/final-fixed/isolated.sqlite.report.json`，同样通过，未追加在线请求。

在线共3次DeepSeek Flash/high、0次格式修补：同事件采用merge_short；稳定认识候选采用合法retain，未强求晋升；事实冲突采用review_detail，正式值和作者背景未改。各请求耗时约12.4／13.4／3.9秒。仅使用已授权背景及三组模拟记忆，不发送正式聊天或图片、不连接QQ；不以这三例声称已完成数月运行验证。向量清理使用离线固定Embedding夹具，未调用实际Qwen接口，本期未改Embedding模型。

## 正式库与部署边界

正式`runtime/data/hdsi-remake.sqlite`只读检查：schema3、未初始化角色、各记忆计数0、无未完成故事、容量标记null。没有执行apply或正式清理；该空库用户下一次启动按新库路径初始化版本1和空闲时钟。既有有角色旧库需先完成旧轮、停止、只读检查，再执行`memory:capacity ... --apply --stopped`，工具先备份。容量标记版本1，记忆schema仍3。

HDSI及SnowLuma未由本次任务启动，仍由用户在主目录双击既有cmd。库容量不是SQLite文件字节上限；归档超过条数或90天会真实清理，不能保证删除后从归档恢复。

## 最终代码复核

唯一新上下文只读复核覆盖`9e24b0d..03c50f8`，未启动服务，另用纯内存组合场景验证。无Critical／Minor；发现6项Important，统一补回归再修复：

| 问题 | 修正及失败→通过的测试 |
| --- | --- |
| merge_short把详细content写进long | long使用事件／感受摘要；`merge_short_same_event_one_or_two_longs`两种分支先失败后通过 |
| reserved linked long等待重试，dirty short导致deadline=now | 选择与deadline共用元数据候选筛选；`reserved_linked_long_waits_for_retry_without_zero_timer` |
| 次级canonical证据更新不排learned审核 | `evidenceVersions`反向追踪且同版去重；`secondary_canonical_evidence_change_requeues_understanding_once` |
| 正式detail审核只看到自身 | dirty→makeJob补同键／别名及同来源依赖；`dirty_detail_audit_reads_related_fact_and_source_evidence` |
| 历史short来源漏保护、新promote合同与应用不同义 | `canonicalEvidence`解析已知short，promote readSet补长期版本；`legacy_short_source_resolves_canonical_evidence_before_cleanup`与`promotion_resolves_short_evidence_and_reads_its_canonical_version` |
| audit消耗只读证据事件待办 | 仅完成selected审核对象水位；`audit_does_not_consume_unselected_event_dirty` |

补依赖时另复现同批audit共享只读证据被误拒；新增`audit_units_can_share_read_only_evidence_without_duplicate_targets`先失败后通过。audit不同目标允许共享只读readSet，重复目标仍拒绝，事件整理仍隔离完整依赖。此次在同一修正过程内完成，未再派发复审；最终整套435项通过及独立离线复验作为修正证据。

审查暂不判断的两项均维持既定范围：不以模拟测试代替正式上线验证（服务按用户要求保持停止）；不以有限验收声称默认容量已经适合数月真实运行（条数可独立配置，默认保持用户已接受值）。没有遗漏待处理的重要问题，无延期Minor。
