# 提示词与上下文优化 V0.1 实施细化

日期：2026-10-08；本次整合：2026-10-09。设计源码基线 `6ed66e2`，首批实施起点 `f891c48`；补充实施参考基线 `177561e`。状态：任务1～12为已交付历史；REVIEW22／23与新活动窗口规则已整合，任务13～20待实施，当前程序仍为旧混合窗口，尚未启用普通聊天独立索引。

实施参考**本文＋[执行计划](PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md)**。[方案](PROMPT_CONTEXT_OPTIMIZATION_V0.1_PROPOSAL_20261008.md)、[REVIEW20](../DSH-review/DSH_REVIEW20_PROMPT_CONTEXT_V0.1_20261008.md)及[已确认回应（含后续补充）](../DSH-review/CODEX_REBUTTAL_PROMPT_CONTEXT_V0.1_20261008.md)用于追溯，其已同意的规则在本文集中落实，无需实施者另行拼接。

[REVIEW21](../DSH-review/DSH_REVIEW21_PROMPT_CONTEXT_V0.1_PLAN_20261008.md)已按用户决定合并，逐项口径见§12；不再另建rebuttal。无必需通知时即使有冲突也不额外调用周模型，采用B，冲突由程序保留，角色在已知安排基础上自行选择。

[交付回应](../DSH-review/CODEX_REBUTTAL_PROMPT_CONTEXT_V0.1_DELIVERY_20261008.md)及[REVIEW23](../DSH-review/DSH_REVIEW23_PROMPT_CONTEXT_V0.1_SUPPLEMENT_20261008.md)已整合至§13～14，不再新建rebuttal。**本次实施直接参考本文及执行计划任务13～20。§3～4及§9保留版本1的交付／恢复合同；新的普通窗口以§13为准，不继续使用活动保持或活动结束加15分钟的旧规则。** 既有记录和已完成复选框不代表新增规则已经实现。

## 1. 范围与不变的业务规则

采用方案B，分两批。第一批完成确定去重、最近4个对话段、程序权限分支、轻量模型资料视图、无用途查询embedding免调用、无新来源时基础提取空结果及错误可观测性。第二批完成表达专用上下文、背景审阅拆分、世界学校资料投影及学校周计划机械输出移交；第二批单独验收，不与第一批一起混改。

- 不新增生成模型阶段，不合并主叙事、个人导演、表达和记忆提取，不用额外LLM概括总上下文。
- 不增加人为字符／token预算，检索条数上限继续默认不限；相关性、权限、最近原文窗口继续有效。
- 默认最近4个普通对话段，当前普通段计入4段之内；普通交互空闲15分钟划段。共同活动整体不占名额，进行中提供本场完整已授权原文，结束后统一检索记忆，允许一场多条短期记忆。共同活动60秒推进、约10轮收尾、最多20轮及既有代写权限不变。
- 短期7天、长期90天及既有唤醒／晋升制度不变；容量目标短期100、长期1000、归档500不变。基础提取仍按故事轮，深度整理仍按现有独立15分钟门禁。
- 超限报错，不自动减少段数、裁条目、摘要或跳轮；按用户最新决定，**不增加强制关段／清空／手动脱困命令**。恢复原轮可能再次报错，不保证等待15分钟即可解决。
- 所有任务保留原模型配置键及思考强度，默认flash仍允许改pro。`memory_audit`仍使用`memory_consolidation`连接；不重新选模型。
- 普通主叙事不能看本轮未读私聊；学校客观资料、已交付通知、角色真正已知资料继续分开。

实现沿现有TypeScript、Zod、SQLite JSON行及单串行Host，不新增运行依赖。

## 2. 模块与接口分工

| 文件 | 责任 |
| --- | --- |
| 新 `src/dialogue/types.ts`、`store.ts`、`episodes.ts` | 段、活动关联、事务内归属、关闭判定与按阶段选择近期原文 |
| 新 `src/deployment/dialogue-upgrade.ts`、`scripts/migrate-dialogue.ts` | 只读检查、停服备份、一次性回建、版本门禁 |
| 新 `src/model/context-types.ts`、`context-views.ts`、`resource-pool.ts` | 明确模型DTO、阶段投影及同一请求的身份去重 |
| 新 `src/model/prompt-policy.ts` | 任务适用规则及冻结条件；实际能力由Client每次续调用计算 |
| `src/types.ts`、`storage.ts`、`settings.ts`、`config.ts` | 索引表、Runtime／Message／Turn字段和配置兼容 |
| `src/app.ts`、`recovery.ts`、`host/input.ts`、`host/shared.ts`、`host/runtime.ts` | 归属接入、在途保持、发送确认、活动起止、状态提示 |
| `src/memory/context.ts`、`retrieval.ts`、`organize.ts`、`maintenance.ts` | 段窗口、查询免调用、提取来源门禁、维护轻量视图 |
| `src/model/client.ts`、`contracts.ts`、`prompts.ts`、`src/web/types.ts` | 最终HTTP资料去重、提示分支、Schema和旧checkpoint兼容 |
| 第二批 `src/deployment/character-background.ts`、`src/output/expression.ts` | 作者设定映射、表达专用资料 |
| 第二批 `src/environment/types.ts`、`runtime.ts`、`src/school/calendar.ts`、`contracts.ts`、`src/directors/school.ts` | 环境资料投影、新旧学校模型候选及机械展开 |

核心接口名称固定如下，实现类型放相应模块，不把`any`当模型合同：

```ts
DialogueEpisodes.acceptMessage(message: Message): string;
DialogueEpisodes.bindTurn(turn: TurnRecord): DialogueTurnBinding;
DialogueEpisodes.confirmOutput(turn: TurnRecord, message: Message): string;
DialogueEpisodes.releaseReply(turnId: string, at: string): void;
DialogueEpisodes.recordActivity(activityId: string, episodeId: string,
  event: 'start' | 'end', at: string): void;
DialogueEpisodes.closeDue(at: string): void;
DialogueEpisodes.nextDeadline(at: string): string | null;
DialogueEpisodes.recent(phase: string, at: string, count: number): DialogueRecent;
DialogueEpisodes.checkConsistency(): DialogueConsistencyReport;

projectOwner(row: MemoryCandidate, purpose: OwnerViewPurpose): ModelOwnerView;
buildStageModelInput(stage: PromptStage, snapshot: StageInputSnapshot): StageModelInput;
buildCompletionEnvelope(request: CompletionRequest): ModelCompletionEnvelope;
buildPromptPolicy(stage: PromptStage, facts: PromptFacts): PromptPolicy;
```

`acceptMessage`等写接口在调用者已有SQLite事务中执行，不自行开启嵌套事务；`closeDue`由Host在一个短事务中调用。`recent`只读，不通过读取历史修改段归属。

共享类型约定：`OwnerViewPurpose='narrative'|'personal'|'expression'|'memory'|'maintenance'`；`PromptStage`覆盖narrative／narrative_shared、三类personal、expression、memory、memory_consolidation／memory_audit、world、三类school及sticker_description。`StageModelInput={contextVersion:1,context,resources,roles}`；`ModelResourcePool`固定messages／tasks／owners／materials四类数组。messages视图保留id、direction、content、receivedAt；tasks保留业务身份、时间、种类、描述和延期／共同关联，不发平台消息ID和无关存储字段。

`PromptFacts`只固定mode、sharedMeta、hasCurrentPublicNarration、contactEligible这些业务事实；`PromptPolicy`保存version=1、stage及上述facts。工具是否可用、lookup是否已用、实际是否带projectionBasis／外部材料由每次请求的能力／资料层判断，不塞进必须不变的业务facts。`ModelCompletionEnvelope`固定input（context＋roles）、resources、lookupResult（引用＋元信息）、repair、webResults（无材料正文的元信息）、webStatus；不用另留一份原始input资料池。

阶段context保留适用的现有业务字段，消息／任务／owner全文替换成roles引用。narrative保留from/at/background/state/events/school；personal保留at/background/state/experiences/events/school及冻结资格；memory保留at/background/experiences/arrangementsAndIntent/school及来源说明；maintenance保留kind/cutoff和预计算候选。environment把原`EnvironmentStepInput.context`内资料投影到新context，并保留stage/batchId/at，不把整份原input再套一层重复context；相应提示字段路径同步。sticker保留图片和专用描述资料。

## 3. 对话段数据与配置（版本1交付基线）

本节索引为旧混合段。新增普通索引及版本2运行门禁见§13.2；配置§3.2继续有效。

### 3.1 持久化字段

新表 `dialogue_episodes`、`dialogue_activity_links`沿现有`id/data`方式保存；消息正文继续只在`messages`。

| 类型 | 字段及口径 |
| --- | --- |
| `DialogueEpisode` | `id`、`openedAt`、`lastInteractionAt`、`status:'open'|'closed'`、`closedAt:string|null`、`closeReason:'idle'|'migration'|null`；现代段由首条真实消息建，不先持久化空段 |
| `DialogueActivityLink` | `id=activityId`、`episodeId`、`status:'active'|'ended'|'legacy_span'`、`startedAt/endedAt:string|null`、`evidenceFrom/evidenceTo:string|null`；新活动保存确认起止；旧推断跨度不能冒充精确起止 |
| `DialogueTurnBinding` | `episodeId:string|null`、`holdReply:boolean`；保存在`TurnRecord.dialogueBinding`，用于本轮相关回复归属和恢复，不代替`sharedMeta` |
| `Message` | 增加`dialogueEpisodeId?:string`；版本1的真实入站和确认出站必须有唯一段归属。旧记录由迁移补齐 |
| `Runtime` | `dialogueContextVersion:1|null`、`activeDialogueEpisodeId:string|null`；现有`memoryIdle`及`sharedClock`各自保留 |
| `DialogueRecent` | `episodeIds:string[]`、`messages:Message[]`；消息按实际时间及稳定消息身份排序，保持同次分段发送的序号顺序 |

`closedAt`为规则成立的逻辑截止（锚点＋15分钟）；实际晚一点运行关闭检查不把这次检查时间伪装成新交互。同刻记录以消息既有身份／outbox序号作稳定决胜，不依赖随机重排。

`nextDeadline`返回当前无回复保持／无活跃共同活动阻挡的段截止；纳入Host已有单timer。到期只做索引关闭事务，不触发主叙事或记忆模型。暂停期间允许这一已满足条件的元数据关闭，但有失败生成／待发送保持的段不越过门禁；不把已到期却被保持的段反复排成零延时唤醒。

`DialogueConsistencyReport`至少包括索引版本、孤立消息ID、重复／失效归属、冲突当前段、未完成轮缺失关联、活动关联问题，并区分`blockingIssues`与`historicalWarnings`。报告默认只给ID和原因，分类依据见§4.3。

### 3.2 配置迁移

在`memory.contextLimits`采用`recentDialogueSegments=4`、`dialogueIdleMinutes=15`，均为正数，段数为整数。`recentMessagesLimit`只作为旧配置解析入口，不参与新运行时截断；解析前兼容器移除该旧字段，记录“旧条数窗口已替换”的诊断。

旧值30不换算成段数。未提供新值时明确使用4／15；显式新值优先。示例、本地配置和测试夹具同步，其他可选预算字段仍默认null。不叠加30条裁剪，不悄悄激活历史预算。

## 4. 计时、事务与恢复（版本1交付／旧在途兼容）

本节记录旧行为；版本2的普通计时、阶段排序、活动完整上下文和保护范围分别由§13.3～13.7替代。版本1已冻结轮的权限及输出恢复仍保留，不重新选用户消息或改代写授权。

### 4.1 分段规则

真实交互锚点是用户发言／`【动作：…】`消息的实际接收时间，或公开文字、动作、旁白、表情的实际发送确认时间；一次回复按最后一项确认更新。草稿、失败／未确认发送、系统提示、后台提取、世界学校更新、无声自主生活不刷新。

普通空闲达到15分钟结束；新消息在截止前延续，达到截止后开启新段。相关回复正在生成／发送时保持原段；最终不回复则解除保持，仍按最后真实输入计时，已满足截止可关闭。**已发送后只剩基础提取的轮，不因未完成后处理继续保持聊天段。**

共同活动确认开始至实际结束保持连续。结束后从`max(lastInteractionAt, endedAt)`再等待15分钟。`【推进】`不建立或刷新对话段、不进入消息池；有效控制由活动连续规则保持，无活动时的系统答复也不算角色对话。`MemoryIdle`仍可记录它为input，两者职责不同。

延期复议不改旧消息时间和归属；旧段已结束时，实际新公开回复可开启新段。无新用户输入的主动公开消息也可开启新段。仅生成无公开结果不创建空段。

### 4.2 原子写入点

| 入口 | 同事务写入 |
| --- | --- |
| `InputBuffer.acceptInput` | 现有去重检查→依据最新状态判段→保存message和段ID→更新段锚点及Runtime当前段。失败全部回滚 |
| `HdsiApp.runTurn`保存轮 | 保存轮及`dialogueBinding`，有相关真实输入／正在进行的共同活动时保持对应段；无声自主／环境作业不为旧段加保持 |
| `freezeTurn` | 依据实际待发送内容确定保持是否进入发送阶段；合法不回复时释放。仅后处理不保持 |
| `sendFrozen`确认事务 | 保存outbox确认、outgoing原文、段归属和锚点，更新本轮binding；需要首次开启主动消息段时也在同一事务建立 |
| 活动开始／结束确认 | 同确认事务保存活动link；结束时刻取实际公开结束项确认，后处理幂等补核，不用较晚记忆提取完成时间刷新 |
| 最后发送完成 | 解除本轮回复保持；后续记忆提取不重加保持 |
| 段到期关闭 | 短事务内重查锚点、binding及活动link。新输入已刷新则不关闭，不使用过时读值 |

生成期间到达的新输入按现有接纳规则落库，不能改变本轮模型权限。消息路由转入／转出共同活动时同步核对段与活动关联；不能复制原文、修改来源身份或跨已结束段重新归属旧复议。

### 4.3 恢复与结构核对

正常启动在接纳新输入和恢复轮之前检查必要索引元数据：唯一归属、引用存在、当前段／活动一致、未完成轮及待发送项关联完整。不读正文来猜“是不是同一段”，不把重启当成重算边界的机会。

未提交事务回滚；重复入站ID不再建段或刷新；已确认outbox不再添加出站记录。未确认发送沿原outbox恢复语义，本次不承诺QQ发送恰好一次。恢复沿已提交binding继续分段回复；共同活动在途或回复生成未结束时不误关段。状态查看不能刷新时钟。

按影响范围区分，而不是按“孤立消息／重复归属”的名称一律降级：

- `blockingIssues`：当前段状态冲突、活动归属冲突、未完成轮／待发送项缺少关联，以及任何影响近期4段、未读输入、延期复议或当前合法来源的未知归属。启动／恢复明确报错，不能通过跳过消息让检查变绿。
- `historicalWarnings`：可以从已保存时间、完成状态和关联证明，问题仅在已完成且处于近期窗口之外的历史，未被待办复议、未完成轮、当前活动或来源引用。记录ID及原因，允许继续处理合法当前状态；原记录不删、不改、不自动合并。无法确认不影响时仍归阻挡项。

现代接纳／确认事务回滚不会留下“消息已提交但段归属未提交”的正常半状态；历史警告不替代§9升级回建，不给缺失索引的新消息一个通用跳过入口。不默认“孤立消息并入最近段”或“重叠段全合并”，不新增自动历史修复后台任务。程序内部`closeDue`和`releaseReply`仍照常运行；不新增QQ强制关段／合并／脱困命令，既有计划中的停服迁移CLI不受此限制。

### 4.4 近期窗口与阶段权限

先按阶段授权，再选最多4个**有该阶段可见原文**的最近段。有可见当前段则当前＋前3；当前只含普通主叙事不可见的未读输入时，不挤掉其第4个历史段，也不把未读输入泄漏进去。个人导演本轮`visible`仍显式授权，不把“段内完整”理解为提前阅读同段全部未读输入。

段候选明确按`lastInteractionAt`升序、`openedAt`升序、`id`字面升序稳定排序，取末4段，以旧→新顺序提供；不是按数据库rowid或随机ID排序。排序不重写时刻，阶段无可见原文的段先排除；段内仍按实际消息时间及同轮输出序号排列。

段内所有已授权原文完整保留，退出窗口不删除messages或记忆。`visible/reconsider/recent`引用同消息ID只展示一次正文，同时保留三种角色标签。旧相关事件走现有记忆检索，本期不新增全旧原文向量检索。

## 5. 阶段模型视图及确定去重

### 5.1 模型输入合同

新增`StageModelInput`使用`contextVersion:1`，由`context`（阶段业务字段）、`resources`（资料池）、`roles`（用途引用）组成。Host的`TurnCandidate`、完整维护snapshot、readSet、版本、可写ID集合继续留在应用侧，不能由精简视图反推事务证据。

资料池包括messages、tasks、owners及阶段本人网页材料；消息用原ID，任务用原ID，owner用类型＋ID＋revision/stateVersion确认身份，网页用materialId。同ID不同版本不合并：Host保留版本映射，模型用不透明`ref`区分，返回业务ID仍经过原任务校验；查到新版本不静默覆盖已展示的旧认识。

`roles`固定为适用子集：`recentIds/visibleIds/reconsiderIds`、`currentActivityMessageIds`、`dueTaskIds/pendingTaskIds`、`detailRefs/shortRefs/longRefs/learnedRefs`、`currentSourceIds`、`sharedPublicOutgoingIds`、`selfReadSources`。`recentIds`在版本2仅指普通聊天；活动用途与来源资格见§13.5～13.6。不适用角色不创建假来源。相同资料有多个角色时正文仍一份。

投影的输入`StageInputSnapshot`按stage形成判别联合，直接消费当前app／organize／maintenance已有资料；`PromptStage`覆盖方案全部任务，审核用`memory_audit`区分提示，但连接名称仍为`memory_consolidation`。内部快照不是HTTP序列化对象。

### 5.2 owner字段白名单

| 用途 | 允许内容 |
| --- | --- |
| 叙事／个人／表达 | `id/kind/ref`、正文或事件／感受摘要、topics、importance、happenedAt/happenedUntil；detail的key/value/aliases/effectiveAt；learned的learnedKind/canonicalMemoryId/projectionBasis及理解依据所需sourceIds |
| 基础提取 | 上述＋sourceIds、short.linkedLongId及合法可更新／可唤醒身份；不让模型判断容量／期限资格 |
| 维护整理／审核 | 语义字段、创建／事件时间、来源、short↔long、learned证据关系、摘要质量；按需保留唤醒信息供解释。可用动作、修复对、晋升候选由Host预计算 |

`normalizedVector`永不发送。纯存储／容量字段、索引状态、整理标记、空后台字段不默认出现在普通视图。维护Host仍保存全部原字段并在应用时校验；模型选择readOwners，程序由原snapshot还原完整OwnerVersion和隐含依赖，不把精简DTO作为新的readSet。

detail的content与value确定相同时只给value；long.content确定等于eventSummary＋feelingSummary时只展示摘要，否则保留额外正文。短／长期／常驻虽有共同来源但职责不同，不按语义相似删掉一个。

### 5.3 各阶段范围

- 主叙事去掉顶层recent副本；shared视图保留上轮公开节点、本轮publicNarration的不同语义，不用旧节点替代null。轮号、phase、outline等只给一份权威共享字段。
- 个人导演任务正文只给一份＋due引用；可见／复议／近期消息单一资料池。第一批保留当前有效背景与表达资料量作为基线。
- 基础提取以实际确认outgoing为共享公开依据；代写说明引用这些ID，不再次嵌旁白全文。内部经历仍是独立合法来源，不能只因与公开旁白相似而删掉。
- 本人网页材料按materialId唯一，selfRead来源保留其原sourceId、时间、run/operation/material关联；不创造替代来源ID。网页查阅可以生成short，但不能凭此新增detail／唤醒long。
- 维护不再直接把完整持久化owner序列化；selectedIds、cutoff、promotionEligibleIds、summaryRepairPairs及只读依赖身份仍明确提供。
- 看图仍保持图片内容，连通探针不附正式背景；旧兼容入口／demo／验收脚本同步合同，不能只改生产app而让工具暗中走旧30条路径。

## 6. Client与Transport统一去重、提示分支

### 6.1 每次HTTP完整且独立

`buildCompletionEnvelope`是纯函数：对stage input、原始lookupResult和累计网页结果作只读投影，合并已授权资源，输出一份`resources`；业务context和lookup元信息用引用。不改原checkpoint／工具response／供应商缓存结构。

网页所有可用正文每次请求各一份，`webResults`改为materialIds及原计数、失败、请求／取得页数、“结果不足”、停止原因。续请求不能只发新材料。本人网页输入和公共网页集合重叠也在最终HTTP层按materialId去重。

lookup返回新资料合并到本次模型池；应用侧仍在原路径追加可写／唤醒ID。相同ID＋版本去重，不同版本保持区别。旧checkpoint内完整materials不直接再次序列化。修补保留待修响应和错误，不能为追求正文出现次数删掉原响应中必要文字；“正文一份”验收针对资料池，待修响应原样证据单独标识。

lookup业务context的确定去重见§13.8：只对白名单内完全相同的块作引用，不能整体丢掉同名字段或新增版本；不对不同ID消息做全局文本去重。

图片入口同步适配新视图：Transport从stage context取得imageDataUrl，生成现有image_url内容块，并在HTTP文本的只读副本中移除data URL；不能因原检测只找input顶层字段而丢图片，也不把base64同时再发进JSON。旧图片工具输入沿兼容路径处理；日志只记图片数量，不记data URL。

### 6.2 程序条件与模型判断

`PromptPolicy`记录stage、mode、共享代写权限、首节点／phase、共同结束资格、主动联系资格、可解释资料类型。每次`runModel`入口固定业务条件；修补／本地补查／网页续请求复用，不因新消息改变。共同权限继续从`turn.sharedMeta`恢复。

完整未发送候选按既有`discardUnattempted`重建时，可重新生成适用阶段数据；不能把它当作原HTTP续请求，不能重算本轮选定用户集合／共享代写授权。已确认输出不重新生成。旧web checkpoint保留已确认工具进度与计数，兼容投影不清空额度。

| 条件 | 提示／Schema固定分支 |
| --- | --- |
| shared代写 | 只给允许或禁止块；保留“不新增用户台词、心理、重大选择”等已确认约束 |
| 首节点＋final | 两块可同时生效，不用互斥if漏掉公开开场／公开收尾 |
| wrap_up | 延续原字符串集合只减不增校验；goal／endingCondition含义仍需模型遵守和真实验收 |
| shared结束 | final必须end；没有本轮非空公开旁白不允许end；有旁白只是结构资格，不证明语义已经收尾 |
| contactEligible=false | `personalTask`增加options参数，life Schema只接受`contact:{willing:false}`；Host发送门禁保留 |
| contactEligible=true | 保留true／false选择，不变成强制主动联系 |
| 本地补查已用／禁用 | 不给lookup Schema或使用邀请；业务规则仍要求未知时不编造确定事实 |
| web未配置／额度耗尽 | 不给调用Schema或邀请；已有外部资料仍附来源规则，“结果不足”可保留未知，个人导演可自然询问 |

提示拆为基础协议、职责、冻结业务块、实际能力块和适用语义规则。Client每次续调用只重算实际tools能力，不重算冻结业务权限。projectionBasis说明只给有相应资料的阶段，表达只润色规则只给expression，活动字段说明只给会输出该状态的任务；其他阶段仍保留外部资料非亲历等适用边界。

当前生产默认json_object，保留提示Schema；prompt模式也保留。json_schema模式仅在已有兼容验证成立时由response_format携带Schema、system保留短JSON要求，不自动切换模式。

## 7. 可免调用的工作与维护机械字段

### 7.1 查询embedding

在请求向量**之前**检查：index可用、query有有效内容、semantic阈值有效且configSignature匹配、存在可能进入语义路的兼容向量候选。不合格则不调用`MemoryIndex.query`，仍运行现有直接事实／词法／alwaysInclude路线。不更改后台索引生成或表情包embedding用途。

记录`semanticSkipped`及原因；主动跳过不计为远程失败／超时，也不伪造“请求后词法降级”。合格路线保留缓存、超时及失败词法fallback。阈值为null的当前正式配置应得到查询远程请求为0，不宣称此时已有语义召回收益。

### 7.2 基础提取

在检索和模型请求之前取得本轮完整合法来源：经历、首次可见用户消息、实际确认outgoing、personal_life本人selfRead。四类全部为空才返回原SchemaVersion3合法空结果；旧复议、检索资料、计划、outline不是新来源。共同活动双方无台词但有经历／公开旁白时不能跳过。

来源门禁不改变段B事务、应用记账或后处理完成标志；有任一合法来源则仍交模型判断值得记什么。空结果不得被标为一次模型调用。

### 7.3 维护的canonicalShortId

模型仍选同事件成员、生成摘要与证据；程序从合法成员中按createdAt升序，再以ID字面序选canonicalShortId。新模型候选Schema不要求它抄该字段，parse后补成原`MaintenanceUnit`，Host应用合同不变。旧候选若携带此字段仍校验一致，不能接受不一致值后静默覆盖。

已有ready MaintenanceUnit直接应用原结果；完整snapshot和隐含依赖继续保留，归档必须真实重谈恢复后才可晋升。修复缺摘要、保护／清理和迟到结果规则不改变。

## 8. 错误可观测性

扩展`ModelRequestError`结构信息：taskName、httpStatus、providerCode及`kind:'context_limit'|'request'`。只对已核实的明确容量错误码／消息认定context_limit；不把所有400或网络错误当超限。

前台捕获保存结构化`Runtime.lastFailure`（kind、task、generation/sending/postprocessing、时间和安全摘要），原lastError继续兼容。`hdsi.status`分别显示前台失败与后台维护错误。用户系统通知表明失败阶段及暂停，未确认失败原因不编造“上下文太长”；不附输入正文或密钥。

保持原未完成轮、已确认输出及显式resume，不自动恢复或减载。模拟接口超限验证上述状态；另验证后处理失败时已发剧情仍保留。环境步骤的独立retry制度和维护后台隔离不改成前台一律暂停。

## 9. 升级与旧恢复数据（版本1基线；本次升级见§13.9）

新库直接初始化dialogue版本1。旧库启动只检查版本，缺失时要求显式升级，不由Storage构造器偷偷回建。

计划CLI：`npm run dialogue:migrate -- --database <path> --check`只读；`--apply --stopped --backup-dir <path>`先备份DB/WAL/SHM再事务回建。回建普通段依真实时间、出站确认、可靠消息活动ID／turn证据；同一已知活动跨度覆盖15分钟切点。只在有证据限定范围内保守合并；不把所有未知历史合成一段，不编造旧精确起止。

先输出消息计数、可确定活动、模糊边界、在途关联和是否可应用；安全确定的部分按固定算法，无法为活跃活动／未完成轮可靠绑定时拒绝apply并保留报告。已有明确现代元数据可接续，不能仅因存在未完成轮一律拒绝。迁移不改消息ID、receivedAt、正文、seenTurnId、记忆或已确认outbox。再次apply幂等；dry-run不得写库／建表／建备份。

旧web checkpoint不加硬失效：历史toolResults完整材料经§6模型层投影，同run进度／计数继续；旧Maintenance ready结果不重新解析。普通未发送候选沿原重建路径适配新视图，已冻结且部分确认的候选只继续发送／后处理。

## 10. 第二批的细化合同

### 10.1 表达

新`buildExpressionView`只消费已选intention/draft/actions、实际输出mode、当前情绪／必要场景、当前对话和近期措辞、style/chatExamples及解释草稿所需事实。删除与表达无关的自主时钟等机械字段。

已有明确引用的事实保留；关系、称呼、否定、约定、时间或代词依赖不确定时保留原阶段检索到的相关资料，不能只按草稿关键词硬删。第一版不增加LLM相关性裁判，也不为了变短减少完整对话段。其收益来自职责投影，不以字符比例替代保真验收。

### 10.2 作者背景

扩展既有候选工具输出core、style、world/school/group身份块、可变facts及段落／key来源映射。每段允许多种用途，必要身份在对应阶段保留；不能因某段含手机就整段删除性格／关系。

正式背景拆分前先交付候选和映射审阅；未确认映射时生产仍用完整作者背景，不能由模型自动改作者设定。启用后已交details负责的事实不再留生产core旧副本；原作者文件保留。迁移只初始化缺失事实，不覆盖运行中已更新的手机等。新增配置`backgroundViewsFile`可选，缺省仍走原backgroundFile；经过审核的配置文件明确各stage内容，不用隐藏自动摘要。

### 10.3 世界学校资料投影

world取worldSetting及活跃世界事件，移除无关学校plans/items；背景映射批准启用后，不默认拿私人全文，必要世界身份按审阅映射提供。映射未启用时，依赖旧background的调用继续原全文回退，不提前自动摘删。campus/group各拿自身持续plans/items及必要身份；group的campusTiming保留安排关联，研究progress按所提供研究taskId归组保留过程／反馈，不凭固定条数截断。Host验证仍使用原记录，不因DTO变小减少可更新对象。

周计划由已提交上游展开，不借机重设计通知、06:00调度、跨日、时区、历史保护或角色是否参加。

### 10.4 周计划：模型只写固定通知文本

新模型候选为：

```ts
interface SchoolWeekTextResult {
  stage: 'school_week';
  noticeTexts: Array<{ key: string; text: string }>;
  weekNotes: Array<{ weekStart: string; conflictNotes: string[] }>;
}
```

从冻结SchoolExpansionInput程序生成全部requiredOccurrences对应instanceChanges、revision及requiredNoticeKeys的声明实体集合；模型每个必需key给一次非空自然正文，不再抄instanceChanges、sourceVersions、entityRefs。输入通知描述给kind、publishAt、channel和程序固定声明实体／必要快照，要求正文不能偷偷宣布其他实体。程序将正文和固定实体映射成现行candidate，继续调用原resolveSchoolWeek及应用时normalize。

**课次通知映射固定如下：**每个描述保留`key`、`sourceItemId`、`occurrenceKey`、kind/publishAt/channel、源条目标题／地点及声明实体。`occurrenceKey`非空时，提供它对应的冻结课次`instanceId`、startsAt/endsAt、status、标题和地点，并标明故事timezone。查找优先使用本次requiredOccurrences生成的预解析实例，再查既有existingInstances；不能用“该条目下一次课”替代精确key。未列入requiredOccurrences的既有课次提醒也必须有相应资料。

有具体occurrence的通知，其声明快照包含目标instance及原规则要求的条目；提醒的最终`instanceId`必须等于该occurrence映射的真实实例ID，不能为null或绑定同课程的另一次。若应用时历史保护把候选重定向到after实例，继续由原normalize同时改实例ID、快照和通知身份；不保留过时引用。条目级issue/change/cancel在现行代码中occurrenceKey为空，按条目资料处理；week_digest声明给定实体集合，不编造一个课次。

适配原candidate时，instance类`entityRefs.entityId`统一使用目标`occurrenceKey`，条目类继续原条目ID；尤其新实例尚未落库，不能把预解析instanceId直接送给只认识requiredOccurrences key／existingInstances的旧校验器。模型描述可提供两种身份帮助解释，最终通知行及payload快照则经resolver保存实际实例ID，随后按原历史保护规范化。

程序校验key、实例及声明快照映射。自然中文是否把星期／时刻／地点说错还需真实通知验收，不能用正文非空或关键词相等冒充语义检查。提示明确publishAt是通知发布时间、startsAt才是活动开始时间，不让模型混用。

**用户已选B：**`requiredNoticeKeys.length===0`时跳过周模型，包括有冲突的情况；仍生成／解析机械实例，保存覆盖、checkedAt及程序检测的冲突。程序可以由目标课次的标题、时间和身份生成直接冲突说明，不需要LLM改写。不能因为跳过调用就丢掉`SchoolWeek.conflictNotes`。

有必需通知时照常调用，weekNotes可空，声明的周必须合法且唯一。转换现行candidate时，任何模型weekNotes只能补充程序冲突，不能用空数组或改写正文抹去程序检测结果；无调用时使用合法空noticeTexts/weekNotes及现有冲突fallback。sourceVersions和checkedAt继续程序保存。有必需通知绝不能因hash未变跳过。

冲突记录不新增学校通知、不让角色提前知道安排，也不自动取消课程或组会。在角色通过既有通知／亲历真正知道两个安排后，由个人导演决定上课、参加组会、向导师请假或协调。请假请求／答复／结果属于模拟生活，按个人导演意图与主叙事经历推进，不能仅因生成了计划就写成已请假成功；不向现实导师发送消息。

新冻结`EnvironmentStepInput.modelContractVersion=1`；缺失视为0。`EnvironmentModelResult`兼容联合新增SchoolWeekTextResult，而不直接删除旧school_week候选类型；按冻结输入版本分派解析，不靠字段猜测版本。旧running/pending且已有inputSnapshot沿版本0原模型合同和checkpoint续跑；新生成版本1用新合同。旧ready是已解析EnvironmentChangeSet，继续直接提交，不作废、不重新调用模型。解析后变更集合同不变；旧代码兼容入口保留到相关在途步骤已结束。

## 11. 验收、日志与交付

执行计划逐任务给测试命令。主要验收包括：同次请求原文一份且来源标签不丢；普通主叙事不泄漏；4段内无30条二次裁剪；超时生成和分段发送不误拆；活动连续；事务回滚／重复接纳／恢复无空洞；超限暂停无减载；lookup／web续请求完整；维护版本／来源校验不弱化；表达及背景保真；学校ready／running分别兼容。

真实模型验收在隔离库，使用已有授权范围内的角色背景和测试剧情，不用正式聊天／图片，不连接QQ。测试流程明确记录授权和实际发送类别；超出既有范围时先呈现具体范围再请求授权。故事、表达和学校通知语义不能仅凭Schema通过认定质量合格。请求默认验收上限300秒，不替生产新增通用超时规则。

实施时创建 `docs/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md`：记录基线、每任务变更、红绿回归、提交、升级报告、调用统计、已知限制和验收结果。默认统计task、分支／提示版本、资料ID和数量、资料去重数、输入字符数及实际HTTP／embedding请求数，不默认落正文或密钥。字符数是观测，不是预算，也不换算未经验证的token／费用。

每批完成后做类型检查、构建、全量回归和差异复核；新增任务有独立验收，不把过去473项通过写成这次已跑。同步现状说明，旧方案保留历史检查事实并加实施状态入口。最终运行HDSI和SnowLuma仍由用户双击已有启动文件。

## 12. REVIEW21整合记录与澄清

| 意见 | 处理及执行位置 |
| --- | --- |
| §2.1 通知课次资料／instanceId | 采纳，§10.4及任务11补冻结课次描述、既有课次fallback、精确实例绑定和真实正文验收。当前条目级change/cancel实际为null，不把“部分变更已有occurrence”写成现行源码事实；非空key统一按具体课次规则处理 |
| §2.2 无通知但有冲突 | 用户明确B，§10.4及任务11：不额外调用，程序冲突永远保留。已有resolveSchoolWeek本来就用input.conflicts兜底，跳过调用不等于冲突丢失 |
| §2.3 旧30条文档同步 | 采纳，任务8加入记忆V0.3与根目录REMAKE说明；已完成历史验收标记保留当时事实并注明已替代，不伪装成过去已经测试4段 |
| §3.1 段排序 | 采纳，§4.4／任务2固定lastInteractionAt、openedAt、id排序 |
| §3.2 硬失败／历史降级 | 收窄后采纳，§4.3／任务3按影响范围分blockingIssues/historicalWarnings；不按记录类别跳过未知的近期、未读、复议或在途消息。正常原子事务回滚不造成已提交孤立消息 |
| §3.3 自动关闭措辞 | 采纳，§4.3明确closeDue／releaseReply保留，不新增QQ操作命令；停服升级CLI仍按计划提供 |

上述内容已成为本文及执行计划的一部分，没有新增待用户决定项。该句描述整合审阅当时状态。任务1～12的历史代码／测试／停服迁移和隔离模型证据见[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)及[验收记录](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)；任务13～20的证据必须另行记录，不能引用旧结果冒充本次通过。正式服务仍未启动。

## 13. 本次补充实施合同：普通四段与活动工作上下文

### 13.1 归属由程序确定

| 内容 | 普通4段 | 活动中 | 活动结束后的普通任务 |
| --- | --- | --- | --- |
| 非活动中的双方真实聊天、普通用户动作输入、实际确认的主动联系 | 计入 | 普通窗口仍可提供 | 普通窗口及相关记忆 |
| 活动期间双方聊天，包括与活动无关的题外话 | 不计入 | 本场完整已授权原文 | 相关记忆；未读／复议另按直接输入处理 |
| 活动中的用户动作、角色动作、公开旁白／代写、公开开始与结束项 | 不计入 | 本场完整已授权原文及进度／outline | 相关记忆 |
| 自主生活的未公开经历 | 不计入 | 本轮职责所需经历／状态 | 相关记忆 |
| 控制【推进】、系统提示／报错、后台作业 | 不计入 | 必要控制状态 | 不作为聊天原文 |

活动归属取现有入站路由的`sharedActivityId`、冻结`turn.sharedMeta`以及已确认的公开start/end变更，不根据内容是否“像活动”或是否带【】让模型判定。活动中聊“我妈刚打电话来”也属活动，不刷新普通锚点；有记忆价值可正常提取。

活动开始前的预约／邀请仍属普通聊天；已确认的公开开场及其后按活动路由接纳的内容属活动。结束项仍属活动，结束后的新输入属普通。生成期间新到达消息沿当时接纳／转移规则；未选择消息不能加入本轮冻结上下文。现有结束转移未读消息的批次路由可改变，但**既有活动归属不因转入普通待处理批次而被清空**。后续补读仍可成为直接输入，不重新归入普通历史。

### 13.2 独立索引、冻结选择与接口

新增`chat_episodes`，只保存普通段的轻量索引，结构沿`DialogueEpisode`，类型名`ChatEpisode`。**不用旧混合段删掉活动正文来冒充普通段。** 消息正文仍在原messages，旧`dialogue_episodes/dialogue_activity_links`保留历史及旧轮恢复，不删除、合并或改写旧段ID。

| 字段 | 目标合同 |
| --- | --- |
| `Runtime.dialogueContextVersion` | 扩为`1\|2\|null`；新库初始化2，现有1库须显式升级；2指普通独立窗口，不是模型DTO版本 |
| `Runtime.activeChatEpisodeId` | 新增`string\|null`；与旧`activeDialogueEpisodeId`分开，不由活动link保持 |
| `Message.chatEpisodeId` | 新增`string\|null`可选兼容字段；现代普通消息必须是有效普通段ID，活动消息明确为null且有可靠活动归属 |
| `TurnRecord.dialogueWindowVersion` | 新轮写2；旧缺失视为1，恢复不静默换窗口或重选已冻结输入 |
| `TurnRecord.chatBinding` | 新增`ChatTurnBinding={episodeId:string\|null,holdReply:boolean}`；只有普通回复可保持普通段；活动轮可合法`null/false` |
| `TurnRecord.activityContext` | 可选`ActivityContextSelection={activityId:string,at:string,messageIds:string[]}`；本轮第一次生成前持久化选择身份，恢复使用同一选择 |
| `ChatRecent` | `{episodeIds:string[],messages:Message[]}`；阶段授权后的普通窗口 |
| `ModelRoles.currentActivityMessageIds` | 新增可选`string[]`；只表示当前活动工作原文，不自动具有新来源资格 |

升级计划同时保存普通索引元数据`chat_index_metadata={id:'chat-index',idleMinutes:number}`，用于报告采用的参数及识别参数变化；不保存密钥／背景，不把元数据写成每次启动自动回建授权。`DialogueStore.chatEpisodes/chatEpisode/saveChatEpisode`只访问新表；旧表访问接口不改名以维持版本1恢复。

新模块`src/dialogue/chat-episodes.ts`、`activity-context.ts`分别负责普通生命周期、活动原文选择。旧`DialogueEpisodes`保留版本1兼容；`Dependencies.chat`接入新服务，生产检索在版本2消费ChatRecent；旧轮显式沿版本1视图恢复。`StageModelInput.contextVersion`继续1，资料池结构不变，不把窗口版本误当学校合同／网页checkpoint版本。

固定接口（写方法仍由调用者持有事务）：

```ts
ChatEpisodes.acceptMessage(message: Message): string | null;
ChatEpisodes.bindTurn(turn: TurnRecord): ChatTurnBinding;
ChatEpisodes.confirmOutput(turn: TurnRecord, message: Message): string | null;
ChatEpisodes.releaseReply(turnId: string, at: string): void;
ChatEpisodes.closeDue(at: string): void;
ChatEpisodes.nextDeadline(at: string): string | null;
ChatEpisodes.recent(phase: string, at: string, count: number,
  visibleIds?: string[]): ChatRecent;
selectActivityContext(storage: Storage, turn: TurnRecord): ActivityContextSelection | null;
activityContextMessages(storage: Storage, selection: ActivityContextSelection,
  stage: PromptStage, visibleIds: string[]): Message[];
checkWindowConsistency(storage: Storage,
  options: { idleMinutes: number; recentSegments: number }): WindowConsistencyReport;
```

`WindowConsistencyReport`固定字段为`version:1|2|null`、`ordinaryAssociationErrors:string[]`（含指针问题）、`activityErrors:string[]`、`legacyInflightErrors:string[]`、`blockingIssues:string[]`、`historicalWarnings:string[]`、`protectedMessageIds:string[]`；默认只输出身份与原因。`selectActivityContext`是只读选择，不自行保存turn；调用者在保存轮的事务内保存选择。没有当前活动返回null，不能从“上次活动”自动取得全文。

### 13.3 普通计时与窗口排序

仅普通真实入站／确认出站更新普通锚点。活动开始、期间任意消息、结束、无声自主生活和基础提取均不刷新、不保持普通段，也不在结束后加15分钟。与普通回复有关的生成／发送保持仍有效，合法不回复或最终确认完成释放；发送失败／暂停保留，显式resume继续，不能自动重试或拆开冻结分段回复。

例：20:00最后普通消息，20:05活动开始，20:40结束。普通段逻辑关闭时间是20:15；20:41普通消息创建新段。**20:15关闭的段仍是普通历史候选，关闭不等于出窗**，仅在更新的合资格普通段超过4个时退出。若活动很短、结束后新普通消息仍在旧普通锚点15分钟内，则可延续旧段；不是每次活动结束都强制另开。

Host单timer加入`chat.nextDeadline`；到期只关索引，不调用模型。活动仍运行时也可关闭普通段；仍被普通回复保持的到期段不排零延时循环。

选择顺序固定：先按普通归属排除活动→按原阶段权限过滤→去掉没有可见普通正文的段→按**该阶段可见普通消息的最近交互时间**、段openedAt、ID字面序排序取末4→旧到新输出完整段。排序值只存在视图，不覆盖持久化lastInteractionAt，不改消息时间／seenTurnId。只有不可见输入的当前段不挤占主叙事历史名额；混合段也不能被不可见的新内容抬高排名。

### 13.4 原子写入与旧轮恢复

| 入口 | 版本2写入规则 |
| --- | --- |
| 接纳入站 | 去重后按已确定路由写message＋活动归属或chatEpisodeId＋普通锚点／Runtime；同事务回滚 |
| 保存新轮 | 写windowVersion=2、chatBinding及activityContext；绑定只取本轮已选普通输入／普通回复，活动不取旧link的episodeId |
| 公开开场／结束确认 | 保持原共享确认事务；记录活动身份，活动正文chatEpisodeId=null；不更新普通锚点。开场确认时释放已转为纯活动输出的普通回复保持，不能让邀请轮的旧普通绑定继续保持整场活动 |
| 确认出站 | outbox确认、outgoing及普通绑定／锚点或活动归属同事务；活动返回null时不能因旧`message.dialogueEpisodeId`条件漏掉起止处理 |
| 输入转入活动 | 只调整现有明确转移的输入；移除其普通索引资格，同事务重算受影响普通段锚点／指针；无普通正文的段删除轻量索引，不删消息，不能残留空候选 |
| 活动结束转入待处理批次 | 保留原活动身份与chatEpisodeId=null；本轮首次可见／复议输入仍明确供模型消费 |
| 最后发送／合法无输出 | 释放普通chatBinding；仅剩后处理不保持，实际发送失败保留 |

版本1未完成轮保留旧dialogueBinding、checkpoint、policy、已确认输出及选择身份。升级时可基于可靠普通输入／输出建立独立chatBinding供新普通索引恢复，旧活动保持不映射为普通保持。旧轮续发仍完成原版本1恢复，同时在同一确认事务记录新普通索引或活动归属；不能用新窗口重新生成已确认输出。无法可靠映射的活跃／在途情况拒绝升级，报告具体身份。版本2新轮不再为所有消息写旧混合段，新一致性检查也不能拿旧“每条消息都有dialogueEpisodeId”的条件误拒绝它们。

### 13.5 活动完整工作上下文

活动轮第一次生成前，从同activityId的已持久化原文及本轮已选输入确定`activityContext`；不得把此前另一场活动、未来到达的新输入、未确认草稿或内部experiences伪装成公开原文。各阶段从固定ID集合按现有授权取可见正文，补查／修补／恢复沿用选择，不重新扩大权限。

shared主叙事、共同个人导演及其表达使用本场完整已授权原文，不限轮数或字符数、不挤普通4段；同时保留当前progress、outline及lastPublicNode等不同语义字段。消息正文只在`resources.messages`出现一次，`currentActivityMessageIds/visibleIds/reconsiderIds/sharedPublicOutgoingIds`允许多标签共指同ID。普通`recentIds`不得夹入活动。世界／学校阶段不因新角色标签获得私人聊天；普通catch-up主叙事仍遵守未读私聊门禁。

本轮确认的新公开收尾／输出可按原路径供表达／基础提取使用，与冻结的历史选择分开标明；不重新抓取生成期间其他输入。即使应用的下一状态已退出shared，**本轮收尾处理所需活动资料继续保留**。下一次普通聊天任务不再自动填整场activityContext；跨结束尚未读到的消息或延期复议仍按本轮直接用途进入，不把整场历史一起重新开放。

### 13.6 活动记忆与召回

继续每轮基础提取，不等待活动结束才记录。模型可把一场活动拆成多条有来源的短期记忆，例如见面／游玩事件、值得记住的细节、情绪反应、结尾约定；不是强制一轮一条，也不强制一场一条总摘要。结束轮正常提取收尾，不额外新增活动总结LLM阶段。

历史活动原文仅提供理解上下文，不能整体追加到`currentSourceIds`或可新增／唤醒集合。新来源仍是本轮经历、首次可见输入、实际确认outgoing和允许的本人网页来源；历史／旧复议／outline不冒充新来源。基础提取失败沿原后处理恢复，不能跳过失败轮直接宣称整场记忆已完成。

活动结束后与其他记忆共用`MemoryRetrieval`相关性、权限、词法／兼容embedding、版本和唤醒规则。没有“活动结束自动alwaysInclude”、没有全旧活动原文检索或常驻全文。活动内真实获知的手机等事实可按既有detail合同更新，不因原文退出普通窗口而禁止记住。短期7天／长期90天／容量100、1000、500及归档先真实重谈恢复后才可晋升保持不变。

### 13.7 一致性保护范围

版本2启动／恢复先检查版本与关联，普通窗口和活动资料不能互相替代。保护范围取**各实际前台阶段可见普通窗口的并集**、当前活动授权原文、未读输入、待复议消息、未完成轮／待发送项及当前合法来源／记忆来源引用；使用实际配置段数，不固定写死4。已关闭段也可能仍在窗口内。

缺归属的消息不能先过滤掉，再以“没有选中”证明不影响。历史警告必须依据可靠身份、已完成状态和每个阶段足够数量的更新合资格普通段，证明它不可能进入当前窗口，且未被上述集合引用；候选不足4或证据不够时按阻挡项。活动归属未知而可能属于当前活动也阻挡。版本2事务产生的新消息缺必要关联是错误，不走历史豁免。

不以全库最新4个混合段cutoff、固定天数或迁移时间替代证明。保留原记录，不自动把孤立消息并入最近段，不重叠合并，不增加历史修复后台任务。

### 13.8 已接受的交付修复

1. **lookup业务块**：在`buildCompletionEnvelope`内对白名单`school/detailHistory`做只读确定去重。完全相同的块保留input.context版本，lookup.context移除该副本并在`lookupResult.contextRefs`记录对应`input.context.<key>`路径；结构比较仅忽略对象键顺序，不忽略数组次序、实体身份／版本或字段差异。不同学校已知快照、新detail版本或补充内容完整提供。其他字段不因同名自动删除；以后扩白名单须有合同和测试。Host原lookup/checkpoint不改。不同消息ID即使正文相同仍保留；修补原响应独立保留。
2. **v0周计划输入**：`buildEnvironmentView`明确展开旧冻结context，实际模型路径为`input.context.sourceItems`等，而非`input.context.context.sourceItems`；保留modelContractVersion=0、原Host快照及checkpoint，旧ready直接提交。
3. **v0程序冲突**：新解析结果的模型weekNotes与程序input.conflicts取确定字符串并集，空数组不能擦除程序冲突；不重解析旧ready、不通过回填改变历史通知。v1继续保留程序`SchoolWeek.conflictNotes`；无通知时用户B选择不变。
4. **保持／失败回归**：发送失败、暂停超过15分钟、显式resume继续同普通绑定；维护及环境失败不设置前台lastFailure；通知含阶段、无正文／key的现有断言写入准确映射，不仅对齐名字。
5. **验收统计**：将仅检查消息ID唯一的`uniqueMessageBodies`改为准确名称`uniqueMessageIds`，另用受控唯一标记验证整份HTTP中的同身份副本；同一Host夹具才可比较前后体量。字符数不作预算、不换算未经核实token／费用。

不修复已撤回的“策略重复／续调用重算业务事实”，不额外增加自动冲突通知、未证实的HTTP状态硬名单或无证据的全表扫描重构。

### 13.9 显式升级与参数

延续`dialogue:migrate`入口，扩展`--target-version 1|2`，本次默认目标2；check报告当前／目标版本、采用的idleMinutes／配置来源、普通／活动消息及段计数、模糊归属、在途映射与canApply。`--config <path>`只读取并归一化所需公开配置项，不为读索引要求加载密钥／模型连接；默认取项目实际配置，未设置值才15。显式`--idle-minutes <value>`优先并在报告显示；check与apply均向同一计划函数传相同参数，不能再从state猜配置，也不修改运行配置。

新增`src/deployment/chat-upgrade.ts`生成目标2计划，由原upgrade入口分派。普通历史只对可确定非活动消息按真实时间和已确认发送划段，不跨活动延长空闲。可靠活动身份优先消息原字段，再核对冻结turn／公开确认；不能凭【】内容或把所有活动跨度内消息一律当活动回填。旧含糊跨度保存证据，不冒充精确起止；影响窗口、当前活动或在途的含糊归属必须阻挡。

从版本1升级保留旧混合索引和旧绑定，新普通表及chatEpisodeId独立建立；尚未迁移库可通过同一检查制定先1后2的确定计划，不执行隐式启动迁移。目标2已完成的库再次apply幂等；不能为了修复旧默认15分钟参数，无条件重做已正确升级库。兼容性签名记录采用的分段参数，参数变化需显式报告，不能再次apply静默回建。

正式apply依旧要求停服、DB/WAL/SHM备份，事务内复核并提交；不改消息ID、正文、receivedAt、seenTurnId、记忆及已确认outbox。SQLite只读check承诺不修改业务数据、不建表／迁移／创建业务备份，不承诺WAL读取绝无旁文件变化。当前仅准备文档，正式库是否有学校running/ready步骤须实施时实际检查，不能用此前故事在途为0推断。

## 14. REVIEW22／23整合与实施入口

| 意见 | 最终处理 | 待实施任务 |
| --- | --- | --- |
| REVIEW22 §5.1 参数来自错误位置 | 采纳；check/apply同参数、实际配置／报告 | 15 |
| §5.2 不可见消息影响窗口排序 | 收窄；保留真实锚点，按阶段可见普通消息排序 | 14、17 |
| §5.3 历史警告保护范围不足 | 采纳；实际窗口／当前活动／来源并集，未知影响阻挡 | 19 |
| §5.4 lookup业务块重复 | 采纳；明确白名单及完全相等引用，不删新版本 | 13 |
| §5.5 失败即释放保持 | 撤回；保留暂停与保持，新增恢复回归 | 16 |
| §5.6 策略重复／重算 | 撤回；原selectedTask链已正确，不重复修复 | 20复核已有断言 |
| §5.7、§5.8 v0路径及冲突 | 采纳；只改投影和新解析，ready不重跑 | 13 |
| §5.10 测试映射／缺失组合 | 现有安全通知断言映射；补后台失败与v1取消／时区／历史提醒 | 13、20 |
| 字符数跨夹具对照 | 撤回不成立比较；统计身份及同夹具真实载荷 | 20 |
| REVIEW23 §4.1 独立普通索引 | 采纳；不能仅过滤旧活动正文 | 14～16 |
| §4.2 活动不保持／刷新普通段 | 采纳；校正“关闭即永久出窗”，关闭仍参与最新4段选择 | 14、16 |
| §4.3 活动期间题外话 | 明确整体活动归属，由程序路由，不作语义拆段 | 16、18 |
| §4.4 currentActivityMessageIds | 采纳；同池多用途，收尾本轮保留、后续普通不再带全文 | 17、18 |

没有新增待用户决定的问题，也不需要下一份rebuttal。本次仅完成细化／计划整合，代码、数据库、模型请求与服务均未在本轮改变。开始实施时顺序执行[执行计划任务13～20](PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md)，过程续写既有实施日志，新增证据与任务1～12历史区分。交付再次审核这两份主文档、增量日志及增量验收记录即可。
