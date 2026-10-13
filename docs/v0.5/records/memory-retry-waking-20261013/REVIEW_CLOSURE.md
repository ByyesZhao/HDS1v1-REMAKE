# 原计划R1～R4：实现与验收映射

日期：2026-10-13。原[计划审核](../../reviews/memory-retry-waking-20261013/REVIEW.md)与原计划未修改；本页记录实施后的映射。M1、W1范围复核通过；当前修正基线367747a6ca9c587e18d0eb069af8e474b479fd4a。M2／整批审核两项P2已实现修正并有12文件134项稳定定向证据，最终CODE spec／quality批准、F1／F2关闭，a4e781f完整离线工程验收已通过。最终结果见[交付](DELIVERY.md)。

| 原问题 | 实现落点 | 判别回归与关闭范围 |
| --- | --- | --- |
| R1暂停归属／通知／并发恢复 | [runtime字段](../../../../src/types.ts)、[Host](../../../../src/host/runtime.ts)、[maintenance](../../../../src/memory/maintenance.ts)、[app](../../../../src/app.ts)：独立maintenancePause保留job／cycle；发送前持久登记attempted，人工恢复只重开记录周期 | [retry-limit测试](../../../../tests/memory-maintenance-retry-limit.test.ts)：foreground交错、notification失败／reopen不重发、resume_with_both_failures_reopens_only_recorded_cycle_after_disk_reopen。最终CODE复查通过；a4e781f完整离线工程验收通过 |
| R2归档异常与ready复用 | [history](../../../../src/model/run-history.ts)、[store](../../../../src/memory/store.ts)、[maintenance](../../../../src/memory/maintenance.ts)：归档清理SAVEPOINT回滚，ready先保存，失败进入同attempt结算，活动Promise受控，存储故障停止 | [历史测试](../../../../tests/model-run-history.test.ts)实际SQLite写失败覆盖四入口；retry-limit含archive_failure_after_prepare_preserves_ready_result_and_retries_without_model、ready_archive_retry_survives_reopen_without_model_regeneration、graceful_stop_archive_failure_remains_retryable_and_does_not_reject_unowned_promise及存储故障。M1存储层已复核，M2执行／Host闭环经最终CODE复查通过；a4e781f完整离线工程验收通过 |
| R3合法睡前阅读 | [app](../../../../src/app.ts)、[prompts](../../../../src/model/prompts.ts)：保留原sleep输入，校验后清已结束sleep；原学校可读validator保持 | [waking测试](../../../../tests/waking-school-notice.test.ts)：睡前合法、睡眠内拒绝、精确wakeAt放行、发布／释放／手机／范围限制；W1spec／质量已复核通过，已集成并保留在367747a，a4e781f最终整批离线验收通过 |
| R4调用身份唯一性 | [ModelClient](../../../../src/model/client.ts)、[history](../../../../src/model/run-history.ts)：每次调用UUID invocationId，按响应序号／类别存failure；同business runId与repair预算保持 | model-run-history：foreground_resume_keeps_all_invalid_response_records、history_record_identity_survives_reopen、web／owner缺省和最后无效稿保存；M1已复核通过 |

W1另两项澄清已由其独立审核覆盖：磁盘重开后narrative repairCount=2，合法首稿继续、非法首稿立即失败；personal清已结束sleep但正式B提交仍保留下一晚计划。已尝试发送与outputComplete沉默候选不重生成为新时间轮。W1原P3仅为新加EOF空行，已在49e4247关闭并复查完整范围diff --check，无行为修改。

原审核的600秒／索引120秒、首次＋2次自动重试、failed占用、只读不DDL及ready复用要求仍适用；不得用格式修补、换jobId、重启或清空checkpoint绕过。M1已确认无Important／Critical，只有既有负向CLI测试打印预期栈的非阻断P3噪声，未作为本批代码缺陷改写。

公共报告由主任务复制：[M1审核](evidence/task-1-review.md)、[M2审核](evidence/task-2-review.md)、[W1审核](evidence/task-3-review.md)、[整批审核](evidence/final-review.md)。原审核的changes requested与原失败证据保留，下述补修不覆盖原文；本页不是部署／启动／resume批准记录。

## 整批／M2审核补修

| 发现 | 修正与判别证据 | 状态 |
| --- | --- | --- |
| F1／R-M2-2 · P2：执行错误详情在成功恢复后丢失 | maintenance history按prepare／archive／apply／timeout／interrupted保存有界脱敏的私有诊断；未知transport字符串不保留，job／runtime／status使用通用安全摘要。真实INSERT／UPDATE trigger验证归档／提交详情跨重试到done及终态人工resume仍在；既有文件库回归另验证历史及ready恢复；canary验证密钥／userinfo脱敏、2000字符正文上限及公开状态不泄漏 | 367747a修正，经独立CODE复查关闭 |
| F2／R-M2-1 · P2：已报告fatal从队列消失使稍后stop成功 | 独立storageError保留首个fatal；Host全部drain后合并该错误并按身份去重。两个回归先让真实Host消费全部错误，再阻挡background／environment排空，证明stop等两者完成后仍拒绝；包含paused写入也失败的情况 | 367747a修正，经独立CODE复查关闭 |

[修正报告](evidence/task-2-fix-report.md)记录8项判别RED→GREEN和最终12文件134项稳定定向通过；新retry-limit文件此时37项。修正不改变ModelRunHistory schema、业务runId、准备结果复用、修补／工具预算或W1。初次完整回归的4项兼容合同失败与修正诊断见[交付](DELIVERY.md)，该旧失败结果保留；独立最终CODE复查已批准两项关闭；主任务最终a4e781f完整流水线均退出0：223文件1491项通过、0失败、2项既有跳过（总1493项）；typecheck／build／demo通过，插件合同2文件10项通过，双场景smoke各四阶段提交通过；独立reviewer亦批准该测试微调。部署／启动／resume不属于此离线关闭。
