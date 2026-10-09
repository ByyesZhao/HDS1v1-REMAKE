# HDSI 记忆 V0.3 实施细化

日期：2026-10-07。状态：实施前细化，尚未编码。依据：[方案草案](MEMORY_V0.3_PROPOSAL_20261007.md)、[DSH 审查回应](CODEX_REBUTTAL_MEMORY_V0.3_20261007.md)。执行拆分见 [执行计划](MEMORY_V0.3_EXECUTION_PLAN_20261007.md)。

本文补齐行身份、合同、合并、向量、维护与迁移规则。尤其落实“维护不遮挡正常聊天”。当前 V0.2 文档仍描述已实现程序，本文不是已经通过的验收报告。

## 1. 采用的规则和对原草案的调整

采用七天详细短期、九十天长期、三次跨日有效唤醒续期、三十次常驻候选。客观细节不自动过期；常驻不改作者设定；查询命中不计唤醒。时间统一使用带时区时刻，日期去重按 Asia/Shanghai；故事计数依据冻结的 TurnRecord.at，恢复不改到提交时刻。

为保证聊天优先，对原草案作三个明确调整：

1. **维护模型计算可以与一个前台故事轮同时在途**，但正式记忆变更只能由宿主在前台空闲时用同步事务应用。没有第二个故事线程，也不允许两个故事轮并行。
2. **启动不先清空维护积压**：先恢复旧故事，随后照常选择环境／故事轮；旧维护结果和新维护都在前台没有待执行轮时处理。
3. **短期建立时提供预备长期摘要**：七天到期即可按简要版本检索，不必等待后台 LLM 压缩。维护随后负责更好的压缩、合并及常驻候选。

这三点是本细化的新增设计决定，供用户／DSH 检查。单纯“每20条之间让位”仍会让用户等待当前一批远程调用，本方案因此拆开计算与应用。

“不遮挡”指本地宿主不 await 后台远程请求后才处理故事；不是保证供应商网络零延迟。少量同步数据库提交仍会占用事件循环，应保持小事务并测量耗时。

## 2. 记录身份、版本与来源

### 2.1 身份

- 新短期 ID 继续用 `${turnId}:short:${createIndex}`，新记录映射保存在 post job，创建后不变。
- 对应预备长期 ID 默认 `${shortId}:long`；若模型明确关联已有同事件长期，引用该已有 ID，不另建副本。
- update／awaken 只按已有 ID 执行；数组位置不能重新分配 ID。同结果同 ID 不能重复写，违规进入格式修补。
- 合并保留一个主 ID，副本标 merged 并保存 mergedInto，旧来源引用可以追溯。普通检索只返回主记录。
- details 继续按确定 key 保存当前值；learned_background 的创建 ID 用 `${jobId}:learned:${unitIndex}`，映射随维护结果保存。

### 2.2 两种版本

| 字段 | 何时增加 | 用途 |
| --- | --- | --- |
| revision | 索引文本实际变化：内容、主题、感受摘要、事实值／别名 | 使派生向量与当前正文匹配 |
| stateVersion | 任何正式记录变更，包括正文、计数、期限、合并关系与状态 | 检查异步维护准备期间是否被前台更新 |

两者由程序生成，初始为 1。只续期或加次数不重算向量，但会使旧维护输入失效；Embedding 完成时只校验正文 revision 和索引配置，不因计数变化浪费同样文本的向量。

索引检索还必须连接 owner 的当前状态和期限；不能只凭 revision 相同就提供已过期／合并的记录。

### 2.3 来源与字段归属

模型提供：内容、主题、事实／感受描述、引用 ID、来源 ID、操作意图、关联事件。程序提供：ID、两个版本、创建／处理时刻、保留锚点、到期时间、计数、任务状态及索引元数据。

事件发生时间与记录创建时间分开。模型可以引用来源中已有事件的 happenedAt 或有依据的历史日期，不把“去年那次考试”改成今天发生。七天窗口依据本轮真实事件更新的处理时刻；单纯重谈、查询或改写不延长窗口。

每轮新增／内容更新／唤醒都要求非空当前来源，范围仍为本轮经历、首次可见输入、实际已确认输出。旧 reconsiderMessages 可帮助理解，不能单独当新来源。非空合法来源不等于程序证明了事实／真实重谈，语义继续由提示要求和样本验收。

检索命中、模型在回答中顺便复述摘要不自动构成有效唤醒；应是本轮确实重谈该经历的语义判断。不能仅为提高计数而引用一个无关但合法的来源。

## 3. 短期与预备长期

短期保留 content（详细过程）、eventSummary（简短事件）、feelingSummary（可为空）、topics、人物、真实事件时间、sourceIds、lastEventUpdateAt、shortExpiresAt、linkedLongId、consolidationState。

短期 create 同时让整理模型给出 eventSummary／feelingSummary；这不是额外一次模型调用。程序组合两项作为预备长期正文，保存独立长期记录，summaryQuality=preview。索引任务可提前登记。

| 场景 | 短期 | 关联长期 |
| --- | --- | --- |
| 普通新事件 | shortExpiresAt=本轮 at+7天 | retainedFrom=shortExpiresAt，expiresAt=retainedFrom+90天；在 retainedFrom 前不提供 |
| 明显重要新事件 | 同上 | 从本轮 at 立即进入长期；仍保留七天详细版本 |
| 在预备长期尚未生效前发生新事件进展 | 更新短期及预备正文，七天按真实进展重算 | 跟随新的短期到期锚点调整尚未生效的窗口 |
| 长期窗口已经生效后又有新进展 | 可继续／重新形成详细短期内容 | 更新同事件正文，但不因改写自动重开九十天；续期仍看有效唤醒 |

短期到期不再注入详细全文；只提供已到生效时间的预备长期，等待后台完善。精确事实仍在 details。这样聊天不会因维护排队而丢掉刚满七天的事，也不用等待维护网络调用。

维护可 refine 预备摘要、合并同事件记录或明确舍弃无持续意义的琐碎记录。已产生有效唤醒的长期不能再以“琐碎”为由自动舍弃，只能完善或合并。短期原文和实际经历继续归档保存。

维护失败保持 preview 和待办状态，不清空来源。明显重要事件的长期期限不因七天压缩刷新。

## 4. 每轮合同与合并

### 4.1 V0.3 的每轮记忆输出

```text
schemaVersion: 3
shortTermChanges:
  create: clientRef + content/eventSummary/feelingSummary/topics + sourceIds
          + importance: normal | high + 可选 existingLongId
  update: id + content/eventSummary/feelingSummary/topics + sourceIds
          + hasNewEventProgress
longTermChanges:
  awaken: id + reason + 非空 sourceIds
detailChanges:
  create/update: key + value + aliases + reason + 非空 sourceIds
```

hasNewEventProgress=true 是模型的语义提议，程序检查其当前来源、按本轮 at 设置锚点；不能由模型直接给新的 expiresAt。没有新内容，三个变更数组均可为空。

事件更新只允许操作本次提供的短期／关联长期 ID。importance=high 的新事件立即进入长期，normal 则等待七天；沿用当前重要度枚举。重要程度不让无关记录强行入选。

details 沿用已实现规则：新值相同跳过整条；值变化时 aliases 非空替换、空数组沿用旧别名；首次无旧别名则空。当前值及历史同事务保存，不无限累加旧属性值为别名。

### 4.2 压缩合同

memory_consolidation 接收选定批次快照，输出 disjoint units：

```text
unitKey + readOwners + action
action: refine | merge | discard | promote | retain
refine: 短期 ID／关联长期 ID + 新简要内容与感受 + 来源引用
merge: 来源记录 ID 列表 + 主 ID + 合并内容／感受 + 来源引用
discard: 到期短期／未被唤醒的预备长期 ID + 理由
promote: 达阈值长期 ID + durable_experience 或 stable_understanding
         + 内容 + 来源经历 ID
retain: 已有 ID + 保持现状的理由；常驻判断未通过也使用此操作
```

每个被选中事件／候选须有处理结果；多个事件可以组成一个 merge 单元。不同单元写入集合不能重叠，不以模型输出顺序制造中间历史。其 readOwners 来自本批提供集合，程序补齐对应 stateVersion；模型不能伪造版本。

retain 不改正文／期限／唤醒；程序记录已处理的压缩版本，或未通过常驻判断的 evaluatedEvidenceVersion，避免同一内容无变化时被再次排入下一批。

来源可引用本批已有事件／记忆的合法来源，不误用每轮“只有当前新来源”的合同。常驻稳定认识需要跨事件支持，单事件重复次数不能充当多个独立事件。

### 4.3 合并规则

主 ID 优先使用已有 linkedLongId；仍有多个候选时按 createdAt 最早、ID 字典序确定。来源去重并集；事件时间保留范围；感受保留阶段变化，不简单新值覆盖旧值。不能确定同事件则不合并。

同一事务保存主正文、合并去向、来源、唤醒记录、合法期限及待建索引。副本不物理删除。durable 不因合并降级；合并当前时刻不作为续期时间。

## 5. 唤醒、期限和常驻

### 5.1 去重依据

增加 memory_awakenings：canonicalMemoryId、localDate、firstEffectiveAt、turnId、sourceIds。唯一约束为记忆 ID + localDate；同日重复只补充必要来源，不再 +1。

totalAwakenings=去重日期数，创建为 0。归档重新激活使用本轮 at 给九十天，本次有效唤醒计入总数但不计入下一续期窗口。durable 只累计总数，不继续九十天续期。

保存 memory_retention_grants：kind 为 initial／migration／renew／reactivate，anchorAt 是有效时刻，triggerDates 保存已消费的唤醒日期（初始／迁移为空，续期三个日期，重新激活一个日期）。它是程序给出的保留期限事实，不由模型输出。

### 5.2 三次续期与合并计数

活跃窗口内，三个不同日期的有效唤醒触发 renew，锚点取第三次真实有效时刻而不是后台提交时刻；窗口计数归零。到期未续则普通检索退出，明确追问才能找回归档。

合并时去重日期，并保存已有合法 grants。以最后一个已授予窗口为起点，只重放该起点之后尚未计入窗口的有效日期；每三日按第三次真实时刻续期。超过未续窗口的记录不能凭后台重放当作重新激活，必须有实际 reactivate 依据。较早的窗口事件不能再次消费。

同一天在不同副本上的记录选择最早 firstEffectiveAt，来源并集。不能直接 sum 或 max 两个旧计数。已有较晚合法期限不被缩短，新的合并本身不创造 grant。

### 5.3 常驻候选

达到30个有效日期登记候选，维护可提炼 durable_experience 或 stable_understanding。模型判断未通过时保存 evaluatedEvidenceVersion；没有新来源／新唤醒依据不反复每天提交同一候选。

重要经历常驻仍按相关检索；稳定认识最多800可见字符可常驻，超额按相关性提供。两类都不自动写回作者背景或改变核心身份。

提升后长期主身份和唤醒日志保留，正文投影存入 learned_background，含 canonicalMemoryId；原长期标为 durable，不再作为普通长期候选重复返回。查询 learned ID 时按 canonicalMemoryId 记唤醒；合并去向仍可追溯。稳定认识如果引用多个经历，其来源关系不会把这些不同经历合并成同一事件。

## 6. 检索与索引

### 6.1 查询权限

RetrievalScope 为 current／archive，includeDetailHistory 独立。程序依据该阶段实际可见的当前话题建立 RetrievalPermissions，而不是让模型任意开放档案。

普通主叙事不读取本轮未看私聊，不能由该正文开启归档；共同叙事和个人导演可依据实际可见输入。明确回忆请求如“还记得那次吗／回忆一下去年那次生日”允许 archive；“现在什么手机”只取当前事实，“以前用什么手机”开启细节历史而不自动开放经历归档。

既有 lookupDetails 字符串形式保留；新增结构化 `{query, scope, includeDetailHistory}`，程序检查权限再查找。一次任务仍最多一次逻辑补查，不增加独立意图分类模型。

词法和向量两路都按时间、状态、合并主 ID、当前正文版本过滤。归档和历史旧值不能通过词法旁路混进 current。

### 6.2 向量与查询

记忆独立 memoryEmbedding，初始 qwen3.7-text-embedding／1024维，可与表情独立改。ownerType+ownerId+revision+配置签名定位 float32 BLOB；库向量和查询向量均归一化。

查询向量采用进程内 LRU：最多256条、TTL10分钟，key 包含端点／模型／维度／模板版本／原查询文本。只缓存向量，不缓存含旧记录的检索结果。一个逻辑查询跨分类复用；新的合法补查可再产生查询。

新增查询向量等待上限初始1500ms，超时／失败走词法检索，不把故事暂停。后台索引与压缩远程请求单次上限120秒，失败记待办，最早5分钟后重试；后台错误与 runtime.lastError 分开。

确定 key／明确别名优先。其余词法与向量候选使用排名融合，初始 RRF 常数60，两路各取前24候选，最终上限仍为12细节、12短期、8长期／常驻经历。近期原文最多30条。

向量相关性下限不凭空使用统一常数。实施时用标注正反例标定：在所有观察到的相似度切分点中，选验证集 F1 最高的阈值，同分取较高阈值；单独记录事实／经历阈值、模型及模板签名。未完成标定前 semantic-only 召回不开启，已实现的确定／词法入口继续可用。不能照搬表情包“无阈值必取一个”。

预算初始沿用草案8000可见字符及3000／2500／1000／1500分块，空余份额可借用，当前来源与状态不裁。整理只构造自身需要的相关事件／细节／长期，保留独立预算。

## 7. 维护不遮挡聊天：宿主可见规则

### 7.1 两种执行槽

**前台槽只有一个**：旧轮恢复、环境轮、普通／共同／预约／自主等故事轮，继续按原 Scheduler 规则串行。输入立即落库，仍在15秒静默窗口的新输入按原截止闭合。

**后台准备槽最多一个**：memory_consolidation 或索引网络任务二选一。快照只在前台空闲且没有 openBatch 时选取；remote Promise 启动后不挂在 SerialHost.active 上，不占住前台槽。新的输入不取消已经在途的准备，减少无效调用，但阻止继续启动下一批。

后台完成回调只保存 job.result／ready 或派生结果待办并请求 host.wake，不应用正式记忆。全部共享内存计数保存在任务实例中；不能因同时请求两个任务而覆盖 ModelClient 的 repair／lookup 状态。

### 7.2 每次 pump 的顺序

```text
1. closeReady(now)，即使 paused 也先正常合批。
2. paused/stopped：不启动或应用新的维护，不开故事轮。
3. 有需恢复的旧故事：按原阶段续办；结束后重新扫描。
4. collectReady(now) 有到期环境/故事轮：运行一个，结束后重新扫描。
5. 有 openBatch：保持静默截止；不启动新维护或提交维护结果。
6. 无上述前台工作：最多提交一个就绪维护单元；await setImmediate 让出事件循环，然后重新从1扫描。
7. 仍空闲且后台槽空：启动一个合格后台准备批次，不等待它结束。
8. 没有可做的本地工作：退出 pump，安排一个下次定时器。
```

第4步保留原世界→学校→合并故事的内部顺序；维护不能偷偷插在一个已有到期环境轮前。第6步应用一个单元后必须真正让出事件循环并重新扫描，不能在 for 循环内一次提交整个月积压。此处使用 node:timers/promises 的 setImmediate；仅 await 已完成 Promise 或连续微任务不能保证输入 I/O／定时器获得执行机会。

即使维护模型请求一直在途，新闭合输入也能执行第4步。正常聊天仍可能等待旧故事自身完成，这属于原串行语义；不能把后台维护变成新的“旧故事”。

### 7.3 批次、让步与积压

- 每批最多20个事件／候选，输入快照目标上限12000可见字符；超过时减少本批数量，不裁掉选中事件的必需来源。单条超过目标时独占一批并记录超额，不因无法装入常规批次永久遗漏。
- 一批模型结果拆成不重叠的应用单元。每个单元一个小同步事务；每次调度扫描最多一个单元，随后让出事件循环并重新检查前台。
- 有 openBatch／ready turn／未完成故事时，不启动下一批、不应用当前 ready 单元；已经运行的远程计算可以完成并等待。
- ready 单元优先于新维护准备。日常用户持续聊天时允许维护积压，不通过抢占故事来强行清空。
- 04:30 标记当天维护到期；扫描捕获 cutoff 并保存。批次只消化该 cutoff 范围，完成后推进 nextMaintenanceAt；新到期内容进入下一维护周期。启动错过则恢复未办周期，不补造每天的生活。
- 后台槽在途时，不把已到期维护时间反复作为“现在”定时器；由前台截止、结果通知、retryAt 驱动下一次 wake，避免0ms空转。
- 纯索引提交是派生写入，也在空闲 pump 中限量处理；无就绪向量的当前事实始终可用词法入口。
- 新后台准备从符合 retryAt 的压缩／索引待办中按 createdAt、jobId 选最早项，避免同类积压无限推迟另一类。模型常驻候选与短期压缩共用压缩入口，不另开网络槽。

### 7.4 版本冲突

每个维护单元保存 readSet 的 ownerId／stateVersion，包括会影响该单元的相关事实。事务应用前核对当前版本。

未变：按单元应用、登记新索引、记录 appliedUnitKey，同事务完成。已变：不覆盖新正文／计数，单元标 stale；仍符合到期或候选条件则重新排准备，不符合则跳过。只作废冲突单元，不丢掉本批其他有效单元。

程序在应用时计算合并计数／期限，不使用模型快照中的旧计数作覆盖值。stateVersion 与 readSet 校验仍保留，避免依据旧事实提炼常驻认识。

### 7.5 暂停、失败与退出

hdsi.pause 阻止新后台准备和 ready 应用。在途远程计算可完成、保存 ready，正式应用等待 resume；前台已运行故事按原行为完成。

压缩失败不设置全局 paused，不发送故事 error，不清掉 preview。维护状态与最近错误加入 hdsi.status，不新增控制命令；resume 可促使符合 retryAt 的任务重新扫描。

stop 不再启动后台，AbortSignal 取消后台 HTTP，等待后台收尾后再关 SQLite。前台旧 stop 语义保留。所有回调检查实例仍有效，不能在 dispose 关闭库后写入。

## 8. 存储、恢复与迁移

新增业务表：memory_awakenings、memory_retention_grants、learned_background；新增派生／辅助表：memory_index、memory_index_jobs、memory_maintenance_jobs。继续单个 SQLite／WAL／FULL，同步事务无网络 await。

maintenance job 保存 jobId、cutoff、输入快照、readSet、状态 pending/computing/ready/done、模型结果、appliedUnitKeys／staleUnitKeys、retryAt／lastError。模型结果先保存，正式单元变更与应用标记同事务。index job 保存 owner版本／配置签名，向量返回前正文更新时丢弃旧结果。

恢复顺序以第7节为准：旧故事优先；维护 computing 因进程退出失去的请求退回 pending，ready 复用已存结果，applied 单元跳过；前台有工作就让位。索引 computing 退回 pending，不重发故事、不重加唤醒。

升级前要求服务停止且没有未完成 V0.2 故事；若存在，先用 V0.2 完成该旧轮再升级，不拿新合同解析旧冻结稿。当前尚未启动正式故事，不预计有此升级阻碍，但迁移检查仍给出明确原因而不修改旧轮。

迁移为一个有版本标记的事务：旧主键／来源保留，revision/stateVersion=1，短期按 createdAt+7天补窗口，legacyMentions 固定保存，不继续维护；新唤醒计数0。旧长期给予迁移时刻起的一次90天观察期并保存 migration grant。旧短期只有摘要时将其作为预备摘要，不编造详细过程／感受。

迁移按正式正文登记索引待办，不等待向量全建完才能运行；同一迁移标记再次执行无副作用。重建索引不动期限和唤醒。

核心背景拆分另生成可审阅摘录与细节初始化差异，不覆盖作者原文件；切换前核对核心摘录没有与 details 重复生效的可变旧值。

## 9. 文件职责与接口

| 文件 | 职责 |
| --- | --- |
| src/memory/types.ts | V0.3 业务、检索权限、job/readSet 类型；src/types.ts 引用共享类型 |
| src/memory/store.ts | SQL 按种类／状态／日期／版本筛选，计数、grants、job 与迁移方法；Storage 提供有限 prepare／query 支持 |
| src/memory/lifecycle.ts | 来源验证后的日期去重、三次续期、归档／恢复、合并期限与常驻候选登记 |
| src/memory/retrieval.ts | 权限、词法／向量融合、配额及预算；context.ts 保留原文与调用适配 |
| src/memory/index.ts | 索引版本、归一化、float32 编码、进程内查询缓存、索引待办 |
| src/embedding.ts、src/output/stickers.ts | 提取并复用现有 EmbeddingProvider／HttpEmbeddingProvider，增加可选 signal；表情包导入与选择行为保留 |
| src/memory/maintenance.ts | 快照、remote准备、readSet校验、逐单元应用与重试 |
| src/memory/organize.ts | 每轮 memory 输入／输出与段 B 应用，不能自行应用后台结果 |
| src/model/contracts.ts、prompts.ts | 新 memory 与 memory_consolidation 合同／提示，补查权限与修补 |
| src/model/client.ts | 每次调用独立 lookup／AbortSignal；网络调用与同步事务分开 |
| src/host/runtime.ts、scheduler.ts | 前台优先、一次后台槽、单元后复扫、定时与暂停／恢复 |
| src/settings.ts、config.ts、index.ts | 独立 memoryEmbedding、consolidation 模型、配置与装配 |
| scripts/migrate-memory.ts、check-memory-retrieval.ts | 离线迁移／索引准备与标注召回验证 |

关键接口约定：

```ts
// 类型定义具体放 src/memory/types.ts；以下是实施接口，不是现有API。
MemoryStore.migrate(now: string): void;
MemoryStore.selectCandidates(request: RetrievalRequest): MemoryCandidate[];
MemoryLifecycle.awaken(input: AwakeningInput): void; // 仅在调用者正式事务内
MemoryRetrieval.build(request: RetrievalRequest): Promise<RetrievedContext>;
MemoryIndex.query(text: string, signal?: AbortSignal): Promise<Float32Array | null>;
MemoryIndex.prepare(job: IndexJob, signal: AbortSignal): Promise<IndexResult>;
MemoryMaintenance.applyOneReady(now: string): 'applied' | 'stale' | 'none';
MemoryMaintenance.startOne(now: string): boolean; // 非阻塞，只启动准备
MemoryMaintenance.nextDeadline(now: string): string | null;
MemoryMaintenance.stop(): Promise<void>;
```

selectCandidates 的 SQL 仅筛有效 owner 与就绪版本；尚无向量的词法候选也要返回，不能因未建索引忘掉新事实。MemoryMaintenance 统一管理压缩与 Index.prepare 的后台槽；Index.prepare 只返回派生结果，由协调器保存 ready、空闲时校验并提交。

新的 ModelRunOptions 可提供 signal 和本次 lookup；不能把不同任务的权限写入共享可变字段。lookup=null 表示明确禁用补查，维护调用使用这一值，只根据快照计算，保证 readSet 完整；未传 options 才兼容旧调用。接口和类型字段见执行计划第一项。

生产装配不再传共享的默认 lookup 回调。每个允许补查的前台调用携带本阶段权限闭包；未需要补查的调用传 null。世界／学校缺少可见聊天依据时只允许当前事实，不开放经历归档／细节历史。兼容旧默认回调只用于旧API调用路径，不承担新生产权限。

## 10. 配置、验收与文档

初始参数：shortDays=7、longDays=90、renewAfter=3、durableAfter=30、每日最多一次；maintenanceTime=04:30、batchItems=20、batchCharacters=12000、backgroundConcurrency=1；queryTimeoutMs=1500、backgroundTimeoutMs=120000、retryDelayMs=300000；缓存256／600000ms。

memory_consolidation 单独配置 DeepSeek Flash／high，原 memory 仍 Flash／high，其他任务原配置保留。新增任务后模型总数更新为11项（原十项加压缩），不得偷偷使用统一模型设置。

验收必须证明以下可见行为，而不仅检查源码是否有分支：

1. 阻住后台模型 Promise，新输入仍15秒闭合并能发送／完成前台轮，不需要先释放该 Promise。
2. 一个ready批次有多个应用单元；第一个后产生到期前台轮，第二个必须等前台轮完成，且openBatch截止不被重置。
3. 后台计算期间前台更新同记忆，旧结果不能覆盖；其他有效单元仍能提交，冲突内容重新准备。
4. 七天到期维护被阻住，简要preview仍可查到，详细短期退出；索引失败保留词法召回。
5. 文件重开ready复用、单元标记同事务回滚、一次日期唤醒与一次候选登记不重复。
6. 三次跨日续期、同日多轮不加、合并日期并集、归档激活与durable无期限；查询本身不写次数。
7. 暂停无新维护／无0ms空转，退出取消后台、不写已关闭库；来源／归档权限不能泄漏未看输入。
8. 10,000条候选及三／六个月样本验证检索耗时、输入长度、召回和误召；供应商真实延迟另行记录，不用离线假网络声称实机通过。

实施完成后同步 MEMORY、INTERFACES、IMPLEMENTATION、RECOVERY、LIFE、README、DOCUMENT_AUDIT、IMPLEMENTATION_LOG，保留原审核快照。构建、完整离线测试、真实Koishi离线加载及.cmd --check为交付检查，正式服务仍由用户运行。

本次只形成细化与执行计划；尚未进行上述测试、迁移、在线调用或程序修改。
