# HDSI V0.2：对 DSH 审查的复核与回应（rebattle）

日期：2026-10-07。对应审查：[DSH_REVIEW_20261007.md](DSH_REVIEW_20261007.md)。

本文供 DSH 第二轮复核，沿用原审查的 K／D／I 编号。判断依据是当前 `D:\HDSI-remake` 工作区源码、测试源码、已安装 OneBot 适配器及文档。本文只记录结论和建议，不代表已经实施修复。

本次没有修改程序或原设计文档，没有运行测试、构建、在线模型验证或服务。以下代码判断来自静态核对；建议增加的运行验证均仍待执行。代码位置使用相对项目根目录的路径和行号，方便在本机定位；文档包不包含源码时，应回到完整工作区核对。本文不包含密钥、角色背景或聊天内容。

## 1. 总体判断

DSH 对两阶段提交、逐项确认、可见性和模型职责边界的核对有参考价值；提出的若干测试与上下文改进也值得处理。但“有三个必须先修的代码缺陷”的结论需要修正：**K1 的布尔推导相反，K2 漏读了 `check` 分支；K3 的时间校验缺口成立，但过期任务不必然造成无限循环。** K4 漏读合批先于暂停判断的执行顺序；K5 关于当前平台无响应无限等待的论证漏掉了已安装适配器的响应超时。

建议先讨论并确认 I11、K3、I8／K6、I9、I12 的适用范围，再实施具体改动。不要依据 K1／K2 的现有推导修改消息队列，也不要把缺素材或非法引用自动跳过后提交故事。

## 2. K 组：关键结论逐项复核

### K1：睡眠清队列导致起床无法交付正文——不成立

当前代码 `src/host/scheduler.ts:33–34`：

```ts
const batchIds = wake || check ? [...pending] : pending.slice(0, 1);
const inputs = this.storage.unreadMessages()
  .filter(m => !pending.includes(m.batchId!) || batchIds.includes(m.batchId!));
```

当 `pending = []`、`batchIds = []` 时：

```text
pending.includes(batchId)        = false
!pending.includes(batchId)       = true
batchIds.includes(batchId)       = false
true || false                   = true
```

因此，队列清空后的闭合未读消息会通过筛选，不会按审查所述被排除。起床时 `wake = true` 产生 `sleep` 触发，即使 `batchIds` 为空，仍会返回包含这些消息 ID 的请求。

`src/storage.ts:64–66` 的 `unreadMessages()` 已独立筛选 incoming、`seenTurnId === null`，并排除当前 `openBatch`。消息是否未看由消息行决定，队列决定即时触发和批次边界；从队列移除不等于已看。`REMAKE_V0.2_RECOVERY.md:31` 已说明这一点。

复核建议：构造“真实输入 → 15 秒到期闭合 → 睡眠扫描清队列 → 起床扫描”，检查 `inputMessageIds`、`seenTurnId` 与尚未闭合新输入的排除。该测试值得补充，但不能以原布尔推导作为修复理由。

另外，不能仅删掉睡眠中的清队列操作：`nextDeadline()` 在 `pendingBatchIds` 非空时会加入 `now`（`scheduler.ts:59`），而睡眠中的故事扫描返回 `null`。修改这条语义时必须同时考虑截止时间，否则可能引入即时重复唤醒。

### K2：待看检查只交付一个批次——不成立

同一表达式明确是 `wake || check`，不是仅 `wake`：

```ts
const check = tasks.some(t => t.kind === 'check_messages');
const batchIds = wake || check ? [...pending] : pending.slice(0, 1);
```

待看检查存在时取全部 pending；已经离开队列但仍未读的闭合消息也通过另一侧条件进入请求。`slice(0, 1)` 适用于没有起床或检查触发的普通轮。

建议补“多个真实闭合批次 + 到期检查”的回归用例。当前实现无需因 K2 改成所有普通输入轮都读取全部队列。

### K3：模型可新建或改期到过期的检查任务——校验缺口成立，影响需收窄

`src/model/contracts.ts:58–80` 校验 `reply.reconsiderAt > at`，但对 `taskChanges` 合并后的 `check_messages` 只检查 `checkReason` 与消息 ID，没有检查最终任务时间。因此模型可能创建或更新到一个已到期时间，造成一次不必要的即时后续轮。

不过，“一个过期任务必然形成紧凑无限回合循环”不成立：

- `src/app.ts:137` 将本轮可处理的检查任务加入 `completedTaskIds`。
- `src/memory/organize.ts:48–60` 默认完成这些任务；显式 update／cancel 才覆盖默认完成行为。
- 持续循环需要模型持续创建或重置过期任务等额外条件，不能由单个过期任务直接推出。

建议：在个人导演返回合同中，对 create／update 后的最终 `check_messages.at` 增加明确的未来时间要求，通过现有格式修补通道处理。保留到期既有任务的正常处理能力。不要把此约束扩大成“所有已有过期预约非法”，也不要影响程序允许立即触发的其他任务路径。

### K4：暂停时过去的 readyAt 会导致定时器活锁——当前执行路径不支持此结论

`src/host/runtime.ts:40–42` 的顺序是：

```ts
this.requested = false;
this.input.closeReady(d.clock.now());
if (d.storage.runtime().paused || this.stopped) break;
```

`src/host/input.ts:26–31` 在截止时间到期时将批次移入 pending，并把 `openBatch` 设为 `null`。即使暂停中的 `armTimer` 遇到已过期的 readyAt，下一次 pump 也先完成合批，再退出。之后暂停分支 `nextDeadline()` 返回 `null`，不会持续为同一个过期 openBatch 安排 0 毫秒定时器。

原审查的推演遗漏了 `closeReady`。可增加带定时器的暂停合批测试，但目前没有理由加入统一最小等待时间；那会改变正常立即到期触发的行为。

### K5：发送无限等待与素材缺失——分开判断

**当前 OneBot 部署的“完全没有响应超时”论证不成立。** `runtime/koishi.yml:18` 配置 `protocol: ws-reverse`。已安装适配器 `runtime/node_modules/koishi-plugin-adapter-onebot/lib/index.js`：

```js
// 659：ws-reverse 的配置默认值
responseTimeout: Schema.natural().role("time").default(Time.minute)

// 688–695：请求 Promise 的超时路径，以下仅保留相关语句
return new Promise((resolve, reject) => {
  listeners[data.echo] = resolve;
  setTimeout(() => {
    delete listeners[data.echo];
    reject(new TimeoutError(params, action));
  }, bot.config.responseTimeout);
  socket.send(JSON.stringify(data));
});
```

上面的 `Schema`／`Time` 为阅读简化后的名称，实际编译文件使用导入对象前缀。默认响应期限为一分钟。当前 WS 请求不返回响应会走 reject，故事执行失败后保存暂停；HTTP 模式的配置结论不能直接套用到当前 WS 模式。

这不证明任意自定义 `Sender` 或所有上游等待阶段都受该期限保护。若能指出当前实际调用链中另一个绕过超时的等待阶段，应继续核对；目前不建议仅凭原描述增加重复超时。

**缺素材导致暂停是真实边界，但自动跳过并非自然修复。** 冻结稿保存素材 ID，要求素材文件保留。缺文件时人工还原后恢复，符合当前设计。自动跳过会改变已经冻结的输出及随后记忆输入。可以以后改善错误定位；是否允许跳过、替换或取消冻结项，需先明确产品语义。

### K6：夹具导致整个调度／恢复验收不可信——概括过度，增加真实路径用例有价值

`tests/helpers.ts:45–47` 的 `saveInput` 确实只写消息，不更新 pending。它适合直接指定请求的应用层测试，也能表示已从即时队列移除的闭合未读消息；不能把所有使用它的用例都解释为“真实刚入队”。

但当前测试不全依赖该夹具：

- `tests/input.test.ts` 直接测试 `InputBuffer.acceptInput` 和 `closeReady`。
- `tests/integration.test.ts:14–17、28–30` 走 `SerialHost.acceptInput`。
- `tests/scheduler.test.ts:44–45` 显式设置了 pending 队列。

原审查称睡眠测试第 34 行的 `acceptInput` “替它入队”也不准确：该调用新建消息 b 的 openBatch，未将旧消息 a 入队；该测试要求 a 被交付、仍在合批的 b 不被交付。

建议新增一个明确表示“真实闭合批次”的辅助函数，或直接用 InputBuffer 构造 K1／K2 的场景。保留用于直接请求测试的 `saveInput`；不要全局改写其语义而使不同测试层级混在一起。当前睡眠用例未完整覆盖“真实 pending 经睡眠清空”路径，这个覆盖缺口应承认。

## 3. D 组：文档与交付包

| 编号 | 复核判断 | 建议 |
| --- | --- | --- |
| D1 | 数量没有自相矛盾：九项故事任务为 low 8／high 1，另加 high 的图像描述任务，合计十项、low 8／high 2。原文有“另用”说明。 | 将“九个模型任务”明确为“九项故事任务”，提升可读性即可。 |
| D2 | 配置键与运行任务名确实不同，但本身合法。 | 加明确映射：`stickerDescriptionModel` → `sticker_description`。 |
| D3 | `docs/DSH-review-20261007.zip` 是原工作区中的交付包路径；解压目录内没有 zip 本体不构成错误，包无需递归包含自身。 | 可标注“原工作区路径”，避免把该说明当成解压后的附件链接。 |
| D4 | README 位于解压根目录，其 `docs/...` 链接正确解析到 `DSH-review/docs/...`。原审查所列这些失效链接不成立。历史归档 README 的 `../../docs/STICKER_MIGRATION.md` 在原工作区也存在。 | 真正的包内缺项是 INTERFACES 的 `src/types.ts` 链接：文档包未含源码。可标明“源码链接需完整项目”，或下次打包附共享类型源文件。 |
| D5 | 恢复文档已有明确顺序，三处说明并不冲突。 | 无需按该意见改变调度；可统一引用恢复文档。 |
| D6 | 49 为历史阶段、55 为当前核对阶段，原审查也承认没有数字矛盾。只写不读字段不自动等于缺陷。 | 历史测试数字可加“当时”；`entryMode` 可说明其审计用途，`activity` 保留项用途可进一步解释。 |

D5 的直接依据是 `REMAKE_V0.2_RECOVERY.md:125`：启动先恢复未完成旧轮，选择新轮时先到期世界、再学校、随后起床／输入／自主／任务合并轮。该三步顺序已经写入，而非尚待补充。

D4 应区分完整工作区、解压包及未分发历史归档三种链接上下文。建议 DSH 在实际解压根目录按 Markdown 文件所在目录解析路径，再报告仍失败的具体目标。

## 4. I 组：改进建议逐项判断

### I1：未尝试整稿重做重新抽样——符合现有恢复规则

`REMAKE_V0.2_RECOVERY.md:37` 明确允许未尝试发送时丢弃“未公开稿和随机结果”，按恢复当前时间重新生成；已有任一发送尝试才固定候选和随机结果。`discardUnattempted` 与此一致。不建议为该项保留未公开旧随机结果，除非用户主动改变恢复规则。

### I2：resume 的异步拒绝——存在局部可维护性改进

`src/index.ts:95` 使用 `void host.resume()`；`SerialHost.wake()` 的 pump 已有 catch，正常故事执行错误也由 `HdsiApp.execute` 保存暂停和 lastError。因此“所有续办错误都失去通道”的说法过宽。

但 finalizer 中的 `armTimer()` 等异常仍可能使返回 Promise 拒绝，外层没有 catch。可补日志错误通道，优先级较低。立即返回状态是命令当前行为，不必改成等待整个故事发送结束才回复。

### I3：freeze 不额外清理旧 outbox——现有不变量足以解释

当前一轮只冻结一次，未尝试整稿重做先删除旧 outbox 和 post job。尚无生产路径会在同轮残留越界项。没有必要为假设中的额外重复冻结增加清理；若以后改变冻结入口，再同时调整这个不变量。

### I4：非法引用跳过后提交——不建议采用

当前引用受合同和串行事务控制。失败后回滚暂停，比静默跳过引用并提交部分故事更符合完整提交要求。显式报错可以增强定位，但“跳过、记录”会改变语义，不能作为非空断言的机械替换。

### I5：全表 JSON 扫描——真实性能债，后续可优化

`src/storage.ts:54–69` 的 all／messages／outbox 确实先取全表；发送每一项重查 outbox 会随历史增长增加成本。可逐步使用已有 JSON 表达式索引进行 turnId／状态／时间范围查询。单用户初期无需引入额外存储体系，但长期运行前值得处理。

### I6：过短别名匹配过宽——条件性问题

substring 匹配会使过短别名误召回。当前未给出已有别名导致错误的具体案例。优先改善实际别名，若验证存在误匹配再调整规则；不必为此增加复杂语言处理框架。

### I7：非法睡眠关系抛错——现有明确边界

文档已经说明无效睡眠关系会抛错暂停。自动把起床时间压到入睡之后，会创造未经设计的作息，也可能影响预约准备时间。可以让错误信息更清楚，但不建议未经语义确认自动截断时间。

### I8：恢复测试缺口——成立，值得补充

以下独立路径仍值得新增验证：

1. 持久化 outbox 存在 `sending`，恢复后转 retry 并续发。
2. 无输出冻结立即 `outputComplete=true`，直接进入后处理。
3. `freezeTurn` 同时写 turn、全部 outbox、post job，注入失败后不留下部分写入。
4. 关闭 Storage 后用同一数据库文件重新打开，再恢复未完成轮。

现有应用流程测试会间接执行冻结，不等于完全未覆盖；但原子性失败路径和重新打开文件的恢复没有由这些间接测试充分证明。重新打开数据库也不等同于真实强杀／断电测试，应分别描述验收范围。

### I9：空别名覆盖旧别名——机制成立，建议改进

`src/memory/organize.ts:39–44` 在 value 变化时整体替换 aliases。模型更新值却返回空 aliases，会丢掉原通用检索入口。即使仍可能通过 key／value 关键词找回，也会削弱旧别名召回。

建议至少讨论“空数组沿用旧别名”；若合并别名，应避免把过时属性值无限保留为别名。原审查中“此后再也召不回”措辞应收窄为“原别名入口丢失，召回可能下降”。

### I10：同 key 多次变更产生中间历史——机制成立，需先定规则

逐项应用会保存中间值历史。当前没有同轮每 key 唯一约束，但重复项是否描述真实多次变化，需要先定义。建议优先明确“每轮同 key 最多一次”，再通过合同拒绝并走格式修补；不宜未经确认直接只保留最后一条而丢掉前项依据。

### I11：整理上下文被无用字段占用预算——成立，建议优先处理

`src/memory/organize.ts:13–18` 调用完整 `ContextBuilder.build()`，最终只向整理模型传 details 与 longTerm。`src/memory/context.ts:46–52` 却对包括 recent、shortTerm、detailHistory 的整个对象计预算，并最先裁剪 longTerm。

因此，整理模型根本不会接收的历史字段仍可挤掉它实际需要的长期记忆和细节；这是上下文有效性问题，不只是扫描性能问题。建议为整理构建仅包含所需检索字段的上下文，沿用相关性与数量规则，单独按实际投喂对象裁剪。测试应证明长近期历史不会无故挤掉相关长期记忆。

### I12：空 sourceIds 与旧原文来源——部分成立

`src/model/contracts.ts:85` 使用 `every`，空数组确实通过。因此当前只保证非空时的 ID 合法性，没有强制新事实提供至少一个来源。

但提示词并非完全没有限制：`src/model/prompts.ts:12` 已要求仅从本轮 experiences／首次可见 visibleMessages／实际 outgoing 提取事实，旧原文不能仅因重现而加强，sourceIds 仅用给定当前来源。可以进一步直说 reconsiderMessages 不属于本轮可引用来源，减少歧义。

建议确认并增加细节变更及新建记忆的非空来源要求；不要要求合法“无新内容”的空结果必须生成来源，也不要把合法来源 ID 当成事实真实性的完整证明。

### I13：重复上下文与记录用途——部分接受

`src/app.ts:95–99` 把同一 recent 同时作为顶层 recent 和 history.recent 传给主叙事，重复投喂可以清理，减少提示词开销。

experiences 当前虽无独立检索读取路径，仍是正式经历与记忆来源的留档；不能仅因当前只写就删除。索引可随 I5 查询优化实际使用；不可达兜底抛错属于低优先级清理。

## 5. 建议确认后的处理顺序

| 顺序 | 项目 | 具体目标 |
| --- | --- | --- |
| 1 | I11 | 整理模型的预算只计算其实际需要的上下文字段，防止相关长期记忆被无用历史挤掉。 |
| 2 | K3 | 限制个人导演新建／重排检查任务的时间，保留正常到期任务处理。 |
| 3 | I8、K6 | 补真实合批、睡眠清队列、多个批次检查、持久化恢复和冻结原子性测试。 |
| 4 | I9 | 明确空别名更新策略，保留必要检索入口。 |
| 5 | I12 | 明确旧原文来源限制与新事实非空来源要求。 |
| 后续 | I5、I13、I2 | 优化历史查询、清理重复 recent、补 resume 外层拒绝日志。 |
| 先定规则 | I10 | 明确同轮同 key 多变更是否允许，再决定拒绝修补或保留顺序历史。 |

文档可随后做 D1／D2／D6 的小幅澄清，并说明 D4 中真正缺失的源码链接。以上是建议顺序，不是当前已获授权的实施任务列表。

## 6. 请 DSH 优先复核的分歧

1. K1：空数组下 `!pending.includes(...)` 是否应为 true？结合 storage 的未读筛选，能否仍构造起床漏交付路径？
2. K2：原报告是否漏掉 `wake || check` 中的 check？如仍有漏批，请给出不同于原推导的状态序列。
3. K4：pump 先 closeReady、后 paused 判断，是否足以终止同一 readyAt 的定时器重复？如不足，请指出实际调用次序。
4. K5：当前 ws-reverse 的默认 responseTimeout 是否覆盖原报告所指的无响应请求？若有别的无期限等待，请标明实际路径。
5. K3：请区分“一次不必要的即时后续轮”和“模型持续新建／重排后形成循环”，并确认约束仅作用于个人导演的检查任务变更。
6. I11：是否同意它应按上下文有效性优先处理，而不必等到出现性能压力？
7. D4：请按解压文件所在目录重新解析链接，并区分真正缺少源码附件与本来可解析的 docs 链接。

欢迎给出最小状态序列、精确代码位置或可执行测试来推翻本文判断。后续以复核后的事实和用户确认的设计为准，不按报告的严重性标签直接修改实现。
