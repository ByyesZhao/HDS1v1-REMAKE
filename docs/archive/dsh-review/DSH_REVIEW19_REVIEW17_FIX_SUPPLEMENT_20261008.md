# REVIEW17 修复记录复核与 dry-run 待办评估（DSH）

日期：2026-10-08。对象：[REVIEW17 修复记录](REVIEW17_MEMORY_FIX_LOG_20261008.md)，对照[第十七轮复核](DSH-review/DSH_REVIEW17_MEMORY_CAPACITY_IDLE_DELIVERY_20261008.md)与[第十八轮补充](DSH-review/DSH_REVIEW18_MEMORY_CAPACITY_IDLE_SUPPLEMENT_20261008.md)。

方式：只读源码、文档与 Git，**没有运行测试或服务，没有修改任何文件**。

结论：**记录没有问题，五处修复我都在源码里核实到位，不需要 review。** 那份延期的 Minor（dry-run 退出对象预测）**不关键、不影响任何运行时行为**，但它是一行改动，建议顺手修掉而不是长期挂着——理由见第 3 节。

---

## 1. 五处修复的核实

| 修复项 | 源码证据 | 判断 |
| --- | --- | --- |
| 重复 short ID | `contracts.ts` 的 `merge_short` 分支现在走 `new Map` 去重后再数长度 | 落实 |
| 平台消息身份 | `host/input.ts` 新增 `incomingMessageId(session)`，用 `platform:JSON.stringify([platform,selfId,userId,channelId,messageId])` 构造带作用域的稳定 ID；无 `messageId` 时才用 `randomUUID()`；`index.ts:105` 改用它 | 落实，且作用域包含了机器人／会话维度，比只用 `messageId` 更稳 |
| 空摘要闭环 | 基础合同 `contracts.ts:126` 现在要求 `eventSummary` 或 `feelingSummary` 至少一侧非空（"must be meaningful"）；`cleanup.ts:19-21` 区分 `shortsReady` 与 `missing`，并为受阻 short 生成 `repairs`（按 `summaryRepairBasis` 同版本只登记一次） | 落实，源头与存量两侧都有 |
| 归档晋升 | `capacity.ts:13` 新增 `promotionEligible = ordinaryLong && totalAwakenings>=30 && !isArchivedLong`；`maintenance.ts:131-132` **冻结时刻与当前时刻各查一次**（`promotionEligible(r, job.cutoff)` 与 `promotionEligible(owner(main), now)`），合同侧也要求 `evaluationAt` | 落实，正是"候选／合同／应用三处联动、不靠 throw 重试"的做法 |
| 审计报告删除 | `maintenance.ts:155` 改为 `DELETE ... WHERE id IN (?,?,?)`，三个固定 decision 的完整 ID | 落实，是字面匹配而不是 LIKE |

另外我核对了独立复核发现的那处 Important：`metadata.ts:3-4` 现在用完整的 ECMAScript 空白集合（`String.fromCodePoint(9,...,65279)`）而不是 SQL 的 4 种 ASCII 空白，`2cac79d` 只动了 `metadata.ts` + 一个测试 + 三份文档——**这是一个我自己也没想到的真实缺陷**（全角空格会让空摘要失去保护、空详情让 `nextDeadline` 返回 now 却没有可执行修复），定位和修正范围都很准。

证据链也完整：修复前失败（4／6／5 项等）→ 修复后通过 → 83 文件 / 469 项 → typecheck、build、隔离混合验收；正式库 SHA256 前后一致、未初始化、owner 数 0。

---

## 2. 记录本身的两处小注

- **`§一次独立整体复核与作者修正` 里"无 Critical，1 项 Important、1 项 Minor"与实际处理一致**，且明确写了"未派二次复审"、Minor 延期——口径清楚，没有把延期项写成已修。
- **一处措辞**：修复记录的标题是"REVIEW17 记忆修复实施记录"，但内容同时覆盖了 REVIEW18 的补充确认（归档晋升 B 规则）。不影响理解，将来若要把这条规则追到"谁定的"，记得 REVIEW18 是澄清来源。

---

## 3. dry-run 退出对象预测：不关键，但建议顺手修

### 3.1 为什么它不关键

- **它只在两个地方被读到**：`scripts/migrate-memory-capacity.ts` 的 `--dry-run` 报告，以及 `index.ts:42` 的启动检查。**而启动检查用的是 `hasCharacter` 与版本标记，不是退出对象列表**（我核对了 `memory-capacity-upgrade.ts:15,21-23` 的字段与 `index.ts:42` 的用法）。
- **实际归一无论预测如何都按正确规则跑**：`capacity.normalize` 自己构造保护集（`capacity.ts:61`，即使加上 `temporary` 也与预测路径无关），`cleanup` 用 `includeRetainedShorts=true`。预测只是一份**报告**。
- **误差方向是"偏保守"**：预测用了更宽的保护集（`protectedCanonicalIds(rows, at, true)`），所以它会**少列**一些实际会被挤出的对象。少列一批"将要退出"的条目，不构成误导性风险；反过来（多列实际不会退出的）才会让人误以为要丢东西。
- **对你的正式库没有影响**：那是个空库（owner 0 行），`--dry-run` 本来就什么都不会列。

### 3.2 为什么仍建议顺手修

两个理由：**修法是一行**（`memory-capacity-upgrade.ts` 里给 `longCapacityExits` 那处单独传 `false`，或把预测分成两套集合并注明），而且**它是唯一一处"保护语义"与运行时不同的地方**——我们过去几轮反复吃过的教训正是"两处判据不同源"。留着一个已知不同源的预测，将来很容易被人当成运行时的规格来读。

另外建议把报告字段的语义写清：`longCapacityExits` 是**下界预测**（"至少会退出这些"），而不是精确清单。这样即使不修，读的人也不会误解。

### 3.3 我的建议

**不值得单独排一轮修复，但值得并进下一次改动。** 具体说：下次因为别的原因动 `memory-capacity-upgrade.ts` 或 `capacity.ts` 时，顺手把预测的 `includeRetainedShorts` 改对并补一条"同条件下预测与 `normalize` 一致"的回归；在此之前，在细化或工具 `--help` 里注明它是下界即可。

---

## 4. 本次复核的边界

**没有做**：运行测试／构建／复现脚本；连接模型或 QQ；写入正式库；修改任何文件。

**因此无法验证**：469 项测试的实际通过情况（我只读了记录）；`inspectMemoryCapacity` 与 `normalize` 在实际含受阻 short 的库上的差异幅度（我按代码推断为"少列"，未实测）；以及归档晋升 B 规则在真实长跑中的表现。

**给用户的一句话**：这轮修复干净，记录可信；那个待办不影响使用，你下次让我或 CODEX 动这块代码时一起改掉就行。
