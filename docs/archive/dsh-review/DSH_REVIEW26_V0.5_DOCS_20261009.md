# HDSI V0.5 文档体系复核（DSH）

日期：2026-10-09。对象：`docs/v0.5/` 的整套说明（源码基线 `bf59782`／文档提交 `81ba5df`）。依据：[文档索引](README.md)、[总架构](architecture/REMAKE_V0.5.md)、8 份子系统、[实现对应](reference/V0.5_IMPLEMENTATION_MAP_20261009.md)、[对照整理记录](records/V0.5_DOCUMENT_ALIGNMENT_LOG_20261009.md)，以及 `src/`、`tests/`、配置与非敏感运行状态。

方式：只读文档、源码与 Git，**没有运行测试或服务，没有修改任何文件**。

结论：**这套文档可以当作当前唯一说明入口，正文与代码的吻合度很高——但三路审核合起来发现 3 处建议改文档、1 处需要改代码。** 我核对的每一组数字都对得上（概率常数、超时默认、睡眠作息、模型强度默认、图库条目数、版本标记）；四份子系统文档的专项审核确认"不需要按文档回改代码"。**需要改代码的那一处是 §5.5**：`lifecycle.merge` 会把归档记忆复活并搬走唤醒日期，绕过 REVIEW17 §4.4 已确认的"先真实重谈恢复、再允许晋升"，而且测试用例名与断言互相矛盾。**建议改文档的三处是 §4.1（连接表述）、§4.2（跳过原因漏列）、§6.2（版本清单漏 `dialogueWindowVersion`）**，加上 §6.1 那条没有代码落点的"07:00"。

---

## 1. 我核对的数字全部准确

| 文档声称 | 我实测 | 位置 |
| --- | --- | --- |
| 素材概率 `p0=0.025`、`step=0.00177786838251657`；主动 `p0=0.075`、`step=0.0183782066846511` | 完全一致 | `host/probability.ts:2-3` |
| `queryTimeoutMs=1500`、`backgroundTimeoutMs=120000`、`retryDelayMs=300000` | 一致 | `memory/index.ts:42`、`memory/maintenance.ts:99,144`、`settings.ts:44` |
| 睡眠 23:30～00:30、08:00～09:00、准备 60 分钟 | 一致 | `config.ts:21` |
| `batchItems=20`、`batchCharacters=null`；深度空闲 15 分钟；容量 100／1000／500／90 天 | 一致 | `maintenance.ts:13,39`、`settings.ts` |
| 环境 `06:00`／重试 300000 | 一致 | `settings.ts`、`environment/scheduler.ts:22` |
| "12 个故事／后台连接键，加单独看图描述连接" | `modelRoles` **恰好 12 项**，`stickerDescriptionModel` 是独立可选字段并在 `:80` 单独分派 | `settings.ts:10,61,80` |
| 除 `school_*` 默认 low 之外其余未写强度默认 high | `:32` 是 `default('high')`，`:60` 对 `school_*` 单独 `default('low')` | `settings.ts:32,60` |
| 图库 67 项已就绪、`stickersEnabled=true` | 目录下 **67** 个文件；本地配置为 true | `runtime/data/stickers/qq-market` |
| `dialogueContextVersion 2`、`memoryCapacityVersion 1`、`sharedActivityVersion 1`、`environmentPlanningVersion 1`、`modelContractVersion 1` 并列而不混同 | §3 的版本表与代码里的字段一一对应；并明确"文档号 0.5 不是要求把数字统一改成 0.5" | 实现对应 §3 |
| REVIEW24 修复后 106 文件 612 项、typecheck/build 通过 | 测试文件数**实测 106**；`bf59782` 确实改了 `chat-upgrade.ts`／`dialogue-upgrade.ts`／`index.ts`／`activity-context.ts` 等 | `bf59782`、`records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md` |

另外三处"如实标记未启用"我也确认了：`webSearch=false`（供应商未装配）、`semantic=null`（语义查询关闭）、新图描述未在线验收——这三条都是当前真实状态，没有被写小也没有被写成已通过。

## 2. 结构上的两处做法值得保留

**总架构与实现对应的分工。** 总架构只讲职责、规则、机制与流程，把源码路径、配置键、版本号和验证证据全部推给实现对应文档（总架构开头就写了这句），实现对应再用 §6 的"用户概括与真实行为的差异"表把口语化的说法与实现对齐。这样将来改代码时只需同步一份技术映射，不必在两处同时维护同一组数字——**这正是前面几轮反复出现"文档说 A、代码是 B"的根因，这个结构从源头上减少了它。**

**`docs/DOCUMENT_AUDIT.md` 只留导航、完整索引只在新位置维护**（对照整理记录 §2），并且明确"历史文件只调整受影响导航，不重写原决策或证据；DSH-review 快照与用户未跟踪审查资料保持原样"。链接检查也写了方法（101 份文档、583 个本地链接无新增失效、36 个明确源码路径均存在），并把"这一轮不重跑业务测试、不把 612 项说成本次文档核对测出来的"写在了明处。

## 3. 一处我给用户的实操提示（不是文档问题）

实现对应 §5 写"`recentDialogueSegments`／`dialogueIdleMinutes` 本地已明确配置"，并写明 `sharedIdleSeconds`／`sharedMaxSteps` 省略时由 Schema 补默认。这与代码一致（`settings.ts` 的默认与 `config.local.json` 的实际值我核对过）。

但要提醒一句**运维后果**：`dialogueIdleMinutes` 现在属于"建档时记录进 `chat_index_metadata` 的参数"，改了之后需要走 REVIEW24 新加的 `--rebuild-chat-index`（停服＋备份）才能生效，而不是改配置重启即可。文档在 `records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md` 与实现对应 §8 都写了这条，但建议在 §5 的参数表里也带一句——那张表是最容易被当成"改了就行"的地方。

## 4. 上下文／表达／搜索／恢复四份文档的专项审核

它逐条对照后结论是"与 `bf59782` 吻合度很高"，**没有任何一处需要回改代码**，只有两处**低危矛盾**建议改文档。我逐条核实过它的证据。

### 4.1〈建议改文档〉`CONTEXT.md:9` 的"各阶段有独立提示和模型连接"

真实情况是：`modelRoles` 恰好 12 项，**没有 `memory_audit`**（`settings.ts:10`），固定信息审核的任务名是 `memory_consolidation`，**只换提示**：

```ts
// contracts.ts:156
return {name:'memory_consolidation',prompt:kind==='audit'?prompts.memory_audit:prompts.memory_consolidation,…}
```

所以"各阶段独立连接"这句话对审核阶段不成立。**影响有限**（同一目录的 `MAP:69` 与根 `README.md:68` 都正确写了"复用 `memory_consolidation` 连接"），但 CONTEXT 是被建议第 6 个读的文档，读到这里容易建立一个错误的连接表印象。建议改成"各阶段有独立提示；连接按连接键复用，审核阶段复用 `memory_consolidation`"。

### 4.2〈建议改文档〉语义跳过的原因漏列两项

`CONTEXT.md:72` 与 `MEMORY.md:71` 写的是"语义未标定、空查询或无兼容候选"，而 `retrieval.ts:34` 实际有**五种**：

```ts
const reason = !this.index ? 'no_index'
  : !request.query.trim() ? 'empty_query'
  : !calibrated ? 'uncalibrated'
  : threshold!.configSignature !== this.index.configSignature ? 'signature_mismatch'
  : !compatible ? 'no_compatible_candidate' : null;
```

漏的是 `no_index` 与 **`signature_mismatch`**。后者值得写进去，因为它是一个**换了端点或模型但标定签名未更新**时会静默跳过的路径——当前 `calibration.semantic=null` 使实际影响为零，但将来标定完成后，"换了模型却忘了重标"就会表现为语义检索悄悄不工作。建议把五条原因列全，并点明 `signature_mismatch` 的含义。

### 4.3〈表述收紧·无实际后果〉`RECOVERY.md:25` 的"status 只查看状态"

它指出 `hdsi.status` 的调用链里确实有写入：`host/runtime.ts:101` → `nextDeadline`（`runtime.ts:79-84`）→ `host/scheduler.ts:89` → `scheduler.ts:43-44` 事务内 `refreshSharedStep` → `host/shared.ts:52-56` 写 `tasks['scene:<id>']` 与 `character.scene.shared.nextStepAt`。

**但文档的两个具体保证仍然成立**：不推进剧情、不刷新自主周期，写入的是锚定已确认事件的**幂等投影刷新**。所以这是"措辞不够严谨"而不是矛盾。建议把"只查看"改成"只读取状态并刷新既有投影，不推进剧情、不重排自主"。

### 4.4 其余六处可改进（我确认）

- **`WEB:7`／`CONTEXT:82` 的"未接入"应区分两层**：服务其实**已装配**（`index.ts:77` 调 `assembleWeb`，无 provider → `web/provider.ts:6-10`），每个模型任务都会建会话行（`web/phases.ts:6` → `service.ts:16-20` → `store.ts:16-22`），只是 `available=false` 让工具不暴露（`client.ts:45-46`）。写"未接入"容易被读成"这段代码没跑"。
- **`WEB:15` 的"只用已可见资料构造查询……不泄露未读输入"只是提示层保证**：程序侧只保证**送入阶段**的资料可见（`app.ts:118,155`、`organize.ts:24`），而查询文本是**模型自己写的**并原样发出（`client.ts:66` → `service.ts:36`），约束在 `prompt-policy.ts:25`。这条我上一轮在"程序边界 vs 提示边界"上踩过同样的坑，文档写清"程序保证送入资料可见，查询措辞由提示约束"更准。
- **`EXPRESSION:27` 给了 5% 期望频率但没给公式与上限**：`probability.ts:2-9` 是 `min(1, p0+step*misses)`，`p0=0.025`、`step=0.00177786838251657`，上限 100%。建议四份文档遇到这类常数时统一加一句"见实现对应 §5"。（它复算的期望频率正好 0.050000，与我核对的一致。）
- **`EXPRESSION:21` 的"可见长度"没有定义**：实际是 `qq.ts:3` 的**去空白字素计数**（`Intl.Segmenter` + `replace(/\s/gu,'')`），不是 `string.length`。建议写明，否则"1～25 字"会被按码元理解。
- **`RECOVERY` 未覆盖"停止"**：只有 `index.ts:124` → `host/runtime.ts:108-113`（dispose 时置 stopped、清定时器、等前台轮与 `maintenance.stop`）。建议补一小段，因为"停止时正在发送/正在整理怎么办"是运维会问的。
- **`CONTEXT:84` 的"没有记忆条数配额"易与容量池混淆**：`settings.ts:40` 的容量是 100／1000／500，而这里说的是"注入配额"。建议加一句指引区分。

## 5. 记忆与共同活动两份文档的专项审核

两路审计都确认多数条款逐行可对上（7／90／3／30、100／1000／500／90 含预备、两套排序中重要度分别居第一与第三、退出与到期的 OR、15 分钟闸门与刷新源、单槽／20 批／索引豁免、四段与活动零占位、关闭段仍在窗口）。**但发现一处硬矛盾，且我核实其触发链可达**。

### 5.5〈代码缺陷·建议优先修〉合并会把归档记忆复活，而文档承诺不会

**文档承诺**（`MEMORY.md:57`）："归档记忆必须先经真实重谈显式恢复活跃，再考虑晋升。**后台不能靠整理自动恢复或跳过归档规则**。"

**代码实际**（`lifecycle.ts:99-101`）：

```ts
const live=unique.filter(r=>!archiveStart(r,mergeAt)), …
archiveEnteredAt: live.length?null:anchors[0]??null,
capacityExitedAt: live.length?null:…
```

合并时只要**有任何一个成员还活着**，合并后的主身份就把 `archiveEnteredAt` 与 `capacityExitedAt` 一并置为 `null`——**被合并进来的归档内容重新成为可检索的活跃记忆**；`:107-108` 还把归档成员的唤醒记录**搬到主身份**，于是那些日期也进入 30 天晋升基数（`capacity.ts:13` 的 `promotionEligible` 只看 `status==='active' && totalAwakenings>=30 && !isArchived`）。

**触发链可达**：`capacity.ts:64` 在长期因容量退出时调 `queueDirty(r,'capacity',now)` → 该行进入增量待办 → 维护快照包含它 → 模型对"归档行＋活跃行"发 `merge`（合同只要求 ≥2 个 long，`contracts.ts:176`，不排除归档）→ 合并即复活。**这不是理论边界，而是容量压力下自然会出现的一条路径**，而且它正好绕过 REVIEW17 §4.4 已经确认的那条规则（"必须先真实重谈恢复活跃，再允许晋升"）——当时修的是 `promote`，`merge` 这条旁路还在。

**测试把这个行为固定成了断言**（最值得注意的一点）：`tests/memory-idle-consolidation.test.ts:30` 的用例名是 `merge_does_not_awaken_or_restore_archive`，而 `:33` 断言

```ts
d.life.merge(['a','c'],'a',days(110));
expect(d.store.canonical('a')).toMatchObject({archiveEnteredAt:null, …});
```

**名字说"不恢复归档"，断言却要求 `archiveEnteredAt:null`（即确实恢复了）**，只保证了不产生 awaken／reactivate grant。将来靠测试名检索会以为这条规则有保障。

**修法建议（我倾向第二条）**：**A** 让合并后的归档状态取"**全部成员都归档才归档**"（`live.length===unique.length?null:最早锚点`），使合并只能把归档并入活跃、不会把活跃拉回归档；**B（更彻底）** 既然归档行本就"已退出日常检索"，就不该作为维护增量候选——在 `queueDirty` 之后或 `makeJob` 选候选时排除已归档行，并在 `merge`／`merge_short` 合同里拒绝含 `archiveStart!==null` 成员的单元。**无论选哪条，都要同时修正那个用例名或断言**，别留下一个反向固定的测试。

### 5.6〈与文档不符〉预备期"顺延生效时刻"的触发条件在 create 路径不一致

`MEMORY.md:43` 说"**真实新进展**发生在预备期，可把生效时刻顺延到新的短期截止"。更新路径确实要求 `hasNewEventProgress`（`lifecycle.ts:52-54`），但 **create 路径只判断 `at<long.retainedFrom`**（`lifecycle.ts:38`），不要求任何新进展——而 `ShortCreate` 里根本没有 `hasNewEventProgress` 字段可判（`types.ts:53`，对比 `ShortUpdate` 的 `:54`）。后果：预备期内任何带 `existingLongId` 的 create 都会顺延生效时刻并**改写 initial grant**（即"重谈／改写也顺延"）。现有测试只用"已生效的 high 重要度长期"（`memory-v3-lifecycle.test.ts:31-35`），没覆盖这条路径。建议要么在 create 路径补同样条件，要么在文档里把 create 的口径写明。

### 5.7 其余八处可改进（我确认）

其中四处值得单独提：**两套"15 分钟"措辞相同易被读成矛盾**——`MEMORY.md:85` 的"刷新"指记忆整理锚点（活动消息确实刷新，`input.ts:26` 在【推进】分支之前），`SHARED_ACTIVITY.md:75` 的"不刷新"指普通聊天段锚点（`chat-episodes.ts:14`），建议各带主语；同理 `S:59` 的"活动原文"与 `M:81` 的"结束仍未读的活动消息"是两个集合（本场已授权原文 vs 结束后转入普通批的积压输入）。**`SHARED_ACTIVITY` 全文没提 `scene_step`／"每活动一个场景任务"**（`shared.ts:17,48-55,103`、`contracts.ts:108,113`），这是实现者最容易踩的活动机制之一。**活动期间仍可能插入环境轮**（`scheduler.ts:30-33` 无 `hasValidSharedScene` 守卫；对比学校通知在 `school/notices.ts:23` 明确拒绝），所以"活动节点不跳过"包含被环境轮串行占用的时间。**容量归一有两条路径**：段 B 的 `recovery.ts:85` 用默认 `changeBudget=Infinity`（一次事务可退出任意多条），后台清理是 `cleanup.ts:33` 的 `normalize(now,[],1)`（每次一条），文档只写了后者。

另外：`temporaryProtectedIds` 全仓无消费者（死输出）；`M:85` 未列"不刷新锚点"的情形（环境轮与后台应用／清理都不写 `memoryIdle`）；`M:75` 的 15 分钟是**建档参数**（`storage.ts:41` 写 `chat_index_metadata`，不匹配即拒绝启动，需 `--rebuild-chat-index`）；`800 字符`与`30 条`是已删除上限的历史数字，出现在否定句里但无历史标记。

## 6. 总架构、导演与调度三份文档的专项审核

它的结论是"除一条外逐条吻合"。**那条值得优先修，因为它会让人去找一个不存在的东西**：

### 6.1〈建议改文档〉"争取 07:00 前完成"没有任何代码落点

`DIRECTORS.md:23` 与 `MAP:99` 都写了"06:00 开始，**争取 07:00 前完成**"。但全仓 `src/` 里 **grep `07:00` 零命中**——只有旧 V0.4 设计与过程记录，以及 `tests/scheduler.test.ts:63` 一个无关时刻。真实存在的常量只有 `settings.ts:57` 的 `environmentDailyAt` 与 `environment/types.ts:3` 的四步顺序；**07:00 不是配置项、不是校验、也不是提示词内容**。

我理解它来自 V0.4 方案里"期望完成时刻，不是硬截止"的表述，作为意图描述没错；但写在 V0.5 的现行说明里，读者会去找这个时限在哪里实现。建议改成"06:00 开始，按顺序串行推进；没有硬性完成时刻，迟到批次在可用空档继续"，或明确标注"这是运行目标、无程序常量承载"。

### 6.2〈建议改文档〉版本清单漏了承载双路径的 `dialogueWindowVersion`

`MAP:54-63` 的"版本不能混同"表列了 8 个版本，**唯独没有 `dialogueWindowVersion`**——而它正是每轮记录 `1|2`、决定"走 v2 独立普通索引还是 v1 旧混合窗口"的字段（`app.ts:51`、`types.ts:95`、`recovery.ts:16,46,61`、`window-consistency.ts:25`）。文档只在 `MAP:62`／`:167` 用"普通窗口版本／按轮的窗口版本"暗示。**照文档实现会漏掉 V1/V2 双路径恢复**，而那张表的标题恰好是"版本不能混同"。建议给表加一行。

### 6.3〈建议改文档〉配置面只给中文标签，且缺关键键

`MAP:93-109` 的参数表好几行只写中文标签不给键名（容量 → `memory.capacity.*`；深度空闲／睡眠后台 → `memory.idleMaintenanceMinutes`／`maintenanceDuringSleep`；人工预算／检索条数 → `historyBudget` + `memory.contextLimits.*`）。更关键的是 **`timezone`、插件 Config（`botId`／`userId`／`databasePath`／`storyConfigPath`）、`backgroundFile`／`backgroundViewsFile`、`initial*`、`chatExamples`／`worldSetting`／`schoolSetting`、`cacheSize`／`cacheTtlMs` 在 v0.5 各文档里完全没有出现**，根 `README.md` 也没列全。结论是：**只凭文档无法配置一个新部署**。这与上一路审计提的"参数表要能落到键名"是同一件事，值得合并处理。

### 6.4 其余三处（我确认）

- **`stickersEnabled` 那行把本地值写得像默认**：`MAP:109` 写"true"，而 Schema 默认是 `false`（`settings.ts:58`），当前为 true 是因为 `config.local.json` 显式打开了。建议标注"本地显式开启"。
- **`school_campus` 提示词硬编码"角色是 25 岁在读研究生"**（`model/prompts.ts:25`），与 `DIRECTORS.md:45`"按已批准的角色背景延续…身份"的口径不一致。我按只读边界没有读私有背景，无法判断是否真矛盾——**但无论如何，把人物身份硬编码进提示词、同时又声称身份来自作者背景，是个应该收敛的点**：身份应由背景映射提供，提示词只写"按提供的身份资料"。
- **每日 04:30 的过期队列扫描已实现但文档未提**，且硬编码 `Asia/Shanghai`（`storage.ts:43`、`memory/maintenance.ts:64,71`），与 `DIRECTORS.md:23` 强调的"故事时区"不一致。这属于既有实现，不是本轮引入，但既然文档要讲时区，就该说明这一处是固定的。

另外它核对到：`environment/runtime.ts:10` 给 `school_week` 传了 `appointments` 而 `schoolWeekTextInput` 不使用（死字段）；`MAP` 引用的 32 个 `tests/*.ts` 与 41 个源码路径全部存在；`bf59782..HEAD` 的 `src/`／`package.json`／`runtime` 差异为空，所以"代码基线 `bf59782`"在 HEAD 上成立——这几点我都认可。

## 7. 一处数字自查

两路审计都核对了一个我没查的细节：README §3 与交付记录里写的"**任务13～20 过程目录保留 55 份工作树记录**"，而该目录现在是 64 个平铺文件（其中 47 个带 `task*` 前缀）。这是**历史声明与当前目录状态不一致**，不影响产品，但建议改成"过程目录保留全部工作树记录（数量随追加变化）"，避免以后每次有人数一遍都对不上。

## 8. 本次复核的边界

**没有做**：运行测试、构建、demo 或 `--check`；连接模型或 QQ；读取正式库正文；修改任何文件。私有配置只读了非认证字段（模型强度、开关、窗口参数）。

**因此无法验证**：106 文件 / 612 项测试的实际通过情况（只读了日志与静态文件数）；两场真实活动验收（35 次 HTTP）的输出内容；正式库的实际状态（文档说窗口 2、完整性正常，我未打开库）；以及人物风格与故事的语义质量——README §4 已明确这需要你另行决定是否提供背景，我认可这个边界。

**给用户的一句话**：这套文档可以放心作为当前唯一入口；我核对过的数字**没有一个对不上**。唯一建议补的是 §5 参数表里加一句"改 `dialogueIdleMinutes` 需要走显式重建"，免得它被当成"改配置重启就行"。
