# SDD ledger — plan: docs/MEMORY_V0.3_EXECUTION_PLAN_20261007.md

日期：2026-10-07。实施依据为记忆细化／执行计划，完成后再执行搜索计划。正式服务不启动，真实接口验证、生产迁移和背景切换分别记录，不能把离线结果当线上验收。

## 初始检查与裁定

- Node v24.21.0，npm 12.2.0；基线typecheck通过，基线18文件／78测试通过。
- 普通沙箱运行Vitest在配置加载阶段spawn EPERM；相同命令获准在沙箱外执行后通过，未修改测试配置来绕过测试。后续离线测试使用同一执行权限。
- Ruling: 当前目录无Git仓库，按已批准计划直接在本项目实施；不建立虚构分支／提交，不调用依赖Git的SDD脚本。备份位于runtime/implementation-backup-20261007，保留ledger替代Git检查点。若需回退，可对照备份逐项恢复。
- Pre-flight: 任务1→2共享owner身份／版本／SQL事务；2→4共享preview、来源及canonical ID；3→4共享查询向量／ModelRunOptions；4→5共享候选与权限；5→6共享startOne/applyOneReady/stop；1～6→7生产装配。接口与细化一致，搜索计划在这些接口上扩展runRef/web，不另建宿主。
- Ruling: SelfWebReadSource在记忆任务1定义，记忆任务2先允许经程序验证的来源注入（无搜索时为空）；真实登记由后续搜索任务负责。不因尚未接搜索而提前发送网页或放宽其他操作来源。

## 任务进度

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1 存储与迁移 | 完成 | 5项真实SQLite测试及typecheck通过 |
| 2 合同与生命周期 | 完成 | 5文件40测试及typecheck通过 |
| 3 向量与独立调用 | 完成 | 3文件12测试及typecheck通过 |
| 4 混合检索 | 完成 | 7文件46测试；1万条3／6个月离线基准；typecheck通过 |
| 5 后台协调器 | 完成 | 4文件28联测／typecheck通过；临时文件重开及回滚 |
| 6 前台优先宿主 | 完成 | 4文件19测试通过；后台未释放即confirmed发送 |
| 7 配置与交付 | 离线核心完成 | 27文件132测试、typecheck/build/smoke/两个cmd --check；正式库schema3 |

## 检查点

基线：2026-10-07，npm test → 18文件78测试通过；npm run typecheck → 退出0。正式SQLite未迁移，服务未启动。

Task 1: complete — 新增memory/types.ts、store.ts及迁移CLI，Storage提供prepare与nextMaintenanceAt，package.json增加memory:migrate。测试先因新store模块不存在失败；新增“迁移登记所有索引待办”断言后观察到空待办失败，再实现queueIndex通过。最终npm test -- tests/memory-v3-store.test.ts → 5/5；npm run typecheck → 退出0。覆盖主键／来源、preview／90日grant、重复迁移、未完成轮拒绝、04:30／补办、SQL期限／合并过滤、配置／revision向量连接及事务回滚后文件重开。只使用临时SQLite，生产库未迁移。

Task 2: complete — 新增MemoryLifecycle及schemaVersion=3合同，七天preview、initial/renew/reactivate、上海日期去重、合并UPSERT及30日候选落库；details空别名规则保留。程序查阅来源注入、post job的clientRef→ID映射及来源保存已实现，网页实际登记仍待搜索阶段。旧夹具明确改为V0.3，不兼容旧reinforce输出解析。初始模块缺失RED；补验初始grant唯一性发现两条grant，统一稳定initial ID后GREEN；查阅post恢复先报unknown source，接入来源及持久化后GREEN。最终5文件40测试通过及typecheck退出0，含原memory/review-fixes/recovery回归、合并回滚和重放不重复加次数。

Task 3: complete — 提取共享EmbeddingProvider，记忆独立MemoryIndex，双侧float32归一化、带配置签名LRU256／10分钟和1500ms查询超时；prepare只返回派生结果，正式提交留给协调器。runModel与HTTP transport携带本次signal及lookup，lookup=null禁止旧默认入口；传输／取消错误不走JSON修补。新增测试先因缺模块及旧调用不接options出现RED，最终3文件12测试与typecheck通过。未请求真实供应商，表情包4项原测试保留通过。

Task 4: complete — ContextBuilder改为async权限请求，生产各前台调用携带阶段lookup；整理补查通过同一权限检查且只预算自身实际使用字段。RRF60前词法／已标定向量筛选，current排除过期／merged／旧revision，默认不裁字符／条数，long＋按需learned统一可选上限。先因模块缺失RED；真实测试发现问句尾词阻止召回，完善有效词规则；旧预算夹具按V0.3迁移并使用完整元数据预算。7文件46项针对性测试与typecheck通过。memory:check报告在runtime/data/memory-retrieval-calibration.json：训练／验证分离，词法事实和经历各4＋4人工样本，阈值由验证F1选择；三／六个月1万条返回100相关、误召0，离线SQL约66～69ms／端到端101～112ms。小人工集不代表真实聊天效果，后续可扩充标注；真实Qwen语义阈值待标定，semantic-only未启用，未作真实网络或容量结论。

Task 5: complete — MemoryMaintenance统一一槽，startOne不await远程，ready先保存后逐单元apply；120秒Abort／5分钟retry、fixed cutoff、default20事件／软字符目标、公平createdAt＋ID、readSet冲突转新job、索引revision／签名校验及stop晚结果丢弃已实现。两文件缺模块RED后实现，空units验收发现覆盖校验漏空数组，修正后通过；随机job ID导致夹具按排序首项取错，改为按result识别原job。另加同事件existingLongId正文更新测试先RED，修正新短期关联既有摘要但不续期／造副本。4文件28项联测与typecheck通过；后台容量错误不暂停、不缩小重发；临时SQLite重開ready复用、正文／index／标记同事务回滚，未操作生产库。

Task 6: complete — SerialHost按旧轮→世界／学校／故事→openBatch门禁→一个ready单元→真实setImmediate→重新closeReady的顺序执行；不await后台网络，定时器合并可运行维护截止，在途不反复返回now，status只显示运维统计。stop立即Abort再并行等待前／后台。新增宿主测试先有4项RED，接入协调器后只剩夹具尚未进入异步前台就stop的失败，改为等待真正进入前台，再断言Abort先于完成。4文件19测试通过，包括acceptInput真实15秒批次、后台未释放即outbox confirmed／turn done、实际setImmediate输入让位、旧轮→世界→学校→故事→维护、暂停ready、无0ms空转和停止所有权。

Task 7: offline core complete — 装配唯一store/lifecycle/index/retrieval/maintenance，生产不传旧全局lookup；独立memoryEmbedding及memory_consolidation Flash/high，默认字符／条数null，记忆端点初始沿用本地Qwen地域但与表情配置独立。新增配置／容量／背景夹具测试先因模块缺失RED；最终27文件132项全量测试、typecheck、build、真实Koishi离线smoke及两个cmd --check通过。补查初始化发现旧直接save会缺V0.3 owner版本，改为makeOwner/saveOwner；smoke实际创建人工细节并确认后台向量一次应用通过。后续搜索完成后再做最终全量检查。

后台规模补充：已完成job不在每次pump全量读取；过期配置待办逐个applyOneReady标stale，让宿主在每个单元间让位，未发不兼容Embedding请求。新增针对性回归18项通过；这是静态复核后的补验，不冒称此前已存在的RED证据。

生产迁移：获准只读进程检查HDSI／SnowLuma相关进程0；正式库备份runtime/implementation-backup-20261007/hdsi-remake.before-memory-v3.sqlite。npm run memory:migrate -- --stopped成功；只读业务元数据核对schema3、unfinished=false、memories=0、details=0、stickers=67、pendingIndex=0。库尚未建立首个故事，16项initialDetails在用户启动新故事时由V0.3初始化，不在迁移中凭空建故事。未启动服务、未真实调用供应商。

背景：memory:background离线产生36段审阅候选／来源映射及16项既有初始细节差异，作者原文件和生产入口未改。当前selection为空，候选保留全部原文；需审阅选择段落后才能去除core中的重复可变细节，未把关键词自动删段当完成摘录。Qwen真实阈值仍待另行授权发送标注样本后标定，semantic-only关闭。真实QQ、角色模型输出及供应商容量未因离线测试而宣称验收。

## 最终复核与交付

搜索1～6完成后，独立新上下文只读复核提出四项Important，无Critical／单列Minor：短期merge越过长期readSet、补查中断恢复遗漏可操作ID、durable投影旧正文、合并后短期linkedLongId不匹配canonical快照。四项先4/4 RED，修正后GREEN；同轮补验两常驻别名合并重复投影先RED后GREEN，稳定认识basis更新及投影版本冲突补验通过。修复统一在一次最终pass内完成，未派重复复核。

Final: fixed 合并读写闭合／恢复ID白名单／常驻投影及索引同步／canonical压缩快照 — tests/memory-final-review.test.ts四项RED→GREEN，另合并投影一项RED→GREEN，最终全量39文件177项通过。后台派生投影进入固定快照及程序补齐readSet，单元依旧同步事务和真实让位。索引文本模板memory-v3-text-2包含投影的新依据。

Ruling: durable_experience随同事件当前摘要更新，stable_understanding保留多事件结论并显式附projectionBasis新依据，不以单事件摘要自动改结论 — 保留两类常驻语义区别 — 代价是模型需结合新依据理解旧结论，真实语义效果仍须联调。

最终typecheck／build／真实Koishi离线smoke／两个cmd --check均通过；正式服务未启动，未新增供应商调用。所有取舍、备份、未完成范围及DSH交审入口汇总于IMPLEMENTATION_HANDOFF_20261007.md。



## 第七轮审核修正（2026-10-07）

已按用户接受的CODEX_REBUTTAL_MEMORY_V0.3_DELIVERY与新搜索指令实施。归档和lookup不提前提供预备长期；DTO控制字段不保存／回传；happenedAt＋可选happenedUntil保留已知范围，lastEventUpdateAt独立；常驻经历同步时间、新来源与依据，纯元数据不重建索引；可选预算保护来源与排除指标修正，提升立即清窗口计数。维护应用失败整体回滚后在事务外保存ready的retryAt／lastError，五分钟后应用原结果；其他任务与前台仍可运行。正常来源补充仍可增加stateVersion，不删不同稳定认识。

任务与回归证据见REVIEW7_FIX_IMPLEMENTATION_20261007.md：新记忆11项、新维护3项及原生命周期／host回归通过。21:27完整42文件200项通过；typecheck/build、真实Koishi离线smoke及两个cmd --check均通过。独立最终复核进行中，后续结论收录于该记录；未启动服务，未发真实供应商请求。


本轮最终独立复核：Critical／Important／Minor均0，未发现需追加修正项。最终证据为42文件200测试通过，类型／构建／真实Koishi离线smoke／两个启动文件--check全部通过。任务1～5完成，详见REVIEW7_FIX_IMPLEMENTATION_20261007.md；代码与记录留在新项目，服务未启动。
