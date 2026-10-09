# ASTRA 修复交付与离线验收

日期：2026-10-09。T1～T13已实施，源码起点73774bf，独立隔离分支codex/astra-v05-fixes，随后集成本地main。细化与计划见[统一计划](../plans/ASTRA_FIX_EXECUTION_PLAN_20261009.md)，逐任务RED/GREEN、异常定位及裁决见[过程记录](ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)。未修改密钥、人物背景或正式配置，不读正式故事库，不发送真实QQ、不调用真实模型、不启动服务。

## 业务修复与主要回归

| 事项 | 当前行为 | 主要证据 |
| --- | --- | --- |
| F1 活动归属 | 新活动只迁入显式普通未读；旧活动A身份不被B改写，混合批次按实际残留保留FIFO/readyAt，时钟只计真迁入 | shared-v3-cross-activity：实际SerialHost交错、确认开始到B事务、新旧批次、回滚、恢复重放、旧A首次读取和普通窗口隔离 |
| F2 个人提醒 | 已读公开计划的准确时间可推导同课次资格，无需另读实例；未知、更正未读、取消、待定或不匹配实例仍不可提醒 | world-school-personal-reminder、world-school-reminder-timing：V1真实展开/阅读/发布，weekly跨午夜与非默认时区；资格只读，无知识副作用 |
| F3 知识版本 | 已知候选共用公开版本→记录版本→获知时间→稳定顺序选择；旧课次现场记录保留，不能回退已读新计划 | world-school-knowledge-version：实际观察、提交、App个人/表达/lookup都保留新计划与历史旧课次，未读客观更正不泄漏 |
| F4 晋升召回 | 同一认识候选含抽象结论及主事件依据，词法/向量文本可按细节召回；旧active learned可确定依据时幂等补齐 | memory-projection-retrieval：晋升、同步、旧投影、状态变化、缺主事件报告、恢复顺序与冻结任务 |
| D1 提醒口径 | 未保存的过时提醒不补建；已保存且仍合法可延迟发布/重放，取消或过期仍退出 | 原通知回归保留；导演文档明确两类 |

## 恢复与后台请求成本

- 原前台先恢复，确认发送与B事务原语义保留；学校知识提交失败回滚，重复阅读不重复写知识。
- 记忆补齐在无unfinished、无后台prepare的安全空档执行，每进程一次；缺canonical只报告，不猜历史，不制造唤醒/续期。正文改变才排新向量，stateVersion变化不等于新正文。
- startedAt显式null才可刷新未开始任务；缺字段旧任务、已开始重试和ready原输入保留。兼容旧任务可能执行一次旧请求，应用版本门禁再判stale；不为省调用改恢复依据。
- 整理t=0登记待办但不占快照，t=5新活动刷新空闲，t=20才取得新版依赖闭包；派发与startedAt冻结同事务，释放仅匹配原预留版本。
- 索引r1/r2/r3服务前合并，只编码r3并继承首次未服务队位；已服务A的新版本排在等待B后。stateVersion-only仍可应用。每轮最多清理20项失效队列，25项分20+5继续调度，清理不计外部请求。

## 历史量工作量与查询计划

环境Node v24.21.0／Windows，临时合成SQLite；每规模一次预热、五次采样，不计建库/基线恢复。N表示各N条合法已读消息、完成轮和关闭段，当前工作集固定。毫秒仅此次本地观测，不是延迟承诺。

| 历史N | full中位ms | full查询/解码/data行 | active中位ms | active查询/解码/data行 |
| --- | --- | --- | --- | --- |
| 1,000 | 5.85 | 13 / 3005 / 3005 | 4.20 | 67 / 46 / 46 |
| 10,000 | 49.72 | 13 / 30005 / 30005 | 4.02 | 67 / 46 / 46 |
| 50,000 | 258.73 | 13 / 150005 / 150005 | 3.24 | 67 / 46 / 46 |

full的messages、turns、chat_episodes各读一次，仍随历史增长；active不调用这三表的all。实际生产SQL的EXPLAIN：unfinished使用turn_active_work等价COALESCE部分索引，未读使用message_unread两条件，按段/活动/open分别使用索引。新增生产SQL计划回归防止只减少JS解码却仍扫描已读历史。工作集含全部unfinished/未读、当前活动全文和真实引用，不通过删历史或减少保护集合取得优化。

首次输入、启动、恢复、参数改变及影响窗口证据的迁移仍完整检查；任务、冻结/输出、post、memory/detail/learned和检索消费都有来源检查。旧orphan成为新引用时仍阻挡。完整函数接入表与fallback理由见过程记录；不支持外部直接写库后的持续监控。

## 网页状态体积

| 合成轮数 | 会话总数 | 网页字符 | status中位ms | 原会话未变 |
| --- | --- | --- | --- | --- |
| 10 | 40 | 153 | 0.47 | 是 |
| 100 | 400 | 155 | 0.85 | 是 |
| 1000 | 4000 | 157 | 5.13 | 是 |

网页文本增长4字符，低于64目标且均低于2048。汇总用SQL，当前最多3个owner、每owner6阶段，环境step/维护任务也可显示；不读历史正文/输入/checkpoint。完整诊断及raw保持精确，不承诺其他status部分或SQL汇总总耗时恒定。

原始五样本、计数和查询计划：[benchmark.json](ASTRA_FIX_BENCHMARK_20261009.json)。可重新执行 `node scripts/bench-chat-status.cjs --output runtime/astra-fixes-acceptance-20261009`；不传参数也使用该默认目录。工具只打开自身临时合成库。

## 最终命令与证据

| 命令 | 新结果 | 日志 |
| --- | --- | --- |
| npm test | 退出0；121文件681项，66.15s | t13-final-suite.log |
| npm run typecheck | 退出0 | t13-final-types.log |
| npm run build | 退出0 | t13-final-build.log |
| npm run demo | 退出0；普通回复/固定细节/3步活动完整结束 | t13-final-demo.log |
| npm run smoke --prefix runtime | 退出0；empty四步committed、3生成；required四步committed、4生成；各Embedding1、repair0 | t13-final-smoke.log |
| node scripts/bench-chat-status.cjs | 退出0；默认目录、三个规模、五样本全部断言通过 | t13-final-bench.log |
| git diff --check | 退出0 | t13-final-diff.log |

本地集成：`73774bf → ac1e870`快进合入main，随后同步README及三份计划状态，原有审核链接与材料保留。主目录再次执行完整回归：121文件681项，66.23s，退出0；build、typecheck、demo、smoke与diff检查均退出0，日志为primary-final-*。16份当前/计划/记录文档的130个相对链接检查无缺失。原未提交README与三份计划先备份到验收目录original-docs，不覆盖DSH-review或reviews原始材料。

日志最终保存在 `D:\HDSI-remake\runtime\astra-fixes-acceptance-20261009\logs`。原始审核与旧复现保持历史，不要求修复后继续满足其错误行为断言。smoke使用真实Koishi注册/Host/V1展开，但所有模型/Embedding是假fetch，未知请求失败；测试不会透传网络。

独立复核未发现Critical/Important，窄回归7文件39项通过。两处Minor验收漏检已修正并增回归：默认--output和持久通知ID精确覆盖；无空数组/部分缺项假绿。Declined-to-judge均逐项裁决于过程记录。

## 部署与剩余边界

本地新构建可供用户后续手动运行两个cmd。没有替用户部署或自动升级正式故事库。首次正式安全pump补齐旧认识后，应另看实际changed/reindexed/missingCanonical报告；正式数据结果本次未知。已被旧代码改错的活动ID不猜测恢复，原已选批次消费规则不改。

真实模型/QQ持续运行、真实旧库补齐与数月性能没有本轮证据。semantic未标定和搜索供应商未装配的状态保持原样；此次不以离线回归宣称这些能力已上线。所有业务配置、数据协议和模型预算决定沿用用户批准口径。


## 后续R1恢复补验

实施后独立复核发现已开始维护任务的模型checkpoint在失败finally中被清除；这是旧代码已有的遗漏，此前snapshot冻结测试未覆盖它。现由`b398699`局部修复：pending/computing保留模型进度，ready/done清理。原121/681及性能数据保持本批次历史，新增正式12项后的122/693、原独立9项转绿与恢复证据见[R1补验](ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md)。不重做其余T1～T13任务或混写旧数字。
