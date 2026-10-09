# HDSI V0.2 实现与文档审核（DSH）

审核日期：2026-10-07。**本文件已于同日第二轮复核后更正：原 K1、K2、K4 三条判断错误（布尔推导反了、漏读 `check` 分支、漏读 pump 中 `closeReady` 先于暂停判断），原 K5 的 WebSocket 部分不成立，原 D3/D4/D5 三条不成立。** 更正说明见文末第 7 节；主体内容保留，但以第 7 节为准。CODEX 的逐条复核见 [CODEX_REBATTLE_20261007.md](CODEX_REBATTLE_20261007.md)。

审核方式：**只读**——阅读源码、测试、启动脚本与文档，没有运行测试、构建或服务，没有修改任何文件（除本节的更正记录）。

审核范围：`src/`（app、recovery、storage、host/*、memory/*、model/*、output/*、directors/*、index、settings、time、config）、`tests/`（16 个文件）、`docs/` 三份、根目录七份文档，以及 `config.local.json` 的实际配置键。

编号用于讨论，例如 K1、D3、I5。

---

## 0. 总体结论

**主干语义与设计文档高度一致，可以交给外部审核者，但要按"已核对、未实机验收"的快照来读。** 我逐条核对了四类承重不变量（见第 3 节），没有发现反相布尔、脱离事务的正式状态写入、会重复发送或永不发送的发送项，也没有发现未看消息正文泄漏进任何模型输入或检索查询的路径。

但有 **3 个我独立复核过的代码缺陷必须先修**（K1～K3），它们都落在同一根状态轴上：`runtime.pendingBatchIds` 同时承担"投递顺序"和"未看归属"两种职责。另有 2 个运行期风险（K4、K5）和 1 个测试夹具问题（K6，这条决定了现有验收结论是否可信）。

文档侧只有表述与链接层面的问题（第 2 节），没有发现把未验收写成已通过的情况。

---

## 1. 必须修：代码缺陷

> **⚠ 第 7 节更正生效**：本节 **K1、K2、K4 三条已撤回**（判断错误），**K5 的平台部分收窄为"除 WebSocket 之外仍有未设上限的等待点"**。仍然成立的只有 **K3**（合同缺 `at` 校验）与 **K6**（测试夹具与真实入队不同，属覆盖缺口而非"验收不可信"）。

### K1〈已撤回〉睡眠期间被关闭的批次，起床轮不会交付其正文

`scheduler.ts:14-19` 在睡眠时无条件清空 `runtime.pendingBatchIds`（且不像 `stashPending` 那样登记待看检查）；而 `scheduler.ts:33-34` 的交付集合完全依赖这个队列：

```ts
const batchIds = wake || check ? [...pending] : pending.slice(0, 1);
const inputs = this.storage.unreadMessages()
  .filter(m => !pending.includes(m.batchId!) || batchIds.includes(m.batchId!));
```

队列被清空后 `pending = []`、`batchIds = []`，于是 `!pending.includes(...)` 与 `batchIds.includes(...)` **同时为假**，这批正文被排除出 `inputMessageIds`。

触发方式很普通：入睡后收到一条消息、静默 15 秒被 `closeExpired` 关闭入队，然后在 `wakeAt` 之前没有任何扫描（或扫描时仍在睡眠）——清队列就发生在这一次扫描。数据不丢（`seenTurnId` 仍为 `null`），但会静默延迟到下一次普通对话才被读到，违反 `LIFE.md:171/196` 与 `IMPLEMENTATION.md:105` 的"起床统一交付已合批待看消息"。

修法：睡眠分支不要清队列（或清后按 `stashPending` 语义重建），并让交付集合按 `seenTurnId === null` 且排除 `openBatch` 选取，队列只用来决定本轮边界。

### K2〈已撤回〉待看检查只交付一个批次

同一行的 `pending.slice(0, 1)` 决定了非 wake 轮只取队首一批，其余批次被下一行的过滤排除，既不进 `inputMessageIds` 也不会被标已看；而 `IMPLEMENTATION.md:109` 明确写"起床或待看检查可以一次交付所有已合批待看消息"。结果是连续几条消息被拆成多轮阅读。

与 K1 同源，建议一起改。

### K3〈会放大调用量〉模型可以创建 `at` 已过期的 `check_messages`

`contracts.ts:58-80` 校验了 `reply.reconsiderAt > at`（:60）、任务 ID、`messageIds`，但**没有校验 `taskChanges[].task.at`**。一个过期 `at` 会被 `scheduler.ts:28` 判为 due → `nextDeadline` 把它当候选（:68/:74）→ `runtime.ts:61` 的 `wait` 为 0 → 立即再唤醒，每轮都真实调用主叙事与个人导演，形成零等待紧凑回合循环。

`reply.later` 这条路是安全的（靠 `contracts.ts:60` 与 `app.ts:153` 的覆盖），风险只来自模型自己 create/update 检查任务。修法：在 `personalTask` 校验里对 `taskChanges[].task.at`（及 update 后的最终 `at`）要求晚于 `at`，或对过期检查做一次显式改期。

### K4〈已撤回〉暂停时定时器空转

`nextDeadline` 的暂停分支返回 `openBatch?.readyAt`（过去时间）→ `armTimer` 算出 `wait = 0` → 立即唤醒 → `pump` 在 `paused` 处 break → finalizer 再 `armTimer` → 又是 0 毫秒。只要暂停时还有未合批输入，就会持续空转，直到 `hdsi.resume`。修法：暂停时只投出真正在未来的截止时间（或直接返回 `null`），并给 `wait` 加下限。

### K5〈收窄〉除 WebSocket 之外仍有未设上限的等待点

`recovery.ts:29` 的 `await d.sender.sendItem(item)` 没有超时。若调用永不 settle：outbox 留 `sending`、`paused` 仍为 `false`、`hdsi.status` 仍报"运行/发送"，而 `pump` 的 active 永不结算，后续所有 `wake` 被推迟，只有重启才会触发 `sending → retry`。文档只定义了"明确失败/空 ID/结果不明 → retry"，没有覆盖"永不返回"。建议为发送加显式超时（这与之前接口核查里"HTTP 协议下 `Http.Config.timeout` 无默认值"是同一类风险）。

**同族问题**：素材文件被删除或移动时，`index.ts:63-66` 的 `readFileSync` 抛 `ENOENT` → 该项存 `retry` → 整个回合 `paused = true`；由于冻结的是素材 ID，每次 `hdsi.resume` 都会重放同一失败，故事永不提交，只能人工还原文件。文档确实声明了"素材文件需要保留"这一前提，但实现没有区分可重试与不可重试失败，建议至少给缺文件这类错误一条不重放的出口。

### K6〈测试盲区〉夹具与生产入队状态不同，掩盖了 K1/K2

`tests/helpers.ts:45-47` 的 `saveInput` 只写消息行，**不把批次写进 `pendingBatchIds`**；而生产路径由 `InputBuffer.acceptInput` 入队。因此所有"批次已封闭"的用例都运行在与生产不同的队列状态上：`tests/scheduler.test.ts:24-42` 之所以通过，是因为第 34 行那次 `acceptInput` 替它入了队。

建议把 `saveInput` 改成走真实入队（或新增一个 `enqueueBatch` 夹具），否则调度与恢复类的验收结论都建立在与生产不同的状态上。

---

## 2. 文档与配置表达（已核实，均为表述/链接层面）

### D1 模型任务数量与配置的表述自相矛盾

`REMAKE_V0.2_LIFE.md:5` 与 `REMAKE_V0.2_MEMORY.md:5` 同一句里先写"九个模型任务…八项低推理、一项高推理"，随后又写"合计低 8 / 高 2"。实际 `config.local.json` 是 `models` 九项（8 项 `low` + `memory` 为 `high`）加 `stickerDescriptionModel`（`high`）＝十项、low 8 / high 2。按 `REMAKE_V0.2_INTERFACES.md:139` 的写法统一即可。

### D2 配置键名与任务名混用

配置键是 `stickerDescriptionModel`，任务名是 `sticker_description`（`src/settings.ts:46` 用后者查连接表，`modelRoles` 数组不含它）。`README.md:75` 把两者写在一起，`REMAKE_V0.2_INTERFACES.md:139` 同一行里出现两种写法。建议加一句"配置键 `stickerDescriptionModel` 对应任务名 `sticker_description`"。

### D3 审核包的 zip 位置描述不准确

`docs/DOCUMENT_AUDIT.md:69` 说 zip 是"本次核对后快照，包含上述十份当前 Markdown"。zip 的内容我核过，确实是那十份 Markdown 加 `examples/story.sample.json`；但它实际位于 `D:\HDSI-remake\docs\DSH-review-20261007.zip`，在 `DSH-review` 包之外，包内没有。要么写明位置并说明不随包分发，要么把它放进包内。

### D4 包内链接解析不到

`DSH-review/README.md:11` 的 `docs/DOCUMENT_AUDIT.md`、`docs/IMPLEMENTATION_LOG.md`、`docs/STICKER_MIGRATION.md` 指向包内 `docs\`，而实际位于 `DSH-review\docs\`；根目录文档里的同名相对链接在包内同样解析不到。另外 `references/legacy-stickers/README.md:5` 指向 `../../docs/STICKER_MIGRATION.md` 已失效，且该历史目录不随包分发。

### D5 启动顺序三处说法不同

`REMAKE_V0.2_RECOVERY.md`（先续办旧轮）、`docs/DOCUMENT_AUDIT.md:30`（起床选择新轮前可以先完成到期环境更新）、`README.md:109`（启动先续办旧轮）。代码实际是 `runtime.ts:43-47` 先恢复未完成旧轮，随后在 `pump` 循环里环境回合优先（`scheduler.ts:21-22`）。建议在恢复文档里写死三步顺序，其他文档只引用。

### D6 测试数字与死字段

- 测试项数**没有矛盾**：我静态清点 `tests/` 为 16 个文件、48 个 `it()` 加 3 个 `it.each()`（展开 2/2/3）＝ 55 项，与 `DOCUMENT_AUDIT.md:7`、`IMPLEMENTATION_LOG.md:87` 一致。只是 `IMPLEMENTATION_LOG.md:48/:78` 的 49 项是更早一轮的数字，建议给历史行加"当时"，并注明当前 55 项的复跑时间与命令。
- `TurnRecord.entryMode` 是**只写不读**的字段（写于 `app.ts:26`、`recovery.ts:95`，全库无读取点）；重做时实际用的是 `state.scene.mode`（`app.ts:65-66`），行为与文档意图一致。要么删字段，要么在文档里说明它只作审计记录。
- `TriggerKind` 里的 `activity` 当前没有生成路径（`IMPLEMENTATION.md:198` 已如实注明），保留可以，建议补一句用途与移除条件。

---

## 3. 次要缺陷与建议改进（不影响主流程，但建议处理）

### 3.1 条件触发的数据问题

**I9 细节别名的整体替换会静默退化检索。** `organize.ts:44` 写入 detail 时把 `aliases` 整体替换：模型若在更新某个已确立细节时给出 `aliases: []`，旧别名就被抹掉，之后按旧别名（例如"手机""型号"）再也召不回这条细节，而当前值本身还在。文档没有承诺"合并别名"，所以不算矛盾，但建议改成"新别名非空才替换，为空则沿用旧别名"。

**I10 同一轮同一 key 的重复 detailChange 会写出两条历史。** `organize.ts:39-45` 逐条处理 `detailChanges`，`contracts.ts:33` 不做 key 去重；结果同一 key 在一轮里出现两次时会写两条历史，且第二条的 `previousValue` 是第一条刚写入的中间值。建议按 key 去重或只保留最后一条。

### 3.2 可维护性与效率

**I1 丢弃未尝试的整稿会重抽样。** `recovery.ts:94-101` 退回重新生成，于是 `app.ts:139` 重新抽自主间隔、`app.ts:127-128/186-192` 重算概率计数，而文档承诺"间隔随候选保存、恢复不再抽样""恢复复用清单和最终计数，不重抽"。影响很小（未发送的稿子重做），但要么把这两项在丢弃时保留，要么在文档里写明"未发送重做会重新抽样"。

**I2 `hdsi.resume` 的错误通道被 `void` 掉。** `index.ts:95` 是 `void host.resume()`，返回的是 `wake()` 的整条链（含 `armTimer`/`nextDeadline`），一旦抛错就成为未处理拒绝，既不进 `onError` 也不写 `runtime.lastError`——而 `SerialHost` 明明已经准备好错误通道（`runtime.ts:31`）。同时该命令先 `void resume()` 再立刻返回 `status()`，状态可能在续办完成前读出（`resume()` 已同步持久化 `paused = false`，所以不会误报"暂停"）。

**I3 `freezeTurn` 不清理序号越界的旧 outbox 行。** `recovery.ts:12` 只写新项，当前靠"每轮只 freeze 一次 + 丢弃时删行"的不变量成立。建议 freeze 时删除 `seq >= items.length` 的同轮行，或断言该轮 outbox 为空。

**I4 段 B 事务里的非空断言是承重结构。** `recovery.ts:53/63/72/81`、`organize.ts:34/58` 依赖合同校验兜住（`contracts.ts:66/85/88/95`）。目前是安全的，但 `post_jobs.result` 会被复用（`recovery.ts:54-55`），若将来放宽校验，坏 ID 会在提交事务里抛错 → 回滚 + 暂停，且每次 `resume` 复用同一结果再次抛错，形成"只能改库"的卡死。建议这里改成显式校验并跳过、记录，而不是 `!`。

**I5 存储原语是全表 JSON 扫描。** `storage.ts:54-56` 的 `all()` 无 SQL 过滤，`outbox()`/`unfinishedTurn()`/`messages()` 都先取全表再在 JS 里过滤排序；`recovery.ts:21` 每发一项都重读一次 `outbox(turnId)`，而 outbox 与消息按设计永久保留，于是单轮成本是"项数 × 历史 outbox 总行数"。已有 `(turnId, seq)` 唯一索引（`storage.ts:26`）但未被使用。单用户量级短期无碍，属于该修的性能债。

**I6 细节别名匹配过宽。** `context.ts:26` 用 `normalized.includes(alias)`，别名过短（例如"机"）会误召回；当前 16 项初始细节下无实际影响。

**I7 `arrangeSleep` 用抛错处理"次晨预约太早"。** `state.ts:46` 直接抛错并暂停整个故事（`app.ts:54-59`）。文档写了"无效睡眠关系会抛错并暂停"，但读者容易把它读成"程序不会静默制造负时长睡眠"的柔性处理。建议要么在文档里把这条边界写得更显眼，要么改成把起床时间压到入睡之后并记一条警告。

**I8 恢复相关测试的覆盖缺口。** `app.ts:40` 的 `sending → retry` 分支没有任何测试构造过 `sending` 行；没有测试断言静默冻结时 `outputComplete === true`；`recovery.test.ts:28-29` 手工拼冻结态，绕过了 `freezeTurn`，因此"一次事务写 turns + outbox + post_jobs"没有直接断言；也没有测试用同一文件路径开第二个 `Storage` 跑跨进程恢复。

**I11 记忆整理拿到的是被裁剪过的检索结果。** `context.ts:46-52` 的预算裁剪作用在整个上下文对象上，而 `organize.ts:18` 只取其中的 `details` 与 `retrieved`：当历史（近期原文/短期摘要/历史值）很大时，裁剪可能先削掉本该给整理模型看的长期记忆与细节。另外 `organizeMemory` 算出的 `recent`/`shortTerm`/`detailHistory` 实际都没用上（`organize.ts:18`），属于白做的全表扫描。建议给整理路径单独构造一个只含所需字段的上下文。

**I12 提示词与合同对"来源 ID"的口径有一处空隙。** `contracts.ts:85` 只校验 `sourceIds` 落在给定集合内，**允许空数组**，所以"无依据也可以建事实"在程序层没有被拦住（目前只靠提示词约束）；同时 `prompts.ts:12` 没有说明 `reconsiderMessages`（旧原文）不能作为本轮来源 ID，而合同会拒绝这种引用，模型若引用就会白白走一次修补。建议补一句提示，并把"细节变更必须至少给一个来源"作为可选的硬校验。

**I13 小型死重与重复投喂。** `app.ts:95` 取出的 `narrativeHistory.recent` 与 `:98` 传入的 `history.recent` 是同一份数据，主叙事会收到两份近期原文；`experiences` 表只写不读（`recovery.ts:66`）；`storage.ts:25` 的 `memory_time` 索引未被使用；`client.ts:28` 的兜底抛错不可达。

---

## 4. 我确认没有问题的部分（避免返工时误改）

- **两阶段契约成立**：`freezeTurn`（`recovery.ts:8-16`）在一个同步事务内写 turns（含 `frozenResult`）、全部 outbox、`post_jobs{result:null}`；`outputComplete = items.length === 0` 也在事务内，静默/环境回合因此直接置真；发送前没有任何平台调用。
- **逐项发送与确认成立**：先存 `sending` 再调平台（`recovery.ts:25-29`），成功后在**同一事务**写 `confirmed` + `confirmedAt` + 平台 ID + 实际 outgoing 记录 + 下一项 `notBefore`（:33-47）；空 ID 数组显式抛错（:30）；失败只转 `retry`，全库没有回退到 `pending` 的路径；"已有尝试即禁止丢弃整稿"由 `app.ts:38-40` 唯一守门。
- **间隔计算正确**：`notBefore` 用上一项**实际确认时间**（`recovery.ts:32,42`），从不使用生成时间；`nextItemDelay`（`qq.ts:14-19`）正确排除了旁白、表情包与共同活动标志，只把角色文字/动作算作"短段"，首个短段立即发送；字数按去空白后的字素计（`qq.ts:3`），公式与 `LIFE §3.2` 逐位一致。
- **段 B 一次提交成立**：整理结果先落库（`recovery.ts:54-58`，用 `=== null` 判断，所以合法空结果可复用），随后是唯一提交事务（:60-91），`done:true` 全库唯一写入点在该事务内（:90），事务内二次检查防重复应用；`applyMemory`/`applyTasks` 自身不开事务，无嵌套。
- **恢复判定顺序正确**：`done → outputComplete → 尝试/冻结稿`（`storage.ts:68`、`app.ts:37-40`），与文档一致；重做时更新 `at`，续办已尝试稿时保持不变。
- **自主周期正确**：提交时用 `completedAt` 加已保存间隔（`recovery.ts:64,68`），不是 `at`、也不是最后一段的确认时间；睡眠置空有调度与提交两条路径；只在含自主触发或起床的回合重排。
- **暂停语义正确**：`paused` 存在 SQLite，跨重启保留；暂停时输入继续落库合批但不启动新轮；系统 `error` 走 `sendPrivateMessage` 不写消息表，因此不可能进入记忆；`hdsi.*` 命令在中间件里 `next()` 绕过，命令回复不落库。
- **概率曲线与文档逐位一致**：`probability.ts:2-3` 的 `p0 = 0.025 / step = 0.00177786838251657`、`p0 = 0.075 / step = 0.0183782066846511`，`expectedRate()` 的 `E = 1 + Σ S(k)` 与文档公式同构，封顶 549/51 与文档相符。
- **可见性只有一个门禁**：`app.ts:110` 在合入场景后一次判定，共同场景短路可见；主叙事在普通私聊下不接收本轮新消息正文（`app.ts:93,98-99`），记忆整理只取 `visibleMessageIds`（`organize.ts:8`）——未看正文确实进不了任何模型输入或检索查询。
- **数据库选型比原设计更稳**：改用内置 `node:sqlite` + `BEGIN IMMEDIATE` + WAL/FULL（`storage.ts:17,39`），写事务在单连接内同步执行，反而消除了对 Koishi sql.js 适配层的依赖风险。
- **记忆与检索子系统的数字与口径全部对得上**：整理输入正好是文档列的九项（`organize.ts:15-19`）；固定基数 30 条近期原文 / 7 天 12 条短期 / 12 项细节 / 8 条长期 / 8000 预算与裁剪顺序（`context.ts:27,33,35,38-45,48-52`）与 `MEMORY.md` 一致；长期排序公式与 `MEMORY.md:89` 逐项相同；`mentions`/`reinforcedAt` 完全由程序维护，`reinforce` 只能引用本次检索到的 ID（`contracts.ts:88`），检索本身无副作用；修补上限 2 次、`lookupDetails` 续调一次且不计入修补（`client.ts:8,12,16-20`）与 `INTERFACES.md:323` 一致；普通 HTTP 故障直接上抛触发暂停，只有查询续调在可修补路径内。

> 说明：记忆/检索子系统**没有发现与文档的硬矛盾**；恢复子系统的四条验收属性在阅读层面全部成立（唯一 `done` 写入点、`sending` 先落库、`notBefore` 用上一项实际确认时间、整理结果先落库再提交）；调度与共同场景的结论与上面各条一致。上述"没问题"的判断全部来自静态阅读，未由运行验证。

---

## 5. 建议的处理顺序

1. **K1 + K2**（同一处状态轴，一起改）：交付集合改为按 `seenTurnId`/`openBatch` 选取，睡眠分支不要清队列。
2. **K6**：修 `tests/helpers.ts` 的入队夹具，否则 K1/K2 的修复没有可信的回归测试。
3. **K3**：在个人导演合同里校验 `taskChanges[].task.at`。
4. **K4**：暂停时不投出过去的截止时间。
5. **K5**：给发送加超时，并给"素材文件缺失"这类不可重试失败一条不重放的出口。
6. 文档侧 D1～D5 都是一句话到几句话的改动；D6 只需给历史数字加时间标注。
7. I 组按性价比排：**I9（别名合并）与 I10（同 key 去重）是两处小改动、效果直接**，建议并入第 1 批；I2/I3 顺手做；I1（重做重抽样）要么改代码要么改文档；I5、I11 等有性能或上下文压力时再做；I12 只需在提示词里补一句"旧原文不作为本轮来源 ID"。

---

## 6. 本次审核的边界

**没有做**：运行任何测试、构建、demo 或服务；连接真实 QQ 或模型；断电与中断注入；修改任何文件。

**因此无法验证**：55 项测试是否真的通过（我只是静态清点出 55 项）；真实 QQ 的收发与返回 ID 语义；跨进程恢复是否真的按预期续办；段 B 各写入点被强杀后的行为；素材视觉描述与 Embedding 阈值；机器人自己发出的 `error` 文本是否会被适配器回灌成 incoming 消息；`z.toJSONSchema` 对含 `iso.datetime` 与判别联合的记忆 Schema 在 `outputMode: json_schema` 下是否可用；以及真实模型是否会给出空 `aliases`、同一 key 的重复变更，或引用旧原文当作来源 ID（这三项决定了 I9/I10/I12 是否真会发生）。

---

## 7. 第二轮复核更正（2026-10-07 同日）

CODEX 在 [CODEX_REBATTLE_20261007.md](CODEX_REBATTLE_20261007.md) 里逐条复核并提出了分歧。我自己回到源码重算后确认：**它的主要反驳成立，我的第 1 节有三条判断错误。** 记录如下，避免有人按错误结论去改代码。

### 7.1 撤回的三条（我的错误）

**K1 撤回——布尔推导反了。** 我把过滤式读成了"两个条件都为假"：

```ts
.filter(m => !pending.includes(m.batchId!) || batchIds.includes(m.batchId!));
```

当 `pending = []` 且 `batchIds = []` 时，`!pending.includes(...)` 为 **true**，整式为 true，闭合未读消息**照常通过筛选**。而且 `storage.unreadMessages()`（`storage.ts:64-66`）本来就独立按 `entryMode` / `seenTurnId === null` / 排除 `openBatch` 选取，消息是否未看由消息行决定，**从队列移除不等于已看**。所以睡眠清队列不会导致起床漏交付。我错在依赖了专项审计线程给出的结论而没有自己重算这一行——这一行还被我原样引用过。

**K2 撤回——漏读了 `check` 分支。** 我引用过 `const batchIds = wake || check ? [...pending] : pending.slice(0, 1);`，却在结论里写成了"只取 wake"。待看检查存在时取的是**全部** pending；`slice(0,1)` 只作用于没有起床也没有检查触发的普通输入轮。与 `IMPLEMENTATION.md:109` 并不冲突。

**K4 撤回——漏读 `closeReady` 先于暂停判断。** `runtime.ts:40-42` 的顺序是 `input.closeReady(now)` → 判 `paused` 后 break。定时器在 `readyAt` 触发时，打包会先把批次闭合、`openBatch` 置空，随后才 break；于是下一次 `armTimer` 走暂停分支 `nextDeadline()` 返回 `null`，不会为同一个过期 `openBatch` 反复排 0 毫秒定时器。我在推演时把 `closeReady` 跳过了。

### 7.2 需要收窄的两条

**K5 收窄。** `runtime/koishi.yml` 配的是 `protocol: ws-reverse`，而我核对了已安装适配器 `runtime/node_modules/koishi-plugin-adapter-onebot/lib/index.js:616,659`：`responseTimeout` 默认 `Time.minute`，并在 `:688-693` 以 `TimeoutError` reject。**WebSocket 发送路径有 60 秒上限**，我原先"平台调用无超时"的说法对当前部署不成立。仍然成立的部分是：这条上限不覆盖其他等待点（`d.wait()` 的分段等待、Embedding/HTTP 抓取等），给发送侧再叠一层超时也不是必需的。原来那条"素材文件丢失导致该回合反复重放失败"的**机制描述**仍然成立，但"自动跳过"会改变已冻结的输出与随后记忆输入，属于产品语义决策，不应作为自然修复——这一点接受 CODEX 的判断。

**K6 收窄。** `saveInput` 不入队是事实，但并非所有测试都依赖它：`tests/input.test.ts` 直接测 `InputBuffer`，`tests/integration.test.ts` 走 `SerialHost.acceptInput`，`tests/scheduler.test.ts:44-45` 显式设置了队列。我也说错了一处细节：睡眠用例第 34 行的 `acceptInput` 是给**新消息 b** 建 openBatch，并没有替 a 入队。正确的结论是：**"真实闭合批次经睡眠清空"这条路径缺少覆盖**，而不是"整个调度/恢复验收不可信"。建议新增一个明确的"真实闭合批次"夹具或用 `InputBuffer` 构造，而不是全局改写 `saveInput`。

### 7.3 撤回的文档条目

- **D3 撤回**：`docs/DSH-review-20261007.zip` 是原工作区的交付包路径，解压目录里没有 zip 本体不构成错误——包不需要递归包含自身。
- **D4 撤回（README 链接部分）**：README 位于解压根目录，其 `docs/...` 链接解析到 `DSH-review/docs/...` 是正确的；`references/legacy-stickers/README.md` 的相对路径在原工作区也成立。**但 CODEX 指出的真正缺项成立**：文档包不含 `src/`，因此文中的源码链接在包内无法解析，应标明"需完整工程"或在打包时附上共享类型文件。
- **D5 撤回**：`REMAKE_V0.2_RECOVERY.md:125` 已经写明三步顺序（先恢复未完成旧轮 → 新轮选择时先世界、再学校 → 随后才是起床／输入／自主／任务的合并轮）。我漏读了这一节。
- **D1 降级**：`config.local.json` 确实是九项故事任务（8 low + memory high）加一项 high 的图像描述，"另用"二字已在句内，属于可读性建议而非矛盾。

### 7.4 我接受但我原先表述过头的

- **I1**：`RECOVERY.md:37` 明确允许未尝试发送时丢弃"未公开稿和随机结果"并按时重新生成，`discardUnattempted` 与之一致——我应把它记作"文档已规定的行为"，而不是"与文档不符"。
- **I4**：以"失败即回滚暂停"代替"静默跳过引用后提交部分故事"更符合完整提交语义，我接受；I4 只保留"显式报错可以增强定位"这半句。
- **I9**：措辞应收窄为"原别名入口丢失、召回可能下降"，而不是"此后再也召不回"。
- **I13**：`experiences` 表虽是当前无独立读取路径，但它是正式经历与记忆来源的留档，不应因"只写"而删除。
- **I10**：同意先定规则（每轮同 key 是否最多一次），再决定"拒绝并修补"还是"保留顺序历史"，不应直接丢掉前项依据。

### 7.5 更正后仍然成立、且优先级最高的

1. **I11**：整理路径的预算按整个上下文对象计算，可能先削掉整理模型真正需要的长期记忆与细节——这是上下文有效性问题，不只是性能。建议优先。
2. **K3**：个人导演合同应对 create/update 后的最终 `check_messages.at` 要求未来时间；这只限制"新建/重排"，不影响程序处理已到期的既有任务。
3. **I8 / K6 的测试补充**：真实闭合批次、多个批次 + 到期检查、持久化 `sending` → retry 续发、无输出冻结的 `outputComplete`、`freezeTurn` 三表原子失败路径、同文件重开后再恢复。
4. **I9 / I12**：空别名沿用旧别名；提示词里点明旧原文不属于本轮可引用来源，并考虑要求新事实至少一个来源。
5. **I5**：历史查询优化，长期运行前处理。

我原来的"必须修 K1+K2"结论作废；请不要依据第 1 节前四条改动消息队列或加入统一最小等待时间。
