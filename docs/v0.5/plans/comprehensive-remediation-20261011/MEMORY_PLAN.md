# 记忆访问与冻结载荷优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成审核 M1／M2，在保持记忆资格、排序、保护及恢复行为的前提下，消除无变化容量处理的全文物化、比较器数据库读取和不可用语义通道的向量物化。

**Architecture:** 每次同步容量／清理操作持有一份局部元数据快照及规范身份索引，需要退出时才加载该对象完整正文；唤醒时间批量读取并转为纯数值排序键。检索在读取候选前判定语义能力，环境冻结保存能力判断且维持原配置签名校验，旧快照保持兼容。

**Tech Stack:** 现有 TypeScript、Node.js `>=22.13.0`、`node:sqlite`、Vitest、`tsx`；不新增依赖、不增删数据库索引、不调用真实模型／Embedding。

**Spec:** [记忆审核 M1／M2](../../reviews/comprehensive-audit-20261011/MEMORY_PERFORMANCE.md)、[当前记忆产品合同](../../subsystems/REMAKE_V0.5_MEMORY.md) §2、4–6、8–10。M3 检索质量评估由 [RETRIEVAL_QUALITY_PLAN.md](RETRIEVAL_QUALITY_PLAN.md) 负责，不属于本文件实施范围。

## Global Constraints

- 计划编写时 `git rev-parse HEAD` 为 `ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`，与审核基线相同。开始实施先运行 `git rev-parse HEAD`、`git status --short`、`git diff ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c -- src/memory src/environment/snapshot.ts src/deployment/memory-runtime.ts src/deployment/memory-capacity-upgrade.ts src/recovery.ts tests`；有源码漂移先重读差异并更新本计划对应接口，不覆盖已有改动。
- 当前阶段仅交付方案，不修改产品代码、默认配置、标定数据、索引或正式数据库，不运行全量测试。下面命令属于 SOL 实施时的步骤。
- 默认短期 7 天、长期许可 90 天、3 个有效日期续期、30 个有效日期进入晋升审核、容量 100／1000／500、归档保留 90 天、后台主选 20 条及空闲 15 分钟不变；配置中的 `null` 仍表示原先对应的不限／禁用限制。
- `defaultCalibration.lexical={fact:1,experience:1}`、`semantic=null` 不变；不调整词法、RRF60、别名直达、始终提供项、权限、最近四段、预算或检索默认上限。
- 正常基础提交 `normalize(..., Infinity)` 仍可一次处理多条差额；后台 `normalize(..., 1)` 每轮只开始一个退出单元，其中“短期退出＋关联预备长期生效”可原子写两个 owner。不得把前台提交改成每次一条，也不得在短／长配对写入中间截断预算。
- 缺摘要、活跃短期关联、有效认识证据及本轮恢复保护可以使数量暂时超标；保留状态／blocked 信息，不为达到目标删除唯一事实依据。
- 快照只在一次同步调用／已有事务中复用，不跨 `await`、调度轮、事务或配置变化缓存。写入仍沿原事务、版本、dirty、grant、purge 和恢复路径；元数据不能交给 `saveOwner`、`queueIndex` 或模型。
- 历史审核证据保持只读；新测量统一存于 `docs/v0.5/records/comprehensive-remediation-20261011/evidence/`。时间使用同机前后相对实测，不承诺绝对毫秒或恒定时间；SQLite 对 JSON 提取仍会访问原存储页，不能宣称彻底摆脱正文大小影响。

## Review Focus

1. 空正文、全 ECMAScript `trim()` 空白和没有来源的短／长配对必须保留现有缺摘要与修复资格，不能因元数据占位文本变为可删除（Task M1-A／M1-C）。
2. 多条短期、合并旧 ID、认识主依据及 evidence 指向同一 canonical 时，计数、保护与唤醒读取不重复；同时保留短期本身的事件更新时间（Task M1-A／M1-B）。
3. 同一 epoch 的 `Z`／时区偏移 ISO 表示、衰减封顶／未到时间及所有平局顺序保持稳定，不能用文本 `MAX` 或字符串排序代替时间比较（Task M1-B）。
4. 无变化、不可退出的超量、一次多条基础提交及后台配对写两 owner 是不同情形，各有结果和工作次数断言（Task M1-B／M1-C）。
5. 旧／新环境快照经 JSON 往返、冻结基础查询为空后实际补查非空、配置变化和校准兼容向量均需恢复正确；不可用通道不得读取或重新制造向量，索引登记不受查询 gate 限制（Task M2-A／M2-B）。

---

## 已锁定的数据与行为合同

### 元数据不是缩短后的正文

新增 `src/memory/policy-snapshot.ts`。为避免误用既有 `memoryMetadata()` 的 `content:'present'`／`sourceIds:['present']` 兼容投影，本轮保留该旧函数及它的既有导出；新热路径只使用显式 `MemoryPolicyRow`。新投影不返回 `content`、`value`、`eventSummary`、`feelingSummary`、`topics`、`sourceIds`、`projectionBasis` 或向量。

`MemoryPolicyRow` 包含且只包含：

| 字段 | 类型／取得方式 |
| --- | --- |
| `table` | `'memories'\|'details'\|'learned_background'`，由查询分支指定 |
| `id,ownerId` | `string`，均取 SQL 主键 `id`，沿既有元数据行为 |
| `kind,ownerType` | `MemoryCandidate` 同名类型；JSON 缺失时依表默认 `long/detail/learned` |
| `status,importance` | `MemoryCandidate` 同名类型，原 JSON 值，不新增业务默认值 |
| `createdAt,happenedAt,lastEventUpdateAt` | `string`，原 JSON 值 |
| `mergedInto,shortExpiresAt,linkedLongId,retainedFrom,expiresAt` | `string\|null`，原 JSON 值 |
| `capacityExitedAt,archiveEnteredAt` | `string\|null`，缺失为 `null` |
| `capacityExitReason` | `'short_capacity'\|'long_capacity'\|null`，缺失为 `null` |
| `canonicalMemoryId` | `string\|undefined`，保留原值 |
| `totalAwakenings,revision,stateVersion` | `number`，原值，唤醒次数不从历史行重算 |
| `consolidatedRevision,evaluatedEvidenceVersion` | `number\|null`，原值 |
| `learnedKind,summaryRepairBasis` | `MemoryCandidate` 同名可选类型，原值 |
| `evidenceMemoryIds` | `string[]`，仅解析此 JSON 数组，缺失为 `[]` |
| `hasContent` | `boolean`，SQL 等价于 `(content ?? value ?? '').trim().length>0`；复制 `metadata.ts` 的完整 ECMAScript trim 空白字符集合，不只用 SQLite 默认空格 |
| `hasSources` | `boolean`，等价于 JSON `sourceIds` 数组长度 `>0`，不物化源 ID 数组 |

`MemoryPolicySnapshot` 持有 `rows:MemoryPolicyRow[]`、`byOwner:Map<string,MemoryPolicyRow>`、`legacyById:Map<string,MemoryPolicyRow>`、`memoryById:Map<string,MemoryPolicyRow>`、`learnedById:Map<string,MemoryPolicyRow>`；前三池按原顺序 `memories → details → learned_background`，每池 `ORDER BY id`，owner key 为 `${ownerType}:${ownerId}`。这些 Map 各构造一次，后续只读查找或替换已写 owner 对应条目。

保留两个明确的规范身份解析模式，不在性能修改中暗改同 ID 跨表行为：`policyCanonical(snapshot,id,'metadata')` 完全复现旧 `metadataCanonical` 的三池 `Map` 后值覆盖及解析顺序；`policyCanonical(snapshot,id,'owner')` 完全复现 `MemoryStore.canonical` 的先 memories、缺失才 learned、后续跳转只读 memories。两者均先处理 `canonicalMemoryId`、再沿 `mergedInto`、最终只接受 `kind==='long'`。现有保护／counts／nextDeadline／只读检查／maintenance 用 metadata 模式；容量短期配对、排序短期唤醒与 applyOne 摘要判断用 owner 模式。不要趁机统一其历史边界差异；针对跨表同 ID 的基线测试锁住两条路径。

### 资格与排序

- `archiveStart` 仅接受 long、active、无 mergedInto，按 `archiveEnteredAt ?? capacityExitedAt ?? (expiresAt<=now ? expiresAt : null)`；已有归档锚点优先于后来变更的到期。
- 活跃短期是 short、active、无 mergedInto、无 capacityExitedAt、有 shortExpiresAt 且 `>now`。普通长期占用是 long、active、无 mergedInto、未归档；含 `retainedFrom>now` 的预备摘要。`longPreview`／`longVisible` 和所有 overflow 算法保持原值。
- 容量保护：active 且无 mergedInto 的短期，其关联 canonical 在短期活跃时保护；清理额外 `includeRetainedShorts=true` 时，关联长期缺正文，或短期到期仍在未来，也保护。active learned 的 canonicalMemoryId 和 evidenceMemoryIds 均解析并去重保护。调用 normalize 的 `protectedLongIds` 与本次退出短期所关联长期只加入临时退出保护；`counts.protectedLong` 仍只统计正常引用保护，不把临时保护写成持久计数。
- `meaningfulMs` 为该候选自身 `lastEventUpdateAt` 与其相关长期的全部 `firstEffectiveAt` 中最大 epoch。短期使用所关联 canonical 的唤醒时间，但不使用 canonical 的 `lastEventUpdateAt`；无关联长期时只有短期自身事件时间。短期的 `awakeningCount` 来自关联 canonical 的 `totalAwakenings` 或 0；长期取自身 `totalAwakenings`。不以查询到的唤醒行数代替计数。
- 活跃排序从小到大依次比较：`Number(importance==='high')`、`awakeningCount`、**负向** `decay`、`meaningfulMs`、`happenedMs`、`createdMs`、`id` 的现有 `<`／`>` 字符串序；`decay=clamp((nowMs-meaningfulMs)/((kind==='short'?7:90)*86400000),0,1)`。不得将最后 ID 顺序换成 `localeCompare`。
- 归档排序依次：`awakeningCount`、`meaningfulMs`、高重要度布尔、`happenedMs`、`createdMs`、同样 ID 字符串序。比较器只能读已计算的数值／ID，不访问 DB、canonical 或逐条时间解析。
- cleanup 过期短期仍按当前条件 short、active、有 expiry 且 `<=now`，此处不额外排除 mergedInto／capacityExitedAt；有非空关联 canonical 正文才可清理。缺正文修复资格严格等价于 `summaryRepairPair`：短期 active、无 mergedInto、自身有正文；关联 long 的 status 为 active／durable、无正文；双方至少一方有来源；`summaryRepairBasis !== JSON.stringify([short.revision,short.stateVersion,long.revision,long.stateVersion])`。
- cleanup 顺序不变：可删到期短期 → 可删 merged/discarded short/long/learned → 归档。旧 owner 被任何 short 的 `linkedLongId` 引用，或 active learned 的直接 canonical/evidence 引用，就仍阻止删除；不要把“任何 short”缩成“活跃 short”。归档优先处理**无保护且到期**项；有此类项时不混入未到期溢出项；否则若归档超量才从全部无保护归档排序。一次仅 purge 第一项，保持 `blockedIds` 的原顺序和字符串。
- `nextDeadline` 只需知道 eligible／repair 是否存在，不需要确定“第一名”；不为存在性判定读取唤醒或排序。它在容量 overflow 后的 `can` 判定逐条件保留现实现：long 分支为 long/active/无 archiveStart/未受保护，short 分支为 short/active/无 capacityExitedAt/expiry>now/关联摘要存在，这两处分支不额外补 mergedInto 判定。没有立即工作时，未来 deadline 仍按现有短期摘要条件与归档 age 条件筛选，只返回严格晚于 now 的最小 epoch 对应原字符串。

### 语义 gate 与冻结

`selectCandidates` 是通用数据访问函数，不能根据 query 是否空、phase 或默认校准自行决定是否读向量。新增 options，默认仍读向量，以保持已有存储调用／测试行为。

语义 reason 优先级完全保持：`no_index → empty_query → uncalibrated → signature_mismatch → no_compatible_candidate → null`。前四项能在读候选前判定；第五项需候选后校验维度、有限值、非空向量，且维持 alwaysInclude 与事实别名直达候选不参与 compatible 判定的现有规则。合法 semantic 阈值仍要求两个数均 finite 且处于 `[-1,1]`；不更改指标累加时机（每次 build/buildFrozen 只累计一次 skip）。

环境快照的初始 setting/query 不一定等于模型稍后补查 query，因此冻结只按**与 query 无关的能力**省略向量。配置可语义检索而基础 query 为空时仍冻结向量，实际 lookup query 为空时再跳过；不能把 `empty_query` 存成永久能力拒绝。新字段可选，外层 `EnvironmentPreparationSnapshot.version` 保持 1，旧 `signature=digest(retrieval.configuration())` 及 configuration 返回结构不变。

---

### Task M1-A：建立显式元数据快照，复用 canonical 索引

**Files:** Create `src/memory/policy-snapshot.ts`, `tests/memory-policy-snapshot.test.ts`；Modify `src/memory/metadata.ts`（仅允许新增共享 trim 导出／可选索引，旧 API 保持兼容）, `src/memory/summary-repair.ts`, `src/memory/maintenance.ts`；Test `tests/memory-pending-refresh.test.ts`, `tests/memory-batch-characters.test.ts`。

**Interfaces:**

- Produces `readMemoryPolicySnapshot(db:Pick<Storage,'prepare'>):MemoryPolicySnapshot`、`policyRow(owner:MemoryCandidate,table:MemoryPolicyRow['table']):MemoryPolicyRow`、`replacePolicyRow(snapshot:MemoryPolicySnapshot,owner:MemoryCandidate):void`、`policyCanonical(snapshot:MemoryPolicySnapshot,id:string,mode:'metadata'|'owner'):MemoryPolicyRow|null`，定义于新文件。
- Produces `summaryRepairPolicyPair(short:MemoryPolicyRow,long:MemoryPolicyRow|null):boolean`；既有 `summaryRepairPair(short:MemoryCandidate,long:MemoryCandidate|null)` 保持类型／调用兼容，断言两者等价。`summaryRepairBasis` 参数收窄为 `Pick<OwnerVersion,'revision'|'stateVersion'>` 即可接受两种输入，序列化内容不变。
- Changes `MemoryMaintenance.incrementalCandidates(reserved:Set<string>):MemoryPolicyRow[]`；先过滤 dirty／reservation 资格，再沿既有 `store.owner(ref)` 读取这些可用主项完整 owner，之后才调用 `selectBatch`／`buildSnapshot`，保持字符软目标基于完整正文。不把元数据当 MemoryCandidate 强转，也不新增这条路径的全文读取预算。

- [x] **Step 1: 写失败测试。** `policy_projection_matches_content_and_source_predicates` 对 `''`、空格、`\t\n`、`\u00a0\u2003\ufeff`、中文正文、缺 content 但有 value、空/单项 sourceIds 逐项断言 `row.hasContent === (content??value??'').trim().length>0` 与 `row.hasSources === sourceIds.length>0`；`expect('content' in row).toBe(false)`、`expect('sourceIds' in row).toBe(false)`，正文放入 4096 字符尾部标记，断言快照 JSON 不包含该标记。
- [x] **Step 2: 写 canonical／repair 等价测试。** `policy_canonical_modes_match_existing_readers` 构造 long A、merged B→A、learned C→B、两 short→B/C、跨 details／memories 同名 ID、跨 learned／memories 同名 ID、缺 target；分别与旧 `metadataCanonical(memoryMetadata(db),id)`、`store.canonical(id)` 比较最终 ID／null。`policy_summary_repair_matches_full_owner_pair` 对短期缺正文、双方无源、长期 durable／active／discarded、同修复版本逐项比较资格与 basis。
- [x] **Step 3: 运行 `npx vitest run tests/memory-policy-snapshot.test.ts`，预期新模块／导出缺失而失败。** 保留失败摘要到实施记录，不以类型断言跳过失败。
- [x] **Step 4: 实现以上投影和 Map。** 三池各一次列投影＋一次 sqlite_master 表清单，支持只读检查所用的旧缺表库；不 `SELECT data`。查询取得的数据与 `policyRow` 输出保持字段／缺省一致。替换 owner 时同步该 owner 在 rows 和各索引的位置，保留三池原顺序；跨表同 ID 时 legacyById 的获胜行仍由原表顺序决定，不能因较早表更新而覆盖较晚表。只允许更新本快照已存在的 owner。
- [x] **Step 5: 将 incrementalCandidates 改为单快照读取。** 仍按 dirtyOwners 原顺序、pending／reservation 条件过滤；canonical 调用传 `'metadata'`。新增 `incremental_candidates_hydrate_full_text_before_batch_selection`，设置 40 个主项且 `batchItems=20`，断言进入 batch 字符筛选的是完整正文、模型输入尾部标记存在、未选主项仍 pending，现有依赖闭包不被裁掉。
- [x] **Step 6: 运行 `npx vitest run tests/memory-policy-snapshot.test.ts tests/memory-pending-refresh.test.ts tests/memory-batch-characters.test.ts` 及 `npm run typecheck`，预期全通过。**
- [x] **Step 7: 独立 commit `refactor(memory): add explicit policy metadata snapshots`。** 仅暂存本 Task 的实际变更文件；可单独回滚，不触及容量／检索行为。

### Task M1-B：容量无变化快路径与纯值排序

**Files:** Modify `src/memory/capacity.ts`, `src/deployment/memory-capacity-upgrade.ts`；Create `src/memory/policy-order.ts`, `tests/memory-policy-order.test.ts`, `tests/memory-capacity-work.test.ts`；Test `tests/review17-capacity-cost.test.ts`, `tests/memory-capacity-lifecycle.test.ts`, `tests/memory-capacity-upgrade.test.ts`, `tests/memory-v3-recovery.test.ts`。

**Interfaces:**

- Consumes Task M1-A 的 `MemoryPolicySnapshot`／canonical／replace helpers。
- Produces `readLatestAwakeningTimes(db:Pick<Storage,'prepare'>,canonicalIds:readonly string[]):Map<string,number>`（`policy-order.ts`）：先去重 ID，每批最多 500 参数，只取 `canonicalMemoryId,firstEffectiveAt`，按 `milliseconds` 求最大值，不读 sourceIds／turnId／localDate；空 ID 集不发 SQL。调用者仅在表存在时调用；runtime MemoryStore 已保证表存在，旧库 inspector 依已有 tables 集跳过缺表。
- Produces `MemoryOrderKey={importance:number;awakeningCount:number;decay:number;meaningfulMs:number;happenedMs:number;createdMs:number;id:string}`、`memoryOrderKeys(rows:readonly MemoryPolicyRow[],snapshot:MemoryPolicySnapshot,latest:ReadonlyMap<string,number>,now:string,canonicalMode:'metadata'|'owner'):Map<string,MemoryOrderKey>`（owner key）；`activePolicyOrder(keys:ReadonlyMap<string,MemoryOrderKey>):(a:MemoryPolicyRow,b:MemoryPolicyRow)=>number`、`archivePolicyOrder(keys:ReadonlyMap<string,MemoryOrderKey>):(a:MemoryPolicyRow,b:MemoryPolicyRow)=>number`，全部定义于 `policy-order.ts`。本轮保留旧 `activeOrder/meaningfulAt/archiveOrder` 导出用于基线对照／兼容，但新 normalize/cleanup/inspector 不再调用。
- Produces `policyProtectedIds(snapshot:MemoryPolicySnapshot,now:string,includeRetainedShorts=false):Set<string>`、`policyCapacityCounts(snapshot:MemoryPolicySnapshot,now:string,config:MemoryCapacityConfig):MemoryCapacityCounts`（`capacity.ts`），接受 Task M1-A 投影而非伪正文；旧 `protectedCanonicalIds/capacityCounts` 保留兼容。它们与旧函数对同一 fixture 的返回值必须一致。另定义 `CapacityPolicyRow=Pick<MemoryCandidate,'kind'|'status'|'mergedInto'|'capacityExitedAt'|'archiveEnteredAt'|'expiresAt'|'shortExpiresAt'|'totalAwakenings'>`，`archiveStart/isArchivedLong/activeShort/ordinaryLong/promotionEligible` 的 row 参数改用此结构类型，使完整 owner 与显式 policy row 都能直接传入；不强转成有正文的候选。
- Extends `MemoryCapacity.counts(now:string,snapshot?:MemoryPolicySnapshot)`、`protectedIds(now:string,includeRetainedShorts=false,snapshot?:MemoryPolicySnapshot)`、`normalize(now:string,protectedLongIds:string[]=[],changeBudget=Infinity,snapshot?:MemoryPolicySnapshot):CapacityResult`；未提供快照时各自创建，normalize 内部所有阶段复用同一个快照。外部原调用不改。

- [ ] **Step 1: 写工作次数失败测试。** `normalize_at_limits_hydrates_zero_owners` 对正文 128／4096 字符，分别建 100 活跃 short（关联前 100 long）＋1000 occupied long＋500 未到清理年龄 archive，断言 `changedOwners=[]`、counts 与旧函数深等、`allOwners=0`、完整 owner 读取行数 0、`listAwakenings=0`、批唤醒查询 0、政策快照装载 1、元数据行 1600、owner/grant/dirty 写入 0。计数器在建库、旧实现预期值计算之后安装，只统计单次被测调用；断言用的查库移到计数窗口之外。
- [ ] **Step 2: 写超量／排序失败测试。** `normalize_single_overflow_bounds_sort_reads` 在上例新增一个普通 long，共 1601 元数据行；100 protected long 不进退出排序，901 distinct canonical 的批唤醒 SELECT 恰为 2；`allOwners=0`、`listAwakenings=0`、完整 owner 读取行数 1、退出 owner 1、返回 longOccupied=1000，snapshot 装载仍 1。`policy_comparators_do_not_read_database` 在键建好后把 db.prepare、store.canonical、store.listAwakenings 替换成抛错函数再排序，断言结果与旧比较器预先算出的 ID 序列一致。
- [ ] **Step 3: 写行为矩阵。** `active_order_preserves_all_tie_breakers`／`archive_order_preserves_all_tie_breakers` 使用每层至少一对只在该层不同的记录，比较预先固定 ID 序列；含 future meaningful、超过 7／90 天衰减封顶、same-epoch `'2026-10-11T00:00:00.000Z'` 与 `'2026-10-11T08:00:00+08:00'`、一个文本排序靠前但 epoch 更晚的唤醒。`shared_canonical_is_loaded_once_without_losing_short_event_time` 用 100 short→同一 merged/learned 规范事件，断言 distinct awakening ID=1、SELECT=1、每个 short meaningfulMs 仍受其自己的事件时间影响、count 来自同一 long.totalAwakenings。
- [ ] **Step 4: 写保护／预算矩阵。** `blocked_overflow_preserves_protected_and_missing_summary` 分别造全部长期受引用/本轮恢复保护、短期关联缺失/全空白摘要，断言保持 overflow、无 owner 物化或写入。`story_normalize_handles_multiple_deltas` 用 shortLimit=1、longLimit=2，建三对新短期/预备长期，Infinity 后 shortActive=1，退出两 short、其两 long 同步提前生效且临时保护有效。`background_budget_one_keeps_short_long_pair_atomic` 对相同输入预算1，断言只退出一 short、只提前对应 long、`changedOwners` 恰2、grant 初始 anchor=now、其余 pair 不变；既有状态版本/dirty 一致。另断言 `changeBudget=0` 不写。
- [ ] **Step 5: 运行 `npx vitest run tests/memory-policy-order.test.ts tests/memory-capacity-work.test.ts`，预期热路径计数／新导出失败。**
- [ ] **Step 6: 实现容量步骤。** 先从一快照算 counts／正常保护，无 shortOverflow／longOverflow 即返回（archiveOverflow 不由 normalize 清理）。有短期差额才为符合退出资格的 short 建键；去重所关联 canonical ID 后批读时间。选中 short 与确需更新的 long 才按 `store.owner(ref)` hydrate，每个不同 owner 本调用至多一次；单次 `listGrants` 同时找 initial 和 others，维持 `max(now+90天,others.expiresAt)`；写 owner／dirty／grant 后立即 replacePolicyRow。短期退出完成后从更新快照重算 occupied/保护，合并临时保护再做 long 差额；直接 long 退出仅 hydrate 被选中的那一行。每阶段重算只在内存中，不重新 SELECT 全池。
- [ ] **Step 7: 迁移只读 inspectMemoryCapacity。** 同一个 policy snapshot 用于 counts、两类保护、short/long/archive 顺序及 missingReferences；排序 canonicalMode='metadata'，保留 inspector 与原 dry-run 的现有输出，不改迁移、备份、SQL 归档锚点或正式库。把回归断言落在 `tests/memory-capacity-upgrade.test.ts`，含缺 memory_awakenings 表旧库。
- [ ] **Step 8: 运行 `npx vitest run tests/memory-policy-order.test.ts tests/memory-capacity-work.test.ts tests/review17-capacity-cost.test.ts tests/memory-capacity-lifecycle.test.ts tests/memory-capacity-upgrade.test.ts tests/memory-v3-recovery.test.ts` 和 `npm run typecheck`，预期全通过。** recovery 测试必须保留普通基础事务原 normalize 调用无有限预算这一断言，不能为通过成本测试移走基础提交工作。
- [ ] **Step 9: 独立 commit `perf(memory): normalize capacity from one policy snapshot`。** 包含排序、容量、只读检查及其测试；不包含 cleanup 或语义变化。

### Task M1-C：清理资格与截止复用快照

**Files:** Modify `src/memory/cleanup.ts`；Create `tests/memory-cleanup-policy-work.test.ts`；Test `tests/memory-capacity-cleanup.test.ts`, `tests/memory-cleanup-write-amplification.test.ts`, `tests/memory-capacity-prune-race.test.ts`, `tests/memory-capacity-idle-integration.test.ts`。

**Interfaces:**

- Consumes Tasks M1-A／M1-B 投影、repair、count、保护、排序和 normalize optional snapshot。
- Changes 内部 `candidates(now:string,snapshot:MemoryPolicySnapshot,ordered:boolean,canonicalMode:'metadata'|'owner')`，返回 `{rows:MemoryPolicyRow[];protect:Set<string>;repairs:MemoryPolicyRow[];eligible:MemoryPolicyRow[]}`。public `applyOne/nextDeadline/status` 签名不变。
- nextDeadline 传 ordered=false／metadata；applyOne 传 ordered=true／owner，保护仍通过 metadata 模式的 policyProtectedIds。只有 applyOne 的实际归档排序使用批唤醒键。

- [ ] **Step 1: 写无变化调度测试。** `next_deadline_reads_one_metadata_snapshot_without_sorting` 使用 100／1000／500、128 和4096字符两档，所有 archive 距清理年龄还差一天，short 七天后到期；断言 deadline 与旧实现固定值一致、snapshot=1、metadataRows=1600、完整 owner=0、awakening SELECT=0、owner/grant/dirty/purge 写入=0。`next_deadline_eligible_archive_needs_no_awakening_reads` 放501 archive，断言 deadline=now、awakening SELECT=0。
- [ ] **Step 2: 写资格和 blocked 失败测试。** `cleanup_projection_preserves_expired_and_old_reference_rules` 覆盖已 capacityExited short、有 mergedInto 但仍 active 的过期 short、任意非活跃 short 对旧 owner 的引用、active learned 的直接 evidence 引用；断言可删 ID 序及被保留 ID 与合同一致。`missing_summary_repairs_only_changed_basis` 覆盖缺正文/空白、双方无源、长期 durable、相同 basis 和版本变化；断言 `status().blockedIds`、nextDeadline、一次排队／随后不重复完全一致。
- [ ] **Step 3: 写单元／门禁测试。** `apply_one_purges_only_first_eligible_and_keeps_archive_priority` 同时有到期短期、discarded、到期归档和未到期溢出归档，分次调用断言精确删除顺序、每次 purge=1；到期归档排序只在到期未保护集合内。`cleanup_gates_do_not_load_policy_snapshot` 分别 paused／unfinishedTurn／openBatch，断言 applyOne='blocked'、nextDeadline=null、snapshot=0。`cleanup_capacity_fallback_reuses_snapshot` 无可 purge/repair 但超量，断言 normalize 后 snapshot 总装载仍1。
- [ ] **Step 4: 运行 `npx vitest run tests/memory-cleanup-policy-work.test.ts`，预期 snapshot／排序计数失败。**
- [ ] **Step 5: 实现纯元数据 candidates 与两条调用路径。** nextDeadline 无排序；applyOne purge 只需要 owner ref，不 hydrate 正文。实际 summary repair 必须从 store.owner 读取被选中 short 与 owner-mode canonical long 的完整内容，更新 basis/stateVersion 后存回真实短期并 queueDirty；最多2完整 owner，不将投影正文或假 source 写回。无 eligible/repair 时将同一快照传 `normalize(now,[],1,snapshot)`。不改 purgeOwner 派生任务修剪语义。
- [ ] **Step 6: 运行 `npx vitest run tests/memory-cleanup-policy-work.test.ts tests/memory-capacity-cleanup.test.ts tests/memory-cleanup-write-amplification.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-capacity-idle-integration.test.ts` 及 `npm run typecheck`，预期全通过。**
- [ ] **Step 7: 独立 commit `perf(memory): reuse policy metadata for cleanup scheduling`。**

### Task M2-A：current build 在候选读取前判定向量需求

**Files:** Modify `src/memory/store.ts`, `src/memory/retrieval.ts`, `src/deployment/memory-runtime.ts`；Create `tests/memory-retrieval-vector-work.test.ts`；Test `tests/memory-v3-store.test.ts`, `tests/memory-v3-retrieval.test.ts`, `tests/memory-v3-index.test.ts`, `tests/memory-v3-deployment.test.ts`。

**Interfaces:**

- Produces `CandidateReadOptions={includeVectors?:boolean}`（`store.ts`）和 `selectCandidates(request:RetrievalRequest,options:CandidateReadOptions={}):MemoryCandidate[]`，默认 `includeVectors!==false`。false 的 SQL select 只返回 `o.data`，不含 JOIN memory_index／vector 列，不分配 Float32Array；两条 SQL 的资格条件和参数绑定完全相同。
- Produces `SemanticCapability={reason:'no_index'|'uncalibrated'|'signature_mismatch'|null;indexSignature:string|null;dimensions:number|null}`、`MemoryRetrieval.semanticCapability():SemanticCapability`（`retrieval.ts`）。纯读取、不更新 metrics；不包含 query 空否。
- Produces `semanticPreflight(query:string,capability:SemanticCapability):'no_index'|'empty_query'|'uncalibrated'|'signature_mismatch'|null`（`retrieval.ts`），按已锁定优先级。
- Extends `buildFrozen` 既有参数后追加 `capability?:SemanticCapability`；缺省用 `semanticCapability()`。先 preflight，再且仅当 preflight=null 时做 compatible 判断；实际 query／skip 统计仍集中在 buildFrozen。
- `configuration()` 输出结构保持 `{limits,calibration,indexSignature}`，不得把新 capability/dimensions 附加进去导致旧快照 digest 全失效。

- [ ] **Step 1: 写 gate 工作量测试。** `current_build_skips_vector_sql_for_preflight_reasons` 参数化 no_index／empty_query／semantic null／NaN或超界阈值／signature_mismatch，1000 long 各1024维当前 revision 向量，断言向量 SELECT/JOIN=0、解码字节=0、provider.embed=0、skipReason 精确值、skip次数每 build +1、返回上下文与用旧全向量候选调用 buildFrozen 的结果深等；重叠条件断言 reason 优先级。
- [ ] **Step 2: 写可用及通用调用测试。** `select_candidates_defaults_to_vectors_and_false_preserves_visibility` 沿用 store 测试矩阵，默认调用仍得到当前 signature+revision 向量；false 所有 candidate 公共字段相同、没有 normalizedVector，权限拒绝仍抛错。`calibrated_current_build_keeps_vector_and_rrf_path` 1000×1024向量，signature匹配，断言解码字节=4,096,000、query调用=1、旧RRF排序与结果一致。`no_compatible_candidates_skips_remote_after_read` 分别空向量／错维／非finite／仅alwaysInclude或别名直达，断言 reason='no_compatible_candidate'、remote=0。
- [ ] **Step 3: 写登记保护测试。** `index_registration_does_not_inherit_empty_query_gate` 令 `memory_index_rebuild_required=true`，以空 query 的 index_registration 走 assembleMemory，断言原候选集合全部登记、index text 完整含正文／topics／feelingSummary／projectionBasis，配置签名和 revision 正确；`includeVectors:false` 只省向量，不能省正文。后续 index.prepare/apply 的原测试照常通过。
- [ ] **Step 4: 运行 `npx vitest run tests/memory-retrieval-vector-work.test.ts`，预期 preflight 仍JOIN或新接口缺失而失败。**
- [ ] **Step 5: 实现 options 与 gate。** current build 先取 capability/preflight，再 `selectCandidates(request,{includeVectors:preflight===null})`，将同一 capability 传 buildFrozen，计时仍包围实际 candidate SQL。index_registration 明确传 `{includeVectors:false}`，因为该调用仅以完整 owner 文本排索引；其他直接调用不改变默认。不要修改 memoryIndexText、MemoryIndex prepare、队列合并、已存索引或 calibration 文件。
- [ ] **Step 6: 运行 `npx vitest run tests/memory-retrieval-vector-work.test.ts tests/memory-v3-store.test.ts tests/memory-v3-retrieval.test.ts tests/memory-v3-index.test.ts tests/memory-v3-deployment.test.ts` 及 `npm run typecheck`，预期全通过。**
- [ ] **Step 7: 独立 commit `perf(memory): skip vector reads when semantic retrieval is unavailable`。** 可在 M1 之前或之后实施，不依赖 M1 helper。

### Task M2-B：新环境冻结省向量，兼容旧快照与配置校验

**Files:** Modify `src/environment/snapshot.ts`；Create `tests/environment-retrieval-vector-snapshot.test.ts`；Test `tests/environment-preparation-snapshot.test.ts`, `tests/environment-async-recovery.test.ts`, `tests/environment-async-provenance.test.ts`, `tests/environment-async-tools.test.ts`。

**Interfaces:**

- Consumes Task M2-A `SemanticCapability/semanticPreflight`、selectCandidates options 和 buildFrozen 追加参数。
- Extends `FrozenEnvironmentRetrieval` 可选字段 `semanticPolicy?:{version:1;capability:SemanticCapability;vectorsIncluded:boolean}`。旧 snapshot 无字段合法，不迁移/补写历史任务。
- `freezeEnvironmentRetrieval` 以 `capability.reason===null` 决定 includeVectors 与 vectorsIncluded。原 request/recent/sourcePresence/invalidSourceIds/signature 字段保留；禁用能力的候选对象不出现 normalizedVector 属性（不是空数组）。
- `lookupFrozenEnvironment` 先校验原配置 digest，再 resolveLookupRequest；新 snapshot 用保存 capability，旧 snapshot 用当前 capability（原配置 digest 已相等），然后按实际 query preflight 决定是否把已有 number[] 转 Float32Array。新 snapshot 策略的 indexSignature／dimensions 须与当前 capability 匹配；不匹配抛原 `frozen retrieval configuration changed`。无 live selectCandidates/owner/vector 回补。

- [ ] **Step 1: 写默认冻结量测试。** `uncalibrated_environment_freeze_omits_all_vectors` 建1000 long×1024维，default calibration；断言 vector JOIN=0、解码=0、`JSON.stringify(snapshot.retrieval.candidates)` 不含 `normalizedVector`、semanticPolicy.reason='uncalibrated'、vectorsIncluded=false、signature仍等于原configuration digest。冻结源合法性/usedBasis所需候选正文与sourceIds保持完整。
- [ ] **Step 2: 写恢复矩阵。** `frozen_retrieval_old_and_new_json_roundtrip_preserve_results` 对旧形状（删除semanticPolicy）、新无向量、新有向量三类 JSON 往返；测试当前 calibration相同且 signature相同，之后修改 live owner/向量，断言 lookup 不调用 live selectCandidates、结果／usedBasis 来自冻结数据。旧无政策但带向量且未标定时断言不分配Float32Array、不query，仍输出旧词法结果；旧无政策但校准能力可用、新有向量两种情形均 query=1并保持语义结果。
- [ ] **Step 3: 写空基础query和配置测试。** `empty_freeze_query_does_not_disable_later_semantic_lookup` 令 worldSetting=''、能力已标定且有兼容向量，冻结 vectorsIncluded=true；随后非空lookup断言获得语义结果，空lookup断言empty_query且不query。`frozen_lookup_rejects_changed_configuration_before_decoding` 分别改 calibration、limits、index endpoint/model/dimensions/template签名，断言抛`frozen retrieval configuration changed`、query=0、Float32Array转换=0、lookupBasisCurrent=false；原配置旧快照仍接受。
- [ ] **Step 4: 写权限／来源／取消回归。** `frozen_lookup_keeps_permissions_sources_and_abort` 断言越权archive/history拒绝、invalidSourceIds命中仍拒绝、旧/新快照对AbortSignal沿既有行为抛出且不回补live内容；新语义跳过原因仍只累计一次。
- [ ] **Step 5: 运行 `npx vitest run tests/environment-retrieval-vector-snapshot.test.ts`，预期默认冻结仍携带向量／新字段缺失而失败。**
- [ ] **Step 6: 实现冻结与恢复字段。** 保存capability快照，不将empty_query或no_compatible_candidate写作永久能力；保留原配置摘要算法和外层version=1。restore时解析已有数组仅在实际通道可用时执行；配置检查在数组转换、query及结果使用之前。`lookupBasisCurrent` 继续使用原signature及owner/source版本校验。
- [ ] **Step 7: 运行 `npx vitest run tests/environment-retrieval-vector-snapshot.test.ts tests/environment-preparation-snapshot.test.ts tests/environment-async-recovery.test.ts tests/environment-async-provenance.test.ts tests/environment-async-tools.test.ts` 及 `npm run typecheck`，预期全通过。**
- [ ] **Step 8: 独立 commit `perf(environment): freeze semantic capability without unused vectors`。** 依赖M2-A，回滚时先回滚此提交，再M2-A；不清除已有冻结任务。

### Task M-D：固定工作预算、相对测量与已接受文档同步

**Files:** Create `scripts/check-memory-access-work.ts`, `tests/memory-access-work-probe.test.ts`, `docs/v0.5/records/comprehensive-remediation-20261011/evidence/memory-access-before.json`, `docs/v0.5/records/comprehensive-remediation-20261011/evidence/memory-access-after.json`, `docs/v0.5/records/comprehensive-remediation-20261011/evidence/memory-access-comparison.md`；Modify `docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md` §6、9–10，以及 `docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md` §6 环境步骤恢复。不改审核源报告、旧JSON/日志或检索质量标定。

**Interfaces:** `runMemoryAccessProbe():Promise<MemoryAccessProbeReport>`（脚本export并CLI调用），报告包含 `head,nodeVersion,platform,fixtureSeed,pools,textCharacters,warmups,samples,medianMs,work,vectorBytes,snapshotBytes`。只创建 `Storage(':memory:')`，固定种子／时间、provider为离线stub；输出路径由显式 `--output <path>` 参数指定，不写用户配置或数据库。

- [ ] **Step 1: 写探针校验测试。** `access_probe_has_deterministic_work_counts` 用上文100/1000/500及额外一long两档正文，断言结构、样本数7、warmups1、每次计数器重置、样本重新造同样超量状态，不能第一次退出后把后六次“无超量”当同类测量。`probe_never_uses_network_or_real_storage` 将网络stub设为抛错，断言只创建内存库、模型调用0。
- [ ] **Step 2: 运行 `npx vitest run tests/memory-access-work-probe.test.ts`，预期脚本导出缺失失败，再实现探针。** 计数器在fixture建好后装配；区分 metadataRows、完整owner行、awakening批次数/行、vector decode bytes、owner/grant/dirty写入，不能只算allOwners而漏掉逐owner全文读取。`SELECT`分析需覆盖SQL实际列／JOIN和返回的BLOB字节；metrics.candidates不能替代向量字节计数。
- [ ] **Step 3: 取得before/after同机测量。** 保留审核历史样本作背景；用相同新探针在基线独立只读源码副本／临时worktree与待交付源码各运行一次，基线适配仅在探针层计数，不替换实现。探针仅调用两版共有的公开 capacity/cleanup/retrieval/freeze API，不导入新 policy helper；通过实际SQL形状/返回行/BLOB字节计数，以便原样运行基线。每档正文先1次预热、再7次独立同状态样本；保存完整 samples、median、源码HEAD及环境。若基线需依赖编译，沿同样Node/deps版本执行，输出到独立临时构建目录，不覆盖根lib，不访问正式库。输出命令为 `npx tsx scripts/check-memory-access-work.ts --output docs/v0.5/records/comprehensive-remediation-20261011/evidence/memory-access-after.json`；基线使用同脚本和before路径。不得重跑原审核probe覆盖旧文件。
- [ ] **Step 4: 核对硬预算并记录相对时间。** 无超量 normalize：snapshot=1、metadata=1600、全文=0、awakening=0、写入=0；cleanup.nextDeadline同样全文/唤醒/写入为0且snapshot=1；单long溢出采用100受保护长的fixture：metadata=1601、排序canonical=901、awakening批次=2、全文=1、退出=1；未标定live build/freeze：vector bytes=0、remote=0；可用1000×1024语义：vector bytes=4,096,000、query=1。时间只列before/after median、比值和原始样本；若中位数退化或文本长度敏感性异常，先解释与定位再通过该Task，不以臆测收益验收。
- [ ] **Step 5: 更新已接受产品文档。** MEMORY §6追加“不可用语义通道在读候选前跳过向量，默认未标定仍保持词法/直接键”；§9说明元数据快照降低纯调度与归一重复读取，保留多条基础提交/后台一个单元区别；§10及RECOVERY环境段说明新冻结保存能力、旧快照兼容、配置变化拒绝、不从live补读。只有实际通过对应测试后才用完成时态；不要把“有索引”写成“默认语义已开启”，也不要写数据库体积恒定或主循环恒定耗时。
- [ ] **Step 6: 运行 `npx vitest run tests/memory-access-work-probe.test.ts`、以上各Task的定向测试合集、`npm run typecheck` 和 `git diff --check`。** 构建与全量suite统一交给 [DELIVERY_PLAN.md V1](DELIVERY_PLAN.md#v1每批工程验收) 的隔离输出流程；本子计划不运行覆盖根lib的 `npm run build`，也不重复跑全量。
- [ ] **Step 7: 独立 commit `docs(memory): record access budgets and compatible snapshot behavior`。** 同提交包含离线探针/测试/新证据/产品文档，只对已实际通过的优化记完成；M1或M2某一支未完成时分为两个对应文档提交，不先写未完成事实。

## 交付门槛与提交依赖

`M1-A → M1-B → M1-C` 与 `M2-A → M2-B` 可分别实施；两条线改同一文件时由顺序集成者解决，禁止并发覆写。M-D 在两条线完成后统一测量/同步产品文档。每个Task先失败测试、后最小实现、后定向通过再提交；提交前审阅 `git diff --stat` 和 `git diff --check`，不将已有用户文档改动一起暂存。

交付记录必须分别报告“生命周期/排序结果等价”“固定工作量预算”“相对时延与载荷实测”“current及old/new frozen恢复”“未改默认阈值/索引/正式数据”。运行记录必须真实；本方案文本自身不构成测试通过或性能收益证据。
