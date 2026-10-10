# 普通回复跟进新消息：细化执行方案

> **For agentic workers:** 按任务使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 实施；以下复选框是待办，不表示已经执行。此次交接给 SOL，不在审核会话实施。

**Goal：**普通消息回复尚无发送尝试时，跟进最新输入，等其完整 15 秒后重新合并生成；首次发送尝试后保留原冻结恢复规则。

**Architecture：**保留一个未完成前台 turn。为普通请求记录输入版本与候选代际；过时后进入可持久恢复的等待状态，等待专用调度可将同一个未发送轮改绑为最新普通请求或到期事件。业务代际隔离模型阶段，图片附件任务保留自身冻结身份。

**Tech Stack：**现有 TypeScript、Node.js 同步 SQLite 事务、Vitest、现有 SerialHost 定时器；不引入依赖或通用任务框架。

**Spec：**[SOL 原方案](../../plans/chat-reply-freshness-20261010/README.md)与[审核裁决 R1～R4](REVIEW.md)。基线 `3fb4e1c`；状态：**未实施**。

## 全局约束

- 静默窗口固定 **15,000 ms**，判断依据为服务器已经接收落库的普通消息。使用现有 Clock，不用 QQ 客户端时间或模型判断。
- 原消息、正文、接收顺序、batchId 保留；一次轮可覆盖多个 batchIds，提交只消费该轮最终选择的批次。
- 单一前台业务提交；不改环境／记忆后台准备并行方式，不把基础后处理异步化。
- 对话协议仍为 2；兼容没有新字段的旧冻结轮，不新增索引重建／强制协议升级。
- 保持四段窗口、图片可见权限、睡眠／phoneAccess、模型与思考参数、20／40 单阶段上限；允许个人导演不回复。
- 每任务先写失败回归、记录实际失败、完成最小实现、跑通过后提交；每次提交只包含本任务文件。不覆写 SOL 原调查记录或本次基线探针。
- 计划不授权改正式配置、数据库或操作服务。工程验证使用隔离数据；正式部署另按项目 README 执行。

## 重点回归

1. 旧批已就绪，新开放批还剩 1 ms；不能旧回复先跑，也不能把 timer 设成永远到期的 now（T1／T3）。
2. 等待期间不断追加，同时预约、起床或学校通知到期；事件处理一次，未读没有丢失或提前标看见（T1／T3）。
3. 在首次 sending 落库前后分别加入消息或崩溃；事务前重算，事务后保持冻结，包括发送结果未知（T2／T5）。
4. 老代际已检索／看图，新一代权限或问题改变；旧检索不自动注入，旧图终态不重判，最终记忆只用有效来源（T4／T5）。
5. 等待跨入睡眠或不可查看活动，且 pending 索引曾清空；不调用无权限个人导演，恢复可读后完整取回（T1／T3）。

## 1. 必须采用的业务裁决

### 1.1 普通资格与事件例外

普通 freshness 请求同时满足：当前入口为普通聊天且没有有效共同活动；没有 `sharedMeta/environmentStepId/environmentKind`；triggerKinds 非空且全部属于 `input/check_messages`；所选任务全部是 check_messages；`schoolNoticeRefs` 为空。已看复议属于检查消息流程，但不递增新输入版本。

预约、起床、学校通知、自主生活、activity、共同活动及环境轮保持事件合同。混合轮也算事件，**不能仅凭 entryMode=chat 或 triggerKinds 含 input 就启用重算**。正常调度存在新开放批时，不给事件请求捎带尚待合批的普通输入；若没有开放批，正常事件请求仍可按既有规则携带已就绪普通输入。此类事件轮开始生成后不因新消息重算，应在交付中说明这个保留边界。

纯普通轮的 personal 返回 `sharedChange.start`，仍受发送前门禁约束；第一段“共同活动开始”登记 sending 后才锁定，确认后仍由现有 recordSharedOutput 改路由。已经在共同活动内的结束轮不纳入本次普通门禁。

### 1.2 等待轮与事件接管

继续让 `Storage.unfinishedTurn()` 返回等待轮；**不增加第二个活跃轮，也不修改全局 unfinished 判断**。为宿主增加一个只处理等待轮的分支。

- 无到期事件：静默期满并可读后，重新选择普通未读＋到期 check_messages，改绑同一 turn ID，再生成。
- 有到期预约／起床／可投递学校通知：优先把同一等待轮改绑为事件请求。该接管请求固定 `inputMessageIds=[]、batchIds=[]`，不携带 check_messages；保留真实事件 taskIds、triggerKinds、noticeRefs。既有睡眠、通知可投递条件仍适用。
- 接管前的普通消息及其检查任务继续保持未读／pending，事件提交不得顺手完成它们。事件完成后，普通未读本身可重新触发调度；不能依赖已被改写的 turn.batchIds。
- 只有 `state=waiting`、未发生发送尝试、未冻结无输出决定的轮可接管。普通生成中仍等待当前阶段返回；已封口的发送／后处理不抢占。
- 等待时不启动或提交新的环境／维护业务；已在途后台准备可按现有机制保存 ready。此次“归还前台”特指允许必要事件接管，不扩展为任意并行故事轮。

接管带来的额外一轮普通处理优先于让过时草稿混进事件。角色状态从当前已提交值重读，不复活等待前的候选状态。

### 1.3 普通内容选择与截止

输入版本用于判旧；`runtime.openBatch.readyAt` 用于静默期限；普通未读用于选择内容。不要用其中任何一个替代另两个。

- 有开放批且未到期：普通请求等待；即使旧 pending 已就绪也不启动旧输入或 due check_messages。
- 到期先沿用 closeReady，再选择完整普通未读，顺序沿用 Storage 的 receivedAt／原稳定入库顺序；对 batchIds 去重，不合并正文。
- 普通未读选择沿用 `Storage.unreadMessages()` 的路由语义：排除开放批和仍直接属于共同活动的未读；保留共同活动结束后转回普通批、但仍带历史 activity 身份的消息。不要简单过滤 `sharedActivityId===null`。
- 可读且无开放批时，即使 pendingBatchIds 为空，尚存普通未读也应触发 input。这是等待事件接管和旧 stash 路径的续办保证。
- 睡眠时只等原起床／其他合法事件；不可查看时沿用 unread 检查及已知活动结束时间。不能因静默期满就空跑并消耗原聊天批次。
- 一个 due check_messages 没有有效未读／复议内容时，允许沿既有流程执行并完成一次，不留成永久 due；不可读时保留／改期，截止须是未来可执行时刻或 null。
- `nextDeadline` 与实际选择共用 eligibility 计算；选择不能执行时不得返回已过期的普通任务时间。预约等事件期限不受普通静默期刷新影响。

## 2. 持久状态与接口

在 `src/types.ts` 添加以下可选 JSON 字段，不做 SQL 表结构迁移：

```ts
interface ReplyFreshness {
  version: 1;
  generation: number;                 // 初始 1，真正重新绑定业务请求时递增
  scope: 'ordinary' | 'event';         // 等待轮被事件接管后为 event
  inputRevision: number;              // 当前候选选择输入时的版本
  state: 'generating' | 'waiting' | 'frozen' | 'sealed';
  quietUntil: ISOTime | null;
  firstAttemptAt: ISOTime | null;
  personalRunId: string | null;        // 当前生成实际使用的个人导演网页阶段
}
// Runtime.ordinaryInputRevision?: number
// TurnRequest.replyInputRevision?: number
// TurnRecord.replyFreshness?: ReplyFreshness
```

Runtime 缺字段按 0 读；接收一次新的普通输入加 1。平台重复消息、推进控制、共同活动输入不加；版本更新与消息落库在同一事务，不能只放内存。原 batch 关闭或转移不是新用户输入。

`replyInputRevision` 由 Scheduler 在**选择输入的同一次同步读取流程**里附带。App 不能在收到了更新消息后才取当前 revision，误把旧输入集合盖成最新。值 0 也有效，不能用 truthy 判断。生产普通调度路径必须全部带此字段，包括 check_messages 与从 stash 捞回的输入；旧持久轮及专测旧协议的手工请求无字段时保留原恢复合同。此字段是调度凭据，不是新增用户开关。

App 将凭据保存进新普通轮，再在开始模型前检查；collectReady 返回与 runTurn 开始之间到达的消息也应使该候选等待。事件接管从原 metadata 改为 scope=event，不去掉 generation。

新增小模块 `src/host/reply-freshness.ts`，接口固定为：

```ts
type WaitingContinuation =
  | { kind: 'wait'; deadline: ISOTime | null }
  | { kind: 'run'; request: TurnRequest; scope: 'ordinary' | 'event' };

function ordinaryInputRevision(storage: Storage): number;
function isOrdinaryReplyRequest(storage: Storage, request: TurnRequest, now: ISOTime): boolean;
function hasReplyAttempt(storage: Storage, turnId: string): boolean;
function assertReplyCurrent(storage: Storage, turnId: string, now: ISOTime): void;
class ReplySuperseded extends Error {} // 仅 App 消化的内部控制中断
```

`hasReplyAttempt` 以 outbox 中任一非 pending 记录为准，并识别新字段 firstAttemptAt；二者任一个有证据就保留冻结。不要以“当前第 0 段 pending”判定整个轮未发送。

`assertReplyCurrent` 只对新合同的 ordinary、尚未封口轮生效：revision 已变化或普通开放合批尚未成熟时抛 ReplySuperseded；旧合同／事件／sealed 直接通过。该类型不得进入模型 JSON 修补或普通错误处理；只在模型阶段外、冻结事务和发送入口使用。

为避免扩大现有 `generateTurn/freezeTurn/sendFrozen` 返回类型和改写大量旧夹具，这里选择内部受控中断，而非把普通等待当运行故障。App 的 catch 第一分支仅接住 ReplySuperseded，持久化等待并正常返回；其他真实错误保留既有处理。

### 2.1 状态转移

| 当前状态／事件 | 行为 |
| --- | --- |
| 新普通请求 | generation=1、generating，保存选择时 revision |
| generating 或全 pending 的 frozen 发现新输入 | 原子清旧候选／outbox／post job，进入 waiting；消息、任务、经历、角色状态不提交 |
| waiting 再来输入 | 接收并刷新 openBatch；不调模型、不增加 generation、不改候选所用 revision |
| waiting 能继续 | 专用调度选择 request；同步改绑同一 ID，generation+1，更新 at、scope、revision、输入／任务／refs／绑定，进入 generating |
| ordinary 候选冻结且有输出 | 冻结事务内核对输入，state=frozen |
| 无输出候选冻结 | 同一事务核对输入后 state=sealed、outputComplete=true；随后正常后处理 |
| 首次 sending 登记 | 同一事务核对输入，设置 firstAttemptAt、state=sealed 和 outbox.sending；事务外调用 sender |
| sealed | 不再因输入换代；确认、未知重试、后处理沿现有合同 |

`quietUntil` 保存发现过时时的静默截止。后续新消息可能使它落后；每次决策取它与当前开放批截止中的较晚者。不能只靠旧 quietUntil 定时。睡眠／不可读条件的截止另由调度计算，不塞进“新消息 15 秒”的定义。

进入 waiting 时释放旧 reply hold，使长时间睡眠／停顿不把聊天段一直撑开；消息本身仍未读，受到现有来源保护。重绑时重新调用对应协议的 bindTurn 和 selectActivityContext，不能 spread 旧绑定假装更新。

旧 candidate 的经历、意图、任务变更、概率候选、school commits 和 autonomousIntervalMinutes 不复用；新叙事从已提交 narratedUntil 重新覆盖到新的 at。web 阶段和图片的保留规则见 §4。

## 3. 发送、恢复与定时接点

### 3.1 首次发送必须是同步门禁

在 `sendFrozen` 每次分段 wait 返回后、调用 sender 之前，读取最新 turn 与 outbox。在**同一个同步 Storage.transaction** 中检查是否已有发送尝试；没有则调用 assertReplyCurrent，然后写 firstAttemptAt／sealed／sending。已有尝试则按原冻结路径写 sending 并继续。

门禁放在 sender 的 try/catch **外面**，避免 ReplySuperseded 被误写成 retry，反而制造“已有发送尝试”。事务提交后直接调用 sender，中间不插入 await。首段即使是 narration／sticker 也适用。

冻结同样把 assertReplyCurrent 放在 freezeTurn 自己的事务里面、任何保存和 releaseReply 之前。当前 Storage.transaction 不支持嵌套；不要从外面包一层事务再调用现有 freezeTurn。过时中断回滚后，由 App 单独进入等待事务。

### 3.2 App 接口与宿主

在 App 增加 `continueWaitingTurn(turnId: string, request: TurnRequest, scope: 'ordinary'|'event'): Promise<void>`。它仅接受 §1.2 的等待轮，完成一次改绑事务，再执行正常生成流程；不要调用 runTurn 去新建 ID。

在 Scheduler 增加 `collectWaitingContinuation(turnId: string, now: ISOTime): Promise<WaitingContinuation>`。先做正常 closeReady／通知释放等现有调度准备，内部通过共享的选择函数计算 §1.2／§1.3 决策。它只能绕过传入且真实处于 waiting 的那个 unfinished gate。

SerialHost.pump 在原未完成轮分支前识别 waiting：

1. 调用 collectWaitingContinuation；wait 则退出 pump 并 armTimer。
2. run 则调用 continueWaitingTurn，完成后继续 pump。
3. 此路径不依赖 recover 标记；新输入 wake、timer、start、resume 都可触发。
4. paused／stop 仍先于续办；stop 不等待一个空置 15 秒计时器。

Scheduler.nextDeadline 遇 waiting 时返回相同决策对应的最早可执行事件／普通截止。保留事件到期唤醒；没有可执行项返回 null。状态显示“等待新消息合批”及计算后的实际截止，不能显示成正在生成或发送。基础后处理阶段的空 outbox 不走此分支。

### 3.3 重启表

| 落盘状态 | 恢复动作 |
| --- | --- |
| 无 replyFreshness 的旧轮 | 完全保留原恢复分支 |
| waiting | 重读落库 revision、开放批、权限、任务；未到期不调模型；到期走专用调度 |
| scope=ordinary，generating／全 pending frozen，已过时 | 先进入 waiting，不能直接发送旧候选 |
| scope=ordinary，generating／全 pending frozen，输入未变 | 保留同 generation；沿未尝试恢复重生成，检查当前睡眠／查看资格，必要时先转 waiting；不把一次恢复当新输入换代 |
| scope=event，generating／全 pending frozen | 按已经改绑的事件请求恢复，保持 generation、任务和通知 refs；普通 revision／openBatch 不触发 waiting 或再次选事件，不套普通 canRead 门禁 |
| 任意 sending／retry／confirmed 或 firstAttemptAt 已落库 | 保留 frozenResult；sending 转 retry，confirmed 跳过，未知结果重试 |
| 已冻结无输出或输出完成 | 只续后处理，新输入留下一轮 |

同输入恢复重生成时可以沿现有合同更新 at，但不刷新原业务阶段额度；当前任务类别变化由 §4 的 taskName 阶段键区分。一次 wake 没有形成新业务选择时，不得增加 generation。若同输入仅因不可读而等待，重新获准后的新选择应按等待续办规则固定一次新的业务快照；不要把仍在等待的每次检查算新代际。

## 4. 模型阶段、图片与最终来源

### 4.1 阶段键

在 `src/web/phases.ts` 增加 `turnPhaseOptions(web, turn, stageKey, taskName, options = {})`，参数类型沿现有 phaseOptions，turn 使用 TurnRecord。

- 无新 metadata 时委托现有 phaseOptions，阶段键不变。
- 新合同业务阶段使用 `reply:${generation}:${stageKey}:${taskName}`，包括 narrative、personal、expression、memory。带 taskName 避免同代际恢复时 personal_life／personal_chat 的语义混用。
- ownerType/ownerId 仍是 turn／同一个 turn ID，因而可保留现有主体内公开页面缓存；旧阶段素材不能作为新阶段默认 webMaterials 或 toolResults。
- 新阶段额度独立 20／40。每次同代际恢复必须命中原 stageKey；同输入不能靠唤醒、失败或重启制造新额度。新阶段第一次通过缓存取得页面仍计一次成功，沿现有 B 口径。
- 重新绑定后，在一次事务内清除旧业务阶段 checkpoint 的大正文，保留阶段计数、操作、材料及来源记录。只压缩旧业务阶段，**不调用 compactOwnerCheckpoint 清掉尚需续办的 incoming_image 阶段**。
- 待办旧业务工具操作保留历史身份但不在新阶段自动续调；实际重新选中该页面只能通过新阶段的工具请求。最终结束仍按现有 owner 清理规则释放缓存。

新增 `WebSearchStore.compactStages(ownerType, ownerId, stageKeys: readonly string[]): void`，只清指定阶段的 checkpoint；事务由调用方管理，不能嵌套事务。旧阶段集合由 generation／业务阶段键确定，不能用模糊匹配把附件阶段一起清理。

在开始一次生成时先将 personalRunId 置 null；真正准备个人阶段后保存其 options.runRef.runId，再调用模型。每次写回读取当前 turn，不能以早期对象覆盖 visualContext 或新 metadata。

`currentSelfWebReads(d, turnId)` 对新合同先读 turn.replyFreshness.personalRunId：没有则返回 []，有则仅取该 runId、phase=personal_life 的来源；有 getSelfWebReadSources 测试接口时也应用同一过滤。旧轮保持原行为。memory 输入与 post_jobs.selfWebReadSources 使用同一集合。

### 4.2 图片及消息上下文

重绑保留 turn.visualContext，包含旧 ready/unrecognized 以及仍需恢复的 pending。incoming_image 的 `incoming_image:<attachmentId>` 阶段键不加业务 generation，不重复给同一图片刷新额度或改变素材。

按新状态、消息、复议任务重新构建 narrative／personal／expression 的真实 DTO；不复制旧历史正文池、intent 或 private lookup。普通叙事仍看不到未读内容；只有已可见的个人阶段输入／复议消息才调用 prepareForTurn。旧冻结图即使保留，也只能通过当前 view 的 resources.messages 注入。

任务变更、已看标记及记忆只在最终代际提交。公共观察缓存写入是观察结果，不等于用户消息已看或草稿生活已发生。旧 personal_life 查阅的历史记录可保留审计，但不能成为最终代际本人查阅来源。

## 5. 实施任务

### T1：输入版本、选择与统一静默门禁

**文件：**修改 `src/types.ts`、`src/host/input.ts`、`src/host/scheduler.ts`；新增 `src/host/reply-freshness.ts`、`tests/reply-freshness-scheduler.test.ts`；必要时扩展 Storage 的定向普通未读查询，避免扫描全部历史正文。

**接口：**产出 §2 的版本／分类／尝试判断接口及带 replyInputRevision 的普通 TurnRequest；既有 collectReady 和 nextDeadline 对普通选择结果一致。

- [ ] 写测试并跑红：`ordinary_14999_waits_15000_selects_all`；旧 ready＋新 open 时 0 次普通选择，最后输入后 14,999 ms 仍为 null，15,000 ms 一次取全部，消息顺序不变。
- [ ] 写测试并跑红：`duplicate_control_shared_do_not_advance_revision`；重复平台消息、推进和共同活动输入不递增，新的普通图片／文本递增一次，重复不刷新 readyAt。
- [ ] 写测试并跑红：`stashed_unread_is_selected_when_readable`、`open_batch_defers_due_check_without_blocking_appointment`；pending 为空但普通未读可取回；due check 不绕过静默；预约继续就绪。
- [ ] 按 §1.1／§1.3 实现选择；当前开放批成熟前事件请求也不携带普通未读。无未读 check 只处理一次；不可读不返回过期普通截止。
- [ ] 跑 `npx vitest run tests/reply-freshness-scheduler.test.ts tests/scheduler.test.ts tests/tasks.test.ts tests/shared-v3-scheduler.test.ts`；所有通过后提交。旧测试中“普通只取第一批”的预期应改为新合同，旧冻结兼容测试不要换含义。

### T2：候选换代、阶段门禁与发送边界

**文件：**修改 `src/app.ts`、`src/recovery.ts`、`src/host/reply-freshness.ts`；新增 `tests/reply-freshness-turn.test.ts`。

**接口：**产出 ReplySuperseded、App 受控等待处理和 §2.1 状态转移；generation 不变时保留原业务阶段身份。旧 generateTurn/freezeTurn/sendFrozen 返回类型保持可用。

- [ ] 写阶段注入测试并跑红：分别在叙事、个人、表达、图片准备、表情检索返回前落库新输入；旧候选不进入下一昂贵阶段／首次发送，所有输入未提前已读，无旧经历／任务／情绪／概率提交，paused=false、errors=[]。
- [ ] 写 `input_between_selection_and_run_is_not_stamped_current`；collectReady 后、runTurn 前追加，必须在任何模型调用前进入 waiting，证明使用选择时 revision。
- [ ] 实现模型外门禁：开始生成前；上下文／图片准备返回后、调用下一模型前；叙事／个人／表达返回后；表情准备返回后。每次只读固定 revision，不扫描全部消息正文。不在 ModelClient 内将控制中断当格式错误修补。
- [ ] 冻结事务内及首次 sending 事务内复查，按 §3.1 放置边界；App 单独捕获控制中断并进入 waiting。进入等待清 post job、pending outbox、候选和候选间隔，释放 reply hold，保留原消息、任务、绑定协议和图片冻结记录。
- [ ] 写 `silent_freeze_rechecks_but_postprocessing_is_sealed`、`new_input_after_sending_does_not_replace_tail`；前者冻结前新输入阻止旧沉默提交，冻结后新输入不推翻；后者保留全部冻结分段。
- [ ] 跑 `npx vitest run tests/reply-freshness-turn.test.ts tests/recovery.test.ts tests/chat-recovery.test.ts tests/shared-v3-recovery.test.ts tests/turn.test.ts`；通过后提交。T2 后是持久状态与 App 能力，不能单独当最终可运行交付。

### T3：等待续办、事件接管与真实定时

**文件：**修改 `src/host/runtime.ts`、`src/host/scheduler.ts`、`src/app.ts`；新增 `tests/reply-freshness-host.test.ts`。

**接口：**实现 §3.2 的 collectWaitingContinuation／continueWaitingTurn，返回 WaitingContinuation；不改全局 unfinished 语义。

- [ ] 写 `waiting_timer_rearms_on_new_input_without_models`：使用 SerialHost、假计时器及同步推进的 TestClock，第二次输入延后截止；原截止醒来不调用模型，不形成零延迟循环；最新截止到达后仅生成一次。
- [ ] 写 `waiting_yields_to_appointment_without_consuming_chat`、`waiting_yields_to_school_notice`：接管为同 ID、新 generation、scope=event，input/batch 均空，原 check 仍 pending；事件提交一次；随后普通输入在完整静默期与可读条件满足后再次可选。
- [ ] 写 `waiting_crosses_sleep_and_wake_preserves_stashed_inputs`、`event_makes_phone_unreadable_then_end_restores_inputs`：期间不调用无权限个人导演、不标消息已读；睡眠清掉 pending 索引后仍能在起床事件后取回原输入；活动结束前不空跑。
- [ ] 实现专用决策、改绑事务与宿主循环；重绑更新 input/task/kinds/batch/at/entryMode/sharedMeta/noticeRefs，清旧业务候选，重新绑定对话／活动，重读已提交状态。scope=event 完成后不把同一 ID 再倒回旧候选。
- [ ] 状态显示等待及真实截止；pause/resume/start/stop 使用同一路径，不能靠手工 resume 才继续。空 check 的一次完成也要断言，不用无限调用次数上限掩盖忙循环。
- [ ] 跑 `npx vitest run tests/reply-freshness-host.test.ts tests/environment-async-host-gates.test.ts tests/memory-idle-host.test.ts tests/chat-flow.test.ts`；通过后提交。

### T4：业务代际与图片冻结隔离

**文件：**修改 `src/web/phases.ts`、`src/web/store.ts`、`src/app.ts`、`src/recovery.ts`、`src/memory/organize.ts`；按需调整 `src/input-media/context.ts`，不改观察模型合同；新增 `tests/reply-freshness-context.test.ts`。

**接口：**产出 turnPhaseOptions 与 compactStages；currentSelfWebReads 继续原签名但新轮按当前 personalRunId 过滤。incoming_image 继续原 phaseOptions。

- [ ] 写 `new_generation_starts_without_old_lookup_repair_or_web_payload`：用真实 ModelClient＋假 Transport／provider，旧阶段产生 lookup、修补、网页材料；新阶段首次请求没有旧 lookupResult、repair、webResults 或 webMaterials。断言当前角色输入集合与新 intent 一致。
- [ ] 写 `same_generation_restart_keeps_quota_new_business_gets_own_quota`：同代际接续已确认页不重复计数；新代际阶段独立 20／40，旧统计存在；同主体显式再请求旧页命中缓存，新阶段计一次成功，实际 provider.read 不增加。
- [ ] 写 `only_final_personal_run_supplies_self_reads`：旧代际 personal_life 实际提供网页后改绑到新业务；最终 memory 的 selfReadSources、post job 均无旧 runId。最终是聊天／不调用个人时集合为空。测试不可仅看 stageKey 不同。
- [ ] 写 `unknown_and_ready_images_survive_refresh`、`hidden_old_image_absent_from_new_event_dto`：ready 与 unrecognized 都保持；旧 pending 用原素材／phase 接续；新图识别一次；新事件不可见旧消息时 DTO 不含该图描述。保留四段、正文池去重和普通叙事权限。
- [ ] 按 §4 实现，跑 `npx vitest run tests/reply-freshness-context.test.ts tests/web-recovery.test.ts tests/web-phases.test.ts tests/web-memory-sources.test.ts tests/incoming-media-turn.test.ts tests/chat-active-consistency.test.ts`；通过后提交。

### T5：磁盘恢复、提交一次与整体关闭

**文件：**新增 `tests/reply-freshness-recovery.test.ts`；同步当前调度、恢复、上下文、网页搜索说明和实现对应；交付过程放 `docs/v0.5/records/chat-reply-freshness-20261010/`。提示词仅在 DTO 正确后按证据决定是否补一句，不把程序版本／重试细节写入角色话术。

**接口：**使用真实 Storage 文件关闭重开与 SerialHost.start/resume，假发送器和脚本模型；不能只在同一对象上调用 resume 冒充重启。

- [ ] 磁盘覆盖 §3.3 每行：waiting 期间重开；新输入延后后重开；全 pending 候选未尝试；sending 登记后尚未调用 QQ；一段 confirmed 下一段 retry；silent 已封口但 post 未完成；旧轮没有字段。另测 waiting→预约接管→首次发送前崩溃→新增普通输入→重启：恢复原事件一次，保持 event scope 与 generation，聊天仍待办，不能再次转 waiting。
- [ ] 断言同输入恢复 generation 和阶段 runId 不变，真正新业务选择才换代；新消息不会让 sending/retry/confirmed 文本改变；已确认段不重发，未知段允许按原合同重试，不能承诺网络绝对只送一次。
- [ ] 断言最终有效情绪／任务／经历／记忆／school commits／已看只提交一次；原 batchId 不改，后来的 batch 未被旧轮消费；没有已发消息时不能造 outgoing 依据。
- [ ] 跑全部新增测试及上述定向回归；再跑 `npm test`、`npm run typecheck`、`npm run build`、`npm run demo`，以及 `npm run smoke --prefix runtime`（现有一个脚本执行 empty_week／required_notice 双场景）。保留退出码与原始输出，失败先解释／修复，不能沿用本报告 35 项通过代替新验收。
- [ ] 按项目 README 在隔离配置做启动检查；若需对正式目录做只读检查，先遵守其现有运行锁与停服要求，不能为了计划验收自动停用户服务。本次可选 JSON 字段不要求正式库协议升级。
- [ ] 独立复核改动差异，逐项关闭 R1～R4 与重点回归，再同步索引、实际 commit、验证范围及仍未执行的在线验收。代码／记录一起提交后再整合；不要只交计划勾选结果。

## 6. 交付口径

至少保存：输入版本／候选代际／集合指纹、选择与等待截止、被废弃的阶段、事件接管原因、首次发送尝试时间、阶段调用耗时、红绿测试和磁盘恢复证据。默认不增加完整聊天／人设／提示词正文记录。诊断指纹不要代替实际消息 ID 的内部选择依据。

上线后用户正常触发的连续聊天应覆盖：“继续工作”之后、首段发送前补充“计算已正常／先休息”，最终回复按最新集合生成；再覆盖允许看见但选择沉默。在线质量单独记录，不把脚本模型测试说成真实模型表现。

最终说明必须保留三条边界：15 秒只是允许开始重算的门槛；已发送尝试后不取消尾段；明确排除的事件轮仍按固定请求完成。连续追加可能反复推迟普通回复并增加生成成本，但不得阻止到期事件接管。
