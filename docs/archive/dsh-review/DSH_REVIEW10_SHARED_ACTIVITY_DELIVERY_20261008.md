# 共同活动 V0.3 实施交付复核（DSH）

日期：2026-10-08。对象：共同活动任务 1～7 的实现（本地 Git `95fec98`，49 个测试文件、250 项测试）。依据：[实施记录](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md)、[最终复核记录](SHARED_ACTIVITY_V0.3_FINAL_REVIEW_20261008.md)、四份规范（方案／细化／计划／本轮细化）与 `src/`、`tests/`。

方式：只读源码与文档，**没有运行测试或服务，没有访问正式库或私有配置，没有修改任何文件**。

**本文件已于同日按 CODEX 的回应修订**（见 `CODEX_REBUTTAL_SHARED_ACTIVITY_DELIVERY_20261008.md`）：撤回 §6.1（守卫其实挡住了该组合）、更正 §6.4 的锚点条目（我误把开始准备轮写成结束轮）、更正 §6.2 的修法（不能复用 `foreground`），并把 §5.1／§7.1／§7.2 从"缺陷／需裁定"收窄为"口径澄清"。结论与优先级已同步更新。

结论：**实现与细化高度一致，可以进入实机验证；但建议先处理 4 条，再按细化 §10 的清单做正式库升级与真实多轮验收。** 三路专项审核 + 我自己的走查都没有发现会损坏数据、丢失输入、重复交付或让规则失效的问题；五类灾难性缺陷（同一节点被选两次、控制重复消费或丢失、轮数溢出、过期截止自旋、比较方向反了）在代码里都推不出来。

**实机验证前建议处理（按优先级）：**

1. **5.2** 首节点与提前收尾都可能**没有任何公开正文**（现有测试里就有一场只有开始／结束两个标志的活动）。这是本轮唯一被双方共同认定的实质缺口，建议按细化补约束：用 `sharedMeta.stepNumber === 1` 识别首节点（不能只看 `phase === 'opening'`，小上限时首节点可能已是 `wrap_up`／`final`）并要求公开旁白非空；非 final 的提前 `end` 也要有公开收尾正文。仍允许角色 `reply = none`、中间轮无新节点。
2. **5.1** `wrap_up` 的 outline 精确字符串校验会卡住改写并暂停，恢复时又对着同一份数据再失败——规则本身是有意选择（"只减不增"的条目身份约定），建议只做**有限空白兼容**（匹配时去首尾空白、合并连续空白，命中后仍保存旧原文），不做语义映射、不静默恢复旧集合、不撤销校验。
3. **6.2** `nextDeadline` 的共同候选缺身份资格（`clock.activityId === scene.shared.activityId`），建议抽一个"不含是否已到期"的共同资格谓词供两处共用；**不要**改成复用 `foreground`，那会丢掉未来截止。
4. **7.1 / 7.2 / 7.3** 都是"补一句口径"而非改代码：开始转移与普通门禁的所属模式、活动外命令的唤醒语义、`【推进】` 的"全文"定义。

其余为已撤回项（6.1）、潜在缺陷（6.3 不加自愈）、次要文档不符与低优先级改进（第 2 节、6.4、7.4），都不影响本次交付。

---

## 1. 已核对一致的关键链路

- **控制指令确实不进 `messages`。** `host/input.ts:16-21` 在事务内先判 `content.trim() === '【推进】'`，直接写 `control_requests`（活动内 pending／活动外 cancelled），**不写消息行**；正常未读集合也独立排除了共同队列：`storage.ts:70` 的条件是 `!(m.sharedActivityId && m.batchId === null)`。所以控制文字不会进入近期原文、检索查询或记忆来源。
- **开始／结束的确认边界是"标志确认"而不是"段 B 完成"。** `host/shared.ts:61-69` 在发送确认事务内用 outbox 位置识别开始（`seq === 0` 且 narration）与结束（最后一个 narration 项），分别建立／关闭 `sharedClock`；`sharedRoutingActivity` 优先读 clock，其次才用已提交的 `Scene.shared`。这与细化 §3 的两条路由规则一致，也解释了为什么"用户看到标志"就能切换路由。
- **60 秒锚点与唯一节点。** `sharedDeadline`（`shared.ts:33-39`）取 `max(startedAt, lastInputAt, lastOutputAt, lastSilentCompletedAt)`，首节点直接返回 `startedAt`；`refreshSharedStep`（`:42-55`）把结果同时写进 `Scene.shared.nextStepAt` 与唯一任务 `scene:${activityId}`，轮数用尽时改为取消任务。`recordSharedOutput` 只对已确认的 narration/text/action/sticker 更新 `lastOutputAt`。
- **段 B 顺序正确。** `recovery.ts:70-84`：先应用记忆与候选状态，再 `applyTasks`／已看标记，然后 `finishSharedTurn`，随后**重读**角色状态写自主字段；`finishSharedTurn` 内部读的是刚保存的状态（含 `nextStepAt`），结尾再写回，不会覆盖 5.1 步骤 5 的 `nextAutonomousAt`。
- **前台优先与环境截止保留。** `scheduler.ts:22-29` 先取 `foreground`，其后才是环境轮与自主轮；`nextDeadline` 末尾仍无条件纳入 `nextWorldAt`/`nextSchoolAt`（`:97-98`），所以共同等待期环境仍有机会运行——这正是第九轮我判断错误、由 CODEX 纠正的那一点，实现与纠正后的口径一致。
- **自主周期统一重排、且不与前台竞争。** `autonomousEligible`（`:60-63`）要求无合法共同活动、未睡眠、无 openBatch、无 pendingBatch、无前台可运行；`collectReady` 只在满足它时才产出自主轮，不把 `autonomous` 混进前台触发种类。
- **睡眠豁免有版本门禁兜底。** `state.ts:7-17` 的 `isSleeping`/`canRead` 都对"合法共同场景"直接豁免，而 `hasValidSharedScene`（`shared.ts:20-24`）只校验 `shared` 字段本身；版本门禁由装配层承担（`index.ts:38` 调 `ensureSharedActivityVersion`，缺版本直接抛错并关闭库）。这与细化 §8 第 189 行"版本门禁由装配处理"的分工一致。
- **复核发现的那处升级误报已修**：`shared-upgrade.ts` 现在只在尚未升级的版本上做旧活动识别，version=1 的正常未完成准备轮／环境轮不再误报，重复 `--apply` 幂等。
- **恢复文档已同步实质变更**：`REMAKE_V0.2_RECOVERY.md:128` 与新增的 §6.1（`:175-177`）已把"可运行前台先选、其次到期世界／学校、再符合资格的自主"和"共同 60 秒等待中环境截止保留"写进去，不再是旧的三步顺序。

---

## 2. 三处细节建议

### 2.1 `hasValidSharedScene` 的名字与职责略有落差

该函数只判断 `Scene.shared` 的字段形态（`activityId`、`completedSteps`、`maxSteps ∈ [1,20]`、`idleSeconds > 0`），**不检查 `Runtime.sharedActivityVersion`**；而它被 `isSleeping`／`canRead`／调度器多处用于"这是不是一个真实活动"的判断。当前靠装配层门禁兜住是没问题的，但函数名容易被后来者当成"完全合法性检查"。

建议在 `src/host/shared.ts` 该函数上方加一行注释说明"版本合法性由装配层负责，本函数只判字段形态"，或把名字改成更中性的（例如 `looksLikeSharedScene`）。**不建议**把版本检查塞进这个函数——那会让 `state.ts` 依赖 Runtime，破坏执行计划第 51 行"shared.ts 不依赖 host/state.ts"的既有分层。

### 2.2 结束轮的 15 秒锚点回推依赖一个隐含关系

`shared.ts:106`：

```ts
const anchor = Math.max(milliseconds(completedAt),
  ...transferred.map(m => milliseconds(m.receivedAt)),
  runtime.openBatch ? milliseconds(runtime.openBatch.readyAt) - 15_000 : 0);
```

这里用 `readyAt - 15_000` 反推"已有普通窗口的锚点"，依赖"`readyAt` 恰等于锚点 + 15 秒"这一关系。当前 `input.ts:41` 正是这么写的，所以成立；但细化 §7.3 的表述是"截止取 `max(completedAt, 这些输入最近 receivedAt, 已有普通窗口锚点) + 15 秒`"，代码走的是等价的回推路径。

建议在 `input.ts` 的 `readyAt` 赋值处留一句注释标明"此处是结束轮回推锚点的依据"，或把窗口锚点直接作为一个字段存进 `openBatch`，避免将来有人改掉 15 秒偏移时静默破坏结束转移。

### 2.3 静默代写的权限仍是"选择时快照"

`shared.ts:17` 用 `inputMessageIds.length === 0` 判定 `allowSimulatedUserActions`。若某一轮被选定时没有任何输入（权限 true），生成期间用户又发了一条消息，这条消息会按串行规则留到下一轮，而**本轮仍会以允许代写的权限生成**。这与细化 §4.3"不预测随后个人导演是否开口"的口径一致，属于有意设计；但用户的实际观感可能是"我说话了，她还在替我演"。建议在实施记录或细化里补一句现象说明，方便真实联调时判断是否需要收紧（例如改为"距最近输入超过 60 秒才允许代写"）。

---

## 3. 值得记一笔的遗留边界

**平台已送达但本地未确认的重复消息**：沿用既有冻结发送约定（已确认跳过、未知项可能重发），本轮没有引入平台幂等或去重机制。这在最终复核记录里已被登记为交付边界，我确认实现与之一致——`recovery.ts` 的确认路径没有变化，`sendFrozen` 仍只在明确确认后写 `confirmed`。真实联调时需要按既有预期接受偶发重复。

---

## 5. 补遗：合同、提示词与"代写→记忆"专项复核

由专项线程交回、我逐条回源码确认。**这一节是本次复核里最值得处理的部分**：前两条都是"程序允许、文档却要求"的缝隙。

### 5.1〈会出错·可证〉`wrap_up` 的字符串包含校验会卡住合法轮次，并可能反复卡住

`contracts.ts:64`：

```ts
if (sharedMeta!.phase === 'wrap_up' && previousOutline)
  requireControl(result.outline.openThreads.every(thread => previousOutline.openThreads.includes(thread)),
    'outline.openThreads', 'wrap_up may only retain or remove original strings');
```

这是**精确字符串成员判断**（`Array.includes`，不做 trim／归一化）。第十轮接受的口径确实要求"保留项沿用原文本"，但实现后果是：模型在收束阶段把一条线索换个说法（例如"还没决定吃什么"→"晚饭吃什么尚未决定"），校验就失败 → 走两次格式修补 → 抛 `ModelFormatError` → `runtime.paused = true`。

更麻烦的是**它很可能重复发生**：该轮未完成，恢复时会复用同一份冻结 `sharedMeta` 与同一份 `previousOutline`（`app.ts:54`、`recovery.ts:105-112`），于是同一处再次失败，形成"恢复—再失败"的循环，直到人工介入。这与记忆轮遇到的"空别名"问题同类，但代价更高（暂停整个故事）。

两个低成本改法，任选其一：

- **A（推荐）**：比较前对两侧 `trim()` 并做空白归一化，仍然要求"保留项来自旧集合"，但不再因为多一个空格失败；
- **B**：把这条校验从硬失败降级——违规时仍接受本轮，但把 `openThreads` 替换为旧集合（以程序为准），或只在提示词与实施记录里标注，不阻塞轮次。

我倾向 A：既保住"只减不增"的意图，又不会因为表述差异把整个插件停下来。

### 5.2〈与文档不符〉首节点与提前收尾都可能没有公开正文

`publicNarration` 在合同里是可空的，只有 `final` 被强制非空（`contracts.ts:16,65-68`）。因此：

- **首节点**：`app.ts:165` 建立活动时 `progress = '已确认开始，待首个公开节点'`、`outline = null`，而合同不要求首节点输出公开正文；方案 §3.4 期望它"建立活动走向、让用户看到场景开头"。模型若首轮返回空旁白，程序完全接受。
- **非 final 的提前 `end`**：细化 §4.2 与 §6 都要求"有合理结束过程和结果 / 公开收尾"，但合同同样不强制。现有测试 `tests/shared-scene.test.ts:59-69` 里就有一个 `phase='opening'` 的结束轮，只发了 `【共同活动结束】`。

这不是数据问题，而是"用户可能点开活动却什么都没看到"的观感问题。建议二选一：

- **A**：在合同里把 `completedSteps === 0`（首节点）与"本轮带 `sharedChange.end`"也纳入"公开正文非空"的要求；
- **B**：接受现状，但在方案／细化里把"首节点与提前结束**建议**有公开正文"明确成建议而非要求。

### 5.3〈已知限制·仅提示词〉未公开的代写仍可进入 `experiences`

`recovery.ts:71` 无条件写 `experiences`，而 `experiences` 是合法的记忆来源（`organize.ts:17`）；`simulatedUserActions` 的校验只证明"声明的 ⊆ 公开正文"（`contracts.ts:63` 的单向 `includes`），**没有任何程序要求一条 experience 必须公开过或必须被声明**。所以细化 §9 那句"没有公开依据的代写不能只凭内部 experiences/progress 进入共享事实"目前**不是程序保证**，而是提示词约束。

这一点细化自己已经承认（§6 第 160 行"程序不能仅靠这项字符串检查证明散文没有漏报代写"），所以属于已知限制而非缺陷。记录在此，是为了真实联调时把它列入观察项：可以抽查若干轮，看 `experiences` 里是否出现既未公开、也未列入 `simulatedUserActions` 的用户行为描述。

### 5.4 与之相关的提示词脆弱点

`prompts.ts:8` 用**字面替换**改写共用规则：

```ts
narrative_shared: `${common}\n${narrativeRules.replace('不替用户编造发言、心理与关键动作。', '用户行为依下述共同任务授权。')}\n…`
```

如果将来有人改动 `narrativeRules` 里那句话（哪怕是标点），替换会**静默失效**，共同提示词就会同时包含"不替用户编造发言"与"允许代写"两条互相矛盾的指令，而且没有任何测试会失败。建议把该句提取为常量，或加一条断言"共同提示词不包含被替换掉的原文"。同一行还提到已删除的字段名 `nextStepAt`——在 `.strict()` 下，模型若真返回该字段会被判为格式错误并消耗两次修补，建议提示词不再指名这个字段。

### 5.5 其余（低优先级）

- 结束轮的 outbox 里，`sharedMeta` 只解析 `seq === 0`（`shared.ts:61`），所以本轮的其它角色文字／动作／表情项不会更新 `clock.lastOutputAt`。今天无影响（`completedSteps === 0` 时截止被钉在 `startedAt`），但属于 §5.1 的一处潜在分歧，建议在注释里说明。
- 代写清单的包含判断允许极短条目（例如 `"你"`）——只会让校验更松，不影响安全；若要收紧可加最小长度。
- 标记文字本身也是合法记忆来源，理论上可以出现"只引用 `【共同活动结束】`"的模拟记忆；实际发生概率低，记录备查。

---

## 6. 补遗：调度核心专项复核

由专项线程交回，我核对了其中最关键的两处。**八项要求全部按细化实现，五类灾难性缺陷（同一节点被选两次、控制被消费两次或丢失、轮数溢出、过期截止自旋、比较方向反了）都无法从代码推出**；下面三条是"形状可证、当前不可达"的潜在缺陷。

### 6.1〈已撤回〉~~`finishSharedTurn` 在"结束轮且 `meta` 为 null"时会抛错~~

**本条撤回。** `shared.ts:77` 的守卫是 `if (!meta && change?.action !== 'start') return;`——`meta = null` 且 `action = 'end'` 时两个条件都为真，函数**直接返回**，根本不会读到第 79 行的 `state.scene.shared!.activityId`。我（以及专项线程）把两个合取项读反了，追加一个相同守卫是多余的。

### 6.2〈修正后的建议〉`nextDeadline` 的共同候选确实缺身份校验，但修法要说准

`scheduler.ts:90` 只查 `status === 'active'`，而 `selectSharedMeta`（`shared.ts:8`）与 `refreshSharedStep`（`:44`）都额外要求 `clock.activityId === scene.shared.activityId`。身份不一致且截止已过期时，`foreground` 返回 null 而定时器仍投出过去的时刻 → 0 ms 空转。**形状成立、当前不可达**，属于一致性改善。

我原先建议的"复用 `foreground(now)` 谓词"**是错的**，这里更正：`foreground` 同时承载了"现在是否可运行"这一半语义，在合法等待窗口里它本来就返回 null（60 秒未到、没有手动推进与预约），照此实现会**丢掉尚未到期的活动截止**，活动只能等别的触发才继续。正确的最小修法是只补身份资格（例如抽一个"不含是否已到期"的共同资格谓词，供 `collectReady` 与 `nextDeadline` 共用），定时器继续负责未来唤醒。

### 6.3〈潜在〉轮数用尽或 clock 缺失时没有运行期出口

若一个**合法**共同场景停在 `completedSteps >= maxSteps`，`selectSharedMeta` 直接返回 null，而 `foreground` 在共同分支里提前 `return null`，不会落到普通输入分支——于是共同输入与普通输入都得不到处理。clock 缺失或 `ended` 但场景仍在时同理。

合同层保证了这两件事不会发生（`final` 强制 `end`；结束路径同时清 clock 与场景），`refreshSharedStep` 也会在到达上限时取消唯一节点任务，所以今天不可达。是否要加出口取决于取舍：项目明确不要防御性编程，我**不建议**为它加自愈逻辑；但可以考虑在 `hasValidSharedScene` 里补一条 `completedSteps <= maxSteps` 的形态约束（一行，纯数据校验，不是防御机制），并让 `foreground` 在这条不成立时回落到普通分支。

### 6.4 其余可改进（低优先级）

- **标记项也算 `lastOutputAt`**：正常边界标志是公开输出的一部分（开始即时、结束停止节点），现行为无错，不必为它新增 outbox 类型。
- 〈更正〉**准备轮与正式节点的锚点规则应区分**：我原先写的"结束轮只有 `seq = 0` 被识别"是错的——`shared.ts:62` 在非 start 情形取 `turn.sharedMeta?.activityId`，而正常结束轮**带** `sharedMeta`，所以该轮的文字／动作／表情与末标志都会更新 `lastOutputAt`。真正的小差异在**开始准备轮**：它没有 `sharedMeta`，因此开始标志之后的角色表达不更新 clock。当前无节奏影响（首节点固定按 `startedAt` 立即选，之后的窗口由实际输出或静默完成时间建立）。建议在细化 §5.1 里把"每个共享输出"明确区分为准备轮与正式共享节点。
- **`refreshSharedStep` 的 `_now` 参数未被使用**（`shared.ts:42`）：保留与既有接口一致，建议补一句注释说明"截止只取持久锚点，不取调用时刻"。
- **`status()` 有写副作用**：它经 `nextDeadline → foreground → refreshSharedStep` 会写 `character` 与 `tasks`；写入的是确定性投影，不修改真实锚点、轮数或自主时间。说明清楚即可，不必据此重构调度。
- **两处过期睡眠清理不是重复**：`app.ts` 按本轮 `at` 清理以便处理候选里的睡眠偏好，段 B 按 `completedAt` 覆盖"慢生成／发送跨过 wakeAt"的情况。不能删掉任意一处。
- **测试强度**：可补"身份缺失的 shared 行"直接过 `isSleeping`/`canRead` 的夹具；"版本为 null 拒绝启动"已有装配层测试，不需要再要求 `selectSharedMeta` 自行拒绝——那与"版本门禁在装配层"的分工冲突。

---

## 7. 补遗：输入路由与控制命令专项复核

最后一路线程的结论。八项要求全部按细化实现，**没有发现"输入丢失、重复交付、控制泄漏进记忆"这三类问题**；它给出三条边界级发现，我核对了两处源码。

### 7.1〈需说明口径〉开始转移与"普通门禁仍有效"的关系

`shared.ts:89` 的转移条件里**没有 `canRead`**，而合法共同场景下 `canRead` 被强制为 true（`state.ts:13`）。因此准备轮若在 `canRead = false` 时被选中（唤醒、预约、检查消息这类触发都可能在手机不可用时运行），且该轮个人导演返回了 `sharedChange.start`，此前因手机门禁暂存的消息会在转移后立刻可读。

我原先把它列成"§3.3 与 §5.2 冲突、需要用户裁定"。**更准确的判断是：这不是两条要求同时失效，而是需要说明门禁的所属模式。** 普通门禁在开始之前有效，而合法共同活动本身就意味着清醒可读；开始之后把这些未看内容转交给活动、由首节点读到，是自然结果（并且这些输入会让首节点 `allowSimulatedUserActions = false`，不触发代写）。所以保留现行为，只需在细化 §7.3 补一句"普通模式的门禁不约束已经开始且身份合法的共同场景"，无需你重新选择产品规则。

顺带一处残留：`stashPending`（`scheduler.ts:64-72`）创建的 `check_messages/unread` 任务在活动开始后不会被取消（`finishSharedTurn` 的取消只覆盖 `scene_step` 与未消费控制请求），它会在到期后被处理并完成，实际变成空操作。属残留而非错误；若将来要清理，必须先确认只针对已转交消息，不能笼统删除全部检查任务。

### 7.2〈需澄清措辞〉活动外控制命令也会唤醒宿主

`runtime.ts:22` 对**每一条**输入都调用 `wake()`，包括被判为活动外、已记 cancelled 的那条控制命令。由于 `wake()` 会跑 pump（`runtime.ts:39-57`），一条 cancelled 命令可能顺带：结算已到期的普通批次、运行已到期的故事轮、把睡眠角色的 `nextAutonomousAt` 清空，或应用一个已 `ready` 的后台维护单元。

我原先认定这与细化 §4.1 的"不调用模型"冲突。**更准确的说法是措辞问题**：`applyOneReady` 本身不调用模型，是随后的 `startOne` 才可能准备到期维护并调用模型；这些都是"本来就已经到期"的独立工作，不是该命令产生的新剧情触发。细化那句话说清了"命令不进入故事输入、不新建回合"就够，不必要求宿主停住所有到期工作——把"不调用模型"改成"不把命令当作故事输入、不产生新的剧情触发条件"。我的原判过强，已按此收窄。

### 7.3〈与文档不符·次要〉"全文恰为"判断的是文本元素拼接结果

`input.ts:16` 比较的是 `message.content`，而 `index.ts:94` 构造它时只取 `text` 类型元素。所以一条"文字部分是 `【推进】`、同时带有引用／图片／@ 的消息"也会被判为控制命令。建议在细化里给"全文"下定义——**所有 text 元素依次拼接、trim 后的全文**；非文本附件本轮不解析，真实引用／图片形态留待联调确认。

### 7.4 其余可改进（低优先级）

- `control_requests` 只增不减，且每次选轮都全表扫描（`shared.ts:9,102`）；单用户量级无碍，但它是唯一不会自然收缩的审计表，值得记一条清理策略。
- `refreshSharedStep` 在每次 `foreground()` 评估时都会跑（`scheduler.ts:36`），包括 `autonomousEligible`／`nextDeadline` 的调用路径——写入值是幂等的，但会产生多余的库写入。
- `controlRequestIds`、`sceneTaskId` 这类程序内部 ID 会被序列化进模型提示词（`app.ts:105,130` → `client.ts:66`）。不泄漏用户内容，但属于无意义的 token 开销。
- 路由与选轮的不对称：`sharedRoutingActivity` 在没有 clock 时回落到已提交的 `Scene.shared`（`shared.ts:29-30`），而选轮要求 active clock（`:8`）——这种输入会被"只入队、不被选走"。门禁部署下不可达，记录备查。

---

## 8. 本次复核的边界

**没有做**：运行测试／构建／demo／smoke；连接 QQ 或模型；检查或升级正式数据库；读取密钥、角色背景、私有配置；审阅 250 项测试的实际通过情况。

**因此无法验证**：测试断言与真实行为是否一致（250 项测试我没有实跑）；静默代写在连续多轮后的漂移程度；目标／结束条件的语义稳定性；正式库的升级与备份结果；QQ 引用／图片消息在真实 `h.parse` 下的元素形态（影响 7.3 的边界）；以及 60 秒窗口在真实网络与模型延迟下的观感。这些正是实施记录"后续真实多轮验收"列出的必做项，我的静态复核不能替代。

三路专项线程（合同与共享记忆、调度核心、输入路由与控制）已全部回报，结论分别并入第 5、6、7 节；**没有未决的补遗**。
