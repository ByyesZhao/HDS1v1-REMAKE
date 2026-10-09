# 世界与学校规划 V0.4 实施细化

日期：2026-10-08。状态：任务1～8实现、场景验收及整分支最终复核完成；终审三项日历修复已通过全量回归。源码起点`690a5ed`，实际迁移／测试及主目录交付见[实施日志](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_LOG_20261008.md)，实际模型选择见[真实验收](WORLD_SCHOOL_PLANNING_V0.4_REAL_STORY_ACCEPTANCE_20261008.md)。设计基线为本地提交 `7da4ace`，审查合并前文档基线为 `ef88904`，保留用于追溯。

实施以本文的字段／时序和[执行计划](WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md)的任务顺序为准。[方案](WORLD_SCHOOL_PLANNING_V0.4_PROPOSAL_20261008.md)说明产品意图；第十一轮[已接受回应](../../dsh-review/CODEX_REBUTTAL_WORLD_SCHOOL_V0.4_20261008.md)、第十二轮[计划审查回应](../../dsh-review/CODEX_REBUTTAL_WORLD_SCHOOL_V0.4_PLAN_20261008.md)及[第十三轮补充](../../dsh-review/DSH_REVIEW13_WORLD_SCHOOL_V0.4_PLAN_SUPPLEMENT_20261008.md)已并入这两份执行依据。审查文件仅供追溯，不再作为需要另行拼接的实施规则；本次合并的时间语义见§5.1、§7。

## 1. 范围与既有边界

每天故事时区06:00启动 `world → school_campus → school_group → school_week`，争取07:00完成。07:00只是目标，不是超时、强制成功或起床门禁。新库先建当前学期／研究安排／本周，再进入每日检查。学校导演构建模拟学校生活，角色自由决定参加、缺席、拒绝或协调；不得执行真实科研。

沿用现有 TypeScript、SQLite JSON 行、Zod、单串行 Host、冻结结果／段B事务及网页工具，不新增依赖或并发环境执行器。不改已有记忆V0.3、普通15秒合批、共同60秒／最多20轮／约10轮收尾、实际前台故事成功后150～210分钟自主重排、代写分支、搜索20成功／40失败等规则。

不增加人为字符、token、检索条数预算；使用时间、归属、关联和角色已知范围选择信息。模型接口实际超限仍报错，不自动删低相关历史重试。新增计划不建立独立Embedding索引，也不受长期记忆90天TTL支配。

本次实现已同步“已实现行为”说明，正式库显式备份升级；隔离模型验收在此前用户授权范围进行，HDSI／SnowLuma仍未启动。逐任务测试、提交、迁移及真实模型选择见记录；合法未读、未知反馈与格式失败分别保留。

## 2. 模块与配置

| 文件 | 责任 |
| --- | --- |
| 新 `src/environment/types.ts`、`store.ts`、`runtime.ts`、`scheduler.ts` | 批次、步骤、冻结、失败隔离、跨日及每日截止。 |
| 新 `src/school/types.ts`、`store.ts`、`calendar.ts`、`contracts.ts`、`notices.ts`、`context.ts`、`progress.ts` | 上游计划、周展开、通知、已知快照、研究来源。 |
| `src/directors/world.ts`、`school.ts` | world适配独立步骤；三个学校模型入口。 |
| `src/types.ts`、`storage.ts`、`settings.ts`、`config.ts` | 核心字段、表注册、解析前兼容、新默认配置。 |
| `src/host/scheduler.ts`、`runtime.ts`、`src/app.ts`、`recovery.ts` | 串行选择、通知合并、故事获知与原子提交。 |
| `src/model/client.ts`、`contracts.ts`、`prompts.ts`、`src/memory/retrieval.ts`、`organize.ts`、`src/web/types.ts`、`store.ts` | 请求错误边界、模型合同、视角、环境查询与独立网页所有者。 |
| 新 `src/deployment/environment-upgrade.ts`、`scripts/migrate-environment.ts` | 只读检查、停服备份、旧环境轮终结、环境版本门禁。 |

新增 `AppConfig.environmentDailyAt: string = '06:00'`、`environmentRetryMs: number = 300000`。HH:mm及正重试间隔按已有配置方式校验。旧 `worldTimes/schoolTimes` 只接受为弃用兼容输入，不驱动定时；正式示例改为新项，旧学校16:00不再运行。批次日期及所有日期计算使用已配置时区，复用 `src/time.ts`，不得用UTC截日期或ISO字符串猜本地周。

模型角色保留world，活动角色表用 `school_campus/school_group/school_week` 替代school。三个学校角色默认Flash、low，分别可改Pro／思考强度；其他角色配置保持原用户选择。

新增 `normalizeSchoolModels(raw: unknown): unknown`，在 `settingsSchema.parse` **之前**运行：仅缺失的新学校键从旧 `models.school` 分别复制；显式新项优先，格式错误不回退；新三项齐全不要求旧school；旧项和必要新项都缺失时报具体任务名。不改原对象，不改配置文件／key.txt，不回退到world或memory。加载顺序为读取→内存补缺→严格解析→读取本地凭据／逐角色连接检查→数据库版本检查→装配Host。可显式写出新配置，但必须另行备份且不得包含密钥；加载器不自动写回。

## 3. 类型与存储

新增表沿用当前Storage的JSON行及事务方式；学校Store不另开事务连接。所有 `ISOTime` 比较用时间工具。程序分配创建ID并冻结，模型用局部 `clientRef` 关联同一结果中的新记录；不得由模型另造数据库主键。

### 3.1 环境批次

```ts
type EnvironmentStage = 'world' | 'school_campus' | 'school_group' | 'school_week';
type EnvironmentBatchStatus = 'active' | 'committed' | 'superseded';
type EnvironmentStepStatus = 'pending' | 'running' | 'ready' | 'committed' | 'superseded';
```

| 类型／表 | 必须字段与语义 |
| --- | --- |
| `EnvironmentBatch`／`environment_batches` | `id, localDate, timezone, scheduledAt, createdAt, reason: daily\|bootstrap\|upgrade, status, closedAt: ISOTime\|null`。同一时区本地日期只有一个批次，ID用时区＋日期的稳定编码；首次建档／升级关联当天批次，不另跑同日晨间链。 |
| `EnvironmentStep`／`environment_steps` | `id, batchId, stage, status, attempt, startedAt, completedAt, retryAt, lastError, inputSnapshot, frozenResult`；可空字段显式null。ID由batchId＋stage确定。`attempt`为模型生成尝试数；已冻结结果只重试提交，不重新生成。 |
| `EnvironmentStepInput` | `stage, batchId, at, context`；context为该职责的JSON输入快照，含已提交上游版本及实际提供网页材料。第一次生成前保存，重启／同一次格式修补沿用；前序步骤未成功不能形成下游输入。 |
| `EnvironmentModelResult` | 按stage区分的模型联合：world有`changes: EnvironmentChange[]`并保留原事件合同；校园／课题组有`planChanges, itemChanges`；周任务有`instanceChanges, noticeCandidates, weekChanges`。学校create用clientRef，update/cancel用原ID＋expectedRevision。候选引用已有ID或本结果clientRef；模型不输出角色状态、记忆、outbox或私人任务修改。 |
| `EnvironmentChangeSet` | 与模型结果同stage及变更集合，但所有clientRef已解析为一次分配的ID，创建对象已补齐程序字段；仅此类型进入步骤frozenResult及应用事务。 |

冻结结果为 `EnvironmentChangeSet`。学校变更带预期原记录／上游源版本，应用校验职责与引用；world沿用既有事件校验。串行执行不引入复杂并发版本仲裁。`ready`表示结果已冻结而非已提交；步骤变更、实例旧通知失效、状态committed在同一事务提交。

Runtime新增 `environmentPlanningVersion: 1|null`、`nextEnvironmentAt: ISOTime|null`。新库初值1；旧库缺项读为null，不能构造器自动升级。`nextEnvironmentAt`只表示下一日期批次入口，当前步骤／retryAt在步骤表读取；每日截止按当地06:00计算，不能按上次完成时间＋24h漂移。当天批次建立后，下一入口为该本地日期的次日06:00；即使05:00首次建档，也不在同日06:00再建第二批次或反复到期。升级后旧 `nextWorldAt/nextSchoolAt`置null，仅保留旧行解码兼容，不再进入选择／deadline。

旧TurnRecord新增可选 `legacyDisposition: 'superseded'`、`closedAt: ISOTime`、`replacementBatchId: string`。新增环境步骤不创建普通TurnRecord；现有前台生命周期保持。统一未完成查询谓词为 `!done && legacyDisposition !== 'superseded'`，仅合法迁移过的旧环境轮可以拥有superseded字段。

### 3.2 学校数据

学校表保留归档历史，不按日期硬删除。`revision`是整条客观记录版本；`deliveryRevision`只在时间、取消、要求或公开通知内容变更时递增。无变化不递增；内部检查备注不导致全套通知重发。

| 类型／表 | 必须字段 |
| --- | --- |
| `SchoolPlan`／`school_plans` | `id, owner: campus\|group, kind: semester\|group, title, startsOn, endsOn: string\|null, summary, revision, status: active\|archived`。学期不能因每日检查被整份替换。 |
| `SchoolPlanItem`／`school_plan_items` | `id, planId, owner, kind: course\|exam\|meeting\|event\|research\|invitation\|holiday\|milestone\|legacy, title, description, location, requirement: required\|optional, issuedAt, timing, noticePolicy, revision, deliveryRevision, status: open\|cancelled\|closed, basis: fiction\|web_reference, sourceUrls`。research另有负责人、交付说明与阶段说明，均属模拟要求。 |
| `SchoolTiming` | 区分once（明确起止时刻）、weekly（生效日期范围及稳定slotKey、weekday 1～7、当地起止HH:mm）、tentative（日期范围／说明）、deadline（明确截止或暂定日期）。weekly只用于重复课程／组会等；research可引用独立里程碑条目。 |
| `SchoolNoticePolicy` | `announceOnIssue=true, announceOnChange=true, reminders[]`；可显式调整。reminder为 `local_days_before` 或 `minutes_before`＋非负offset＋来源 `institution\|personal_reminder`。未知时刻不能展开小时提醒；关闭reminders不等于关闭更正。 |
| `SchoolInstance`／`school_instances` | `id, sourceItemId, sourceRevision, deliveryRevision, occurrenceKey, baseOccurrenceKey?: string, weekStart: string\|null, startsAt, endsAt, sourceSnapshot, status: active\|cancelled\|archived, needsExpansion, legacyEventId: string\|null, cancelledAt?: ISOTime`。cancelledAt为程序记录的实际取消截止，旧行缺项兼容，不要求数据库升级；不改原起止／sourceSnapshot。sourceSnapshot保存实际该版地点／要求／描述，不只指向最新源条目。baseOccurrenceKey记录同一时段／周的基础身份；历史行缺项时沿用occurrenceKey，无需再次升级数据库。 |
| `SchoolNotice`／`school_notices` | `id, sourceItemId: string\|null, instanceId: string\|null, weekStart: string\|null, deliveryRevision, kind: issue\|change\|cancel\|reminder\|week_digest, reminderKey, channel: institution\|personal_reminder, publishAt, releasedAt: ISOTime\|null, payload, status: scheduled\|available\|read\|invalidated, nextWakeAt: ISOTime\|null, readAt: ISOTime\|null, readTurnId: string\|null`。公开措辞由school_week产出，程序解析真实实体引用并冻结版本快照；周摘要可含多条实体。releasedAt记录首次scheduled→available操作，失效后仍保留，用于区分曾发布与仅预排；不证明角色已读。 |
| `SchoolKnowledge`／`school_knowledge` | `id, entityKind: plan_item\|instance, entityId, revision, snapshot, acquiredAt, experienceId, turnId, via: notice\|onsite`。逐次获知保留；查询选该实体最近已获知版本，不直接解引用客观最新值。 |
| `SchoolProgress`／`school_progress` | `id, taskId, kind: progress\|completed\|feedback, experienceId, turnId, happenedAt, summary`。实际已提交经历是必要来源；一次经历／任务／kind幂等。 |
| `SchoolWeek`／`school_weeks` | `id, weekStart, sourceVersions, checkedAt, digestRevision, conflictNotes`；程序对每个input.weekStarts生成完整本轮sourceVersions、checkedAt及公开摘要版本；模型weekChanges可空或补充conflictNotes，显式错误版本／重复周声明仍拒绝。同一来源无变化也更新检查时刻，不复制课次。 |

school_week是实例及通知候选唯一模型写入者；校园／课题组只写自己上游计划和通知策略。程序唯一负责稳定身份、校验、保存、到期发布及旧版本失效。校园不可改课题组任务，周任务不可改上游日期或把建议当成角色已决定的私人计划。

时间字段各有用途：SchoolPlanItem.issuedAt为制度安排的首次下发时刻，可预排未来；SchoolTiming／instance.startsAt、endsAt表示活动或要求生效时间；SchoolNotice.publishAt表示该份通知可交付时刻；releasedAt是程序实际发布操作审计，readAt／SchoolKnowledge.acquiredAt是角色实际获知。已下发条目的改期不能通过把issuedAt挪到未来重新隐藏；未下发草案可调整下发时刻。本版不新增validFrom或独立“下发窗口”配置，不用活动开始时间拦住提前通知。

同一重复课次的基础身份为 `(sourceItemId, slotKey, localWeekStart)`；同一一次性事项用 `(sourceItemId, 'once')`，截止用 `(sourceItemId, 'deadline')`。这些元组用JSON无歧义编码，不拼接描述猜身份。正常课次的occurrenceKey等于基础身份，开始前同一周课次改期保留ID，跨周新实例。已开始实例（startsAt ≤ 实际提交时刻）不覆盖；同一基础时段改为新的未来安排时，程序另建 `JSON.stringify([baseOccurrenceKey, 'after', 最近已开始实例ID])` 的后继实例，并保存baseOccurrenceKey。后继实例开始前再次改期仍保留其ID。冻结输入时尚未开始、返回／ready恢复提交时已开始的候选，仍按冻结输入校验，提交归一化为同规则后继版本，保留旧行并同步重映射通知instanceId、快照实体及提醒ID；不因实际时钟推进反复格式修补。跨开始的取消候选不覆盖已开始历史，采用cancelledAt控制有效投影。原“条目＋本地日期”在此固定为稳定周起点＋时段键，避免日期一改就复制一节课，同时保留已发生历史。

通知ID由 `(source/instance/week identity, kind, reminderKey, deliveryRevision)`确定；相同候选重复提交同一行。weekly摘要以weekStart及digestRevision为身份。不同提醒时距有不同reminderKey，不因同日两次检查再生成新ID。新周摘要提交在同一事务失效同周较旧scheduled／available摘要；read历史不失效。同身份重复应用保留现有发布／已读状态。

reminderKey对提醒由时距类型＋offset＋来源稳定编码，对issue／change／cancel／week_digest分别为固定种类键。默认机构通知／提醒用institution；明确personal_reminder只可基于角色已获知的对应安排版本生成和交付，不能借“自己的提醒”让她提前知道未读课表。未满足已知条件的个人提醒不贡献立即截止，过时则失效；更正机构通知照常可获知。

## 4. 每日链与串行调度

环境模块导出以下接口，使用Storage共享事务；时间参数由Clock传入，不在业务函数中读取真实系统时间：

```ts
ensureEnvironmentBatch(storage: Storage, config: AppConfig, now: ISOTime): EnvironmentBatch | null;
selectEnvironmentStep(storage: Storage, now: ISOTime): EnvironmentStep | null;
environmentDeadline(storage: Storage, now: ISOTime): ISOTime | null;
type EnvironmentGenerator = (input: EnvironmentStepInput) => Promise<EnvironmentModelResult>;
runEnvironmentStep(d: Dependencies, stepId: string, generate: EnvironmentGenerator): Promise<void>;
```

ensure处理bootstrap／每日到期及跨日替代；select只返回active批次第一个尚未成功步骤，pending或到期retry有资格；当前日期ready优先应用冻结变更。deadline只使用未来retry／下一批次或实际可执行步骤，不反复返回已经过期但仍在等前序的下游时间。普通openBatch让位时，即便环境已经到期，也不得贡献now造成空转；等待其readyAt后重新选，暂停／未完成前台门禁同理。

下游资格仅来自全部前序committed；前序pending／running／ready或等待retryAt时，下游不进入选择、不提前冻结输入。retryAt是截止字段，不是额外状态。前序事务提交后Host先让出事件循环、重扫前台与普通openBatch，再选择下一步；不能在一次generateEnvironmentStep中直接串调后续学校模型。

`TurnRequest`新增 `environmentStepId?: string`。Scheduler用此字段选环境工作，trigger仍为environment，但不再用旧environmentKind创建故事。`HdsiApp.runTurn`先守busy／unfinished，再按stepId分流；两条分支共用一个busy槽，环境进入runEnvironmentStep而不进入freezeTurn／发送／故事段B。Dependencies新增 `environmentStore: EnvironmentStore`、`schoolStore: SchoolStore`；两类Store的构造参数均为现有Storage。测试可注入 `generateEnvironment?: EnvironmentGenerator`，生产也显式绑定`input => generateEnvironmentStep(d,input)`；选中步骤却未绑定生成器应明确装配报错，进入既有lastError／paused故障路径，释放busy，由Host报告一次并停止零截止重选，不回落旧school。生产入口及测试setup完成依赖后必须装配，不用隐式关闭功能掩盖资格错误。

Host每完成一个环境步骤让出事件循环并重新选择。选择规则：

1. 既有未完成前台故事、发送、段B先恢复；runtime.paused保留全局人工／前台暂停。
2. Scheduler.collectReady在closeReady及paused／unfinishedTurn门禁后短事务发布到期通知，再读取／选择本轮信息；发布不是故事，不重排自主，不耗模型调用。精确调用点和唯一计时器见§7。
3. 可运行聊天、预约、起床、合法共同节点等前台优先；可读学校通知合并其中。没有现成前台时，符合§7条件可选纯通知轮。
4. 普通openBatch未满15秒，暂不新开环境步骤，等待其截止。共同60秒窗无合法前台则仍可执行环境。
5. 无前台／普通openBatch时，选择当前合格环境步骤；等待未来retry不能压住到期自主。自主及记忆维护继续沿用既有资格与让位规则，环境重试等待不构成unfinishedTurn。

正在进行的一次环境请求仍占串行槽，新输入先落库但可能等它完成；不宣称完全不遮挡聊天。环境不补生活、不更新narratedUntil、角色状态、自主截止或共同轮数。

常见模型传输／响应格式失败：保存lastError、retryAt=失败时刻＋environmentRetryMs，状态回pending，释放busy，不清人工暂停、不向QQ重复报错、不运行下游。`src/model/client.ts`新增 `ModelRequestError`标记请求／HTTP／响应封装错误，与已有ModelFormatError一起构成可重试模型错误；检查点落库、冻结／提交、数据库错误不可被此catch吞掉。非模型存储错误仍进入明确故障／暂停路径。

生成前保存inputSnapshot并标running；修补最多两次。冻结完成后标ready；事务应用后committed。重启running恢复该attempt已存检查点，不递增attempt／不重置修补。终态模型失败后到期retry才新attempt：重置请求修补次数及失败修补提示，保留成功工具结果、lookupUsed、网页计数／审计，不让已耗尽修补的检查点直接再次终态失败，也不重新给网页额度。ready只应用冻结结果。每日后续步骤读最新已提交上游，不读取前一步未提交生成结果。

跨日未完成旧批次标superseded，未提交步骤也标superseded；已提交变更保留。旧批日期以其冻结timezone判断，当前配置时区改变亦替代旧批；新入口按当前配置时区计算，包括上一批已committed后的切换。若返回同日已committed／superseded身份，不重新开步骤或工具额度，下一截止校正至当前配置的次日晨间，不能留下已到期但不可执行的入口。普通日常批次必须到当地06:00才创建：午夜先终结旧批，离线重启在06:00前也将旧到期入口校正至今日06:00。新库bootstrap及显式upgrade允许在06:00前启动／继续，且当天不再重复日常批次。不连续补跑离线每一天，不伪造过去读通知／参加事件。上一日期进行中的请求结束后、应用前再检查日期：已提交部分保留；新返回但尚未提交的旧日结果保留为审计并终结superseded，不应用后再撤销。每日检查不重复当天bootstrap／upgrade已完成链。

## 5. 三个学校模型与周展开

学校入口分别为 `runSchoolCampus`、`runSchoolGroup`、`runSchoolWeek`，参数使用Dependencies＋对应EnvironmentStepInput，返回所属EnvironmentModelResult。统一入口 `generateEnvironmentStep(d: Dependencies, input: EnvironmentStepInput): Promise<EnvironmentModelResult>`按stage分派；生产执行传`input => generateEnvironmentStep(d,input)`。world入口改为同样步骤协议，既有事件合同保留。

校园输入：已知学籍／培养阶段／学院等固定背景、当前学期计划及自己条目、相关世界依据。课题组输入：既有导师／同门／研究方向背景、自己计划、带experienceId的相关研究进展、必要校园时间。周输入：已提交上游、已有实例／覆盖版本、相关明确预约时段；不附完整私聊。不得凭旧正则没选到导师就另造导师。

三个合同在 `src/school/contracts.ts`：`schoolCampusTask`、`schoolGroupTask`、`schoolWeekTask`。create用clientRef，update/cancel引用已有同归属ID与版本；空变更合法。必需结构字段及真实引用校验，研究成果与角色参加不在此输出合同。学期持续沿用，在读研究生可以没有常规课程，不为了课表编满每天。

实际初建合同补充：所属校园／课题组尚无active持续计划时，本次至少建立一个active计划；已有计划后的日常检查可以空变更。计划框架不要求课程条目，也不强制每天新增事件。见实施日志任务7的初建空结果复现。

`src/school/calendar.ts`导出 `schoolExpansionInput(storage: Storage, now: ISOTime, timezone: string): SchoolExpansionInput`：给出本周范围、周五起纳入下周、既存下周需延续的范围、上游确定时段推导出的稳定occurrenceKey，以及远期当前下发／改期／取消项。它是周模型输入，不直接保存候选，不成为第二个通知写入者。

### 5.1 必需展开集合与下发窗口

`SchoolExpansionInput`固定包含 `weekStarts, sourceItems, existingInstances, existingNotices, knownSnapshots, coveredVersions, requiredOccurrences, requiredNoticeKeys, conflicts`。knownSnapshots给出相关SchoolEntitySnapshot，用于识别已通过周摘要／现场获知的条目；只提供学校知识，不附完整私聊。模型填公开措辞、实例／通知候选及可选冲突说明；完整覆盖记录由程序从冻结sourceItems补齐，不可更改上游确切时刻。集合按以下判据生成并校验：

- requiredOccurrences：当前需展开范围内缺失、标needsExpansion、或与最新上游公开日程不符的occurrenceKey。候选expectedRevision取sourceItems对应条目的当前revision，不复制existingInstances的旧sourceRevision；requiredOccurrences本身不携带版本。SchoolWeek.sourceVersions用于检查上游版本覆盖；实际实例身份、版本及日程仍须核对，内部备注改变不触发全套提醒。
- requiredNoticeKeys：按策略应生成且仍有意义的issue／change／cancel／reminder／week_digest完整通知元组身份。已有同身份合法scheduled／available／read行算候选已覆盖；invalidated及旧deliveryRevision不能覆盖新键。只有未来scheduled行不证明已经发布或已知。
- 上游deliveryRevision改变、announceOnChange=true、条目已进入下发窗口，且缺相应本版合法通知时，必须包含change键；取消用cancel键。无失效未读、仅有已读旧通知时同样适用。旧周摘要或现场获知也纳入判断，不能只查单项issue。
- 更正义务延续到相应候选实际提交；周任务失败／跨日后仍从当前版本、策略及通知／知识／覆盖记录恢复，不能仅凭“昨天已失效”或sourceVersions已写覆盖就略过。存在必需键时，空变更或只更新覆盖记录不能通过；同版合法候选已提交则不重建。
- announceOnIssue／announceOnChange默认true，可显式关闭；关闭是上游明确策略，不能由周模型漏项冒充。关闭普通reminders不等于关闭更正，未公开且明确不发布的安排不强造通知。

“已进入下发窗口”固定为 `issuedAt <= now`，或已有实际发布证据（关联通知releasedAt／readAt）、或SchoolKnowledge已经获知该条目／实例。活动／期限离现在多久不参与这个门禁：三个月后截止的任务今天已下发，今天改期仍需更正；不等进入本周／下周才处理。

尚未到issuedAt、未曾发布也未获知的远期草案，不强制立即change／cancel。程序先使旧预排候选失效；仍开放且announceOnIssue=true的条目，未来首次issue采用最新版本，缺本版合法候选时纳入预排必需键，publishAt不早于issuedAt。即使下发时刻落在下一晨间链之前，也能由通知定时器按时发布，不等次日模型检查。其提醒按既有展开范围／策略预排；已取消且未曾公开的草案不再强造首次issue。所有预排都不写成已发布／已知。到下发时刻且仍应通知时，缺失当前版通知仍进入必需集合。临时更正announceOnChange关闭的边界按明确策略处理，不让后台重试随意改变开关。

已预排未来通知的条目需要更新未来候选与身份，但预排本身不迫使当天发布更正。已知／已发布条目的更正可以先说明未来才生效的安排，不用未来活动生效日期延后通知。仅内部revision变化、deliveryRevision不变不产生新更正键。所有required集合为空才允许无变更。

### 5.2 应用与公开版本

school_week校验后由 `applySchoolChanges(storage, changes, now)`统一事务应用：

此函数签名为 `(storage: Storage, changes: EnvironmentChangeSet, now: ISOTime): void`，仅接受三个school stage；world由environment/runtime沿用原事件应用，不调用学校应用。新学校实例是客观日程的规范数据，不再复制一套同内容events；旧school events通过legacyEventId映射读取且去重，旧实例可沿用原event ID维持既有引用。

- 常规只展开本周及已到生成时间的下周；周五生成下周、周一确认。首次周五以前仅本周，但明确预约／直接请求的远期相关事项可以读取。没有变化不重造课程或通知。
- 远期科研任务今天下发，今天的issue通知必须展开；明确远期一次性节点可保留必要实例／定时提醒。不能因本周窗口推迟当前下发通知，也不必因此展开全学期课次。
- 上游更改提交时立即使相关旧scheduled／available通知invalidated、标未来实例needsExpansion；周步骤之后填新实例与更正通知。等待重展开期间，needsExpansion实例不进入主叙事客观投影，也不能成为onsite获知来源；已读旧快照不删、不换最新值，角色旧认识仍可能影响选择，不能将其当作仍有效的客观安排。
- 取消提交时给相关尚未结束active实例记录cancelledAt；客观跨区间投影截止于取消时刻，之后不因同地点继续纳入，onsite的happenedAt不允许达到或越过截止。原起止／sourceSnapshot和旧角色知识不改写；同轮更早onsite获知保存当时原安排，不泄露后来的取消截止。制度取消不强制修改角色行为或直接让角色获知。
- 只有影响公开时间、取消、要求或通知内容的更改提升deliveryRevision；无变化／内部说明不重发。旧实例曾实际发生则保留历史，新未来安排另建相关实例。
- 删除weekly时段、缩短生效范围或改成tentative等导致旧未来课次不再存在时，程序仍将其加入requiredOccurrences，status固定为cancelled；模型必须提交覆盖候选，程序保留旧ID并置cancelled、needsExpansion=false。每个已存未来课次按其自身weekStart核对，不因不在本次常规展开周窗口就遗留“幽灵课次”。RequiredOccurrence的status和基础／后继身份由程序推导，模型不能另选。
- 多个事项时间冲突合法；周任务标冲突、保留客观时间，个人导演决定去哪个。周建议科研空档不是已经研究完成或已经选择执行。

通知默认按timing而非事项kind：once前1本地日＋前120分钟；weekly前60分钟及一次周摘要；明确deadline前1本地日＋前120分钟；tentative／未明确deadline时刻不设提醒。research按自己timing下发及临近明确期限；取消／改期及时更正。策略允许关闭或调整，不强制每项两次。不明确时刻只通知暂定安排，不猜小时。新建时已经错过多个提醒只保留当前有意义的issue／change及未来提醒，不补发一串历史提醒；冻结后请求／pending重试／ready恢复跨过publishAt时，实际应用丢弃尚未入库的过期提醒。此前已入库的有效提醒保留既有延迟发布行为，不因重放移除；已经结束的事项不新造“你早已知道”。

全部安排默认fiction、sourceUrls空。确有本轮提供材料支持的事实才能web_reference；真实校历不能证明模型编出的课程／导师要求，混合内容拆条目。程序检查URL确曾提供，语义支持由提示词和真实验收检查。

## 6. 网页会话与环境检索

`ModelRunRef.ownerType`扩为environment；每步使用ownerId=step.id、stageKey='generation'、taskName=stage。独立学校步骤各自20成功／40失败；同一步修补／续调用／重启恢复复用逻辑会话及模型，不因retry重新给额度。不把四个步骤合为一个池。成功提交／替代后释放缓存占用，保留审计及检查点。阶段输入随inputSnapshot冻结；新的日期步骤是新会话。

跨日superseded保留旧step.id／runId及计数、操作、检查点，不通过改stageKey或重建同身份session清零，旧步骤不恢复生成。次日新step.id是独立调用，仍从0／0取得自己的20／40；不退款旧计数，也不将多日额度合为一个池。

`makeRetrievalRequest`的currentOnly环境判定包含world、旧school兼容及三个新school_*，不意外允许环境读取细节历史／归档私聊。新增environment网页所有者不满足personal_life的自我网页阅读来源条件。模型的学校搜索只构建客观资料，不自动作为角色读过网页的短期记忆来源。

不选择或启用搜索供应商，沿用当前provider缺失时的“结果不足／工具不可用”真实返回；不能伪造联网事实。不把验收工具300秒上限写成正式客户端超时，目前正式请求并没有该默认。

## 7. 通知发布、选择与冻结

在TriggerKind联合中新增 `school_notification`。TurnRequest、TurnRecord、TurnCandidate新增 `schoolNoticeRefs?: SchoolNoticeRef[]`，ref为 `{noticeId, deliveryRevision}`；选轮时冻结可读集合，之后发布的新通知等下一轮。恢复不重新扩展选择，旧记录缺项按[]。

学校通知接口：

```ts
releaseSchoolNotices(storage: Storage, now: ISOTime): void;
selectSchoolNotices(storage: Storage, now: ISOTime): SchoolNoticeRef[];
schoolNoticeDeadline(storage: Storage, now: ISOTime): ISOTime | null;
```

调用点固定为 `Scheduler.collectReady(now): closeReady → paused／unfinishedTurn门禁 → releaseSchoolNotices(storage, now)短事务 → 读取状态／通知 → 选择合法故事并冻结refs`，同一次选择使用同一个now。Host不另建发布入口，直接调用Scheduler的测试也有相同语义。未完成前台先恢复，门禁关闭时不发布／不改其冻结集合；resume后重新扫描。现有closeReady重复不作为本次额外重构。

Scheduler.nextDeadline在原有门禁后合并environmentDeadline、schoolNoticeDeadline及前台截止；Host再与记忆维护截止取最早，由既有armTimer建立唯一计时器。新增deadline计算不发布、不调模型，既有共同节点维护不顺带改造。真正待发布通知到期可以触发一次扫描，已不可读／共同待合并／拒看的通知不得反复贡献过期now。

release只将合法、未失效且 `publishAt <= now` 的scheduled行变available，同时记录首次releasedAt；发布窗尚未到的候选保持scheduled，不偷改为当前时刻。publishAt以§5.1下发规则校验，提醒还须当前仍有意义及满足个人提醒已知条件；过时失效通知不交付。没有validFrom门禁，活动／课程／研究要求未来生效仍可提前通知；下次deadline取真正publishAt。到期发布仍在同一个串行选择点，不增加正在请求中的并发发布线程。

select供已合法故事合并全部相关可获知通知；只有available且nextWakeAt到期、当前可读、非共同模式时才单独唤起通知轮。纯通知运行主叙事后，实际有获知才要求personal_life反应；没有实际获知且无其他个人资格可不调用个人导演。`contactEligible=false`，不抽自主联系。普通消息与预约仍按原个人导演分支，学校通知不改变其身份。

客观版本在上游提交时已经改变；旧已知快照保留的是角色当时的认识，不能称旧日程仍客观有效。新通知发布也不直接更新SchoolKnowledge，必须实际获知并在段B提交。通知内容、客观生效时间和角色知晓时间分别保存，不要求“更正只能晚于旧值失效时刻发布”。

睡眠／洗澡不可读只暂存。deadline组合未来publishAt、可读后必要检查与现有起床／活动预计结束时间；**已发布但不可读的通知不能不断贡献过去的立即截止**。未知结束等已有故事，不新增高频轮询。角色拒看合法：一次纯通知轮成功而未读，令所选未读行nextWakeAt为已知未来活动结束时刻或null；后续可合并既有故事，但不立即又开同样通知轮。再次临近提醒是另一合法通知，不能无限循环同一份。

共同模式只在已合格的scene_step／手动／预约节点合并；通知不新增共同轮、不绕60秒、不另建活动，不算真实用户消息或角色发给用户的新输入，不改变冻结的allowSimulatedUserActions分支。通知若引出真实已发送角色消息，则该发送沿用既有双方消息锚点规则。

仅通知发布不重排自主；实际执行主叙事的前台轮段B成功后沿用原150～210分钟抽样。纯通知轮也补from到at生活。不可读通知不能永久压住到期自主，sleep本身仍按既有资格抑制自主。

## 8. 客观输入、角色知识与研究来源

`SchoolEntitySnapshot`为plan_item／instance判别联合，各含entityId、revision和该版value（SchoolPlanItem或SchoolInstance）。notice.payload含宣告的实体快照集合和公开正文；不能只存最新实体ID。`NarrativeSchoolContext`含objectiveInstances、已发布noticeSnapshots、knownSnapshots、eventIds；`PersonalSchoolContext`含knownSnapshots，来源为旧已知及本轮合法获知，按身份和实际获知时间选版本。该版本选择已由2026-10-09 ASTRA修复替代：仅在实际获知候选中依次比较公开deliveryRevision、记录revision、获知epoch和稳定输入顺序；旧现场快照不得回退已读新计划。历史验收数字保持原记录。接口固定为：

```ts
narrativeSchoolContext(storage: Storage, from: ISOTime, at: ISOTime, scene: Scene): NarrativeSchoolContext;
personalSchoolContext(storage: Storage, observations: SchoolObservationCommit[], query: string): PersonalSchoolContext;
```

明确请求可按直接ID／日期范围读取窗口外已知安排，不以周窗口屏蔽明确请求。这里query与个人检索query保持同源，不把主叙事客观学校描述拼进去。

主叙事允许取得区间／场景相关的未获知客观安排，合同引用白名单与客观输入一致；个人导演、关联引用、lookup、表达及记忆只取得**已知版本＋本轮实际获知**。从events回查新school事件或relatedEventIds不能绕过过滤。一般world事件沿用既有范围；旧school客观事件也纳入学校过滤。个人检索query来自可感知经历／可见消息，不拼入全部客观学校描述。

`NarrativeResult`扩展以下可缺省为空数组字段，原冻结前台结果不因此重生成：

```ts
interface SchoolObservation {
  via: 'notice' | 'onsite'; sourceId: string; experienceIndex: number;
}
interface ResearchProgressDraft {
  taskId: string; kind: 'progress' | 'completed' | 'feedback';
  experienceIndex: number; summary: string;
}
// NarrativeResult新增可选字段；合同解析缺项补[]，兼容历史及普通无学校轮：
// schoolObservations?: SchoolObservation[]; researchProgress?: ResearchProgressDraft[];
```

experienceIndex指本轮原始experiences数组；已有候选构建一次分配experienceId后，转为 `SchoolObservationCommit`（via、sourceId、snapshots: SchoolEntitySnapshot[]、happenedAt、experienceId）及 `SchoolProgressCommit`（taskId、kind、summary、happenedAt、experienceId）。TurnCandidate新增可选 `schoolObservations`、`schoolProgress`，旧候选缺项按[]兼容。知识ID以turnId＋来源＋实体＋版本稳定生成，进展ID以turnId＋experienceId＋taskId＋kind稳定生成，不在段B重试时随机造ID。

notice来源必须在冻结ref集合、已发布、未失效、对应版本且本轮具备读取条件；onsite来源是主叙事相关客观实例，须描述实际现场获知而非仅相关引用。happenedAt取对应经历，位于实际from～at；晚发布安排不能倒插历史已读。提示词要求经历只含实际感知事实，隐藏客观安排留在客观上下文，不能进入experiences。`relatedEventIds`本身不是已读证据，程序也不假装能审核全部自然语言泄漏。

在生成个人输入前校验并形成获知快照，使她能对本轮阅读反应；正式保存仍只在段B。已读周摘要建立其中实际宣告条目的知识快照，不把全部同周隐藏条目一起设已知。更新后旧知识仍旧，直到实际读更正或现场获知。已读信息可按需复用为上下文，但不再次作为新通知／新来源交付。

研究进展draft只能引用角色已知或本轮获知的research task，且有本轮真实模拟经历支持。`completed`记录工作完成，不等于导师验收通过或校园记录关闭；课题组后续可基于进展调整要求。导师反馈先由主叙事实现在experiences再关联feedback，不另造脱离经历的反馈来源。意图、周排程、任务issue通知均不能证明研究完成；模拟结果须符合过去时间，不能几分钟保证完成数日任务。

`PreparedSchoolCommits`固定为 `{observations: SchoolObservationCommit[], progress: SchoolProgressCommit[], visibleSnapshots: SchoolEntitySnapshot[]}`。`src/school/progress.ts`导出：

```ts
prepareSchoolCommits(storage: Storage, turn: TurnRecord, narrative: NarrativeResult, experiences: Experience[]): PreparedSchoolCommits;
applySchoolCommits(storage: Storage, candidate: TurnCandidate, turnId: string): void;
```

prepare在个人输入前验证，apply只在已有段B事务内使用。重复恢复以notice状态及稳定知识／进展身份去重。可读条件结合选轮状态、实际起床／活动变化及获知时刻校验；不能仅因轮末醒着就允许在此前睡眠时刻读过通知。onsite可以支持现场所知，不等同于手机可读。

段B同一事务保存：既有角色经历／状态／任务／记忆、notice已读、SchoolKnowledge、SchoolProgress、成功前台自主重排、turn.done。不出现通知已读但经历未提交、或恢复重复读／重复进展。通知在生成后失效时应用不能把新版本当旧版读过；同一串行槽通常无并发学校更新，仍按被冻结版本校验明确处理。

记忆整理合法来源仍为本轮experienceId、可见真实incoming、确认outgoing及既有个人生活网页来源；计划／通知数据库行不另充来源ID。获知通知可记“收到安排”，不记“已参加”；计划内容进入arrangementsAndIntent，不能作为已完成研究证明。共同代写与记忆既有授权保持。

## 9. 停服升级与启动门禁

独立环境规划版本1，不能凭记忆版本3或共同版本1跳过。新库直接初始化1；旧库必须通过只读check和显式升级。入口在Host启动前检查；不在启动加载路径自动迁移。

新增只读 `inspectEnvironmentUpgrade(databasePath)`，返回 `EnvironmentUpgradeReport`：版本、旧school事件数量、待终结旧环境turn ID／阶段／冻结状态、异常outbox关联、未完成普通／共同turn ID、paused及可升级／需处理原因。使用只读原始SQLite，在Storage构造写表前检查；正式库不存在时按新库装配，现存旧库不偷偷变新库。

`upgradeEnvironment(databasePath, options)` 的 `EnvironmentUpgradeOptions`为 `stopped: boolean, backupDir: string, timezone: string, environmentDailyAt: string, now: ISOTime`。CLI `--check`默认只读；应用必须显式 `--apply --stopped --backup-dir`，其他配置从加载后settings取得。停止状态声明及备份沿用现有shared升级方式，不启动服务。

升级顺序：

1. 配置内存兼容及连接字段检查通过；只读报告，异常环境outbox等先报告而不自动处置。
2. 服务已停止；备份SQLite及存在的WAL／SHM，记录实际路径和版本。应用前复查报告；不可升级则停止应用。
3. 一个事务建新表、导入已提交旧school事件为legacy条目／实例，保留原事件ID映射及历史；不把active或relatedEventIds自动当已知，不凭描述反推“已读”。旧记忆／经历／细节不语义改写。
4. 对 `!done && environmentKind && !legacyDisposition` 的正常旧环境轮设superseded／closedAt／replacementBatchId，**保留done=false**、frozenResult、post job及网页审计。它们从恢复门禁退出，未提交旧结果不应用。普通／共同未完成轮不动、继续恢复。
5. 建／关联唯一当前日期upgrade批次，清旧nextWorldAt／nextSchoolAt，设nextEnvironmentAt当前日期次日当地06:00，写环境版本1，一起提交。
6. 重复apply对已升级库报告无需重复，不重置closedAt、创建第二批次或重复导入。保留runtime.paused，不猜它是人工还是旧错误；明确报告并沿用原resume入口。

Storage.unfinishedTurn、Host恢复、启动诊断及统计都使用§3.1终态谓词；superseded统计为终结未成功，不统计为成功或待恢复。旧post job不能被独立worker再次应用；实际现有执行入口逐一核对。web缓存占用可释放但历史checkpoint保留。完整新学校配置＋旧库也必须通过版本门禁，旧配置能解析不等于数据库已升级。

正式库先只读检查；临时旧格式fixture验证通过后再按检查结果备份应用，保存升级前后报告。本次实施已完成正式库升级／检查，实际路径和报告见实施日志；服务仍由用户cmd手动运行。

## 10. 验收与交付

离线测试使用临时SQLite、假时钟、ScriptedModels、RecordingSender。必须覆盖：06:00顺序／跨日／步骤间openBatch让位；模型失败无全局暂停且重试不压自主；ready重启不重生成；周无变化不重造、远期当前issue不被窗口挡住；改期旧未读失效且旧已知不偷偷更新；睡眠／未知活动不空转；纯通知无联系抽样；共同通知不突破60秒／不改变代写；获知与进展来源／段B幂等；旧配置解析和旧未完成环境轮升级，普通／共同恢复仍受保护。

真实模型隔离验收必须跨日期／周边界，至少包含班会两次提醒、拒绝必到事项、远期研究任务下发、实际模拟研究与导师反馈、未读改期知识差异、共同通知合并、已有学期无变化检查。查看真实多轮正文是否提前泄露隐藏安排、日历是否稳定、任务意图是否伪造成成果；不能只凭JSON合同通过宣称语义正确。

沿用已允许的角色背景＋隔离测试剧情范围；不发送正式私聊或图片、不连QQ、不执行真实研究。新测试夹具不要引入未授权真实第三方资料。scripts/validate-world-school.ts自身单请求等待／取消默认300000ms，可显式覆盖，仅在工具包装Transport／请求signal生效；不新增AppConfig字段，不给正式ModelClient统一加300秒。超时按真实失败记录，不能提高上限后改写原失败记录；取消必须传到请求，不能只Promise.race停止等待后留下请求继续写隔离库。

实施日志在执行任务1时创建 `docs/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_LOG_20261008.md`，逐任务记录起点、RED/GREEN、实际接口调整、提交、只读报告、备份与真实验收结果。实现完成后再同步README、实际架构／调度文档；本文与执行计划届时更新状态并链接日志，审核历史保留原文。

## 11. 合并记录与最终实施入口

| 审查／回应 | 已落入执行依据的位置 |
| --- | --- |
| 第十一轮及其回应 | 配置解析前兼容、独立环境步骤／失败隔离、通知唯一归属、角色视角及旧库升级，§2～9／任务1～6。 |
| 第十二轮及计划回应 | §3.2通知措辞／默认；§4下游只在committed后经选择点放行；§5.1必需双判据、已读更正及幂等；§6跨日旧额度；§7发布点／唯一定时器；§10与任务8工具300秒范围。对应具名用例已补到任务2～5／8及交付自查。 |
| 第十三轮2.1 | §5.1以issuedAt／实际发布／已知界定下发窗口。已下发的远期事项立即适用更正；未下发未知草案更新未来候选，预排不等于发布。 |
| 第十三轮2.2 | §3.2及§7区分活动生效、通知publishAt、发布审计、实际获知；未到publishAt保持scheduled。该建议采用本项目实际字段，不引入审查中未定义的validFrom，不要求更正晚于旧值失效；客观改变、发布、获知依旧分开。 |

本次增加releasedAt只是保存曾发布证据，避免通知invalidated后失去历史发布事实；它不构成新的下发窗口、角色知识或上下文预算。审查意见已并入文档并完成实施；原审查／回应保留当时“尚未回填”的历史描述，不改写历史记录。

正式实施直接使用以下两份：

1. 本文：字段、职责、调度／冻结／事务、通知时间与知识、模型及升级规则。
2. [执行计划](WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md)：任务1～8顺序、文件／接口、RED／GREEN、迁移／验收和日志。

[方案](WORLD_SCHOOL_PLANNING_V0.4_PROPOSAL_20261008.md)用于产品背景；第十一～十三轮review／rebuttal仅用于追溯，不是第三份待拼接的规范。既有源码及已实现记忆／搜索／共同活动文档用于接入基线，按任务查相关接口，不重新执行旧计划；本轮明确改变的目标行为以这两份为准。实施记录产生后用于说明实际进度和偏差，完成后再同步已实现口径。

## 12. 第十四轮交付复核修复索引

以上口径已合入实际实现；修复任务、失败回归、离线验证及终审见[第十四轮修复记录](WORLD_SCHOOL_V0.4_REVIEW14_FIX_LOG_20261008.md)。旧nextWorldAt／nextSchoolAt只解码兼容，旧故事恢复也不写回。配置兼容解析不修改原配置文件。个人提醒版本检查使用SchoolInstance已有deliveryRevision；逾期但当前可读通知允许唤醒一次，不能用“只查未来截止”漏掉。
