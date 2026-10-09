# 调度定向查询 Implementation Plan

实施状态补充：T1～T9现已实施，实际结果见[交付](../../../v0.5/records/current-audit-improvements-20261009/DELIVERY.md)。下文复选项与“待实施”措辞保留原方案合同及当时状态，不代替完成证据；E1～E5独立后续尚未实施。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 待实施 T5、T6：让环境调度只读取活动批次元数据，让学校调度只读取活跃通知及其关联实体、已获知快照，保持当前业务结果。

**Architecture:** 保留现有 `id TEXT PRIMARY KEY, data TEXT NOT NULL` 表和 JSON 协议，在 `EnvironmentStore`、`SchoolStore` 增加同步定向查询。使用表达式索引缩小候选集合；正文仅在真正需要时解码。学校单次评价共享候选集合，并在成功发布或失效后更新集合中的对象，不跨调度调用缓存。

**Tech Stack:** 当前 TypeScript、Node.js `>=22.13.0`、`node:sqlite`、Vitest；不加依赖。

**Spec:** [调度审核](../../reviews/current-audit-20261009/SCHEDULING_REVIEW.md)第 3、4 节；[CODEX 范围回应](../../reviews/CODEX_RESPONSE_CURRENT_AUDIT_20261009.md)第 3.3 节。基线 `c9e4599` 包含 `b398699`。

**状态：全部待实施。** 本文件只决定实施和验收方法；本次没有修改源码、测试或运行本文件中的命令，不能据此宣称查询已优化或回归通过。

## 全局约束

- 只优化同步查询；本篇不引入环境准备槽、不并发 `runTurn`，不改变模型调用和 host 串行提交合同。
- 环境四步依次为 `world → school_campus → school_group → school_week`；`running`、`ready` 和终态的既有冻结正文均保留。
- 时区变化、切回已终态身份、跨日失效、重试截止及 ready 结果复用保持现状。旧批次中的已提交步骤不能改成 superseded。
- 学校资格保持当前 `legal`、`personalKnown`、`knownPlanCoversInstance` 的业务判断；公开版本优先于记录版本，之后才是获知时间和稳定顺序。
- 学校资格查询不写 `school_knowledge`，客观事项和未读通知不能成为角色知识；已读计划仍可解锁其精确课次提醒。
- 历史保留、JSON 字段、`environmentPlanningVersion`、模型协议版本均不变；索引安装不要求业务迁移或新增“最新知识”持久表。
- 只用内存库、测试临时库、脚本模型和合成数据验收；不读取私有配置、正式库或人物背景，不启动服务、不调用在线模型。
- 所有新增索引在可写 `Storage` 初始化时 `CREATE INDEX IF NOT EXISTS`；只读打开不建索引、不写库。新 API 在旧库尚未安装新索引时仍可执行，只是未享受索引收益。
- 索引仅缩小 SQL 工作范围；验收返回行数、JSON 解码量、写入量和执行计划，不承诺 B-tree 查找、JSON 提取或 SQL 内部工作严格 `O(1)`。

## 审查重点

1. 最后插入批次与最后更新批次不同：更新旧批次不得改变“上一个配置时区”的判定。由 T5 测试 `latest_batch_uses_insertion_order_after_old_batch_update` 固定。
2. 时区切回同日终态身份不得重新生成，也不得留下立即到期但不可执行的热循环。由 T5 保留 REVIEW14 回归并新增索引路径断言。
3. `ready` 上游仍阻断后续步骤；deadline 不应为判断状态而读取冻结输入。由 T5 测试 `metadata_selection_preserves_stage_retry_and_ready_barriers` 固定。
4. 旧现场知识具有更晚获知时间或更大记录版本，也不能压过较新公开版本；完全平局由后插入行胜出。由 T6 的定向投影 oracle 回归固定。
5. 同次 release 后新 `available`、新 `invalidated` 状态必须立即对 selection、eligible、deadline 可见；复用 context 不能注册知识。由 T6 的同次发布、失效和已读计划提醒测试固定。

## 文件与任务边界

| 文件 | 待实施职责 |
| --- | --- |
| `src/storage.ts` | T5/T6 所需表达式索引；T4 提供共用时间标量函数，T6 不重复实现 |
| `src/environment/types.ts` | T5 增加调度元数据类型 |
| `src/environment/store.ts` | T5 活动批次、最后插入批次、按批次步骤及元数据查询 |
| `src/environment/scheduler.ts` | T5 将 ensure/select/deadline 接到定向查询，保留完整返回值兼容入口 |
| `src/environment/runtime.ts` | T5 完成判定改读元数据，不全读当批冻结正文 |
| `src/school/types.ts` | T6 增加实体查询键类型 |
| `src/school/store.ts` | T6 活跃通知、按 ID 取实体、按实体取最新已知快照 |
| `src/school/notices.ts` | T6 按候选构造评价 context，同次发布后更新候选对象 |
| `src/host/scheduler.ts` | T5 选择环境时只消费元数据；T6 单次学校扫描共享 context。只改调用方式，不改优先级和并发 |
| `tests/environment-queries.test.ts`（新增） | T5 查询、等价与索引回归 |
| `tests/school-notice-evaluation.test.ts` | T6 改写旧“knowledge 全读一次”断言，补共享 context 断言 |
| `tests/school-notice-queries.test.ts`（新增） | T6 定向投影、关联集合、稳定顺序及 SQL 计划回归 |
| `tests/scheduling-query-fixture.ts`（新增） | T5/T6 合成历史、查询工作量计数辅助；只供测试使用 |
| `tests/scheduling-query-workload.test.ts`（新增） | 固定活跃集合增加历史的确定性工作量断言 |
| `scripts/check-scheduling-queries.cjs`（新增） | 使用构建后的 `lib/`，只创建 `:memory:` 库，输出规模验收 JSON；不复写原审核数据 |

`src/school/calendar.ts` 的完整周展开输入、`src/school/context.ts` 的叙事/个人完整知识选择、`SchoolStore` 原有审计全集方法不属于 T6 热路径改造。它们继续沿用当前行为，不把本任务扩展成所有学校读取的重写。

---

## T5：环境活动批次与步骤元数据查询（待实施）

### 接口

在 `src/environment/types.ts` 导出：

```ts
export type EnvironmentStepMetadata = Pick<EnvironmentStep,
  'id' | 'batchId' | 'stage' | 'status' | 'retryAt'>;
```

在 `EnvironmentStore` 增加下列同步只读 API；`activeBatches` 和 `firstActiveBatch` 均沿 `rowid ASC`，不得根据时间字符串重新排序：

```ts
activeBatches(): EnvironmentBatch[];
firstActiveBatch(): EnvironmentBatch | null;
latestBatch(): EnvironmentBatch | null; // rowid DESC LIMIT 1
stepMetadata(batchId: string): EnvironmentStepMetadata[];
steps(batchId?: string): EnvironmentStep[]; // 有 batchId 时 SQL 定向查询
```

保留 `batch(id)`、`step(id)` 的主键读取和 `batches()`、无参 `steps()` 的审计全集用途。热路径不能调用后三者中的全集方法。

在 `src/environment/scheduler.ts` 增加：

```ts
export function selectEnvironmentStepMetadata(
  storage: Storage, now: string
): EnvironmentStepMetadata | null;
```

保留 `selectEnvironmentStep(storage, now): EnvironmentStep | null`：调用元数据入口，选中后才按 `id` 完整读一条。现有测试和 `environmentInput(d, step)` 使用的完整类型不变。`Scheduler.collectReady` 改用 `selectEnvironmentStepMetadata`，因为它仅消费 `step.id`。

**供后续异步环境篇消费：** `EnvironmentStepMetadata`、`EnvironmentStore.firstActiveBatch()`、`activeBatches()`、`latestBatch()`、`stepMetadata(batchId)`、已有 `batch(id)`/`step(id)`、`selectEnvironmentStepMetadata(storage, now)`。这些 API 不持有跨调用快照、不修改步骤状态，不承担锁、准备槽或异步结果有效性判断。

### SQL 与索引决定

```sql
CREATE INDEX IF NOT EXISTS environment_batch_status
  ON environment_batches(json_extract(data,'$.status'));
CREATE INDEX IF NOT EXISTS environment_step_batch
  ON environment_steps(json_extract(data,'$.batchId'));
```

活动批次使用 `WHERE json_extract(data,'$.status')='active' ORDER BY rowid`；首活动批次再加 `LIMIT 1`。最后插入批次使用 `SELECT data FROM environment_batches ORDER BY rowid DESC LIMIT 1`，以原表 rowid 游标取末条，不新建时间索引。

`stepMetadata(batchId)` 固定为标量投影，不选择 `data`、`inputSnapshot` 或 `frozenResult`：

```sql
SELECT id,
       json_extract(data,'$.batchId') AS batchId,
       json_extract(data,'$.stage') AS stage,
       json_extract(data,'$.status') AS status,
       json_extract(data,'$.retryAt') AS retryAt
FROM environment_steps
WHERE json_extract(data,'$.batchId')=?
ORDER BY rowid;
```

`steps(batchId)` 使用相同 WHERE 和排序，但选择 `data` 后解码；无参仍调用原全集。绑定字符串参数，不插值批次 ID。DDL 与 WHERE 必须使用相同 `json_extract(data,'$.batchId')` / `json_extract(data,'$.status')` 表达式，不能单方面加 `CAST`、`COALESCE` 或换 JSON 运算符。

元数据 SQL 仍可能在 SQLite 内部提取本批次 JSON 字段；收益是没有历史批次扫描，也没有把整个冻结 JSON 传回并在 JavaScript 解码。本任务不承诺 SQLite 不接触当批 JSON 字节。

### 算法决定

1. `ensureEnvironmentBatch` 保留版本门禁、`batchIdentity(date, timezone)` 和原有本地 06:00/首次 bootstrap 规则。以 `activeBatches()` 查需失效集合，stale 谓词仍是 `b.timezone !== config.timezone || b.localDate !== localDate(now, b.timezone)`；以 `batch(id)` 查当前身份。只有当前身份不存在时读取 `latestBatch()` 判定 `changedTimezone`。判断依据仍是最后插入记录的 timezone，不能改用最近 active 或 `createdAt/closedAt` 最大值。
2. 在原事务内把 stale 活动批次变为 superseded。对每个 stale 批次仅取 `stepMetadata(old.id)`，对非 committed 的条目再 `step(id)`、原样展开保存 superseded；不读取其他批次正文，不删除任何冻结字段。已 committed 步骤保持原状态及正文。
3. 若当前身份已经存在，仍返回该身份。其 status 非 active 时按现有 `nextEnvironmentDate` 修正 `runtime.nextEnvironmentAt`，不重开、不重建步骤。保留同日时区切回与“变更到本地 06:00 之前”的处理顺序。
4. `selectEnvironmentStepMetadata` 以 `firstActiveBatch()` 与一次 `stepMetadata(batch.id)` 工作。按固定 `environmentStages` 找首个非 committed 步骤；该步 superseded 或 retryAt 未到时返回 null，不能跳过它选下游；running/ready 和已到期 pending 仍返回该步。
5. `environmentDeadline` 一次取得 runtime、首活动批次与该批元数据。继续取固定阶段顺序中第一个既非 committed 又非 superseded 的步骤，候选值为 `step.retryAt ?? now`，与 `runtime.nextEnvironmentAt` 按 `milliseconds` 取较早者；无批次且无截止仍返回 now。这里保留 deadline 与 select 对 superseded 的现有细微差别，不借优化统一语义。
6. `runEnvironmentStep` 提交后以 `stepMetadata(batch.id).every(s => s.status === 'committed')` 作现有完成判定；不再调用完整 `steps(batch.id)`。事务、ready 恢复、模型异常分流和 web owner 生命周期不改。

### 执行步骤及断言

- [ ] **T5.1 写失败回归。** 新增 `tests/environment-queries.test.ts`，使用 `tests/helpers.ts` 的 `setup/NOW` 和真实 `EnvironmentStore`：

| 测试名称 | 必须断言 |
| --- | --- |
| `metadata_queries_do_not_materialize_frozen_payloads` | 当前四步均带非空 `inputSnapshot/frozenResult`；`Object.keys(meta)` 仅为规定五字段；`environmentDeadline` 返回与旧 selector 相同时间；对 `environment_steps` 的返回 `data`/快照 JSON 行数为 0；禁止调用 `storage.all('environment_steps')` |
| `metadata_selection_preserves_stage_retry_and_ready_barriers` | world committed、campus ready 时只选 campus；group/week 不冻结；campus 改 pending 且 retryAt=`2026-10-07T02:05:00.000Z`、now=`NOW` 时 select 为 null、deadline 为该 retryAt；时间到达后才选 campus；superseded 前驱不能被 select 跳过 |
| `full_selection_wrapper_reads_only_selected_step` | metadata API 不完整读步骤；兼容 `selectEnvironmentStep` 仅完整读选中步骤一次，所得对象含原 inputSnapshot/frozenResult，与 `store.step(id)` 深相等 |
| `latest_batch_uses_insertion_order_after_old_batch_update` | 先插 UTC 批次 A、再插 Asia/Shanghai 批次 B，之后 UPSERT 更新 A.closedAt；`latestBatch().id === B.id`；两个 active 时 `firstActiveBatch().id === A.id`，与原 `all().find` 一致 |
| `batch_step_lookup_preserves_row_order_and_payloads` | 交错插入两个批次；`steps(target)` 深相等于测试 oracle `all('environment_steps').filter(s=>s.batchId===target)`，不包括另一批；空结果为 `[]` |
| `ensure_uses_current_identity_and_stales_only_active_batches` | 固定一旧 active 批次和其四步、混入 committed 历史；ensure 只对旧批三条未提交步和旧批次写 superseded，已提交步原值不变；新身份四步恰建一次；再次 ensure 不新增步骤 |
| `terminal_timezone_return_keeps_identity_and_future_deadline` | UTC/Asia/Shanghai 同日切换再切回 superseded 身份；两次 ensure 后批次/步骤数量不增加，原终态仍终态，deadline epoch 等于下一本地 06:00；再对 committed 身份重复同一断言 |
| `environment_query_plans_use_status_and_batch_indexes` | 从真实 API 捕获 SQL 后 EXPLAIN；active 查询含 `SEARCH environment_batches USING INDEX environment_batch_status`，步骤查询含 `SEARCH environment_steps USING INDEX environment_step_batch`；不是测试自己另写一条可走索引的 SQL |

无参全集 oracle 只在计数窗口外运行。保留 `tests/world-school-review14-environment.test.ts`、`tests/world-school-review14-time.test.ts` 和 `tests/world-school-batch.test.ts` 的现有断言，尤其既有 terminal、ready、跨日及冻结恢复用例。

- [ ] **T5.2 运行上述新增测试，记录实际失败。**

```powershell
npm test -- tests/environment-queries.test.ts
```

预期在实现前因缺少 metadata API、定向查询或索引而失败；配置装载/`spawn EPERM` 不是预期失败，也不算通过。

- [ ] **T5.3 实现类型、查询与索引，再替换四个热入口。** 按上述接口依次改 `types.ts`、`store.ts`、`storage.ts`、`scheduler.ts`、`runtime.ts` 和 host 环境选择调用。不引入全局缓存。

- [ ] **T5.4 验证独立交付。**

```powershell
npm test -- tests/environment-queries.test.ts tests/world-school-batch.test.ts tests/world-school-review14-environment.test.ts tests/world-school-review14-time.test.ts tests/world-school-review14-calendar.test.ts tests/world-school-integration.test.ts
npm run typecheck
```

预期所有列出的测试和类型检查退出 0。最后插入批次的查询允许 EXPLAIN QUERY PLAN 文案为 `SCAN environment_batches`，但捕获的 SQL 必须是 `ORDER BY rowid DESC LIMIT 1`、返回不超过 1 行、无临时排序；进一步 EXPLAIN 字节码确认反向 rowid 起点（`Last`），不能把所有 `SCAN` 文案机械判失败。

- [ ] **T5.5 完成 T5 的规模断言后提交独立变更。** 提交说明建议 `perf: query current environment batch metadata`；提交前只显式暂存本任务已核验文件，保留他人及文档未提交修改。T5 无需等 T6 或环境异步准备才能验收。

---

## T6：学校活跃通知和按需实体、知情查询（待实施）

### 前置与接口

**前置：T4 提供的 `hdsi_epoch_ms` 已进入 `Storage`。** 此函数仅供查询，输入字符串时返回与 `Date.parse` 一致的有限毫秒数，非字符串/非有限结果返回 null；在建立 `DatabaseSync` 后、readOnly 提前 return 前注册。T6 复用该函数，不把它写进任何持久索引，因此直接使用 SQLite 的既有迁移/检查脚本不需要注册它来维护新索引。

在 `src/school/types.ts` 增加：

```ts
export interface SchoolEntityRef {
  entityKind: SchoolEntitySnapshot['entityKind'];
  entityId: string;
}
```

在 `SchoolStore` 增加：

```ts
activeNotices(): SchoolNotice[];
itemsByIds(ids: readonly string[]): SchoolPlanItem[];
instancesByIds(ids: readonly string[]): SchoolInstance[];
latestKnownSnapshots(refs: readonly SchoolEntityRef[]): SchoolEntitySnapshot[];
```

`activeNotices` 按插入 rowid 排序。按 ID 方法去重、空集合零 SQL、每批至多 500 个参数，最终沿 rowid ASC 合并；不按传参顺序返回实体。`latestKnownSnapshots` 按 `JSON.stringify([kind,id])` 去重，一实体至多返回一份快照；输出按 refs 首次出现顺序，找不到则省略，调用者构造 Map。历史完整 `knownSchoolSnapshots`/`selectKnownSchoolSnapshots` 的数组次序完全不变。

保留现有五个通知函数的公开签名及可省略的 context 参数，包括 `createSchoolNoticeEvaluationContext(storage)`。扩大其 context：

```ts
export interface SchoolNoticeEvaluationContext {
  noticesById: Map<string, SchoolNotice>;
  knownByEntity: ReadonlyMap<string, SchoolEntitySnapshot>;
  itemsById: ReadonlyMap<string, SchoolPlanItem>;
  instancesById: ReadonlyMap<string, SchoolInstance>;
}
```

`noticesById` 是本次评价的工作集合；其余三图只读。不得把 context 放到 `Scheduler` 成员、`Storage` 或跨轮静态缓存。任一当前事务失败后，丢弃 context；不拿已回滚事务中的工作集合继续选择。

### SQL 与索引决定

```sql
CREATE INDEX IF NOT EXISTS school_notice_status
  ON school_notices(json_extract(data,'$.status'));
CREATE INDEX IF NOT EXISTS school_knowledge_entity_version
  ON school_knowledge(
    json_extract(data,'$.snapshot.entityKind'),
    json_extract(data,'$.snapshot.entityId'),
    json_extract(data,'$.snapshot.value.deliveryRevision') DESC,
    json_extract(data,'$.snapshot.revision') DESC
  );
```

活跃通知查询只有一条：

```sql
SELECT rowid, data FROM school_notices
WHERE json_extract(data,'$.status') IN ('scheduled','available')
ORDER BY rowid;
```

必须读取所有 scheduled/available 候选，不能先按 publishAt 截断，因为 deadline 需要未来通知，release 也需使尚未到期但已不合法的候选失效。状态 IN 导致的按 rowid 临时排序限于活跃集合，可以接受。

事项/课次使用现有 id 主键查询：`SELECT rowid,data FROM school_plan_items WHERE id IN (...) ORDER BY rowid` 和对应的 `school_instances` 查询。不要读取 `SchoolInstance.sourceSnapshot` 来替代现行事项版本，`legal` 使用的是当前 `school_plan_items` 的公开版本。

每个去重后的个人提醒知识键，执行一次以下查询：

```sql
SELECT json_extract(data,'$.snapshot') AS snapshot
FROM school_knowledge
WHERE json_extract(data,'$.snapshot.entityKind')=?
  AND json_extract(data,'$.snapshot.entityId')=?
ORDER BY json_extract(data,'$.snapshot.value.deliveryRevision') DESC,
         json_extract(data,'$.snapshot.revision') DESC,
         hdsi_epoch_ms(json_extract(data,'$.acquiredAt')) DESC,
         rowid DESC
LIMIT 1;
```

只解码返回的 `snapshot`，不读取整个 `SchoolKnowledge` 包装。选择器的权威字段在 `snapshot` 内，不能误用外层 `revision`。SQL 的实体匹配与索引逐字使用同一表达式；不追加未经测试的 `CAST/COALESCE`。取得最新知识不写数据库，不改原知识记录 ID。

该查询以当前合法数据（数值版本、有效 acquiredAt）与 JS selector 等价为门槛；测试包括带 offset、毫秒及超过三位小数的合法 ISO 输入，不能用 ISO 文本、`strftime` 秒精度或未经证明的 SQLite 浮点日期排序替代 `Date.parse`。本任务不借查询优化修复或改写异常历史数据。

这里选择“小型相关实体集合逐键 LIMIT 1”，不新建持久投影、不扫描全历史做 window rank。索引可按实体定位并提供公开/记录版本前缀；同实体同版本下的获知时间/rowid 尾部排序可能仍需检查相关历史，这是明示成本。固定无关历史量增长时返回和解码量不变；若单个相关实体有大量知识历史，应在规模结果中另外报告其 SQL/时间函数评估成本，不能声称内部恒定时间。

### 构造与消费规则

1. `createSchoolNoticeEvaluationContext` 首先调用一次 `activeNotices()`。空集合立即返回四张空 Map，不能读事项、课次或知识。
2. 从所有候选快照建立事项 ID 集合：plan_item 用 `snapshot.entityId`，instance 用 `snapshot.value.sourceItemId`。这是 `legal` 当前使用的字段，不能只取 `notice.sourceItemId`（week_digest 可以为 null）。
3. 只有 `kind === 'reminder' && instanceId !== null` 的通知需要从现行 `school_instances` 取相应课次，沿用 active、needsExpansion、startsAt 的现行门禁。不能为了通知附带一个 instance 快照便默认加载所有客观课次。
4. 只有 personal_reminder 候选需要知识。对其中每个快照加入直接实体键；对 instance 快照再加入其 `sourceItemId` 对应 plan_item 键，使“已知精确计划推导课次”分支完整可用。机构通知零知识查询。三个集合均去重后交给 Store。
5. 保留 `legal`、`personalKnown`、`knownPlanCoversInstance` 的条件和时间比较不变。具体包括：当前事项 deliveryRevision、提醒现行课次 active/needsExpansion/已开始门禁、已知课次 sourceItemId/公开版本/起止时间一致，或者已知 open 计划的 occurrenceKey/baseOccurrenceKey、周、时区、起止时间完全覆盖。
6. release 遍历 `context.noticesById.values()` 的插入顺序。保存 invalidated/available 成功后，用 `Map.set(existingId, savedNotice)` 替换原对象，保留 Map key 的顺序。仍保留 `releasedAt ?? now`，不重写未改变的 scheduled/available。循环中显式检查 status 活跃；已经 invalidated 的本次条目不能再次进入选择。
7. selection、eligible、deadline 都遍历同一 Map 并看更新后的 status。eligible 直接读候选的 `nextWakeAt`，去掉先 select refs 再逐条 `storage.read('school_notices', id)` 的回查；保留可读、睡眠和 shared 门禁。可抽取私有 eligible-notices 过滤函数以避免重复条件，不能改返回 ref 顺序。
8. `Scheduler.collectReady` 一次工厂创建，在现有发布事务后传给所有学校选择分支；`nextDeadline` 每次重新创建自己的 context。没有传入 context 的独立 API 调用也各自构造新集合；不复用上一次 collect 的候选，不跨外部写入或 await 生命周期持有它。
9. 前台 → 学校通知 → 环境 → 自主优先级、共同活动附带通知条件保持当前顺序。读取优化不移动正式 `applySchoolCommits`，学校获知依然只随真实故事提交。

### 执行步骤及断言

- [ ] **T6.1 写定向读取与语义失败回归。** 新增 `tests/school-notice-queries.test.ts` 并修改 `tests/school-notice-evaluation.test.ts`：

| 测试名称 | 必须断言 |
| --- | --- |
| `no_active_notices_skip_entities_and_knowledge` | 有 1000 个已读历史事项时，context 四图皆空；collect/deadline 对 notices 各只执行 1 次活跃查询、返回 0 行，对 item/instance/knowledge 执行 0 条查询；这四表 `storage.all` 被替换为抛错仍正常 |
| `active_notice_context_loads_only_referenced_entities` | 机构 issue、包含多事项的 week_digest、个人 reminder 混合；item/instance ID 查询集合精确等于第 2/3 步定义的去重集合；无关项不返回；只有个人 reminder 贡献知识键，含 instance 的 fallback plan_item 键 |
| `latest_known_projection_matches_public_revision_record_time_and_rowid_oracle` | 同实体依次保存 `(delivery=2,revision=3,time=09:20)`、`(1,9,09:30)`、`(2,4,09:10)`，获胜必须是 `(2,4,09:10)`；同公开/记录版本时实际 epoch 更晚者胜；`2026-10-07T09:20:00.1239+08:00` 与 `2026-10-07T01:20:00.123Z` 的 epoch 按 JS 截断后相同，必须 rowid 后者胜；平局 UPSERT 更新旧行不能使它变成后插入；逐实体结果等于 `selectKnownSchoolSnapshots` 对完整相关历史的结果 |
| `directed_knowledge_keeps_instance_identities_and_ref_order` | 两个历史 instance 使用同一个 sourceItemId 仍保留两个键；refs 去重后按首次出现顺序输出；缺失知识不返回客观实体代替；空 refs 不发 SQL |
| `active_notice_order_matches_original_rowid_filter` | 故意交错插入 scheduled、read、available、invalidated，再更新早插入行；候选与选择 ref 的顺序等于原 `all(...).filter(...)`，不可按 status、publishAt 或字符串 ID 重排 |
| `shared_context_observes_release_and_invalidation_without_reread` | 同一 context 先 select 为空；release 后 due 合法 scheduled 变 available，select/eligible/deadline 立即见新状态；陈旧公开版本的原 available 变 invalidated，三入口都排除；上下文创建后这些操作不追加 notices SELECT；与另建 fresh context 结果一致 |
| `known_exact_plan_unlocks_personal_reminder_without_registering_knowledge` | 复用现有已读 V1 issue 案例，仅有一条 plan_item 知识；到 `2026-10-09T12:00:00+08:00` 时 reminder available、refs 包含其 ID、eligible=true、deadline 等于该时间；知识条数仍为 1；时间、deliveryRevision、有效课次键 `(baseOccurrenceKey ?? occurrenceKey)` 或 active/needsExpansion 任一不符时不得解锁 |
| `new_evaluation_observes_committed_notice_and_knowledge_changes` | 先构造/消费一个 context 后正式标 notice read 并提交新知识；下一次 collect/deadline 重新查询，旧 available 不再选择，新获知能解锁对应提醒；验证没有 Scheduler 实例级缓存 |
| `school_queries_use_status_entity_and_primary_key_searches` | 从生产 API 捕获 SQL，计划含 `SEARCH school_notices USING INDEX school_notice_status`、`SEARCH school_knowledge USING INDEX school_knowledge_entity_version` 且实体两列均约束；item/instance 按主键 SEARCH，不出现完整 knowledge 表 SCAN |

旧测试 `one scheduling scan reads knowledge once for many notice snapshots` 不能继续期待 `all('school_knowledge') === 1`。将其改成多个提醒共享 K 个知识键、每键查询恰好一次，release/select/eligible 共用候选，不全读知识。保留并加强既有“同次发布可见”测试。

- [ ] **T6.2 运行新增测试并记录实际失败。**

```powershell
npm test -- tests/school-notice-queries.test.ts tests/school-notice-evaluation.test.ts
```

实现前预期缺少定向 API/索引，或全读阻断断言失败；不能把测试启动失败当成有效红灯。

- [ ] **T6.3 实现查询、context 与调用方式。** 先确认 T4 的时间函数可用，按固定 SQL 安装索引；再实现 Store、工厂、release 同步更新及三消费函数；最后接 host 单次共享。不触碰 full-history calendar/context 消费者。

- [ ] **T6.4 验证业务与兼容性。**

```powershell
npm test -- tests/school-notice-queries.test.ts tests/school-notice-evaluation.test.ts tests/world-school-notices.test.ts tests/world-school-personal-reminder.test.ts tests/world-school-reminder-timing.test.ts tests/world-school-knowledge-version.test.ts tests/world-school-perspective.test.ts tests/world-school-review14-contracts.test.ts tests/world-school-review14-calendar.test.ts tests/shared-v3-scheduler.test.ts
npm run typecheck
```

预期全部退出 0。知识查询允许针对已索引实体的尾部临时排序；SQL 计划门槛是先以索引限制实体，不能为避免任何 sort 而改成字符串时间排序或改变平局规则。

- [ ] **T6.5 完成下节规模与旧库兼容断言后提交独立变更。** 提交说明建议 `perf: evaluate active school notices with directed queries`；只显式暂存本任务改动。全量知识审计 API 仍可保留，不能据此宣称学校所有读取都已与历史无关。

---

## T5/T6 共同工作量验收（待实施）

### 计数口径与夹具

在新增测试辅助和离线脚本中捕获真实查询的执行次数、返回行数，以及返回给 JavaScript 并实际解码的 `data`/`snapshot` 数量与 UTF-8 字节数。标量元数据返回行数另计，不能把“不调用 all”直接当成“没有全读”。同时记录相关表 `INSERT/UPDATE/DELETE` 次数和 `storage.all` 次数；SQL/参数由真实 API 捕获供 `EXPLAIN QUERY PLAN` 使用。计数器与计时分开运行，所有 oracle 读取在计数窗口外。

**环境样本：** 历史天数 `0/90/180`，历史每批四步并保留审核探针同结构的学校累计快照；固定当前 active 批次四步，阶段/status/retryAt 不变。对 `environmentDeadline`、metadata select、完整兼容 select、现有身份 ensure、按批次 steps、提交完成检查分别计数；另有固定一旧 active 批次的跨日 supersede 样本。

**学校样本：** 历史事项 `0/1000/5000`，每项 1 item、1 instance、3 read notices、2 knowledge；日期全在过去。分别固定 A=0 和 A=3 活跃通知，A=3 使用一机构 issue、一机构 week_digest、一个人 reminder，固定去重关联事项 I=2、现行提醒课次 J=1、知识键 K=2，且 K 两份知识已存在。不开环境规划，无未完成轮，无到期普通任务，角色清醒可读；`nextAutonomousAt` 固定未来，避免其他路径污染结果。

再为这 K 个实体各追加 `0/1000/5000` 条合法旧知识，保留获胜快照不变。该组专门报告 SQL 尾部排序成本；仍断言每键返回/解码只有一份。若记录时间函数调用次数，其增长只能据实报告，不能并入“与历史长度无关”的结论。

### 硬断言

| 操作（单独计数窗口） | 固定活跃集合的期望 |
| --- | --- |
| 环境 deadline / metadata select（有当前 batch） | 环境相关 SELECT 各恰好 2 条：首 active batch 1 行、该批 metadata 4 行；完整步骤 JSON 解码 0；历史步骤返回 0；相关表写入 0 |
| 兼容完整 select（已有可选步骤） | 上项基础上主键完整步骤 SELECT 恰好 1 条/1 行；只解码该步骤，其他冻结 JSON 解码 0 |
| `steps(currentBatchId)` | 1 条 batch 查询，完整解码当前 4 条；历史步骤 0；与所有历史规模的输出深相等 |
| ensure 已有当前 active 身份、没有 stale | 活动批次查询和当前身份主键查询各 1 次；不查历史步骤/最后批次；步骤正文解码 0，写入 0 |
| 提交后的批次完成检查（仅检查段） | 1 条 metadata SELECT，4 标量行，步骤完整 JSON 解码 0；只有四步均 committed 时保存一次 batch；不得因历史量增大增加保存 |
| 固定旧 active 的 supersede | 保存次数仅由固定旧批未提交步数与新建四步决定；所有其他历史批次和正文返回/改写 0；保留已 committed 步骤 |
| 学校 A=0 的 collect/deadline | 学校 SELECT=1（活跃 notices）；返回/解码 0；其他三表查询 0；学校写入 0 |
| 学校 A=3 工厂（I=2,J=1,K=2） | notices=1 条/3 行；items=1 条/2 行；instances=1 条/1 行；knowledge=2 条/共2份 snapshot；共5条 SELECT、8份 JSON 解码，与无关历史规模无关 |
| 该工厂后的 release/select/eligible/deadline 组合 | 不追加学校 SELECT；原 scheduled 合法到期才写 available，原非法才写 invalidated，其他不写；knowledge 写入始终 0 |
| 相同相关实体增加旧知识 | 每知识键依旧 1 条 LIMIT 1、1份 snapshot 解码，结果与 oracle 一致；单独记录 SQL 内部时间/尾部排序代价，不强求 UDF 调用数恒定 |

学校发布样本每次操作前从同一播种状态构建新内存库，或先将计数/计时分成独立夹具；不能先发布一次再用第二次无写入的状态冒充第一次结果。环境 ensure 和提交检查也按其变更前提单独播种。

### 现有数据与索引安装验收

- [ ] 在测试临时文件创建旧版 `id/data` 表和合成现有记录，不预装新索引；用新 `Storage` 可写打开后检查四个索引名存在（environment 两个、school 两个），逐表 `id/data/rowid` 与打开前完全相同，runtime JSON 未变。再次打开结果仍相同，证明索引创建幂等且无协议迁移。
- [ ] 用只读 `Storage` 打开有表但无新索引的临时库，定向 API 返回正确结果且文件字节不变；有索引库只读查询同样正确。时间函数 readOnly 注册回归由 T4 提供，T6 加一次 latestKnownSnapshots 实际调用接入断言。
- [ ] EXPLAIN 捕获真实 API 的 SQL 和绑定参数；断言指定索引上的 SEARCH、主键 lookup 和环境末行反向游标。允许上文注明的有限活跃集合排序、单实体尾部排序；禁止无约束全历史 notices/knowledge/steps 查询出现在热入口。
- [ ] 确认 `selectKnownSchoolSnapshots` 仍是等价 oracle；公开版本、记录版本、epoch 和平局 rowid 各维度都实际影响过获胜者，不只测试一个简单“最新时间”案例。

### 验收命令与交付记录

以下命令供 SOL 实施后执行，本次不运行：

```powershell
npm test -- tests/environment-queries.test.ts tests/school-notice-queries.test.ts tests/school-notice-evaluation.test.ts tests/scheduling-query-workload.test.ts
npm run typecheck
npm run build
node scripts/check-scheduling-queries.cjs --output docs/v0.5/records/current-audit-improvements-20261009/scheduling-query-results.json
```

`check-scheduling-queries.cjs` 必须只允许输出路径参数，自行创建/关闭 `:memory:` SQLite，不接受生产数据库路径。输出含 Node 版本、各规模、当前集合大小、返回及解码行/字节、写入数、真实 SQL 计划、首次调用与五次热样本及中位数。时间只作观测，退出 0 必须建立在上述确定性断言通过；不设机器相关毫秒阈值。原审核的 `probe-results.json` 不覆盖、不当作优化后证据。

T5、T6 的关闭条件分别是自身新增/已有语义回归、规模硬断言、生产 SQL 计划、索引兼容与类型检查通过，并在统一交付记录中给出实际命令、退出码和新数据路径。任一命令未执行或受运行环境阻断，记录未验证项；不能把本计划中的期望数值写成实测结果。异步环境准备方案不属于本篇关闭条件。
