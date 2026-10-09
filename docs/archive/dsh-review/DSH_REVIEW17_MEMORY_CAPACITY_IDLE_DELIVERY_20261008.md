# 记忆容量与空闲整理 V0.4 交付复核（DSH）

日期：2026-10-08。对象：任务 1～8 的实现与最终复核修正（本地 Git `bc05801`，代码终点 `60ec906`）。依据：[交付记录](MEMORY_CAPACITY_IDLE_V0.4_DELIVERY_20261008.md)、[实施日志](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_LOG_20261008.md)、[实施细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)与 `src/memory/`。

方式：只读源码、文档、Git 与验收产物，**没有运行测试或服务，没有修改任何文件**。正式库只做只读查询。

结论：**核心承诺兑现，证据链完整；三路专项审核共发现 3 处需修、1 处需确认的缺陷，另有 1 处口径待写清。** 我上一轮要求写死的三条全部落实；435 项测试与验收产物的证据链完整；正式库确实未被改动。建议按第 4 节的顺序处置（§4.1 与 §4.2 各一行修法，§4.3 需要一处保护改动，§4.4 需要一次产品确认）。

---

## 1. 我上一轮三条的具体落实

| 上一轮要求 | 落实位置 | 判断 |
| --- | --- | --- |
| 归档判定要同源，且必须覆盖**从未写过归档字段的自然到期项** | `capacity.ts:6-10`：`archiveStart(row,now)` 依次取 `archiveEnteredAt ?? capacityExitedAt ?? (expiresAt <= now ? expiresAt : null)`，并导出 `isArchivedLong`；`cleanup.ts` 的到期与超量、`lifecycle.ts:98` 的合并继承、容量计数全部走它 | **落实，且正是我建议的写法** |
| `merge_short` 的决胜方向要写死 | `contracts.ts:166-167`：按 `createdAt` 升序、再按 `a.id < b.id` 升序排序，并校验 `canonicalShortId === shorts[0].id`，错误文案直接写"must be earliest createdAt then smallest ID" | **落实，方向明确** |
| `merge_short` 的 `sourceIds` 要进合同 | `contracts.ts:161` 已把 `merge_short` 并入"必须非空 `content` + 非空 `sourceIds`"的动作集合；`:160` 另要求 `sourceIds` 必须来自快照内已知来源 | **落实** |

顺带确认两处细节也做对了：`lifecycle.ts:98-101` 在合并时用 `archiveStart` 判定成员是否全部已归档——全归档才继承**最早**锚点（`anchors[0]`，已按升序排），只要有活跃成员就清空归档/容量标记并取最早的 `retainedFrom`；`contracts.ts:173-174` 的 `promote` 稳定认识证据改为沿 `readOwners` 解析到 canonical（`short.linkedLongId`、`learned.canonicalMemoryId`），所以"多 short 指同一 long"确实凑不出两个不同事件——比我上一轮设想的 `evidenceMemoryIds` 联合更严。

## 2. 证据链与正式库状态（只读实测）

- **测试证据完整**：`runtime/memory-capacity-acceptance-20261008/verification/final-full-suite.log` 记录 `79 files / 435 tests passed`；初验 `full-suite.log` 是 `79 / 428`，修正后主目录 `main-full-suite.log` 又是 `79 / 435`。三份日志与"428 → 新增 7 项 → 435"的口径自洽。各任务的 RED（`final-red.log`、`final-dependencies-red.log`、`final-audit-shared-red.log`、`final-promotion-red.log`、`final-evidence-red.log`）与 GREEN 日志都在，**失败先于修复可查**。
- **正式库确实未被改动**（我实测）：`memoryCapacityVersion = undefined`、`memoryIdle = undefined`、`memories = 0`、`memory_awakenings = 0`、`memory_retention_grants = 0`，`paused = false`，`sharedActivityVersion = 1`、`environmentPlanningVersion = 1`。与交付记录"空库、只读检查、未 apply"一致。**该库下一次启动会走新库路径**，届时才建立容量标记与空闲时钟。
- **工作树干净**：只剩你未跟踪的 DSH 审核文件；Git 顶端是 `bc05801`（文档提交），其下 `60ec906` 是最终修正。

## 3. 最终复核的 6 项 Important 值得单独肯定

交付记录列出的 6 项，我抽查了两项，都是**真实的、我自己没想到的**缺陷：

- **`merge_short` 把详细 `content` 写进 long**——现在 `maintenance.ts` 的 `merge_short` 分支用 `[merged.eventSummary, merged.feelingSummary].join('\n')` 更新长期摘要，不复制短期详细正文。这与"长期是简要预备摘要"的分层语义一致，若漏掉会让 1000 条的长期池被详细正文灌满。
- **`reserved` linked long 等待重试时 dirty short 让 deadline 变成 now**——这正是我在世界学校那轮反复强调的"两处判据必须同源"的同类问题（选择与截止共用候选筛选），修法与结论都对。

另外 4 项（次级 canonical 证据变更不重排 learned 审核、正式 detail 审核只看到自身、历史 short 来源漏保护与 promote 合同／应用不同义、audit 消耗只读证据 dirty）以及补充的"同批 audit 共享只读证据被误拒"，都属于**读代码才能发现**的类型；它们先出红灯再修、并在同一次修正内完成且未再派复审，处理方式合理。

---

## 4. 需要处置的发现（按建议顺序）

### 4.1〈会出错〉`merge_short` 的"至少两个短期"是列表长度检查，同一个 id 重复两次即可通过

`contracts.ts:145` 的 `ids` 是 `z.array(text).min(1)`，**没有唯一性校验**；`:166-167` 直接数长度：

```ts
const shorts=u.ids.map(id=>available.get(id)!).filter(r=>r.kind==='short').sort(…);
requireControl(shorts.length>=2,'ids','merge_short requires two shorts');
requireControl(u.canonicalShortId===shorts[0]?.id,…);
```

而 `:159` 的重叠检查跑在**去重后的** `effectiveReadOwners` 上，所以 `ids: ['s','s']` 能一路通过校验；应用侧 `lifecycle.mergeShort` 也不去重（`shorts` 里同一个 id 出现两次），于是**一条事件被走了一遍"合并"路径**，它的长期摘要还会被 `maintenance.ts:148` 更新。

后果有限（它不能把两个不同事件合成一个，只能伪造条数），但违反细化 §7.2 的"≥2 个 short"与计划任务 5 的硬校验，而且**一次不合规的模型输出就会污染一条原本完好的记录**。修法一行：在 `:166` 之前对 `u.ids` 去重（或 `requireControl(new Set(u.ids).size===u.ids.length)`）。

### 4.2〈会出错·仅影响重复投递〉入站消息的稳定身份没有被用来去重

`index.ts:106`：

```ts
const accepted = await host.acceptInput({ id: randomUUID(), receivedAt: clock.now(), content: text,
  platformMessageIds: session.messageId ? [session.messageId] : [] … });
```

而 `input.ts:16-17` 的去重判据是 `read('messages', message.id)`（即这个**新生成的 UUID**）：

```ts
const existing=this.storage.read('messages',message.id),control=…;
if(existing||control)return {kind:control?'advance':'message',systemReply:null};
```

`randomUUID()` 每次都不同，所以**这个守卫在生产装配下永远不会命中**：平台重投一条消息会新建一行消息、开一个新批次、并**刷新空闲锚点**（`:18` 在守卫之后）。细化 §6.1 的"同 ID 重复投递不重复接纳或刷新"与计划任务 4 的 `same_id_duplicate_not_new_idle` 只在**单元测试**层面成立（测试传的是字面 id），装配层把前提消掉了。

会受影响的行为：平台在服务端重发（或适配器重连补发）同一条消息时，会多出一条"新消息"、可能提前触发一轮故事、并把深度整理再推后 15 分钟。**判定依赖真实 QQ 适配器的重发语义**（我无法静态验证它是否真的重发），但守卫本身已经是死代码，这一点是确定的。

修法建议：`index.ts` 用 `session.messageId`（加上会话标识）作为 `id`，把 `randomUUID()` 只留给没有平台 id 的情况；或在 `acceptInput` 里加一条"`platformMessageIds` 已存在则不接纳"的判据。前者更彻底、也顺带让 `messages` 行与平台身份一一对应。

### 4.3〈会出错·永久残留〉摘要为空的到期短期会被永久阻挡，且它的长期仍会被删掉

这条由清理专项审核提出，我核实了整条触发链，**成立**。链条如下：

1. **合同允许长期摘要为空**：`contracts.ts:34` 的 `summary` 用的是无 `min(1)` 的 `text`，所以 `eventSummary` 与 `feelingSummary` 可以同时为空串；`lifecycle.ts:8` 的 `summary = (event,feeling) => [event,feeling].filter(Boolean).join('\n')` 于是得到 `content = ''`。这是**唯一**的触发前提。
2. **清理的"可删"判定要求摘要非空**：`cleanup.ts:18` 的 `shortsReady` 要求 `!!canonical(r.linkedLongId)?.content.trim()`。摘要为空的到期短期落入 `:19` 的 `blocked`（`${id}:missing_summary`），**不进 `eligible`**（`:23`），所以 `applyOne` 永远删不掉它。
3. **同一次清理里它不再提供保护**：`capacity.ts:15` 只保护 `shortExpiresAt > now` 的短期，而这条已经到期；`cleanup.ts:21` 的 `longs` 又在到期或超量时按 OR 触发，于是**它的长期照删**。
4. **长期删了就再也回不来**：`canonical()` 对已删行永远返回 null（`store.ts:79-84`）；`lifecycle.ts:23` 对已存在的 short id 直接 `continue`（不会再建长期）；已完成的轮次不会重跑 `finishPostprocessing`（`recovery.ts:60-61`）。

**结果**：该短期的详细正文、`memory_index` 的全部向量、`memory_index_jobs.text` 与 dirty 行**永久留在库里无法清理**，`status` 永久显示 `:missing_summary`。这也**破坏了细化 §5.2 的"先清理 short 及其派生副本，再删 long"**——在这条路径上顺序反了。

我倾向的最小修法：**让被 blocked 的到期短期也参与 long 的保护**（把 `cleanup.ts:19` 的 blocked 集合并入 `protect`，或让 `:18` 对"长期摘要为空"的情形先保护）。这条 long 的摘要本来就是空的、没有检索价值，保住它不占有效容量，却能让阻挡可解除；之后一旦有合法的非空摘要写入（`maintenance.ts:170-173` 的 refine，或新的真实进展），短期就能被正常清理。**不建议**反过来"无视空摘要直接删短期"——那会丢掉库里唯一的详细记录，而细化明确要求摘要在前、详情在后。

### 4.4〈需一次产品确认〉归档长期仍可被晋升为 durable，从而绕过归档池上限

`lifecycle.ts:144-149` 的 `promote` 只检查 `totalAwakenings >= 30`，**不检查该行是否已经归档**。而归档长期会被排进审核队列（`capacity.ts:64` 在容量退出时 `queueDirty(r,'capacity',now)`），所以它完全可能拿到 `promote` 单元。晋升后 `status='durable'`、`expiresAt=null`，而 `archiveStart`（`capacity.ts:7`）要求 `status==='active'`，于是它**立刻退出归档池**，也不再占 `longOccupied`。

后果是"归档最多 500、最长 90 天"这条上限**是软的**——一条达到 30 个有效唤醒日期的归档记录，可以在没有任何真实重谈的情况下变成永久常驻。500 条正好是"30 个日期"门槛最容易命中的群体，所以这不是理论边界。`promotionCandidates()`（`lifecycle.ts:128`）的 SQL 带了 `status='active'`，说明本意是把归档排除在外，但把关只落在候选查询上，`promote` 与应用单元（`maintenance.ts:160-162`，从**任务快照**取行、不重判存活）都没有再检查一次。

**两种处理都可接受，但要选一个写进细化**：**A** 承认晋升是"重谈"之外的第二条复活通道，明确写出来；**B（我倾向）** 保持"只有带合法当轮来源的 awaken 才能复活归档"，在 `lifecycle.promote` 里补一条 `archiveStart(row, at) !== null` 即拒绝，把不变式收到唯一收口点。

### 4.5〈口径确认〉容量归一与清理的保护集合不一致

我原先把它写成"缺陷"，**现在降级为口径确认**（容量与清理两路审核结论一致）：两处调用各自对应细化 §4.1（归一保护"活跃短期"的长期）与 §5.2（清理闭包处理"已退出／到期短期"的长期），**按文档字面相符**；而且不会造成提前删除——清理用含暂存短期的集合过滤要删的候选（`cleanup.ts:21`），并按短期截止安排下一次尝试（`:39,43`），不会 0 ms 循环。

唯一实质影响是**该 long 的 90 天归档窗口从容量退出时刻起算**，而不是从短期清理截止起算（差最多 7 天）。细化 §5.2 的原话是"保护 long **至该短期清理截止**"——若本意只是"不要在短期清理之前删掉它"，实现正确；若还包括"归档窗口也从清理截止起算"，就需要把 `capacity.ts:61` 改成 `protectedIds(now, true)`。建议在细化里把这句话写清楚。

---

## 5. 三路专项审核确认成立的部分

三路（容量与归档、清理与迟到结果、空闲门禁与公平队列）都给出"按细化实现"的结论，并各自排除了我列出的假设。几处证据值得记一笔：

- **归档判定确实同源**：一个 TS 谓词（`capacity.ts:6-10`）+ 一个等价 SQL 孪生（`store.ts:9`），被 `current` 排除（`store.ts:127`）、归档计数（`capacity.ts:21`）、清理资格与 90 天到期（`cleanup.ts:14-16,41`）、合并继承（`lifecycle.ts:98-101`）与迁移落地（`store.ts:96-97`，落的是**推导出的真实起点**而不是迁移 `now`）共用；自然到期且从未写过标记的行由第三分支覆盖。
- **两个排序器真的不同**：`activeOrder` 的 importance 在第 1 位、`archiveOrder` 在第 3 位（`capacity.ts:31-35`），调用点从不混用；`windowAwakenings` 只被写、从不参与排序。
- **上限无 off-by-one**：`normalize` 精确退出 `max(0, count − limit)` 个可退对象，且"关联长期无摘要"的 `continue` 发生在扣预算**之前**（`capacity.ts:50`），不会白扣；101→100、1001→1000、501→500 都有测试钉住。
- **十项删除面逐条落地**：`grants` 按记录的 `canonicalMemoryId` 字段删（不按 grant ID 前缀，验收夹具还用了一个诱饵 id `unrelated-prefix` 专门验证）；`done` job 只留统计；`post_jobs.result` 与已完成 web checkpoint 都被压缩，且 checkpoint 只清 `$.checkpoint`、保留计数／来源。
- **迟到结果不复活**：回调统一读**当前库**的 job（`maintenance.ts:103,106,115`），按 `prunedOwnerKeys` + 存活 + 快照内 id 剪除，应用时再校版本（`:129`），失效走重排、无关单元继续。
- **空闲锚点只由五个入口写**（输入含【推进】、确认输出、段 B 故事完成、共同活动真实起止、普通活动真实切换），环境步骤完成、通知发布、索引／维护完成都不刷新；`idle.nextDeadline` 不会返回过去值。

### 合并后的低优先项（都不阻塞）

- **`merge_short` 跨两个不同长期时会做不可逆的身份合并**（`lifecycle.ts:154-156`），绕过了 `merge` 合同的 canonicalId／≥2 long 校验；细化 §7.2 允许（同一事件的不同长期），但"同一事件"只由提示词保证，所以一次模型误判就是一次身份合并。
- **审计报告删除用了未转义的 `LIKE '${prefix}%'`**（`maintenance.ts:152`），detail key 由模型／用户提供，含 `_`／`%` 时可能匹配到别的对象的报告（只删元数据，修法很便宜：参数化或转义）。
- **`ensureCycle`／`ensureIncremental`／`makeJob` 在 try 之外**（`maintenance.ts:85,64-78,30-48`），同步抛错会经 `runtime.ts:33,35,67` 变成 0 ms + 报错重新武装；**追踪不到会重复的路径**，形状上值得一处防御。
- **`metadata.ts:14` 的 id→行映射跨三张表**（learned > detail > memories，后写覆盖），而 `store.canonical` 优先取 long——跨表 id 冲突会让元数据路径（计数／清理／升级）与 store 路径不一致。**建议做一次只读检查**：`SELECT id FROM memories INTERSECT SELECT id FROM details`／`learned_background`。
- **`metadata.ts:10` 把缺失的 `$.kind` 兜底成 `'long'`**，而 SQL 孪生要求 `kind='long'`——无 kind 的行会被算作占用长期却永不归档，同样值得只读确认。
- **`retainedFrom === null` 的行被算作"可见"**（`capacity.ts:20`）但 `store.ts:127` 会把它排除在检索之外（"可见却检索不到"）；只对遗留数据成立。
- **未生效的预备长期也会占归档名额**（`capacity.ts:20,62`）：一条从未可见、从未被提及的预备摘要被容量退出后占掉 500 里的一位。与 §4.1 一致，但值得确认是否有意。
- **性能**：`meaningfulAt` 每次比较都发一次 `listAwakenings`（`capacity.ts:27,33,35`），一次 `normalize` 三次全量 hydrate（`:46,61,62`），满池约 10⁴ 次查询，且发生在**每个故事轮完成时**——当前量级能用，建议记一条"将来若卡顿先看这里"。
- 其他小的：`pruneOwnerFromJobs／purgeOwner` 的 `at` 参数完全未用（`store.ts:160,175`）；`cleanup.status()` 在 `:26` 提前返回时会返回陈旧的 `blocked`；`cleanup.ts:26` 以"任一未完成 turn"作全局清理闸门（比 §5.2 更宽）；保护集只认 learned `status==='active'` 而迁移把 `durable` 也当活体；`ownerType='asset'` 的 checkpoint 无压缩规则但当前不可达；`web_operations／web_materials` 保留页面正文（§5.3 明示为设计保留）；`CapacityResult.temporaryProtectedIds` 目前没有消费者；ID 决胜在不同文件里混用码位序与 `localeCompare`；`refreshSharedStep` 会在"读截止"的路径里写 character／tasks。

---

## 6. 本次复核的边界

**没有做**：运行测试／构建／验收工具；连接模型或 QQ；升级或写入正式库（只做只读查询）；修改任何文件。

**因此无法验证**：435 项测试的实际通过情况（我只读了归档日志）；3 次在线请求的原始输出内容（只读了交付记录摘要与报告 JSON 的存在）；100／1000／500 与 90 天是否适合数月真实运行；以及正式库从空库初始化后的第一次真实清理行为。交付记录已把"未在正式环境验证、容量适用性未宣称"列为保留范围，我认同这个边界。

**给用户的一句话**：这次交付的证据链和自查质量是目前最完整的一次；正式库仍是空库，你下次启动时它才走新库初始化路径，届时建议看一眼 `status` 的容量与空闲字段是否如预期。
