# HDSI 记忆与角色状态：V0.3落地记录

提示词／上下文V0.1现状：原文默认最近4个完整对话段，双方实际消息后空闲15分钟关闭；当前段计入，共同活动期间连续，无30条二次裁剪。模型资料按身份合池和阶段职责投影；无新来源免记忆整理，明确超限报错暂停且不自动裁剪。历史测试数字只描述原交付。本期入口：[实施细化](docs/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[实施日志](docs/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。


2026-10-07更新。文件名保留，记忆规则已由V0.2更新到V0.3。直接依据是[记忆细化](docs/MEMORY_V0.3_IMPLEMENTATION_20261007.md)与[执行计划](docs/MEMORY_V0.3_EXECUTION_PLAN_20261007.md)，实际证据见[实施记录](docs/MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md)。搜索接入仍按其独立计划继续。

## 1. 各层归属

核心背景仍由作者文件加载，每轮提供；自动学习不会回写作者身份。稳定细节按key保留唯一现值、别名和历史，无自动过期。详细短期包括真实事件过程、可记细节与感受，七天后退出普通检索但原文仍归档。短期创建同时保存简要预备长期：普通事件在七天后生效，重要事件立即生效，生效锚点起九十天。

长期唤醒必须由本轮整理明确提出，并引用本轮合法来源；查询命中和顺便复述不算。以(canonicalMemoryId, localDate)按上海日期去重；三个不同日期刷新九十天、消费这三日的窗口计数。归档的真正重谈产生reactivate，本次不计下一组三日。三十日期只成为常驻候选，后台判断durable_experience或stable_understanding；稳定认识需要不同事件支持，适合的认识才alwaysInclude。晋升保留长期主身份／次数，正文投影到learned_background。

## 2. 每轮整理合同

MemoryResult采用schemaVersion=3；shortTermChanges支持create/clientRef及update/id，携带content、eventSummary、feelingSummary、topics、sourceIds；create有importance、可选existingLongId，update有hasNewEventProgress。longTermChanges仅awaken/id/reason/sourceIds。detailChanges保持create/update/key/value/aliases/reason/sourceIds。无新内容可以三个空数组。

基础来源是本轮真实经历、首次可见输入、已确认输出，均要求非空；reconsiderMessages、检索结果、计划、未发草稿不能单独当新来源。程序校验结构、来源和身份范围，语义真实性仍靠职责提示。生活个人导演经程序登记的self_web_read另可支持查阅类短期，不能仅凭它修改私人details或唤醒长期；实际来源登记已由搜索模块接入，恢复保留来源ID和首次操作ID。

create短期ID为turnId:short:createIndex，关联长期默认为shortId:long；post job保存clientRef映射，恢复重放稳定。已有同事件长期用existingLongId继续更新，不另造副本、不自动刷新已生效期限。真实新进展延长详细七天及尚未生效的预备锚点；单纯改写不延长。

details值相同时整条跳过。值改变时非空aliases替换、空数组沿用旧别名；旧值从数据库读取，现值和历史同事务写入。

## 3. 检索与长度

ContextBuilder异步调用MemoryRetrieval。SQL先筛有效期限／状态，派生索引只连接当前revision和配置签名；merged副本和过期current不得由词法或向量旁路进入。明确回忆才能开archive；旧手机等历史申请另用includeDetailHistory。权限来自本阶段可见话题，普通主叙事不能用未看私聊开档案，世界／学校仅当前事实。

精确key／明确别名优先；其他词法先去通用叙事词，再按已标定覆盖度筛选；校准向量通过阈值后才与词法按RRF60融合。没有有效词可以返回空，不能score>0即放行。词法训练／验证报告保存于runtime/data/memory-retrieval-calibration.json；小人工集不代表真实聊天质量。真实Qwen阈值待标定，semantic-only关闭。

记忆独立memoryEmbedding，初始qwen3.7-text-embedding／1024维，与表情配置独立。双侧归一化float32 BLOB；查询只缓存向量，LRU256／十分钟，签名含端点、模型、维度、模板、原查询。查询超时1500ms或失败走词法，不暂停故事。

historyBudget、alwaysIncludeCharactersLimit、candidateItemsPerRoute、detailItemsLimit、shortItemsLimit、longItemsLimit默认null，不设800／8000或24／12／12／8配额。选中记录完整提供，近期已看输入／已发输出按最近4个完整对话段提供（当前段计入，空闲15分钟划段）。显式longItemsLimit对按需longTerm＋learned统一裁一次，alwaysInclude独立；用户主动设字符预算才移除低相关完整历史项，当前来源和状态不裁。不新增max_tokens／max_completion_tokens。真实容量错误不自动删内容再请求。

## 4. 后台与正式应用

一个前台故事槽、一个后台准备槽；压缩和建索引共用后台槽。默认批次最多20个事件／候选，字符软目标为null，设置后只减批次条数、超大单条独占且不截正文。每日04:30建立固定cutoff周期，后续新到期内容等下一日，但preview按时可见；停机补办一次、不逐日补造。

后台远程准备最多120秒，失败保留preview及待办，五分钟后可重试，不设置全局paused。回调仅保存ready并wake。宿主先旧轮、世界、学校、故事，再通过openBatch门禁；只应用一个ready单元，真实await setImmediate，再重查输入／故事。后台Promise不在SerialHost.active中。

压缩合同是闭合snapshot上的不重叠units：refine/merge/discard/promote/retain。readSet保存stateVersion，冲突单元不覆新值、合格内容转新job；其余单元仍提交。索引只核对revision及签名，状态计数变动不浪费相同正文向量。正文、来源、grant、索引待办和应用标记同同步事务，不在事务里网络await。

pause不启动／应用维护，在途可保存ready。host.stop立即Abort后台并同时等前台与后台收尾，之后才关SQLite。status显示运维统计，不保存查询正文。

## 5. 迁移和背景

新增learned_background、memory_retention_grants、memory_awakenings、memory_index、memory_index_jobs、memory_maintenance_jobs。旧mentions只留legacyMentions，新唤醒从0；旧长期从迁移时刻观察90天，迁移／建索引不造唤醒。CLI要求服务停止、无未完成旧轮，事务标记可重复执行。正式库已在备份后完成schema3迁移，服务未启动。

npm run memory:check为离线标注／规模检查；npm run memory:background产生审阅候选和来源映射，未选段时保留完整作者背景、不给关键词自动删段。生产核心背景切换仍待审阅，当前入口保持作者文件。各检查及真实接口边界单独见实施记录。


## 搜索离线核心落地（2026-10-07）

进程内唯一WebSearchService及四辅助表web_sessions/web_operations/web_materials/self_web_read_sources已接入。全部十一类任务独立run身份，阶段输入、补查、修补和工具请求检查点私有；公开正文缓存按owner释放，数据库材料保留恢复。同阶段重放计0，跨阶段首次取得各计1。正文响应成功后、最终parse前登记实际提供；personal_life的稳定来源及首次operationId进入post job。环境合同在最终parse读取providedUrls。后台共用既有120秒准备槽／signal，不阻塞前台，stop取消后不保存晚结果。

真实provider未配置，webSearch.enabled=false；当前未联网，待选服务后注入provider。网页无人工字符预算或12000截断，真实容量错误不删内容重试。来源语义、表达不新增事实和查阅不变亲历仍由任务提示约束，程序不冒称能判断散文真假。

证据：[搜索实施记录](docs/WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md)、[审核交付入口](docs/IMPLEMENTATION_HANDOFF_20261007.md)。


## 第七轮审核修正同步（2026-10-07）

当前记忆owner不保存／回传action、clientRef、existingLongId、hasNewEventProgress；happenedAt与可选happenedUntil保留已知事件时间范围，lastEventUpdateAt独立。archive及lookup不提前暴露预备长期。维护应用异常整笔回滚后保留ready结果、五分钟再应用，其他待办和聊天可继续。搜索不注入webSources或用其兜底，结果不足保存并向原阶段模型反馈“结果不足”，角色可自然询问用户；20／40及缓存B不变。最终42文件200项回归、类型／构建／离线加载／启动检查通过，独立复核未发现实质问题。详细依据与记录见docs/REVIEW7_FIX_IMPLEMENTATION_20261007.md及四份V0.3权威规范。
