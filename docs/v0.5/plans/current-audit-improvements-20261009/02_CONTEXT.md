# 上下文读取与资料池实施计划（T3／T4／T8）

实施状态补充：T1～T9现已实施，实际结果见[交付](../../records/current-audit-improvements-20261009/DELIVERY.md)。下文复选项与“待实施”措辞保留原方案合同及当时状态，不代替完成证据；E1～E5独立后续尚未实施。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 以下复选项均为待实施，不是已完成结果。

**Goal:** 让记忆免构造未消费的普通原文，让免个人导演的轮免准备其专用资料，并减少普通窗口全文解码和资料池重复查重；保持阶段知情资格、完整段、活动全文及恢复规则。

**Architecture:** 检索保留现有返回 DTO，以调用选项关闭 recent；记忆补查先检查原权限，再只对实际发送的 owner 投影计费。V2 普通窗口在 SQL 聚合阶段可见消息的交互时间，只解码选中段的完整合格正文，仍用现有纯函数完成消息排序；资料池使用请求内 Set 维护身份索引。

**Tech Stack:** TypeScript、Node.js >=22.13.0 的 node:sqlite、Vitest；不增加第三方依赖。

**Spec:** [专项审核](../../reviews/current-audit-20261009/DIALOGUE_REVIEW.md)、[CODEX 核验§3.3](../../reviews/CODEX_RESPONSE_CURRENT_AUDIT_20261009.md#33-读取优化必须等价)、[上下文合同](../../subsystems/REMAKE_V0.5_CONTEXT.md)。源码依据为 c9e4599（含 b398699）。

## 全局约束

- 本文只交付 SOL 执行的方案。本轮没有修改产品源码、测试或既有文档，没有运行业务测试、正式库、服务或在线模型。下文命令均供实施阶段执行。
- 默认最近 4 个完整普通段、15 分钟空闲划段；count 沿用配置，不添加消息数／字符截断。段是否关闭不影响被选资格。
- 保留 `assertActiveWindow`、`assertMessageSources`、记忆首次可见资格和冻结活动身份。免 recent 不等于免来源检查；免个人导演不等于免学校获知、记忆后处理或正式提交。
- 不引入跨阶段／跨轮检索缓存；不把个人可见输入反灌普通主叙事。共同活动完整授权原文独立，不占普通 4 段。
- V1 在途轮继续走 `DialogueEpisodes`，版本读取仍为 `request.dialogueWindowVersion ?? runtime.dialogueContextVersion`，恢复时显式的 1 优先于当前 runtime 的 2。
- 所有规模样本均是临时内存／临时目录中的**合成数据**；计数和查询计划是验收依据，毫秒只作为附加观测。

## 审核重点

| 条件 | 预期 | 对应新增验收 |
| --- | --- | --- |
| 隐藏未读落在很旧段，且刷新了 lastInteractionAt | 普通主叙事不抬高该段；个人仅按本轮授权 ID 抬高 | T4 `sql_window_ranks_only_stage_visible_interactions` |
| 时间字符串不同 offset／小数，时间相同且混合 outbox 与普通消息 | 按 Date.parse 毫秒及原比较器排序；稳定零比较保留 rowid 输入顺序 | T4 `sql_window_preserves_epoch_and_stable_rowid_order` |
| 没有个人阶段但学校研究进展或普通经历仍需提交 | 专用资料调用为零，正式状态与后处理照常执行 | T3 `no_personal_stage_still_commits_story_and_school_progress` |
| 记忆补查请求 archive／detailHistory，或 finite budget | 权限不放宽；只对发送的 details/retrieved 投影裁预算 | T3 `memory_lookup_preserves_permissions_and_budgets_owner_projection_once` |
| 相同内容不同消息 ID、同 owner 不同版本、同 ID 不同内容 | 不同身份保留；重复身份使用首次加入内容与顺序 | T8 `pool_identity_first_insert_order_and_versions` |

## T3：检索通道与个人阶段提前门禁

**文件：**

- 修改 `src/memory/types.ts`：增加调用选项和记忆投影类型，保留 RetrievalRequest／LookupRequest／RetrievedContext 既有字段。
- 修改 `src/memory/retrieval.ts`：关闭 recent 的分支；抽出共享的补查请求解析与权限检查。
- 修改 `src/memory/context.ts`：正文及补查的统一记忆投影。
- 修改 `src/memory/organize.ts`：补查改调用 `lookupForMemory`；保留学校投影和 `includeLookupIds`。
- 修改 `src/app.ts`：提前计算 runPerson，延后专属资料；不提前返回。
- 新建 `tests/context-channels.test.ts`、`tests/personal-stage-preparation.test.ts`。
- 回归 `tests/prompt-context-call-skip.test.ts`、`tests/activity-memory-context.test.ts`、`tests/prompt-context-integration.test.ts`、`tests/tasks.test.ts`、`tests/world-school-story.test.ts`、`tests/world-school-integration.test.ts`；学校 fixture 使用 `tests/world-school-fixture.ts`。

**接口：**

```ts
// src/memory/types.ts
export interface RetrievalBuildOptions { includeRecent?: boolean }
export interface MemoryContext {
  details: MemoryCandidate[];
  retrieved: MemoryCandidate[];
}

// src/memory/retrieval.ts：共享权限解析；不访问数据库、不修改 base
export function resolveLookupRequest(request: LookupRequest, base: RetrievalRequest): RetrievalRequest;
MemoryRetrieval.build(request: RetrievalRequest, options?: RetrievalBuildOptions): Promise<RetrievedContext>;
// 保持已有普通阶段 API 与整份结果预算行为
MemoryRetrieval.lookup(request: LookupRequest, base: RetrievalRequest): Promise<RetrievedContext>;

// src/memory/context.ts
ContextBuilder.buildForMemory(request: RetrievalRequest): Promise<MemoryContext>;
ContextBuilder.lookupForMemory(request: LookupRequest, base: RetrievalRequest): Promise<MemoryContext>;
```

`resolveLookupRequest` 完全沿用现有 string 请求的 wantsArchive／wantsHistory 判定；拒绝未授权 archive 或 detailHistory，错误仍为 `retrieval permission denied`。返回 `{...base,...wanted}`，保留原 `permissions`、阶段、at、版本和预算；模型不能传入 `includeRecent` 或扩大 visibleSourceIds。`lookup` 改用该函数后仍执行原整份结果预算。

- [ ] **T3.1 写失败回归，固定通道行为。** 在 `context-channels.test.ts` 使用 `modern()` 与合法段／来源，用 `vi.spyOn(ChatEpisodes.prototype,'recent')` 和 V1 的对应 spy；`build(request)` 与 `build(request,{includeRecent:true})` 深相等，false 时 `recent=[]`，其余五组字段与无限预算基准深相等；false 时两个 recent spy 均为 0。V1 false 也不能构造旧窗口。测试名 `retrieval_recent_channel_defaults_on_and_owner_only_skips_both_window_versions`。
- [ ] **T3.2 固定权限、来源门禁与预算。** `memory_owner_only_keeps_source_consistency_gate` 将被选 owner 的真实 message 来源关联损坏，断言 `buildForMemory` 仍抛 `chat 对话段索引不一致`；不是因查 recent 才触发。`memory_lookup_preserves_permissions_and_budgets_owner_projection_once` 对两种越权请求分别断言 rejection，且 build／索引 query／recent 调用均为 0；对允许请求断言传入 build 的 `permissions`、`phase`、`at`、`dialogueWindowVersion` 和原 base 完全一致。
- [ ] **T3.3 固定有限预算的明确行为修正。** 构造一个有 owner 命中的合法查询，4 段含大量正文；取 `ownerView={details:raw.details,retrieved:[...raw.shortTerm,...raw.longTerm,...raw.learned]}`，设置 `B=countVisibleCharacters(JSON.stringify(ownerView))`。断言 `lookupForMemory` 恰好保留整个 ownerView、`budget` 只调用一次且参数为 ownerView／B／base.permissions.visibleSourceIds，recent 从未调用。另用 B-1 与同一 `retrieval.budget(structuredClone(ownerView),B-1,protectedIds)` oracle 深相等。默认 null 则与原记忆返回投影深相等。不得声称有限预算旧结果完全等价：原来未发送的 recent／detailHistory 会先挤占补查预算，本任务有意移除这次扣减；保护 ID 和原预算删项顺序继续沿用。
- [ ] **T3.4 运行新测试确认缺少 API／跳过分支而失败。** `node node_modules/vitest/vitest.mjs run tests/context-channels.test.ts`。区分工具启动错误与业务断言失败，不把 EPERM 记为红测证据。
- [ ] **T3.5 实现记忆通道。** `includeRecent !== false` 才实例化 ChatEpisodes／DialogueEpisodes 并调用 recent；false 返回 `recent:[]`。候选资格、词法／语义路线、owner 投影、detailHistory 返回合同、metrics、`assertMessageSources` 均继续执行。`buildForMemory` 和 `lookupForMemory` 调用 build 的 `{includeRecent:false}`；后者先 resolveLookupRequest。两者只构造上述 MemoryContext，再用 `request.budget ?? limits.historyBudget` 和原 protectedIds 调用 budget 一次。organize 的补查返回 `{...await builder.lookupForMemory(q,base),school:...}`，继续 includeLookupIds；不改已持久 checkpoint 的 privateLookupResult，不重放已完成补查。
- [ ] **T3.6 写个人免构造失败回归。** `personal_preparation_is_skipped_after_narrative_extends_unread_activity`：非共同活动、输入 hidden、到期 unread 检查；主叙事延长不可读活动，无预约／自主／醒来／学校 observations。对 `generateTurn` 断言个人阶段 `build` 0 次，app.ts 的个人专属 `personalSchoolContext` 调用0次（按本样本非空 personalQuery 筛选spy调用）、`personalEnvironmentEvents` 0 次，模型仅 narrative，candidate.personal/expression 为 null，visibleMessageIds=[]，hidden 仍未读，unread 任务被延到新的 expectedEndAt。**不能断言整个 personalSchoolContext 函数总调用为0**：prepareSchoolCommits 的 query='' 调用仍用于学校资格验证，必须保留。门禁使用更新后的 state，不能预先使用进轮 state。
- [ ] **T3.7 补运行资格正例与正式提交。** `personal_preparation_runs_for_each_existing_trigger` 用 it.each 覆盖 shared、visible、appointment、autonomous、sleep、school observations、可读 deferred；各自恰好一次个人资料构造及原个人任务名；shared 无新输入也运行。deferred 仅合法已看消息进入 reconsider，不能添加旧未读。`no_personal_stage_still_commits_story_and_school_progress` 走 HdsiApp.runTurn，有合法研究进展且 observations 为空，断言 turn.done=true、narratedUntil=at、school progress 已提交、未读资格不变、有经历时 memory 仍调用。学校 observations 非空的正例另断言 knowledge 提交。用现有学校 fixture，禁止用 mock 掩盖正式提交路径。
- [ ] **T3.8 实现提前门禁。** 顺序固定为：主叙事→prepareSchoolCommits→更新 state→visible/deferred/reconsider→原公式 contactEligible/kind/runPerson→个人专用准备→runPersonal→原后续流程。将 personalRequest/history/school/events 收在 runPerson 内；需要表达复用的 `personalHistory`／`personalSchool` 用明确可空本地变量保存，只有 intent（只能由已运行的 personal 设置）时送表达。表达继续 lookup:null；不要增加新共享缓存、未定义 fallback 值或提前 return。不删主叙事两次 prepareSchoolCommits（解析验证／真实候选）的既有用途。
- [ ] **T3.9 跑定向回归与类型检查，通过后提交一个独立提交。**

```powershell
node node_modules/vitest/vitest.mjs run tests/context-channels.test.ts tests/personal-stage-preparation.test.ts tests/prompt-context-call-skip.test.ts tests/activity-memory-context.test.ts tests/prompt-context-integration.test.ts tests/tasks.test.ts tests/world-school-story.test.ts tests/world-school-integration.test.ts
npm run typecheck
git add src/memory/types.ts src/memory/retrieval.ts src/memory/context.ts src/memory/organize.ts src/app.ts tests/context-channels.test.ts tests/personal-stage-preparation.test.ts
git commit -m "perf: skip unused recent and personal context preparation"
```

**规模关闭条件：** 固定 owner、来源、当前活动、未完成轮及新输入，仅将已完成普通历史从 1,000 增加到 10,000／50,000 段；单独 buildForMemory 及 lookupForMemory 的 recent 调用始终为 0，`all('messages')`／`all('chat_episodes')` 始终为 0；来源门禁定向读取行数保持固定。普通 narrative→personal→memory 的全轮 recent 次数从原 3 次降至 2 次；若记忆因无新来源跳过，则不得为了达到计数而强行运行。免个人分支只允许 narrative 的一次 recent，个人专属 build／学校／事件投影均 0；学校资格验证内的投影不计入该0次数，正式进展及记忆正例照常成功。

## T4：V2 普通四段 SQL 选择与完整正文定向解码

**文件：** 修改 `src/storage.ts`、`src/dialogue/types.ts`、`src/dialogue/chat-episodes.ts`；保留 `src/dialogue/chat-window.ts` 为行为 oracle（无需重写比较器）；新建 `tests/chat-window-sql.test.ts`、`tests/context-query-cost.test.ts`；在 `tests/storage-queries.test.ts` 增加 SQL UDF／计划断言。

**依赖：** 可独立于 T3 实施，合并验收时叠加其调用次数改善。T6 的 acquiredAt 排序依赖本任务注册的 `hdsi_epoch_ms`。不要求建立持久“最近排名”表，也不要求把 SQL 内部全历史扫描伪装成定量读取。

**接口：**

```ts
// src/dialogue/types.ts
export interface ChatWindowQuery {
  eligibility: ChatEligibility;
  count: number;
  visibleIds: readonly string[];
}
// src/storage.ts：返回供现有 pure selector 使用的定向快照
Storage.recentChatSnapshot(options: ChatWindowQuery): ChatWindowSnapshot;
// 保持外部 API 不变
ChatEpisodes.recent(phase: string, at: string, count: number, visibleIds?: string[]): ChatRecent;
// 每个 Storage 连接注册；readOnly 连接也注册；不写入表或索引表达式
// SQL: hdsi_epoch_ms(value) -> Date.parse(string) 的有限毫秒数；否则 null
```

`Storage` 在 `new DatabaseSync` 之后、`if(options.readOnly)return` 之前，用 `db.function('hdsi_epoch_ms',{deterministic:true},...)` 注册；只有 string 且 Date.parse 有限才返回该数。它只在 SELECT 使用，**绝不**用于持久 expression index／trigger／generated column，避免裸 DatabaseSync 的既有迁移工具与旧程序无法写库。混合 offset、Z、小数精度以 Node Date.parse 为准，不用时间字符串排序、SQLite 秒整数或 julianday 近似替代。

### 已核对的等价规则

1. `recentFromSnapshot` 首先排除 `sharedActivityId` 为真和 `chatEpisodeId` 为空的消息；资格为 outgoing、`seenTurnId !== null` 或本阶段 visibleIds 中之一。普通 narrative 的 allowed 始终为空。缺失 seenTurnId 在当前 JS 中满足 `!== null`，SQL 不能误写成 `IS NOT NULL` 把它排除；不要把 `unseenIncomingMessages` 的显式 null 规则套过来。
2. 每段 rank 是该阶段合格消息 `MAX(Date.parse(receivedAt))`；不是段的 lastInteractionAt。排序为 rank、openedAt epoch、JS literal id，升序取最后 count 段；段关闭状态不参与过滤。当前 `_at` 不作 cutoff，本任务也不能新增 receivedAt<=at。
3. 取中段内**全部合格消息**，不是每段最后一条／30条／固定N条；活动即使误带 chatEpisodeId 也不能进入普通窗口，仍由一致性门禁处理其错误关联。
4. 消息排序继续使用原 pure selector：段次序→receivedAt epoch→同 turnId 且两者 outboxSeq 非 null 时按 seq，否则 literal id。不能改成全局 SQL `ORDER BY turnId,outboxSeq,id`。比较器返回 0 时需要保留原始 rowid 稳定次序，因此新查询正文 `ORDER BY rowid` 后，仍先使用 `Storage.messages()` 相同的仅 epoch 稳定排序，再交 pure selector。
5. 活动集合 `selectActivityContext`／`activityContextMessages` 不变。后到未读、收尾原文、A→B 活动隔离不由 recent 重算。V1 类与恢复绑定不改。

### SQL 与索引设计（实施时必须保留谓词语义）

新增 `message_chat_rank`，索引只保存用于 rank 的两个 JSON 标量；partial predicate 是现有 ordinary+baseVisible 资格：

```sql
CREATE INDEX IF NOT EXISTS message_chat_rank ON messages(
  json_extract(data,'$.chatEpisodeId'),
  json_extract(data,'$.receivedAt')
)
WHERE COALESCE(json_extract(data,'$.sharedActivityId'),'')=''
  AND COALESCE(json_extract(data,'$.chatEpisodeId'),'')!=''
  AND (json_extract(data,'$.direction')='outgoing'
       OR COALESCE(json_type(data,'$.seenTurnId'),'missing')!='null');
```

这些谓词针对 Message 中 string／null／optional 字段域。旧记录缺字段与空字符串按现有 JS 真值行为保留，不新增正式数据重写。SQL 不将 body／content 放入索引；写入、已读变化、活动迁移和删除由 SQLite 自动维护该索引。

- [ ] **T4.1 先写 oracle 差分失败测试。** 创建同一合法 fixture，oracle 为 `recentFromSnapshot({messages:s.messages(),episodes:store.chatEpisodes()},options)`；新路径必须对 episodeIds 和每条完整 Message `toEqual`，不能只断言长度。测试 fixture 的 expected ID 顺序仍须显式列出，避免两个同错路径互为证明。
- [ ] **T4.2 固定边界样本。** `sql_window_ranks_only_stage_visible_interactions` 延续 A..E：A 有旧已看+时间200的 hidden，E 只有未读；narrative 结果 `[A,B,C,D]`，personal visible=[hidden] 结果 `[B,C,D,A]`；传 narrative visible=[hidden] 仍为 `[A,B,C,D]`。插入 activity 后以上结果不变。为 D 添加 41 条合格正文和不可见 unread，断言 41 条正文与尾部 sentinel 完整、unread 缺席。`sql_window_explicit_null_missing_fields_and_closed_segments` 对 seenTurnId=null、missing、已看、outgoing 分别固定资格，closed 段仍入选。
- [ ] **T4.3 固定时间／排序／参数。** `sql_window_preserves_epoch_and_stable_rowid_order` 覆盖 `2026-10-07T10:00:00+08:00` 与 `2026-10-07T02:00:00Z` 同时，`.001` 与 `.010`，以及 `.0009` 被 Date.parse 截为毫秒的行为；epoch 更晚而字面更小的日期仍后排。段 ID 使用 `a`、`z`、`\uE000`、`\u{10000}` 并断言按 JS UTF-16 literal 顺序；同 rank/openedAt 的第4边界 tie 不能被 SQL BINARY 提前截掉。消息含同 turn 同 seq（比较为0）且插入顺序与 id 逆序、同 turn 不同 seq、不同 turn 同时点，断言精确 oracle 序列和原始 rowid 顺序。count=1／4／6 均覆盖；非正整数仅兼容回退旧 selector，不引入新的配置语义。
- [ ] **T4.4 实现 recentChatSnapshot 的定向 SQL。** 使用下列顺序，不把全文 JSON 作为聚合字段：

  1. `base` 使用上述完全一致的 partial predicate，按 chatEpisodeId 聚合 `MAX(hdsi_epoch_ms(receivedAt))`，并计算该组是否有非法 epoch；只返回标量。
  2. `visible` 仅 with_visible_inputs 才做。visibleIds 先去重，经 `id IN (SELECT value FROM json_each(?))` 用 messages 主键定向读取 **ID、chatEpisodeId、receivedAt 标量**，过滤 ordinary 身份。传 JSON 数组参数，避免 SQL 插值和变量上限；普通 narrative 根本不查该分支。与 base UNION ALL 后再按段 MAX，重复 ID 不影响 rank。
  3. 与 chat_episodes 按表主键 ID 连接，计算 openedAt epoch；不按 status 或 lastInteractionAt 过滤。候选标量结构固定为 `{id:string,rank:number,openedEpoch:number,invalidTime:number}`。通过 `RANK() OVER (ORDER BY rank DESC,openedEpoch DESC)` 的边界名次 `<=count` 保留第 count 位的**全部同 rank/openedAt 候选**；在 JS 按完整比较器 `a.rank-b.rank || a.openedEpoch-b.openedEpoch || literal(a.id,b.id)` 升序排序，再 slice(-count)，其中 literal 沿用原字符串比较。不能在 SQL 加 BINARY id 后直接 LIMIT 4，否则非 BMP id 可能不等价。
  4. 非法日期必须兼容原 selector，而不是发明 null 排名：候选窗口查询在全体已连接候选上用 window MAX 汇总任一 eligible receivedAt／openedAt 的非法标记；任何一条返回记录携带该标记即回退全量旧快照。无候选则返回空快照；合法数据只走定向路径。这是旧输入兼容分支，不自动修正数据、不设置新持久开关；非法日期 fixture 只断言与旧 selector 深相等。
  5. 最多 count 个选中段按主键读取完整 episode；messages 使用现有 `message_chat` 的 `chatEpisodeId IN (...)` 再加 ordinary 和该阶段资格筛选，查询 `rowid,data ORDER BY rowid`。只解码匹配全文，先按 epoch 稳定排序；不要按候选阶段的聚合结果只取最后消息。空 ID 集直接返回空快照。
  6. `ChatEpisodes.recent` 对快照调用原 recentFromSnapshot，随后保留原 `assertActiveWindow(requiredMessageIds,touchedEpisodeIds)`。不得 catch 一致性错误返回空窗口。纯 selector 仍用于完整审核及测试 oracle，不改完整审核读取合同。

- [ ] **T4.5 验证旧库／只读／更新与回滚。** 新测试 `sql_window_index_updates_follow_message_lifecycle_and_rollback` 覆盖 unread→seen、普通→activity、删消息、改receivedAt、事务中回滚，分别与旧 selector 相等。临时合法旧库没有 message_chat_rank 时，可写 Storage 打开创建索引后结果相同；readonly 不建索引但 UDF 可用、同查询仍正确，不能因为缺优化索引自行迁移或写库。`epoch_sql_function_matches_date_parse_on_readonly_and_offset_inputs` 覆盖 readOnly 连接，null／非法 string 返回 null。索引无需升级 dialogueContextVersion，不能更改 chat-index idleMinutes。
- [ ] **T4.6 验证恢复及消费门禁。** `v1_inflight_uses_legacy_window_after_runtime_upgrade` 在 runtime=2 且 saved turn version=1 时断言调用 DialogueEpisodes.recent，ChatEpisodes.recent=0；生成失败→恢复保持原 dialogueBinding。保留现有 V2 重生原 chatBinding 与 activityContext，late 输入不变成本轮 visible。损坏的消息必须同时位于当前未读、未完成轮 input 或显式 source 的现有受检工作集，再破坏其段关联／活动身份，确认原门禁仍失败；不能只用此前选中、现在已被过滤的关闭历史段来要求原本不存在的全历史检查。运行既有 chat／activity／recovery 测试。
- [ ] **T4.7 跑计划和规模验收，类型检查通过后提交。**

```powershell
node node_modules/vitest/vitest.mjs run tests/chat-window-sql.test.ts tests/context-query-cost.test.ts tests/storage-queries.test.ts tests/chat-window-snapshot.test.ts tests/chat-episodes.test.ts tests/chat-active-consistency.test.ts tests/activity-context.test.ts tests/activity-memory-context.test.ts tests/dialogue-recovery.test.ts tests/shared-v3-recovery.test.ts
npm run typecheck
git add src/storage.ts src/dialogue/types.ts src/dialogue/chat-episodes.ts tests/chat-window-sql.test.ts tests/context-query-cost.test.ts tests/storage-queries.test.ts
git commit -m "perf: select ordinary chat windows before decoding full messages"
```

### SQL 计划与工作量的关闭条件

`tests/context-query-cost.test.ts` 不读取生产数据。在每段1条、互不同时点的 H=1,000／10,000／50,000 合成历史上，固定最新4段各41条合格消息、相同当前工作集、相同 visibleIds。记录 `db.prepare` 的生产 SQL、bind 参数、all/get/iterate 返回行数、实际 data JSON 解码行数、写入次数与 `EXPLAIN QUERY PLAN`；计数按 ranking 标量、窗口全文、消费门禁、完整启动审核分开。不要只 monkey-patch `Storage.all` 就宣称所有解码已统计。

| 检查 | 要求 |
| --- | --- |
| 正文／段全量读取 | recent 的 `Storage.all('messages')`、`all('chat_episodes')` 均0；合法样本不得走兼容 fallback |
| 窗口全文解码 | 每次 snapshot 正文恰好164条，episode恰好4条；H增长不增加这两项。一致性门禁允许再次读取固定工作集，必须单列而非隐去 |
| 标量排名 | 无时间边界 tie 时返回4条候选标量；第4位 tie 样本允许返回更多标量，但最终全文仍只解码选中的4段。统计并明示 base 聚合扫描随H增长 |
| rank 查询计划 | 正常已建索引 fixture 使用 `message_chat_rank` 遍历合格 rank 字段，非全表正文 `SCAN messages`；visible 分支对 messages 主键 SEARCH，不能为了4个授权ID全扫正文。临时 GROUP BY／窗口 ORDER BY B-tree允许且要记录 |
| 正文查询计划 | 实际查询必须为 `SEARCH messages USING INDEX message_chat` 或新等价索引；不能只检查 sqlite_master 中有索引。`EXPLAIN` 字节码补查聚合是否读取主表 data 做JSON提取，若仍读正文则调整覆盖索引／查询表达式后重验，不能只看“USING INDEX”通过 |
| 回退／写入 | 非法日期／readonly旧库兼容单独记录；普通 SELECT 与 recent 路径写入0。首次 CREATE INDEX 成本单列，不塞入热查询结果或声称无成本 |

**明确收益边界：** 本任务消除全历史完整 Message／ChatEpisode JSON 的 JS 解码与排序；SQL 的候选聚合、与段元数据连接和边界排序仍可能随历史增长，最坏同时间 tie 也会返回大量标量。不能宣称 O(1)、完全无全历史扫描或所有I/O不随历史增长。若后续需要减少 rank 扫描，需另立写入时维护可见排名的设计和迁移验收，本批不增该状态机。

## T8：资料池身份 Set，保持首次加入内容与顺序

**文件：** 修改 `src/model/resource-pool.ts`；新建 `tests/resource-pool-index.test.ts`；回归 `tests/prompt-context-views.test.ts`、`tests/prompt-context-transport.test.ts`、`tests/activity-context.test.ts`。不修改 ModelResourcePool JSON 结构、owner ref 算法、角色引用或 Prompt。

**接口：** `ResourcePool.message(row):string`、`task(row):string`、`owner(row):string`、`material(row):string`、`merge(pool):void`、`readonly data:ModelResourcePool` 保持原签名；增加四个实例私有 `Set<string>`：messageIds、taskIds、ownerRefs、materialIds。仅插入方法写 data 数组，现有调用者只消费 data；不暴露持久缓存或全局索引。

- [ ] **T8.1 写身份与顺序失败回归。** `pool_identity_first_insert_order_and_versions` 输入 m1(content=x)、m2(content=x)、m1(content=changed)：messages 精确为首次 m1、m2，返回ID仍各自正确。任务／素材同 ID 后版本不得覆盖；owner 同ref不得覆盖，不同 revision／stateVersion 得到不同 ref，均保留。分别对 `merge(a);merge(b);merge(a)` 断言每数组首次插入顺序与完整正文，输入对象深相等。两个独立池不得共享去重状态。
- [ ] **T8.2 写多角色和发送投影回归。** `pool_keeps_all_role_references_and_full_bodies` 同消息出现在 recent／visible／reconsider／activity，各 roles 的ID完整，资源只有一次；不同ID同文字保留两次。长活动N条（N=1,000／5,000／10,000）分别进入 activity+visible，stageInput 与 buildCompletionEnvelope 都恰好N条，尾部 sentinel 未截。既有学校／detailHistory 完全相等引用、不同版本保留、网页续调用、image/base64规则不变。
- [ ] **T8.3 写操作数压力门禁，再运行失败测试。** `pool_identity_membership_work_is_linear_in_insertion_attempts` 对单独 ResourcePool 的四种私有 Set 做只限本实例的 has/add spy，N个唯一对象各加入两遍再 merge一遍：每类 has 恰好3N、add恰好N、data长度N。这是算法成本验收，不能用毫秒通过替代；spy不改 global Set、不覆盖实际 membership 返回值。N取1,000／5,000／10,000，正文与版本身份断言与T8.1合用。首次运行因缺 Set 或次数不符失败。
- [ ] **T8.4 实现实例 Set。** 每次尝试插入恰好一次 has；未见过时先构造与原先完全一致的投影／clone、push 成功后 add ID，重复时直接返回原ID。不额外 full clone 整池，不按 content 去重，不覆盖第一次的内容，不在 getter／merge 时重建 Set。沿用原 message 白名单、task可选字段规则、owner/material structuredClone；不借机更改task数组字段别名等现有行为。
- [ ] **T8.5 定向测试通过后提交。**

```powershell
node node_modules/vitest/vitest.mjs run tests/resource-pool-index.test.ts tests/prompt-context-views.test.ts tests/prompt-context-transport.test.ts tests/activity-context.test.ts
npm run typecheck
git add src/model/resource-pool.ts tests/resource-pool-index.test.ts
git commit -m "perf: index resource pool identities with request-local sets"
```

**关闭条件：** 请求资源 JSON 与原语义一致，各类 membership 数量随尝试次数线性增长；stageInput／envelope 不丢全文、不改role或版本身份；合成压力耗时可以记录预热后3次中位数，但不设机器相关硬阈值。小窗口收益不作承诺。

## 联合交付与回退

- T3、T4、T8 分别可提交／回退；T6 若已使用 hdsi_epoch_ms，回退 T4 时保留该连接函数注册或同步回退其调用，不能留下未定义 SQL 函数。新 message_chat_rank 只用SQLite内建函数，旧版程序可忽略；不删除索引以外的任何历史记录，不变更 dialogue schema version。
- SOL 实施后在新的交付目录记录命令、真实退出码、新增测试名称、样本规模／返回行／解码行／写入次数／SQL计划及有限预算行为变化；原审核和失败证据保持原样。本文件的预计值不能复制为实测结果。
- 由主计划安排最终 `npm run typecheck`、`npm run build` 及统一回归；本文不宣称它们已运行或通过。同步上下文文档§8：从“每阶段全读全文”更新为“SQL轻量聚合仍可能扫历史，选中段全文定向解码”，不能写成全链路固定成本。记忆补查只对发送投影计预算的变更同步§7。
- 无新的业务选择待用户裁决；新接口、四段范围、版本1回退和有限预算修正已在本文固定。扩大为持久排名表、跨轮缓存、活动裁剪或全文截断均超出本批。
