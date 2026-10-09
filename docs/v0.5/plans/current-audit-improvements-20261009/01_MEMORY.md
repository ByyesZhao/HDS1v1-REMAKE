# 记忆日期、批次软目标与清理成本实施计划

实施状态补充：T1～T9现已实施，实际结果见[交付](../../records/current-audit-improvements-20261009/DELIVERY.md)。下文复选项与“待实施”措辞保留原方案合同及当时状态，不代替完成证据；E1～E5独立后续尚未实施。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务执行。以下复选框是待执行步骤；本文件仅为实施方案，没有修改产品代码，没有运行本计划测试，不代表问题已关闭。

**Goal:** 修正 B1 事件日期默认值和 B2 字符软目标，消除逐条清理对历史终态载荷的重复重写，同时保留恢复、引用保护和 FIFO。

**Architecture:** 事件时间在生命周期入口一次解析；主选批次使用同一纯选择函数，依赖闭包随后扩展。物理清理只处理该 owner 的活动任务引用，终态载荷在完成边界压缩，旧残留通过显式、有限、可续跑的离线回收处理。

**Tech Stack:** TypeScript、Node.js `node:sqlite`、SQLite JSON 函数、Vitest；沿用现有单库同步事务和离线测试夹具，无新运行时依赖。

**Spec:** [记忆专项审核](../../reviews/current-audit-20261009/MEMORY_REVIEW.md)、[CODEX 核验 §3.1/3.2/3.4](../../reviews/CODEX_RESPONSE_CURRENT_AUDIT_20261009.md)、[V0.3 事件时间与批量合同](../../../MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[容量/空闲合同](../../../MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)。源码定位基于 `c9e4599`（包含 `b398699`）。行号仅辅助定位，以列出的函数名为修改锚点。

## 全局约束

- 本批任务号固定为 **T1、T2、T7**，其他任务见同目录总计划；不借此改变记忆容量、保存期限、知情权限、网页来源资格或睡眠规则。
- 已有来源核验、canonical 解引用、7 天短期窗口、90 天许可、真实进展门禁继续生效。记录时间与事件时间分别处理。
- `batchItems` 缺省 20，`batchCharacters` 缺省/null 不限；字符口径沿用 `[...row.content].length`，只计主选完整 `content` 的 Unicode code point，不改为 JSON 长度、UTF-16 长度或 token 数。
- 后台并发仍为 1；准备超时 120000ms、重试 300000ms 保持。首项超过字符目标仍独占；依赖闭包允许超目标；禁止切正文、切来源或丢闭包。
- `startedAt === null` 才明确未开始；缺字段的旧任务属于未知，不能刷新。已开始输入、web 阶段身份、累计 repairCount 和修补原文保持 R1 语义。
- 现有未提交文档和审核证据保留。实施只在隔离夹具/临时 SQLite 验证，不读私有配置、人物背景或正式库，不调用在线模型、QQ，不启动服务。

## Review Focus

1. **单个已知日期与缺日期不同**：只给 `happenedUntil` 不能混入整理时刻，T1 单日期矩阵测试覆盖。
2. **布尔进展不证明事件时刻**：true 且缺日期也不能把已有事件延到现在，T1 true/false 矩阵覆盖。
3. **旧批次退回 dirty 项不能被后来建批抢位**：T2 派发前增长 + 后来 c 入队的测试覆盖。
4. **依赖不再主选仍可能在闭包内**：T2 断言 `selectedIds`、`snapshot` 和 dirty 预留分别正确，不能以快照总字数误判失败。
5. **清理不能删除失败调用的恢复正文**：T7 运行 R1 完整文件及旧残留四表矩阵，不能只测 saveJob 次数。

## 已核对的入口与文件分工

| 文件/函数（当前约行） | 本计划责任 |
| --- | --- |
| `src/memory/lifecycle.ts` `apply` 17–58、`eventRange` 9–12 | T1 创建短期的日期解析；长期仍取范围并集 |
| `src/memory/store.ts` `canonical` 84–89 | 复用 learned→long、merged→canonical 路径，不另造身份规则 |
| `src/model/contracts.ts` `eventTimes` 38、`memoryTask` 128–135 | 日期仍 optional；已有事件进展布尔校验不放松 |
| `src/model/prompts.ts` `memory` 22 | T1 补清楚省略日期/单日期语义，不要求模型编造日期 |
| `src/memory/maintenance.ts` `ensureCycle`、`ensureIncremental`、`refreshUnstarted`、`startOne` 58–127 | T2 统一初选和刷新限额，控制补建时机 |
| `src/memory/store.ts` dirty API 25–50 | T2 使用现有版本条件释放；不重排 queuedAt |
| `src/memory/cleanup.ts` `applyOne` 28–34 | T7 移除每删 owner 的全历史压缩调用 |
| `src/memory/store.ts` `saveJob`、`pruneOwnerFromJobs`、`purgeOwner`、`compactCompletedPayloads` 165–202 | T7 定向活动引用修剪、完成时压缩、有限旧载荷回收 |
| `src/web/store.ts` `compactOwnerCheckpoint` 45–47 | T7 只更新确有 checkpoint 的目标 owner 会话 |
| `src/recovery.ts` 118–120、`src/environment/runtime.ts` 48–49、`src/memory/maintenance.ts` `prepare.finally` | 保留现有即时压缩触发点；本计划不重写运行流程 |
| 新建 `src/memory/batch-selection.ts` | T2 仅负责按有序主选列表取软目标前缀 |
| 新建 `src/deployment/memory-payload-compaction.ts`、`scripts/compact-memory-payloads.ts` | T7 显式离线兼容回收入口，读检查/备份/分批写入 |

---

## T1 — B1：创建关联短期时不污染既有事件日期

### 决定与接口

在“false 时忽略日期”和“日期事实独立于进展布尔”之间，固定采用后者：false 的本轮来源可以补充历史时间；true 只控制现有进展/保留许可逻辑，不能充当某个新事件日期的证据。

在 `src/memory/lifecycle.ts` 增加私有纯函数，供 `apply` 的 create 分支调用：

```ts
type EventTimes = { happenedAt?: string; happenedUntil?: string };
function resolveCreateEventRange(
  times: EventTimes,
  existing: Pick<MemoryCandidate, 'happenedAt' | 'happenedUntil'> | null,
  at: string,
): { happenedAt: string; happenedUntil: string };
```

该函数不检查来源、不解析 ID、不修改数据库；`apply` 仍先执行 `requireSources`，再以 `MemoryStore.canonical(change.existingLongId)` 获得 existing。无效 ID 继续报原错误。算法先收集本轮显式提供的日期；有任一日期时以这些已知时刻的最早/最晚值形成该 short 的已知范围；无日期时使用 existing 的起点和 `happenedUntil ?? happenedAt`；没有 existing 才使用 `at` 单点。比较继续使用 `milliseconds`，不按字符串比较带不同 offset 的 ISO 时间。

> 单日期等于“目前只有一个已知时刻”。不根据字段名称反推未知端点，也不拿 `at` 填另外一端。两个显式端点按最早/最晚归一化；这只规范新创建 short 的已知范围，不修改已有记录的范围规则。

| 输入 | 新 short 事件范围 | canonical long 更新 |
| --- | --- | --- |
| 新事件，无两个日期 | `[at, at]`，保留既有新事件默认值 | 新 long 使用同范围 |
| 新事件，仅 `happenedAt = D` | `[D, D]` | 同范围 |
| 新事件，仅 `happenedUntil = D` | `[D, D]`，不混入 at | 同范围 |
| 新事件，两个日期 | 两个已知端点的最早/最晚 | 同范围 |
| 既有 canonical，true/false，均缺日期 | 完整继承 canonical 已知范围，旧记录缺终点按起点 | 范围不变 |
| 既有 canonical，true/false，仅一个日期 D | `[D, D]` | `eventRange([oldLong, short])`，只扩展已知范围 |
| 既有 canonical，true/false，显式两日期 | 本轮已给范围 | 与旧范围取并集；历史补充可以提前起点或延后终点 |
| learned ID 或已合并别名 | 按解析后的 canonical 执行以上规则 | 不使用 learned 创建时间或别名壳记录的默认日期 |
| 已存 post job 旧 create 缺进展字段 | 按以上日期规则 | 继续按未声明 true 处理许可；不重跑模型 |

`createdAt`、新 short 的 `shortExpiresAt = at + 7天`、短期记录的初始 `lastEventUpdateAt` 仍按当前 `makeOwner(..., at)`。长期 `lastEventUpdateAt` 仅 true 改为 at；预备期 initial grant 的顺延条件保持当前 `at < retainedFrom`。既有长期范围继续**并集**：即使显式日期落在旧范围内部，也不能缩小或替换。`update`、merge、投影同步中的 `eventRange` 不作全局语义改造。

已污染历史记录不扫描、不猜测修复。当前数据没有“这个日期来自程序默认值”的可靠标记；不能按 `createdAt`、`lastEventUpdateAt` 或今日日期回滚。以后若确有来源支持替换/缩小，需要另立显式修订合同。本任务没有该新能力。

### 执行步骤与回归

- [ ] 新建 `tests/memory-event-time.test.ts`，复用内存 `Storage`/`MemoryStore`/`MemoryLifecycle`；所有 create 先经过 `memoryTask(...).parse(raw)` 再 `apply`。参数化名称 `linked create inherits canonical event range without dates (progress=%s)`：原范围 2026-10-01 02:00Z，本轮 2026-10-09 02:00Z，true/false 均断言 short/long 事件范围仍为 10 月 1 日；false 的长期许可及 grant 不变，true 的 `lastEventUpdateAt` 为本轮，并单独验证预备期顺延/已生效不续期。
- [ ] 添加 `create uses the sole explicit date without synthesizing the other endpoint (%s)`：new/existing × at-only/until-only，显式 9 月 20 日、本轮 10 月 9 日；short 两端都是 9 月 20 日，已有 10 月 1 日 long 合为 9 月 20 日—10 月 1 日。添加两个日期、缺少旧终点及新事件缺日期用例。
- [ ] 添加 `historical dates may extend but never shrink an existing event when progress is false`：原范围 10 月 1—3 日，显式 9 月 30 日则扩起点；显式 10 月 2 日则原范围不变；false 不改许可、不增加 awakening。
- [ ] 添加 `linked create resolves merged and learned identities before inheriting dates`：真实建立两个 long 并 merge，然后使用旧 long ID、learned ID 分别 parse/apply，断言新 short 的 `linkedLongId` 和继承日期均来自 canonical。不能只 mock `canonical()`。
- [ ] 添加 `retrieval and model owner views preserve the repaired event range`：将重谈结果用离线 `MemoryRetrieval.build(makeRetrievalRequest('考试', at, 'personal'))` 取回，检查 long 与 `projectOwner` 的 narrative/personal/memory 视图均无 10 月 9 日伪终点。夹具使用 high importance 或明确有效 `retainedFrom`，避免预备摘要尚不可检索造成假失败。
- [ ] 先运行新增文件，确认原实现至少缺日期与 until-only 用例失败，再实现上述函数和 create 调用替换；保持 `memoryTask` 日期 optional 和进展布尔校验。
- [ ] 在提示和本批后续文档同步任务中写明：“已有事件未给日期沿用已知范围；只给一个已知日期视为单一时刻；真实进展布尔不代替事件日期；显式有据历史日期仍可扩展范围。”
- [ ] 执行下面回归并记录真实结果；失败修正后重跑受影响集合。

```powershell
npm test -- tests/memory-event-time.test.ts tests/review26-memory-create.test.ts tests/memory-v3-lifecycle.test.ts tests/memory-projection-retrieval.test.ts tests/memory-capacity-lifecycle.test.ts
npm run typecheck
```

**关闭条件：** 解析→生命周期→真实检索→模型投影链路通过；日期矩阵及 REVIEW26 许可语义同时通过；无批量旧数据修正；新增用例确实能在修复前捕获缺陷。

---

## T2 — B2：两条维护路径与未开始刷新统一字符软目标

### 决定与接口

固定提取共用选择函数，不弃用配置、不在模型输入层裁剪。新建 `src/memory/batch-selection.ts`：

```ts
export interface MaintenanceBatchLimits {
  batchItems: number;
  batchCharacters: number | null;
}
export function selectMaintenanceBatch<T extends { content: string }>(
  orderedRows: readonly T[], limits: MaintenanceBatchLimits,
): T[];
```

函数遍历已排序、已过滤同类的候选前缀：到条数目标停止；首项无条件入选；其后若累计正文字符加当前项**大于**非空目标则停止，不跳过大项挑后面的小项；相等可入选。空数组返回空数组，不变更对象或正文。配置合法性继续由现有 settings 校验，不添加静默取整或新默认。

调用方传 `(batchItems ?? 20, batchCharacters ?? null)`：

1. 无 idle 的 `ensureCycle`：保留 `maintenanceCandidates(cutoff)` 的既有顺序、固定每日 cutoff、reserved 和 linkedLong 排除；用助手替代当前内联循环。
2. 带 idle 的 `ensureIncremental`：保留 04:30 过期事件登记和空闲资格；依 `dirtyOwners()` 的 `queuedAt`、ID 顺序选择最早可用项的 audit/consolidation 类别，再按此顺序读取该类主项**当前完整 content**，传给助手。不能对 `memoryMetadata` 的简化内容计数。audit 仍为 detail/learned，consolidation 仍为 short/long。
3. `makeJob` 在主选确定后仍调用 `buildSnapshot` 构建完整闭包，`selectedIds` 只来自助手结果，`readSet` 来自完整闭包。闭包正文、来源、同事件 short/long、常驻依据及 detail 关联不得用同一软目标截断。

### 派发前刷新及 FIFO 的精确顺序

`refreshUnstarted(job, now): MaintenanceJob | null` 保持现有私有签名；只有 `startedAt === null && result === null && appliedUnitKeys.length === 0` 进入刷新，其余原样返回。已开始 pending 重试、computing 恢复、ready 与旧 unknown 均不得重选；配置减小也不能改变它们的冻结输入。

刷新在现有派发事务内执行：

1. 沿 **旧 `selectedIds` 顺序** 按 owner 身份取当前行（缺 selectedIds 时才退回旧 snapshot 顺序），剔除已消失/merged/discarded 行；兼容每日分支仍检查旧 cutoff 对应资格。不把旧依赖自动升级成主选，不补入新 dirty 项。
2. 先记录旧主选对应 `readSet` 版本。对这些版本逐个调用现有 `releaseDirtyVersion(ref)`；这只释放相同 revision/stateVersion 的旧 reservation，不能释放别的任务已预留的新版本。`queuedAt`、reasons、lastProcessedVersion 不改。
3. 对最新主选行调用同一助手，重建剩余主项的完整闭包；缩掉的主选仍保有 pending dirty 和原队位。正文增长首项可超限独占；若某缩掉项又因依赖规则留在 snapshot，它仍不在 selectedIds，不能因作为依赖而预留其 dirty。
4. 无主项时将旧 job 置 done；否则保存新 snapshot/readSet/selectedIds，增量 cutoff 更新为 now、每日 cutoff 不变，job ID/createdAt/kind 不变；仅对新主选当前版本执行 reserveDirty。随后同一事务置 computing/startedAt。

**避免提前抢位：** 当前 `startOne()` 先 `ensureCycle()` 再刷新。两条建批路径在查询现有 jobs 后，若存在上述明确未开始的 pending 维护 job，先不补建另一个维护批次；已到期的 daily/expiry 登记仍可做。等旧 job 刷新并派发、完成后，再让剩余 dirty 从原 queuedAt 参加下一次选择。该门禁不适用于 `startedAt` 非 null 或缺失的失败重试，也不阻止已有 index job 的既有 FIFO 调度。新建任务被门禁抑制时，`nextDeadline` 也不得仅因未预留 dirty 返回早于该未开始 job 的合法派发截止（retryAt/idleAt）的立即唤醒，避免空转。

本任务不重排升级前已存在的其他冻结 job；它们保持原 `createdAt,id` 顺序。队位承诺是保留 dirty 的稳定队位并防止本轮提前建批造成越过，不重写旧任务历史身份。

`nextDeadline` 目前使用 `metadataWork()` 的轻量投影，投影并没有 startedAt/result/appliedUnitKeys。实施时为 maintenance 的投影增加 `refreshableUnstarted:0|1` 标量，由 SQL 计算 `status='pending' AND json_type(data,'$.startedAt')='null' AND json_type(data,'$.result')='null' AND COALESCE(json_array_length(data,'$.appliedUnitKeys'),0)=0`；index 条目该标量为0。deadline 与建批门禁共享此资格定义，不为计时查询完整解码恢复正文。必须以 `json_type` 区分明确 null 与缺字段；不能把缺字段经 json_extract/json_object 补成 null 后当作新任务。未来 retryAt 的回归分别覆盖显式 null、缺字段旧 unknown 和已开始三类，只有第一类抑制后续建批。

### 执行步骤与回归

- [ ] 新建 `tests/memory-batch-characters.test.ts`，用真实 `MemoryIdle`、离线模型和内存库覆盖生产入口。`incremental maintenance honors the configured character target`：3 个彼此独立、各 120 code point 的 long，目标 150、items 20，模型的 `context.selectedIds` 仅 a；b/c 仍 pending，queuedAt 不变，无额外依赖。这项应在旧代码失败。
- [ ] 参数化 `main selection preserves limits and full content (%s)`：null 选满既有条数；items=2 时第三项不入选；120+30 等于150可入选；首项200+后项10只选首项；emoji 正文按 code point 计；断言传入正文与存储原文一致。对带 idle 和无 idle 两条路径分别覆盖。
- [ ] 添加 `audit selection retains its category and FIFO order`：按不同 queuedAt 交错加入 detail/long/learned；最早类别决定该批，选中同类顺序不变，其余类别保持待办，不能把 audit 与 consolidation 混入一个任务。
- [ ] 添加 `dependency closure may exceed the main character target`：主项120、目标150，必需 long/learned 依据另有300字；selectedIds 仍仅主项，snapshot/readSet 含完整依赖，模型看到全部正文，并实际 parse 通过闭包相关单元。
- [ ] 扩展 `tests/memory-pending-refresh.test.ts`：`unstarted growth releases deferred items without losing FIFO` 预建[a,b]、二者60字、目标150，派发前a长到120字并出现后来c；首次派发仅a，没有提前新建c批，b pending且queuedAt不变；a完成后下一批先b再c。检查旧 job id/createdAt 不变、readSet为新版本、新主项reserved。
- [ ] 添加 `deferred main may remain an unreserved dependency`：b被字符限额排除，但仍是a完整闭包依据；snapshot包含b、selectedIds不含b、dirty b不被本job预留。
- [ ] 参数化 `started and legacy jobs retain frozen payload despite a smaller target`：startedAt=null/时间/undefined；null 刷新且限额，时间/undefined 的 snapshot/selectedIds/cutoff/checkpoint保持逐字段相等。添加新版本已由其他任务reserved的情况，旧 `releaseDirtyVersion` 不释放它。
- [ ] 添加 `an unstarted retry deadline does not spin on unreserved dirty owners`：显式 null job 的 retryAt 在未来、另有可用dirty时，不新建绕过批，nextDeadline不早于其合法截止；到期后正常派发。每天 cutoff 和 idle 禁止/允许分支同样回归。
- [ ] 先运行新增/扩展用例确认原实现缺陷；实现助手、两条初选、刷新和建批门禁；不改 prepare 的 frozen task/模型格式修补或 R1 状态条件。
- [ ] 执行下列回归，另检查 `src/deployment/memory-runtime.ts` 仍显式传入 idle 及两个 batch 配置。

```powershell
npm test -- tests/memory-batch-characters.test.ts tests/memory-pending-refresh.test.ts tests/memory-v3-maintenance.test.ts tests/memory-idle-fairness.test.ts tests/memory-idle-consolidation.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-index-coalescing.test.ts
npm run typecheck
```

**关闭条件：** 带 idle 正式路径和无 idle 兼容路径的限额矩阵均通过；刷新后剩余 dirty 不丢失、不重排、不误释放；没有提前建批导致的 c 越过 b；依赖完整且允许超目标；R1 冻结/累计修补/应用重试回归通过。

---

## T7 — 清理写放大：定向活动引用与有限终态载荷回收

### 决定与接口

比较“每轮后台顺便扫历史”和“完成时压缩 + 独立旧载荷回收”，固定采用后者。前者会把旧库修复混入每个 host 让位单元；本任务无需新增后台执行槽、runtime 游标或环境调度职责。

保留 `saveJob(status='done')` 当前压缩形态：maintenance `snapshot=[]、readSet=[]、result=null`；index `text=''` 且移除 result。job ID、createdAt、selectedIds、applied/stale keys、completionReason 等轻量身份/统计保留。前台成功提交清空 post result、环境成功提交清空 checkpoint、维护 `ready/done` 后清空 checkpoint 的现有触发点继续保留。

`src/memory/store.ts` 新增/修改接口：

```ts
activeMaintenanceJobsReferencing(owner: MemoryOwnerRef): MaintenanceJob[];
compactCompletedPayloads(limit = 50): CompletedPayloadCompactionReport;
private compactMaintenanceCheckpoint(jobId: string): void;

export interface CompletedPayloadCompactionReport {
  limit: number;
  updated: { indexJobs: number; maintenanceJobs: number; postJobs: number; webSessions: number };
  totalUpdated: number;
  hasMore: boolean;
}
```

`activeMaintenanceJobsReferencing` 只取 status 为 pending/computing/ready 且 snapshot 或 readSet 包含同 `ownerType:ownerId` 的任务，排序保持现有 createdAt/id。用 SQL 的 status 谓词及 `json_each` EXISTS 在数据库中筛选，不能先 `jobs(table)` 全历史 JSON.parse 再 filter。复用 `memory_maintenance_jobs_due` 的 status 前缀；不新增持久引用表、双写引用一致性责任。合同校验使 result 的读写集合来自冻结 snapshot/readSet，因此这个引用入口包含合法结果涉及的 owner；测试同时覆盖仅依赖被剪的情况。

### 逐条清理与恢复不变量

- `MemoryCleanup.applyOne` 的 owner 分支事务改为只调用 `purgeOwner(row, now)`；**不调用**全局载荷回收函数。候选选择、有效 learned 的全部 evidence 保护、短期必要摘要保护与每次让位不变。
- `pruneOwnerFromJobs` 改为遍历上述定向活动查询，其余业务动作保持：从 snapshot/readSet 删除该 owner；写入 prunedOwnerKeys 墓碑；所有受影响单元（readSet/ids/canonicalId）清正文并记 stale；其他独立单元继续；剩余主选 dirty 的既有释放行为保留；没有主选或 ready 单元全已终结时置 done 并即时压缩。
- `purgeOwner` 当前针对该 owner 的 index-job 删除、index 删除、owner/awakenings/grants/dirty/audit 引用清理继续，不以优化为由批量删除历史 done jobs、post rows、web sessions 或审计统计。已有 owner 定向删除范围不扩展。
- `prepare` 必须继续重读持久 job，检查 done、prunedOwnerKeys、当前 owner 存在性；不能把传入准备函数的旧副本重新保存。这样晚到成功、失败和超时都不能复活删除项或重试已终结 job。
- R1 的 pending/computing 失败/stop checkpoint 不压缩；ready 的结构化 result 留在 job 用于应用重试，web checkpoint 已可压缩；只有 status ready/done 的现有 finally 路径继续压缩。有限历史回收也不能越过这些状态门禁。
- 补足移除全局压缩后的完成边界：`saveJob` 保存 maintenance done 后调用私有 `compactMaintenanceCheckpoint(jobId)`，只在 web_sessions 存在时，对该 maintenance owner 的非 null checkpoint 做定向 UPDATE。这样“已开始、当前 pending 等重试、此时被 prune 判 done”即使没有在途 finally，也立即去掉恢复正文。仍保留 in-flight finally 的幂等压缩，以处理晚到执行写入；pending/computing 的普通 saveJob 不调用此方法。沿用调用方事务，不在 saveJob 内嵌套 transaction。

### 四类旧终态残留的精确条件

`compactCompletedPayloads` 在调用者提供的同步事务内执行；不自己嵌套 transaction。每次四表累计更新最多 limit 行，固定表次序 index→maintenance→post→web，在每张表内按 id 稳定选择 `LIMIT remaining`。limit 必须为正整数；不支持 Infinity。候选查询与更新时均保留“仍终态且仍有载荷”谓词，更新实际 `changes` 计入 report。历史压缩使用定向 SQL JSON 字段 UPDATE，不调用可能联动清 checkpoint 的 saveJob，确保四表**合计**不越过 limit。

| 表 | 终态条件 | 确有残留条件 | 只清哪些字段 |
| --- | --- | --- | --- |
| memory_index_jobs | status=done | 非空 text 或非 null result | text设空；result移除，与saveJob一致 |
| memory_maintenance_jobs | status=done | snapshot/readSet非空数组或非 null result | snapshot/readSet设空数组、result设null |
| post_jobs | 同id turn.done=1 | result非 null | 仅result=null；保留memoryIds/selfWebReadSources等 |
| web_sessions | turn.done=1；或environment step status为committed/superseded；或maintenance status=done | checkpoint非 null | 仅checkpoint=null；保留ref/counters/metrics/operations/materials/来源 |

JSON 缺字段和 JSON null 均按“无载荷”，不得给历史空行反复补 null；空 result 数组仍是保存的 result，可规范一次。web 的 maintenance ready 在正常完成路径已经压缩；历史补偿采用上表保守终态边界，不因仅含来源/计数就更新。

残留谓词固定使用 SQLite `json_extract(data,'$.result') IS NOT NULL` / `json_extract(data,'$.checkpoint') IS NOT NULL`；index正文使用 `COALESCE(json_extract(data,'$.text'),'')<>''`；maintenance数组使用 `COALESCE(json_array_length(data,'$.snapshot'),0)>0` 和 readSet 对应表达式。选择、更新和部分索引共用相同表达式，避免谓词漂移。

建立与谓词一致的轻量残留部分索引：MemoryStore 构造器负责两张 job 的 `(id) WHERE status='done' AND <对应残留谓词>` 及 post 的 `(id) WHERE result非null`；WebSearchStore 构造器负责 `(ownerType, ownerId, id) WHERE checkpoint非null`。旧库首次建索引的全表工作是一次 schema 准备，不计为每 owner 代价；运行时只检查残留集合。回收工具 apply 若发现 web_sessions 已存在，也执行相同 `CREATE INDEX IF NOT EXISTS`，不依赖服务先启动；若表不存在则跳过，不能为压缩而创建网页记录。hasMore 使用同候选条件的 EXISTS，不解码全部历史正文。

`WebSearchStore.compactOwnerCheckpoint(ownerType, ownerId): void` 保持签名，在现有 owner 定向 UPDATE 增加 checkpoint 非 null 谓词。相同 owner 第二次调用实际 changes=0，计数/来源不变。`saveJob` 不需要为所有写入增加一次“读旧值去重”；去掉无效调用源和筛选候选足以消除当前写放大。

### 旧库兼容路径（明确采用，无待选项）

新增 `src/deployment/memory-payload-compaction.ts`：

```ts
export function inspectCompletedPayloads(path: string): {
  indexJobs: number; maintenanceJobs: number; postJobs: number; webSessions: number;
};
export function compactMemoryPayloads(path: string, options: {
  stopped: boolean; batchSize?: number; maxBatches?: number; backupDirectory?: string;
}): {
  before: ReturnType<typeof inspectCompletedPayloads>;
  after: ReturnType<typeof inspectCompletedPayloads>;
  batches: number; totalUpdated: number; hasMore: boolean; backupPath: string | null;
};
```

- inspect 用 `DatabaseSync(path,{readOnly:true})` 和只读候选计数，不构造会写schema的 MemoryStore，不读配置。
- apply 要求 `stopped===true`；默认 batchSize=50、maxBatches=20，一次最多1000行，逐批独立事务。非正整数参数报错；不做网络或模型工作。
- 有可回收行才按现有 capacity upgrade 的模式备份指定 SQLite 主文件及存在的 `-wal/-shm`，然后写入。`backupDirectory` 未给时固定使用目标库同目录下的 `backups/memory-payloads/`；每次在其中新建含UUID的子目录，不覆盖旧备份；打印计数和备份路径，不打印恢复正文。无候选时返回0且不创建备份。
- 终止/崩溃最多回滚当前批，已提交批保留。清空字段本身是进度：下次只选仍有载荷的终态行，不需要按时间猜测或强制迁移版本。`hasMore=true` 明确表示本次有限批次耗尽，可重复相同命令；不是失败，也不是全库回收完成。
- 新增 `scripts/compact-memory-payloads.ts` 与 package script `memory:compact-payloads`。默认 `--dry-run`；`--apply` 必须带 `--stopped`，支持 `--batch-size`、`--max-batches`、`--backup-dir`。不沿用会默认读取 `config.local.json` 的容量迁移CLI。
- 现有 `migrateCapacity` 的 `compactCompletedPayloads()` 调用保留为一次默认50行兼容处理，仍处于其现有事务；它不循环消耗全部历史。升级说明指向新命令处理剩余载荷，不把 capacityVersion=1 当成“历史载荷已全清”标记。

这里的离线命令是实施完成后的运维入口设计；本次编写方案不运行它。实施测试只向自己创建的临时库传路径。

### 执行步骤与回归

- [ ] 新建 `tests/memory-cleanup-write-amplification.test.ts`。`cleanup does not rewrite compacted historical payloads`：K=10个同样可删owner、H=0/1000/5000 已压缩历史行；四类历史分别装载。用临时SQLite审计触发器/写入计数统计实际UPDATE（只spy saveJob不足）。每组对既有done index/maintenance、已完成post、终态web的重复更新均为0；owner删除数均10，轻量身份/统计保留。耗时只记录，不作为通过阈值。
- [ ] 添加 `pruning loads only matching unfinished maintenance payloads`：固定少量pending/computing/ready，增加H条done；spy/计数定向查询返回及JSON解码的任务数不随H增加。针对pending、computing、ready各删主项和仅删依赖，检查墓碑、受影响unit清正文/stale、剩余dirty释放、无关unit可应用。记录 EXPLAIN QUERY PLAN，status检索须可用现有due索引，不能退回应用层全历史解码。
- [ ] 新建 `tests/memory-payload-compaction.test.ts`。`bounded legacy compaction visits each residual payload once`：用直接SQL注入旧done残留（不能用saveJob构造，它会即时压缩），四表混合≥7行，limit=3；每次totalUpdated≤3，多次后余量0，重复调用totalUpdated=0，旧ID/统计不变。
- [ ] 参数化 `legacy compaction preserves recovery payloads (%s)`：未完成turn、environment pending/running/ready、maintenance pending/computing/ready均保存恢复所需载荷；并分别验证done turn、committed/superseded environment、done maintenance会清。网页只计checkpoint，相关operations/materials/self-read来源逐字段相等。
- [ ] 添加 `owner checkpoint compaction is idempotent`：同owner连续两次调用，实际更新计数第一次为有checkpoint会话数、第二次0；另一owner不变。
- [ ] 添加 `pruning an idle started retry compacts only its terminal checkpoint`：已开始pending任务带repair checkpoint且无在途Promise，prune最后主项后job为done、checkpoint立即为null；另一个pending/computing的checkpoint逐字段不变，重复保存done不产生第二次checkpoint更新。
- [ ] 新建 `tests/memory-payload-compaction-cli.test.ts`：只读inspect不改变临时库数据/文件；缺stopped拒绝apply；batchSize=3,maxBatches=2最多改6行并正确报hasMore；第二次续跑至0；注入当前批事务失败，前批已提交、失败批完全回滚；备份可打开且原统计/恢复数据存在。测试不传正式路径、不访问配置。
- [ ] 先运行成本/幂等新增回归证明旧实现重复写；实现 cleanup删除调用、定向prune、有限回收、索引和CLI。核对 `rg -n 'compactCompletedPayloads|compactOwnerCheckpoint' src scripts` 的每个调用，不留下隐蔽的逐owner全历史压缩。
- [ ] 运行下面必须保留的真实离线恢复回归；不要删/跳过旧R1测试来使集合通过。

```powershell
npm test -- tests/memory-cleanup-write-amplification.test.ts tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts tests/memory-capacity-cleanup.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-capacity-upgrade.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-v3-recovery.test.ts tests/web-recovery.test.ts tests/recovery.test.ts
npm run typecheck
```

**关闭条件：** 清理K项不再发生K×H历史终态重写，四表实际写入计数均验证；prune仍阻断晚到响应复活并处理仅依赖失效；R1真实失败/停止/重开/应用重试/剪除终态测试通过；旧残留可有限续跑且每行至多压缩一次；当前非终态恢复载荷及历史身份/来源/计数保留。

## 任务接口与合并顺序

- T1 只触及 lifecycle 和记忆提示，T2 触及 maintenance/batch-selection。T7 修改 store/cleanup/web store/部署工具；按 T1→T2→T7 分别提交与审阅，T2/T7 修改同一测试fixture时后者基于前者合入。
- T2 调用现有 `releaseDirtyVersion`，T7 不修改其定义；T7 的 prune不能为了少查行删掉现有释放逻辑。若执行中需调整 dirty 接口，必须同时回归T2增长/退回/新版本reservation用例。
- 与上下文优化任务交界：T1 的检索投影测试复用真实 `MemoryRetrieval.build`，不更改其接口；若其他任务新增可跳过recent的参数，T1仍验证owner日期即可。
- 与环境/调度任务交界：T7不改 `runEnvironmentStep`/SerialHost 的运行流程；只保持既有成功checkpoint压缩和明确终态的旧载荷条件。后续 environmentPlanningVersion=2 的 preparation/legacy 等新载荷不在T7清理范围；environment checkpoint的回收只认committed/superseded，pending/running/ready仍可恢复。
- 与文档同步任务交界：T1日期语义、T2字符口径及闭包例外、T7离线回收命令及残留统计需写入当前权威文档；非主证据不自动durable与有效learned引用下的物理保护按D2原结论说明。旧审核结果保留为修复前证据，新交付另记，不覆盖原复现文件。
- 每任务定向集合通过后再按总计划进行一次全量离线回归、typecheck/build及既定验收，不用重复全套来代替本文件的缺陷矩阵和工作量计数。
