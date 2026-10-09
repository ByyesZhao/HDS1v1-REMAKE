# 记忆容量与空闲整理 V0.4 实施细化与执行计划复核（DSH）

日期：2026-10-08。对象：[实施细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)、[执行计划](MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md)，对照[方案](MEMORY_CAPACITY_IDLE_V0.4_PROPOSAL_20261008.md)、[CODEX 回复](CODEX_REBUTTAL_MEMORY_CAPACITY_IDLE_V0.4_20261008.md)与 `src/memory/`。

方式：只读文档与源码，**没有运行测试或服务，没有修改任何文件**。

结论：**两份文档可以开工。** 我第十五轮的两条判断被 CODEX 与细化正确否决（见第 1 节，其中一条是合同层面的硬错），细化对悬空引用、迟到回写、删除面、空闲锚点四件事的处理比我提的建议更完整。**有 3 处建议开工前定**（归档判定同源、`merge_short` 的两处细节、`archiveEnteredAt` 与自然到期的统一表述），另有 3 处观察。

---

## 1. 我上一轮的两条判断被否决，均成立

### 1.1 `ids ⊆ readOwners` 确实由合同保证，我的"非空断言会抛错"推论不成立

我上一轮说 `maintenance.ts:89` 的 `this.store.owner(r)!` 在"某个 `unit.ids` 不在 `readSet` 时"会抛错。实测 `contracts.ts:153`：

```ts
requireControl(u.ids.every(id=>u.readOwners.includes(id)),'ids','writes outside readOwners');
```

`ids ⊆ readOwners` 是**硬校验**，而 `readSet` 由 `effectiveReadOwners`（readOwners ∪ 投影 ID）构造（`:155,163`），所以 `ids` 必然落在 `readSet` 里——我设想的那个前提不存在。

不过 CODEX 的结论我仍认可：**物理删除仍然需要显式存活检查，不能靠非空断言**。细化 §5.4 已经写成"应用单元前检查 `ids／readSet／canonicalId` 的身份存在、owner 存活、版本一致、必要关联完整，任一缺失按 stale 处理，不抛成无限重试，不回建 owner"，这比依赖合同更强，方向正确。

### 1.2 `lastEventUpdateAt` 确实随真实新进展更新，`latestEventUpdateAt + 7天` 不是错

我担心过"`lastEventUpdateAt` 从不被更新，按它算 7 天会缩短保留期"。实测有三处写入：`lifecycle.ts:43`（短期 `hasNewEventProgress` 时）、`:48`（长期同样条件）、`:34`（长期更新分支），合并时取各成员最大值（`:95`）。所以我这个担心不成立。

---

## 2. 建议开工前定的三处

### 2.1 "归档判定"在两处给了不同定义，需要同源

细化里有两个地方在定义"是否已归档"：

- **§3.1** 用**字段**：`archiveStart(row, now)` —— "已容量退出或已有有效归档锚点取本次最早退出时刻；否则普通长期到期取 `expiresAt`"；配套字段是 `capacityExitedAt` 与 `archiveEnteredAt`；
- **§4.1** 用**日期**："归档自然到期与容量退出统一计入 500"——听起来是用 `expiresAt` 与容量标记一起判。

两者的**结果**可以一致，但表达方式不同：自然到期的条目**从来没有写过 `archiveEnteredAt`**，如果有人按"`archiveEnteredAt !== null` 才算归档"来算 500，就会漏掉全部自然到期条目；而 §5.1 又说"超出归档期限先清理"，清理对象必须是同一个集合。这正是我在上一轮说的"查询和数量统计依据同一归档判定"。

建议在细化里写死一个谓词并点明它被三处共用，例如：

```text
archived(row, now) := row.capacityExitedAt !== null || (row.expiresAt !== null && expiresAt <= now)
archiveStart(row) := row.archiveEnteredAt ?? row.capacityExitedAt ?? row.expiresAt
```

并在 §4.1 明确"500 与 90 天都用 `archived` 判定，计数与删除不得各用一套"。这是本轮最值得写死的一条——它同时决定"500 里到底有多少条"，而 §4.1 的 `longArchive` 统计又直接喂给 §4.2 的排序。

### 2.2 `merge_short` 的两处细节

**① 决胜方向没写。** §7.2 写"`canonicalShortId` 为最早 `createdAt`、同分 ID 的输入 short"。"同分 ID"没有说取更小还是更大——ID 是 UUID 字符串，方向不同会导致同一个输入集合选出不同主身份，进而在恢复顺序上产生不可复现的差异。建议写成"`createdAt` 最早；相同时取 ID 升序最小者"，与 §4.2 的 `id` 升序决胜保持同一个方向感。

**② `sourceIds` 的来源要求没写进合同。** §7.2 的 `merge_short` 行把 `sourceIds` 列在"必需输入／输出"里，但现有校验只在 `refine／merge／promote` 上要求非空（`contracts.ts:158`）。`merge_short` 是新动作，需要**显式加进那个集合**，否则一条 `sourceIds: []` 的合并单元可以通过，等于合并后的身份失去来源依据——这与 V0.3 起就坚持的"每条记忆必须有当前轮次合法来源"直接冲突。

### 2.3 `archiveEnteredAt` 与自然到期并存时的字段语义

§3.1 说"`capacityExitedAt` 后又到 `expiresAt` 不后移锚点"，但没说清两件事：**归档窗口已经在跑之后，`expiresAt` 是否还继续参与判定**，以及**删除时以哪个为准**。建议补一句："一旦 `archiveEnteredAt` 落地，后续判定与删除只认它；`expiresAt` 不再改变归档窗口。"否则一条先容量退出、后自然到期的记录，在两处不同实现下可能得到两个不同的删除时刻。

---

## 3. 三处观察（不必改，但值得记）

### 3.1 归档的"OR"条件我接受，上一轮的建议撤回

我上一轮建议"超 90 天**且**池超 500 才删"。细化 §5.1 明确选了 **OR**，理由是"否则超过 500 仍不能清理，违背有限容量"——这个理由成立，而且它把语义写得很清楚："90 天是**最长**归档时间，不保证每条至少有 90 天找回期"。我撤回原建议。

只是提醒一句运维观感：池满时**未到 90 天**的条目也会被删，所以"进归档就一定能找回三个月"不成立；细化 §9 已经写明"归档缺失按未找到，不保证 500 或 90 天之外可恢复"，与之一致。

### 3.2 细化对"删除面"的补充比源码走查更全

我上一轮列了 6 个删除面。细化 §5.3 的表列出 **10 个**，多出的三处我核对后确认都存在：

- `memory_index_jobs`（待办与其 `text`／`result`）——`IndexJob` 确实带 `text`（`memory/types.ts:36`）；
- `post_jobs.result`——记忆提取结果确实落在 post job 里（`recovery.ts:58-62`）；
- **已完成模型网页 checkpoint**——细化自己说明"`WebSearchService.releaseOwner` 当前仅清进程缓存，不证明持久化 checkpoint 已压缩"，并新增 `compactOwnerCheckpoint`。这一条是它主动补的，我原来的清单里没有。

`done` job 只留统计、不留 snapshot／完整 result 的说法（§5.4）也与我们此前"job 快照本身就保存完整候选正文，所以清理必须覆盖它"的判断一致。

### 3.3 执行计划的覆盖面

8 个任务的具名用例基本把我提过的每条都覆盖了：`short_101_summary_immediate`（场景 1）、`long_1001_includes_preview`、`archive_501_eviction_before_90_days` 与 `archive_age_without_overflow`（OR 的两半）、`protect_and_repoint_references`（悬空引用）、`late_prepare_does_not_restore_pruned_snapshot`／`late_index_no_vector_resurrection`／`timeout_no_pruned_retry`（迟到回写三分支）、`deep_ready_ineligible_index_runs`（我提的索引优先疑问，它用"不合格 ready 不挡索引 + 合格 FIFO"回答得比我的建议更细）、`blocked_ready_no_zero_timer`（0ms 循环）、`environment_and_maintenance_do_not_refresh` 与 `environment_0600_first_not_idle_reset`（锚点写入点 + 环境不刷新）。

任务 3 的 `missing_owner_stale_other_unit_applies`（第 78 行）正好把"存在性检查"与"其他单元继续"两件事锁在一起，是这套里最有价值的一条。

---

## 4. 本次复核的边界

**没有做**：运行测试／构建／demo；连接模型或 QQ；检查正式库；修改任何文件。

**因此无法验证**：100／1000／500 与 90 天是否适合数月真实运行（细化自己也说"不根据一批输出声称已适合"）；真实模型是否稳定区分"同事件合并"与"共享关键词"（`merge_short` 的语义边界只能靠在线验收观察）；以及归档 OR 条件下用户实际的"找不回来"体验。

**给用户的一句话**：三处待定都是把口径写死，不需要你重新做产品选择；睡眠例外、500 上限与 90 天都已在细化里作为推荐值固定，可直接进入实施。
