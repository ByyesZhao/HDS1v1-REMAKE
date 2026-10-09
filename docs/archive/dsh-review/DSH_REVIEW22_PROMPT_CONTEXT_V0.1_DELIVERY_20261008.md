# 提示词与上下文优化 V0.1 交付复核（DSH）

日期：2026-10-08。对象：任务 1～12 的实现（本地 Git `dc68d4d`）。依据：[交付验收记录](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)、[实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)与 `src/`。

方式：只读源码、文档与 Git，**没有运行测试或服务，没有修改任何文件**。

结论：**交付质量高，我上一轮提的三处都已落实（其中一处按"数据保留但无文案"的方式落地，见 §3）；三路专项审核另发现 7 处需修、1 处与文档不符，其中 2 处会静默改变"角色能看到什么"，建议在长期运行前修掉。** 全部三路已回报，见 §5。

---

## 1. 我上一轮三条的落实

| 我提的 | 实际落地 | 判断 |
| --- | --- | --- |
| 提醒正文要带 occurrence 的时间／地点，且 `instanceId` 要绑定到声明的课次 | `school/contracts.ts:53` 的提示现在明确写"程序已展开课次及确定通知对象……**publishAt 是通知发布时间，occurrence.startsAt 才是活动开始时间**"；验收用例名里直接有 `reminder_instance_id_matches_occurrence`（`school-week-text-contract.test.ts:9`）；交付记录 §2 也用真实样例验证了两条提醒分别对应 13:00 与 08:00 的课 | **落实，且比我要求的更完整**（区分了"通知发布时刻"与"活动开始时刻"这个最容易写错的点） |
| 无必需通知跳模型与 `conflictNotes` 的关系要写死 | 选了方案 B：`environment/runtime.ts:33` 有 `emptyWeek = stage==='school_week' && modelContractVersion===1 && requiredNoticeKeys.length===0` 的守卫，**确实跳过模型调用**；`calendar.ts:129` 把 `conflictNotes` 从 `result.weekChanges` 取，所以无通知时**没有自然语言冲突说明**，冲突只作为程序数据保存 | **已写死并有用例**（`conflicts_without_notice_zero_calls_preserved`）——见 §3，这一点建议你确认是否符合预期 |
| 旧"30 条"条款的文档同步范围 | `MEMORY_V0.3_IMPLEMENTATION_20261007.md` 与 `REMAKE_V0.2_MEMORY.md` 都加了 V0.1 现状段（"原文默认最近 4 个完整对话段……无 30 条二次裁剪"）；配置表新增 `recentDialogueSegments / dialogueIdleMinutes = 4 / 15`；原验收条款第 368 行保留但标注"已由完整 4 段窗口替代" | **落实，比我要的范围更全**（连历史验收条款都标了替代说明，没有直接删） |

---

## 2. 值得单独肯定的两处

**独立复核抓到两个真问题，都是"读代码才发现"的类型**：① 迟读让输入段已关闭时，合法空绑定被当成损坏、导致恢复被拒——修正后区分"缺失／非法 hold／应保持当前关联"，并新增 `late_read_closed_episode_with_null_binding_can_resume_after_model_failure`；② **lookup 返回的真实 `RetrievedContext` 顶层 `shortTerm/longTerm/learned` 没被投影**，完整存储 owner 与重复正文会绕过新资料池——这正是"新视图只覆盖了主路径、漏了补查路径"的典型漏口，抓到得很关键。

**证据纪律写得好**：交付记录 §2 明确写"这些落盘成功报告合计 74 次 HTTP……**74 不是本次全部计费请求数**"，还说明有一轮质量夹具因少传 `sharedMeta` 在合同检查阶段中止、前置请求没有落完整报告，并明确"不得把缺失报告算成零请求或从字符数推算费用"。§3 也写明"wrap/19→20 使用冻结种子专测后段，不伪装为连续从第 1 轮跑到 20 轮的全程验收"。这种把不利与不完整证据留在记录里的做法，和前几轮一致。

---

## 3. 一处建议你确认（不是缺陷）

**当周有冲突但没有必需通知时，冲突只有数据、没有文案。** 代码行为（`runtime.ts:33` 的 `emptyWeek` 守卫）是跳过周模型，于是：

- `SchoolWeek.conflicts` 仍保存程序算出的冲突（有用例 `conflicts_without_notice_zero_calls_preserved` 钉住）；
- 但 `weekNotes`／`conflictNotes` 是模型输出（`calendar.ts:129` 从 `result.weekChanges` 取），**跳过就没有自然语言说明**。

我上一轮建议的是"有冲突就仍调用模型"，实现选了另一条路且写进了用例——**这不是错误，是一个产品选择**：省一次调用，代价是当周冲突没有自然语言描述，需要角色自己从客观安排里体会。请确认这是你要的；如果希望冲突也有说明，改法很小（把 `emptyWeek` 的条件从"无必需通知"改成"无必需通知且无冲突"）。

---

## 4. 输入体量的实测变化（供你对观感有预期）

交付记录 §2 给了一组可以直接比对的数字：**同一套夹具下，普通叙事输入从方案阶段的 3903 字符变成 10512 字符**（个人 3861→10710、表达 3487→7331、记忆 3341→5541），各阶段池内消息 43／44／44／5，其中个人那条含"一段 40 条"的完整对话段。

这与设计一致（4 段完整、段内不截断），也说明**这次优化的收益在"去重与投影"，不在"变短"**——真实效果是把重复的一份变成一份，同时把窗口从"30 条"换成"最多 4 段完整原文"。我没有把字符数换算成 token 或费用的依据，也不会这么做（交付记录自己也声明了这一点）。

需要留意的仍是上一轮提过的**无上限增长**：只要没有 15 分钟空闲，当前段就一直增长，而窗口取"当前段 + 前 3 段"。按你已确认的策略这是"超限报错、不自动减载"，所以它是**已接受的取舍**，不是缺陷；我只是提醒它的触发点是"停不下来的长对话"，那时段不会自然结束。

---

## 5. 三路专项审核发现的问题

### 5.1〈需修·实现与运行时不一致〉迁移从生产从不写入的 key 读空闲窗口

`dialogue-upgrade.ts:22`：

```ts
const idleMinutes=(tables.has('state')?db.prepare("SELECT data FROM state WHERE key='dialogueIdleMinutes'").get():null)?.data;
const idleMs=(idleMinutes?Number(JSON.parse(String(idleMinutes))):15)*60000;
```

**生产从不写这个 state key**。真实位置是 `settings.memory.contextLimits.dialogueIdleMinutes`（`settings.ts:42`、`memory/types.ts:36,38`），运行时在 `index.ts:99` 用 `settings.memory.contextLimits.dialogueIdleMinutes` 构造 `DialogueEpisodes`。而 `scripts/migrate-dialogue.ts` 只接 `--database / --check / --apply / --stopped / --backup-dir`，**不读配置文件**，`upgradeDialogue` 的签名里也没有 `idleMinutes` 参数。

所以：**任何非 15 分钟的配置下，迁移都会按 15 分钟切段**，而迁移后的运行时按配置值（比如 30 分钟）判段边界——两者对同一批历史消息给出不同分段，收敛前窗口内容会与运行时不符。默认 15 的用户不受影响，这正是它没被测出来的原因。

修法很小：把 `idleMinutes` 作为参数传入（或让 CLI 像 `memory:capacity` 那样读一份 `--config`／项目配置里的 `memory.contextLimits`），并补一条"非默认窗口也能正确回建"的用例。

### 5.2〈需修·窗口构成〉不可见未读输入会刷新锚点，并可能把历史段挤出窗口

`episodes.ts:17-18` 在**每条被接纳的入站消息**上更新 `lastInteractionAt`（不论该阶段的可见性），而 `:49` 正是按 `lastInteractionAt` 排序后再切最后 4 段。于是窗口构成会出现两种偏差：

- **阶段不可见的未读输入照样刷新锚点**——这与"当前只含未读消息的段不挤占本阶段 4 段名额"的意图只在**当前轮**这一情形下成立；历史段的排序仍受它影响。
- 审核给出一条可复现序列：消息 M1–M4 在 `canRead=false` 时被暂存为 `check_messages`；15 分钟后 drain 轮运行，此时 `closeDue` 已把这些段关掉；drain 轮的 outgoing 落在**新段**、锚点更新；于是 drain 出来的 4 段排名高于仍持有 M1–M4 的那个已关段，**M1–M4 从此不再进入 `recent()`**（它们仍是 `seenTurnId:null`、仍被 `unreadMessages()` 列出，所以能从检查任务与来源集合拿到，不是数据丢失，是窗口构成错误）。更简单的变体：4 条间隔大于 15 分钟的入站消息、中间没有发生任何故事轮，也会产生同样的排名效果。

建议：锚点只由**该阶段真正可见**的交互刷新（或至少让"不可见未读"不参与段排序），并把这条写成任务 2 的具名验收。

### 5.3〈需修·一致性判定的安全窗口算窄了〉

`episodes.ts:60` 用 `recentEpisodes = episodes.sort(...).slice(0,4)` 算出 `cutoff`，`:64-69` 再据此把"缺少归属"判成 `historicalWarnings`（当 `receivedAt < cutoff && !protected && completed && !sharedActivityId`）。于是**一个已关闭段的、位于前 4 段之外的孤立已确认出站消息只会告警**；而细化 §4.3 刻意不加自动修复，所以那条已公开的正文会被 `recent()`（`:51` 过滤 `m.dialogueEpisodeId && ranks.has(...)`）**永久拒绝**。

细化 §3.1 要求"版本 1 的真实入站和确认出站必须有唯一段归属"，而 §4.3 的告警分支本意是"已完成且在近期窗口之外"，不是"按 `openedAt` 排名前 4 之外"。建议把安全窗口改成按**时间**判断（例如早于最近一次迁移／早于可确定的窗口下界），而不是复用窗口排序的 top-4。

### 5.4〈需修·补查路径重新出现同体重复〉

`resource-pool.ts:26-27`：当 lookup 载荷"看起来像上下文"（含 `details/retrieved/shortTerm/longTerm/learned/detailHistory/history/recent/visibleMessages/reconsiderMessages/tasks/dueTasks/snapshot` 任一键）时，它会经 `stageInput` 重新投影，并作为 `lookupResult.context` 发出；而 `:31` 同时把业务上下文放进 `envelope.input.context`。于是**同一份业务字段在一次 HTTP body 里出现两次**。

可达路径两条：记忆阶段的 lookup 返回 `{...budget({details,retrieved}), school}`（`memory/organize.ts:28`），因此 `raw` 含 `details`/`retrieved`/`school` 而走该分支；个人阶段同理（`app.ts:150` 的 lookup 返回里带 `school`）。受影响字段包括 `detailHistory`、`school`、`background`、`arrangementsAndIntent` 以及共享场景子集——**正是这次改动要消灭的那类重复**，只是在补查续请求上又出现了。

验收探针抓不到它，因为唯一性判据是**ID**而不是正文：`prompt-context-acceptance.ts:44` 的 `uniqueMessageBodies:new Set(m.map(r=>r.id)).size===m.length`，只检查 `resources.messages` 的 id 是否唯一，不比较 `envelope` 与 `lookupResult` 的正文。修法局部：让 `lookupResult` 只带元信息与 `materialIds`，或显式枚举允许出现在 `lookupResult.context` 下的字段；同时把验收探针改成**正文级**唯一性断言。

### 5.5〈需修·较轻〉保持中的段在崩溃恢复后没有自我唤醒的定时器

`episodes.ts:44` 只为"未保持且无活跃活动"的段返回截止，而 `held()`（`:10`）读 `turns`。若进程在 `freezeTurn` 之后、`sendFrozen` 完成之前死掉，`resumeUnfinishedTurn`（`app.ts:52-63`）会重入 `execute`；**若发送再次失败，应用暂停**（`app.ts:77-87`），于是 `nextDeadline`（`host/runtime.ts:73-78`）为该段贡献不了任何截止——只有新用户消息、显式 resume 或另一轮成功发送才会重新武装定时器。

不是 0 ms 空转（这点审核也确认了：`closeDue` 与 `nextDeadline` 用同一个谓词读同一份新状态，每次 0 ms 触发要么关闭一个段、要么暴露它是 held，二者都会取得进展）。但细化里"保持解除后，锚点满 15 分钟即可关闭"这条在**崩溃+持续发送失败**这条路径上没有自驱动通道，而该段的全部原文会一直占着窗口。建议：暂停状态下的 held 段在发送最终失败（进入 retry 且本轮结束）时也释放保持，或让 resume 失败路径显式做一次 `releaseReply`。

### 5.6〈与文档不符·较轻〉部分任务的提示策略没有被冻结

`expression`、`memory`、环境各阶段与 `sticker_description` 都没有设置 `task.promptPolicy`（`contracts.ts:127,128,138`），于是 `client.ts:87-88` 会在传输路径上**再追加一次** `policyRules(policy)`，而 `runModel` 里 `selectedTask.prompt` 未变——同一次请求的系统提示里会出现两份相同的策略块；同时这些阶段的业务事实是**每次传输调用重算**而不是冻结的（今天等价，因为 `input` 对象在整个 `runModel` 循环里不变，但这不是规格要求的机制）。

### 5.7〈需修·仅旧在途步骤〉v0 兼容路径的模型输入被多套了一层

`context-views.ts:26` 把 `EnvironmentStepInput` 里未被解构的键 rest-spread 进 `context`；而 v0 分支是 `stageInput(input.stage, input)`——**整份 input 被当作 context 传入**，于是模型实际收到的是 `context.context.sourceItems`。细化 §2（`IMPLEMENTATION:64`）明确要求"不把整份原 input 再套一层重复 context"，legacy `schoolWeekTask` 的提示（`contracts.ts:49`）却让模型去读 `context.sourceItems`。schema／parse 仍能把结果解出来，但**提示与输入路径错位一层**。

这条只影响"旧的 running／pending 步骤沿用 v0 合同"这个兼容窗口（新生成一律走 v1），但既然要保留 v0 路径到在途步骤结束，建议顺手把 v0 分支改成与 v1 相同的显式投影。

### 5.8〈需修·仅旧在途步骤〉v0 路径仍可能让程序冲突被抹掉

`calendar.ts:129` 的兜底是 `…?.conflictNotes ?? input.conflicts`。模型若返回 `{weekStart, sourceVersions, conflictNotes: []}`（`schoolWeekSchema` 允许空数组），`??` 不会触发兜底，**该周程序算出的冲突被归零**。v1 路径不受影响（`calendar.ts:188` 用的是并集 `[...new Set([...input.conflicts, ...模型notes])]`）。修法：v0 也改成并集。

### 5.9 三路审核确认成立的部分

- **分段核心**：锚点规则（入站接收与确认发送两种，草稿／失败／系统提示／后台／环境／无声自主都不刷新）、`【推进】`只写控制表并在任何消息／对话写入前返回、4 段可见窗口与稳定排序、无二次 30 条裁剪、同事务归属、hold／release、单定时器无 0 ms 空转、启动一致性不猜测合并、一次性停服迁移——逐条可指认。
- **DTO 与 HTTP**：身份去重与版本安全（不透明 `ref`、`ResourcePool` 按 id／ref／materialId、Host 侧重建完整 `OwnerVersion`）、白名单"按构造排除"、`long.content`／detail 折叠精确、每次请求各一份网页正文且 `webResults` 只留元信息、图片走 `image_url` 块且不在 JSON 里重复 base64、两条跳过路径在联网前不可达且记为 skip 而非 failure。**原始审计报告记录的四个缺陷确实都消失了。**
- **周计划 v1**：只回 `noticeTexts`＋`weekNotes`、机械字段全由程序生成、重复／缺失 key 拒绝、**提醒输入确实带该课次的时间与地点**（`calendar.ts:164-176`，含 `occurrence.startsAt` 与 `timezone`）、`instanceId` 由程序按声明 occurrence 反查落库且与模型看到的预测 id 一致（所以 `legal()` 仍能作废过期课次的提醒）、`after` 重定向时 instanceId／快照／通知身份一起改。**我上一轮担心的两点都已解决。**
- **错误可观测性**：结构化字段与分类（只有已验证的码／措辞才算容量、4xx 通用错误不算）、不再记录供应商正文、前台失败与后台维护分开显示、环境 retry 与维护不变成全局暂停。

### 5.10 合并后的其余低优先项

- **`conflictNotes` 与 `coveredVersions` 目前没有消费者**：我 grep 过 `src/`，只有写入点（`calendar.ts:49,94,129,188`）与类型定义，`weeks()` 只在测试／脚本里用。也就是说"跳过模型时冲突仍被保留"指的是**数据留存**——当前没有任何代码路径把当周冲突送到角色或主叙事面前。这是方案 B 的既定代价，但值得知道，否则会以为她在冲突周会有所察觉。
- **执行计划有三个勾选项在仓库里没有对应测试**：`background_errors_not_front_failure`、`cancelled_after_timezone_history_reminders_unchanged`、`notification_contains_stage_no_body_or_key`（`EXECUTION_PLAN:123,124,174`）——我 grep 过 `tests/`，**0 命中**。行为本身经阅读成立，但计划与日志都标了 `[x]`。另外**没有任何测试断言"后台／环境失败时 `lastFailure` 保持为空"**。
- **v0 的既有回归被显式钉成 version 0**（`tests/world-school-review14-*.test.ts`），也就是说 review14 那批跨开课／提醒回归不再走生产默认路径；新增的 v1 历史重定向用例在 `tests/school-week-text-contract.test.ts:22-26`。实施日志已如实记录这一点。
- 其他：`held()`／`active()` 每次输入与每次定时器触发都对 `turns` 全表扫描；`episodes.ts:71` 在一致性循环里重算 `bindTurn`；`--check` 用 `readOnly:true` 但 WAL 库仍可能创建 `-shm`/`-wal`；`HdsiApp.runTurn` 不调用一致性检查（只有 Host 调）；`ensureDialogueVersion` 只在 `index.ts:49` 调用；`recent()` 把所有阶段的 outgoing 都算可见原文；描述给模型的 `occurrence.startsAt` 是 UTC 而其它字段多为 `+08:00`（要靠 `timezone` 换算，混排容易催生错时）；容量分类器对任意 HTTP 状态生效，理论上"正文回显里含 context length exceeded"会被误判，建议把 message 分支限定 400／413 或只认 code。

---

## 6. 本次复核的边界

**没有做**：运行测试／构建／验收脚本；连接模型或 QQ；检查或升级正式库；修改任何文件。

**因此无法验证**：98 文件 / 536 项测试的实际通过情况；74 次 HTTP 的真实输出内容；表达保真与故事质量的语义结论（交付记录已把它归为模型行为并保留观察）；以及 4 段窗口在数月真实使用中的体量。三路专项审核已全部回报，**没有未决的补遗**。

**给用户的一句话**：这次交付可用，§5.1（迁移读错配置）与 §5.2（未读输入刷新锚点）建议修掉——它们不报错、不崩溃，只是悄悄换了角色能看到的原文；§3 那个产品选择（有冲突但不需要发通知时要不要写说明）也请你确认一次。
