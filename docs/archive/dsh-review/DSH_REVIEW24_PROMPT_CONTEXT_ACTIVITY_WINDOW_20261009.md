# 提示词与上下文优化 V0.1 活动窗口增量复核（DSH）

日期：2026-10-09。对象：任务 13～20 的实现（本地 Git `43213cf`）。依据：[交付验收记录](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md) 的 2026-10-09 增量两节、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)、过程目录 `runtime/data/prompt-activity-context-process-20261009`。

方式：只读源码、文档与过程产物，**没有运行测试或服务，没有修改任何文件**。

结论：**我上一轮的四点全部落实，实现方式比我建议的更彻底；活动窗口分离的专项审核也没有发现可证的行为缺陷。** 但发现一处**运维死角**：改了 `dialogueIdleMinutes` 之后启动会失败，而错误文案让人去跑 `--apply`，`--apply` 又因为参数不一致拒绝回建，操作者看不到真实原因（见 §5.1）。建议修掉这一处，其余为低优先项。

---

## 1. 我上一轮四点的落实

| 我提的 | 实际落地 | 判断 |
| --- | --- | --- |
| 4.1 普通聊天要有**独立索引**，不能只删活动正文（否则活动保持会把相隔很久的普通前后对话粘成一段） | 新 `src/dialogue/chat-episodes.ts` 的 `ChatEpisodes` 独立于旧 `episodes.ts`；`TurnRecord.dialogueWindowVersion` 新轮写 2、旧缺失视为 1；`chat_episodes` 独立表 | **落实** |
| 4.2 活动开始与结束都**不刷新普通段锚点**，也不保持普通段 | 细化 §382 明文："仅普通真实入站／确认出站更新普通锚点。活动开始、期间任意消息、结束、无声自主生活和基础提取均不刷新、不保持普通段，也不在结束后加 15 分钟" | **落实，且写明了不加 15 分钟尾巴** |
| 4.3 活动期间收到的普通聊天消息归属要写死 | 细化 §332 表格："活动期间双方聊天，**包括与活动无关的题外话** → 不计入普通 4 段；§337："活动中聊'我妈刚打电话来'也属活动，不刷新普通锚点" | **落实**（这条比我预想的更果断，见 §3.1） |
| 4.4 `currentActivityMessageIds` 与"一条正文一次"的关系 | `ModelRoles.currentActivityMessageIds` + `StageBusinessSnapshot.currentActivityMessages`；`context-views.ts:35` 的 `recentIds` 在 v2 下用 `.filter(m=>dialogueWindowVersion!==2\|\|!m.sharedActivityId)` 排除活动消息 | **落实** |

另外细化还补了一条我没想到但对的地方（§384）："**20:15 关闭的段仍是普通历史候选，关闭不等于出窗**，仅在更新的合资格普通段超过 4 个时退出"——这说明设计者把"关闭"与"出窗"分开了，避免了我上一轮担心的"段关掉就丢内容"。

## 2. 实现里几处做得比我建议更彻底

- **活动消息根本不进 chat 索引**：`chat-episodes.ts:14` 遇到 `sharedActivityId` 就 `chatEpisodeId=null` 并直接返回 `null`，不建段、不刷锚点。
- **转移后清理空段**：`:20-24` 的 `reconcile()` 在段内普通消息清空时**删除整个 `chat_episodes` 行**、复位 `activeChatEpisodeId`，并把指向它的 `turn.chatBinding` 一起置空——这正好解决了细化里那句"仅删活动正文会把普通前后对话粘成一段"的连带问题。
- **活动轮的绑定直接为空**：`bindTurn`（`:27`）对 `sharedMeta` 或非 chat 入口的轮返回 `{episodeId:null,holdReply:false}`；`confirmOutput`（`:34`）对活动出站也把绑定置空并走 `acceptMessage`，所以活动输出不会通过 hold 把普通段拖住。
- **迁移参数修好了**：`dialogue-upgrade.ts:10-11` 新增 `DialogueUpgradeParameters{idleMinutes,targetVersion,configSource,recentSegments}` 并在报告里回显；`scripts/migrate-dialogue.ts:8-12` 现在会读 `--config`（缺省回落到 `config.local.json`）或 `--idle-minutes`，并把来源写进报告。**我上一轮 §5.1 那条"非默认值会按 15 分钟回建"的缺陷确实关闭了。**
- **一致性判定的安全窗口按新规则收窄**：`:68` 的 `safe` 条件里现在带 `!m.sharedActivityId`——活动消息不再参与"历史安全告警"的判定，与我上一轮 §5.3 的修法方向一致。

## 3. 两处我本来准备提、核实后不是问题

### 3.1 活动期间的"题外话"永久不入普通 4 段——是设计选择，不是缺陷

我原本想问：活动进行中用户发一条与活动无关的普通消息（例如"我妈刚打电话来"），它被标上 `sharedActivityId`、`chatEpisodeId=null`，于是**活动结束后它也不会出现在普通 4 段原文里**，只能靠记忆检索召回。

但细化 §332 已经明确写了这个口径（"包括与活动无关的题外话 → 不计入"），§337 也给了同一个例子。所以这是**你已经确认的设计**，不是漏掉的边界。我只提示一个实际后果，供你知情：**那段话如果她想在活动结束后原样引用，得靠活动记忆检索命中，而不是靠原文窗口**——活动记忆按正常短期／长期规则走，相关时能召回，但不保证逐字回放（细化 §185 自己也写了"不能声称等价于完整聊天回放"）。

### 3.2 旧 `episodes.ts` 仍在，但它是 v1 兼容路径，不是死代码

我一开始看到 `episodes.ts:13-19` 仍然给消息分配 `dialogueEpisodeId`、照样刷新 `lastInteractionAt`，以为新规则没生效。核实后：那是**v1 旧窗口**的实现，v2 由独立的 `ChatEpisodes` 承担；`dialogueWindowVersion` 决定走哪条。所以两者并存是有意的（旧冻结轮按 v1 恢复），不是新规则被绕过。这一点也与我读到的"旧混合索引和旧轮权限恢复保留"一致。

## 4. 值得单独肯定的两处

- **增量交付的文档结构**：交付记录没有重写旧的 §1～§5，而是追加"2026-10-09：任务13～20增量验收"与"增量主目录交付"两节，旧段落保持原样并注明本轮修改范围（开头写明"本文件记录实际证据与限制"）。这样做的好处是历史事实可追溯——**建议保持这个做法**。
- **证据纪律依旧**：明确写"首次工具没触发自然提前 end 中断，修正工具后补验；**不写成首次覆盖**"；"模型正常语义仅两场样例，未证明长期叙事稳定或 semantic-only 标定"；"已有 536 项是上次交付数字"；并且报告了增量独立复核的 1 项 Important（公开开场确认至 character 提交之间被一致性门禁误拦）**是真实缺陷且已修**——四项真实 Host 回归先失败再修复。这些都是读代码才能发现的类型。

## 5. 活动窗口分离专项审核

它逐条核对了八类要求，**没有发现可证的行为缺陷**——活动消息在写入侧（`chat-episodes.ts:14,34`）、读取侧（`:43`、`context-views.ts:35`）与正文池（`resource-pool.ts:6`）三处被排除；活动原文是**按轮持久化、冻结、只给在途共享阶段**的选择（`activity-context.ts:6-14`、`app.ts:51/107`）；关闭判定不带活动尾巴（`chat-episodes.ts:11`，与 v1 的 `episodes.ts:12` 形成对照）；开场确认的修复是四段式证明且缺凭证仍阻挡（`window-consistency.ts:33-34`）。交付产物也吻合：`task20-online.json` 的活动轮 `activity=41`、`recent=4`、正文唯一，其后的普通轮 `activity=0` 且 `nextNormalHasActivityFulltext=false`。

它还纠正了我给它的提交范围（核心在 `cbfa1c2`／`842307d`／`5a4dbea`，我圈的 `842307d..909b53d` 只含最后 6 个提交）——**这个纠正我接受**，是我给它划范围时看漏了。

### 5.1〈需修·运维死角〉改了空闲参数就再也起不来，而且看不到原因

这条我实测确认，比审核的描述更具体：

1. `chat-upgrade.ts:11` 在 `currentVersion===2` 时比较 `chat_index_metadata.idleMinutes` 与传入参数，不一致就返回 `canApply:false`，**并把诊断放在 `report.ambiguousBoundaries`**：`'普通索引参数变化或元数据缺失；不自动回建'`。
2. `index.ts:48` 的门禁是：

```ts
if(check.version!==2||!check.canApply)throw new Error('Stop HDSI; run npm run dialogue:migrate -- --database <path> --config <json> --check, then --apply --stopped --backup-dir <path>.');
```

**它抛出的文案只让人去跑迁移命令，完全不提参数不一致**。而 `dialogue-upgrade.ts:54` 那边也会抛出，`chat-upgrade.ts:11` 又拒绝回建。

于是：**你把 `dialogueIdleMinutes` 从 15 改成 30，启动就会失败，错误信息让你去 `--apply`，而 `--apply` 也不会救你**（参数不一致时它同样拒绝回建），唯一的出路是手工去改 `chat_index_metadata`。这既没有文档，也没有命令支持。

这与你上一轮特意确认的"不增加强制关段／清空／手动脱困命令"是两回事——那条针对的是**运行中的原文窗口**，而这里卡住的是**启动**。

建议二选一（我倾向前者）：

- **A**：给一个明确的"按新参数重建普通索引"入口（例如 `--rebuild-chat-index`，仍要求停服＋备份），并在 `index.ts:48` 的错误文案里把**真实原因**带上（把 `report.ambiguousBoundaries` 一起打印），这样操作者一眼就知道是参数变了；
- **B**：把参数变化也视为需要重建的场景，由 `--apply` 在停服备份后自动回建（与"不静默回建"并不冲突，因为它仍要求显式命令）。

**最小改动**是把诊断接进启动错误文案。现在这条信息只存在于 `--check` 的 JSON 报告里，而操作者看到的是插件启动失败的一行字——这跟"状态里如实显示阻挡原因"的既有纪律不一致。

### 5.2〈与文档不符·较轻〉v1 库的"活动归属歧义"检查实际上是空转

`chat-upgrade.ts:21` 的歧义分支条件是 `m.sharedActivityId===undefined && oldLinks.some(l=>l.evidenceFrom && l.evidenceTo && …)`。但 v1 的 link **从不写 `evidenceFrom`/`evidenceTo`**（`episodes.ts:38` 在 v1 路径把它们置 null），所以对标准的 v1→v2 升级来说这个分支**永远不会触发**；而普通消息在 v1 里是显式写 `sharedActivityId: null` 的，也不满足 `=== undefined`。净效果：**细化 §13.9 要求的"活动跨度内缺可靠归属要报告"在标准升级来源上没有被执行**，这些消息被静默当作普通历史重建。

真实影响有限（正式库当时是空的，且 v1 的 `sharedActivityId` 本身在活动消息上是准确的），所以这是**保证范围被收窄**，不是已证实的错误记录。建议要么让 v1 库用 `sharedActivityId` 的存在性＋活动 link 的活跃区间来判定跨度，要么在细化里明确"v1 来源不做跨度歧义报告"，别留一个看起来在检查、实际不生效的守卫。

### 5.3 其余低优先项（审核列出，我确认）

- `dialogue-upgrade.ts:11` 对**已经是 v2 的库**做 re-check 时，报告的"在途映射"仍然来自旧 `dialogueBinding`（`legacyPlan`），而不是 `chatBinding`——报告字段对 v2 库有误导，判定本身由一致性检查给出所以不影响结论。
- `storage.ts:41` 对新库硬编码 `idleMinutes:15`，配置值只在 `fresh && 无消息 && 无 chat_episodes` 时才覆盖（`index.ts:52`）；于是"有消息但没有 character"的库会留 15，然后被 `window-consistency.ts:11` 挡住。
- `chat-episodes.ts:23` 在删除空段时会**改写已完成轮的 `chatBinding`**（历史变更，无功能影响）。
- `resource-pool.ts:35` 发出的 `contextRefs` 在提示里没有任何说明（`prompt-policy.ts:23` 只列 roles），模型看到一个没有指令的路径。
- `activity-context.ts:14` 在生成期间若冻结消息消失／身份变化会**抛错让本轮失败**，而不是报告阻挡。
- `window-consistency.ts:36` 的历史告警证明要求"每个阶段窗口都满且更新的段都晚于该消息"，偏保守（更多阻挡），但也让告警在正常库里几乎不可达。

## 6. 本次复核的边界

**没有做**：运行测试或验收脚本；连接模型或 QQ；检查或升级正式库；修改任何文件。

**因此无法验证**：105 文件 / 588 项测试的实际通过情况；`task20-online.json`（21 HTTP）与 `task20-online-recovery.json`（14 HTTP）的真实输出内容；正式库已升级到 version 2 的实际状态（记录说"只读版本2、完整性 ok、无归属／参数冲突"，我只读了文档）；以及活动记忆在真实长跑中的召回质量。

**给用户的一句话**：这批增量可以放心使用；我原来准备提的两点都不是问题——**活动期间的题外话不进普通 4 段是你已经定过的口径**，只是提醒她那句话以后要靠记忆检索而不是原文窗口来复现。等两路审核回来我再补。
