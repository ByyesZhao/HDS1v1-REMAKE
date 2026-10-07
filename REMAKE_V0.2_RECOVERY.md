# HDSI V0.2：阶段回退与中断恢复

状态：2026-10-07已更新记忆V0.3恢复规则，最新验收见记忆实施记录；真实QQ与完整故事路径待联调。本文不将普通事务测试视为物理断电或真实平台发送验收。

返回 [总架构](REMAKE_V0.2.md)；配套 [实施细化与开发记录](REMAKE_V0.2_IMPLEMENTATION.md)、[实施记录](docs/IMPLEMENTATION_LOG.md)。记录字段见[接口、存储与代码组织](REMAKE_V0.2_INTERFACES.md)，输入合批与发送间隔见[生活方案](REMAKE_V0.2_LIFE.md)。

## 1. 当前恢复合同与启动条件

实现从本机成功保存输入开始提供以下恢复行为：

- 输入先落库，生成尚未完成或整稿尚未尝试发送时，可以从保存的输入重做。
- 发送前冻结候选、完整清单和后处理待办；有任何发送尝试后保持冻结稿。
- 输出逐项确认，恢复跳过已确认项目，对未确认项沿用原稿续发。
- 输出完成后只续办整理和提交；正式故事效果与回合完成标记同事务写入，完成后不重复应用。
- 不查询 QQ 是否已经收到了未知项。恢复入口执行时重发该项并继续，接受未知项可能重复。

“自动续发”有明确运行条件。`runtime.paused` 持久化保存：进程意外退出前若为 false，启动的 SerialHost 先续办未完成回合；运行中的模型、发送或后处理抛错会保存 paused=true 和 lastError。暂停不会因重启自动解除，用户须执行 `hdsi.resume`。代码没有持续网络重试或自动解除暂停的后台机制。

恢复不保证找回尚未交到插件或尚未落库的消息；已经送到 QQ 的内容不能靠数据库回滚撤销。“回退”是丢弃未提交候选或续办阶段，不是把正式故事倒回过去。当前保证以单个本地数据库及串行故事进程为前提，实机确认范围见第 5 节。

## 2. 段 A：接收、生成、冻结、发送

### 输入先保存

Koishi 中间件只接收绑定机器人与用户的私聊，提取并拼接 text 元素。纯图片／语音等没有有效文字的输入忽略；当前没有保存完整平台消息对象。`hdsi.status / pause / resume` 管理命令绕过故事输入。

InputBuffer 在同一事务先结算已到期的 openBatch，再保存提取文字、receivedAt、平台消息 ID、batchId 和新的 `runtime.openBatch.readyAt = receivedAt + 15 秒`。消息通过 batchId 关联，闭合批次 ID 进入 pendingBatchIds；不存在单独的批次历史表或 messages 副本列表。

旧回合处理中，新消息继续落库：不加入旧轮已经选定的闭合批次，但可继续加入当前尚未过期的新批次。开始故事回合时保存 turn ID、选定 inputMessageIds、triggerTaskIds、triggerKinds、batchIds、entryMode 和环境种类。没有用户输入的自主、预约、共同节点或环境回合也具有 turn ID。

重启按已存 readyAt 继续剩余等待，已到期批次不重新等 15 秒。睡眠或不可接收时保留未读消息；从待处理批次队列移除并不等于已看。已看状态由 messages.seenTurnId 表示，只有实际可见消息在段 B 更新它。

### 生成只改工作区

generateTurn 克隆角色状态，在工作区计算叙事、个人选择、表达、经历、任务和概率候选。尚未提交时，不把新情绪、体力、计划、消息已看或概率计数写成正式故事效果。

尚未尝试发送就退出，可丢弃未公开稿和随机结果，沿用回合 ID、选定消息／任务引用和原消息 receivedAt，以恢复时的当前时间更新 TurnRecord.at 及 entryMode 后重新生成。它不重新把新收到的输入塞入这个旧轮。已有任一发送尝试则保持冻结 at、输入引用、表达稿和候选，不重新抽样或重新判定本轮共同场景可见性。

恢复时若当前仍睡眠且旧稿从未尝试，会生成没有 narrative、personal、expression、经历或输出的睡眠控制候选，清自主周期，保留未读及未完成预约；不推进 narratedUntil。已有发送尝试的旧稿遵循冻结续发规则，不因后来进入睡眠而改写稿件。

### 完整冻结后才发送

freezeTurn 用一次短事务保存：

1. TurnRecord.frozenResult 中的 TurnCandidate：模型结果、可见／重新考虑消息 ID、经历、下一状态、任务变化、完成任务 ID、概率、自主间隔及环境变化。
2. 全部 OutboxItem，按 seq 排序，保存最终文字／裸动作／素材 ID；首项 notBefore 设为当前时间，其余待上一项确认后设置。
3. PostJob `{ turnId, result: null }`。

frozenResult 在程序中是对象，Storage 统一将整条记录序列化为 JSON TEXT，并非该字段本身另存一层字符串 JSON。没有输出时，冻结事务直接置 outputComplete=true；不等待不存在的发送成功。公开剧情与角色反应也一起生成并冻结后，再按顺序展示。

冻结的是素材 ID，不是图片字节快照。发送图片时从 stickers 当前路径读取文件，因此恢复前须保留相应素材文件与 ID 映射；不能宣称数据库冻结保证图片文件内容不变。

### 逐项发送与确认

Sender 的接口为 `sendItem(item): Promise<{ platformMessageIds: string[] }>`。恢复发送器每项先等待 notBefore 的剩余时间，再在数据库保存 sending，然后调用平台。当前 Koishi 实现调用 sendPrivateMessage；返回非空 ID 数组才确认成功。

```text
等待剩余间隔 → 保存 sending → 调用 QQ
→ 同事务保存 confirmed、平台 ID、实际输出记录及下一截止／输出完成
```

明确失败、返回空 ID 或调用结果不明时，该项保存 retry 并抛错，不退回表示从未尝试的 pending。回合执行入口随后持久化暂停；只有符合第 1 节条件的恢复入口运行后，才继续发送。恢复入口先把遗留 sending 改为 retry，逐项跳过 confirmed，未确认项重发时再次保存 sending。

例：第一项 confirmed、第二项 retry、第三项 pending。用户解除持久化暂停后，恢复跳过第一项、重发第二项，确认后再发第三项；只有第二项可能重复。若是进程意外中止留下 sending 且 paused=false，重新启动执行同样流程。无 QQ 送达查询、幂等键或持续重试器。

每次确认事务同时保存实际 outgoing 消息：旁白和动作使用展示包装，素材保存 `[表情素材:ID]` 占位文本，并保留平台 ID、确认时间、turnId/outboxSeq。系统 error 通知不经过这一故事消息记录路径。

上一项确认时，同时保存下一项 notBefore，按下一角色段裸正文的字素数计算；旁白和素材本身不增加等待，首个角色短段无额外等待。重启只等剩余间隔，已到期可继续。最后一项确认与 outputComplete=true 在同一事务保存，避免确认完最后一项却丢失后处理入口。

## 3. 段 B：整理与一次提交

### 整理输入与结果

普通叙事回合的记忆模型在事务外运行，输入由冻结及已确认记录重建：experiences、visibleMessages、reconsiderMessages、outgoing、候选 plan/taskChanges（arrangementsAndIntent），以及当前加载的背景、检索细节和长期记忆。它不直接收到整个个人导演结果或完整 nextState，也不是冻结了全部部署配置和模型上下文的快照。

实际 outgoing 包括已确认旁白、文字、动作和素材占位；首次可见输入、经历及 outgoing 的 ID 才可作为本轮新来源。重新考虑的旧消息和 retrieved 用于理解，不因再次出现就自动加强。是否真实发生、是否只是计划等语义由记忆提示要求约束；程序检查来源 ID 和旧记忆 ID 的范围，V0.3按(canonicalMemoryId,localDate)去重，同日只补来源。

PostJob.result=null 才重新整理；完整空结果 `{ schemaVersion: 3, shortTermChanges: [], longTermChanges: [], detailChanges: [] }` 也是可复用结果。环境回合以及没有 narrative 的睡眠控制回合直接保存该空结果，不调用记忆模型。普通沉默但有 narrative 的回合仍可整理记忆。

整理结果先保存到 post_jobs，随后才进入提交事务。整理中断且未保存完整结果时重做整理，已保存则复用；都不重跑叙事、个人或表达，也不重发已完成输出。情绪、体力、计划、概率和任务使用段 A 的候选，不在后处理中重新推理或抽样。

### 同库提交

finishPostprocessing 再次检查 done，使用同一个 DatabaseSync 连接和同步事务提交：

1. 普通故事的短期／长期记忆、固定细节及独立 detail_history；新经历。
2. 普通故事的 nextState，包括情绪、体力、场景、文字计划、睡眠和 narratedUntil；必要时安排下一自主周期。
3. 任务变化和默认完成状态；可见消息 seenTurnId；从 runtime.pendingBatchIds 移除本轮 batchIds；保存概率计数。
4. 环境事件变更，以及环境回合相应的下一执行时间。
5. turns.done=true、completedAt，并清空 frozenResult。

没有独立的消息 processed 布尔值，也没有 PostJob.done。输入是否已看由 seenTurnId 判断；批次是否还在待处理队列由 runtime 及 TurnRecord 的关联判断。PostJob 是否可执行由回合 outputComplete && !done 决定，其完整 result 在完成后继续保存。

任务有显式 update/cancel 时优先于本轮默认完成：update 合并旧字段并保持 pending，cancel 保存 cancelled；没有显式变化的已处理到期任务才置 completed。延后回复保存已看消息 ID 与意图，不把消息改回未看。

普通故事将冻结自主间隔加在本次 completedAt 上；若提交时已进入睡眠，则清 nextAutonomousAt。环境回合不替换 character、不推进 narratedUntil、不应用普通记忆；仅提交环境变化、运行时及完成记录，下次环境截止按 completedAt 重新计算，候选 nextEnvironmentAt 不直接作为提交值。

完成标记不能另用一次事务保存。事务未提交而中断时，正式效果与 done 均不应部分生效；提交成功后，恢复依据 done 跳过。frozenResult 与完成标记同事务变更，原始输入、已确认消息、outbox 和 PostJob.result 保留。短期／长期新记录及细节历史的稳定 ID 含 turn ID 和各自索引，不用一条消息 ID 为全部记忆去重。

### SQLite 与持久化范围

当前采用 Node 内置 node:sqlite，单连接、WAL、synchronous=FULL；Storage.transaction 使用同步 BEGIN IMMEDIATE/COMMIT，回调抛错时 ROLLBACK。state 表为 key/data，原十一张业务表为id/data，另有六张记忆辅助表；普通JSON业务表为id/data，JSON TEXT 保存对象；不存在待选型的 Koishi 故事数据库适配层。网络、模型、发送和等待均在事务外。

普通正常关闭重开、同步事务回滚及 WAL/FULL 参数已有自动测试。尚未进行硬件断电、磁盘缓存故障或段 B 每个写入位置的强杀实验；不能把这些普通测试表述成物理断电验收。原子事务是当前代码提供的恢复基础，真实硬件持久性和平台确认仍在验证边界之外。

同一故事串行：旧轮发送和后处理完成前不启动新故事轮，期间仍立即保存新输入。不实现跨进程多写入者；同进程异步维护按stateVersion readSet拒绝冲突单元，索引按revision／签名校验。

## 4. 根据已有记录选择恢复动作

SerialHost 在持久化 paused=false 时才进入恢复与新轮调度；paused=true 时只保存／合批输入，等待 hdsi.resume。下表描述恢复入口已经获准运行后的动作。

| 保存情况 | 当前恢复动作 |
| --- | --- |
| 输入已存，但还没有 TurnRecord | 等合批及接收条件，由调度器选择新轮 |
| 已有未完成 TurnRecord，但未完成生成 | 同 ID，以当前时间重做，保留原选定输入／任务引用 |
| 冻结稿已存、输出未完成、全部项目 pending | 同事务清空候选、删除 outbox 与 post_jobs，更新 at/entryMode，再生成 |
| 任意项目已有发送尝试 | 保留候选；sending 转 retry；跳过 confirmed，按顺序重发未确认项 |
| outputComplete=true，done=false | 复用已有整理结果或重新整理，再只提交段 B |
| done=true | 跳过，不重复发送或加强记忆 |

无输出回合冻结时已经 outputComplete=true，直接进入段 B，不误判为可丢弃未发送整稿。恢复判断以数据库为准，不凭临时文件或旧稿是否存在猜测完成。恢复旧轮后，再选择排队消息和当前到期安排；不按关机错过的每个自主周期补发主动消息。

### 睡眠与环境调度顺序

启动先恢复未完成旧轮。选择新轮时，调度器先处理到期世界更新，再处理到期学校更新，随后才选择起床、输入、自主及任务的合并故事轮。因此“先起床”仅描述个人故事的起床处理，不是高于旧轮恢复和环境更新的全局优先级。

睡眠区间生效时，调度器保存 nextAutonomousAt=null，并把已闭合输入留为未读，预约保持 pending；到期世界／学校仍可更新，不运行个人导演。起床回合统一处理到期预约及已合批输入，并重新安排周期。尚未合批的新输入继续等待自己的截止。

睡眠中恢复未尝试旧稿会走无模型、无输出控制提交；恢复已经尝试的旧稿仍续原输出。以上两类不能混写为“睡眠时所有恢复都不发送”。入睡边界终止周期不需要个人导演；活动预计结束通过检查消息任务参与调度，没有无条件独立 activity 回合。

### 错误、暂停与人工恢复

回合执行中的模型、QQ 发送或后处理错误会保存 paused=true/lastError，并尽力发送系统 error；通知失败被吞下以保留原阶段。错误不是角色发言，不进入故事记忆。Koishi 和 QQ 连接继续运行；插件初始化失败等尚未进入回合的错误不属于这条恢复处理路径。

格式错误使用 ModelClient 的有限修补：默认首次加最多两次修补，每次请求完整任务 JSON，不保证自由文本逐字不变；同一任务最多另有一次本地 lookupDetails 续调。它们沿用同一模型／推理强度，不是持续网络重试机制。详细字段及异常边界见[接口文档第 12 节](REMAKE_V0.2_INTERFACES.md#12-模型调用本地查询与格式修补)。

当前已实现三条目标私聊命令：

- `hdsi.status`：返回运行／暂停、生成／发送／后处理／空闲阶段及下次调度时间。
- `hdsi.pause`：持久化暂停，阻止新轮；已运行的正常回合继续完成，输入继续保存与合批。
- `hdsi.resume`：清除 paused/lastError，先续办未完成阶段，再处理已有队列和到期任务。

命令与命令回复不进入故事消息记录。正常stop清理定时器，立即发起maintenance.stop／Abort，同时等待前台active和后台收尾完成，随后关闭数据库；暂停不等于终止进程，也不取消正在执行的模型或网络请求。

## 5. 当前数据与验收范围

新故事使用独立 SQLite 库，包含 state、messages、turns、outbox、post_jobs、tasks、details、detail_history、memories、events、experiences、stickers。没有依赖旧项目数据库或迁移旧聊天记忆；已有素材导入和兼容检查是独立部署步骤，不能当作故事记忆迁移。

原V0.2基线有78项离线测试，以下保留原恢复覆盖；V0.3新增证据见记忆实施记录。固定模型与模拟发送不代表真实QQ／完整故事验收。

| 文件 | 已覆盖内容 |
| --- | --- |
| tests/recovery.test.ts | 有序发送及等待、同 ID 按恢复时间重做未尝试稿、保留已尝试稿、跳过 confirmed 并续发 retry、复用整理结果、完成后不重复加强、沉默提交、睡眠中重做无模型控制轮 |
| tests/integration.test.ts | 忙时保存新输入并等待其独立静默截止；暂停保存输入及恢复队列 |
| tests/storage.test.ts | 正常关闭重开、主动抛错回滚、WAL/FULL 参数 |
| tests/review-recovery.test.ts | 完整冻结清单与 post job、静默冻结即 outputComplete、post job 写失败时三表回滚、同文件关闭重开后 sending → retry 续发且不重发 confirmed、真实睡眠闭合批次起床交付、多批检查及暂停合批 |
| tests/review-fixes.test.ts | 整理独立预算及排序、空别名保留、本轮来源非空、个人检查最终时间约束与合法到期/取消路径 |
| tests/input.test.ts | 末条消息后静默 15 秒；忙时新输入先结算过期批次 |
| tests/scheduler.test.ts / tests/tasks.test.ts | 睡眠结束周期、起床处理预约、不可接收暂存、延后回复与显式改期 |
| tests/environment.test.ts | 环境增量更新、睡眠时环境任务不运行个人导演或推进故事时间 |
| tests/model-settings.test.ts / tests/turn.test.ts / tests/memory.test.ts | 逐任务模型与强度传输、独立 Pro、同任务 lookup 续调与修补、最多两次格式修补、控制字段校验及本地查询 |

仍待验证：真实 QQ 返回 ID 与确认语义、SnowLuma 连接及用户手动启动后的实际收发、完整四条故事路径、硬件断电与完整退出位置实验。新增冻结失败注入和同文件关闭重开属于受控离线测试，不是实际强杀／断电，也不等于对段 B 所有写入点做过中断注入。

当前没有平台发送查询／幂等去重、跨进程版本冲突处理或全面退出位置故障矩阵；这些不是已经交付的能力。已有 sending/retry 状态、启动调度和三条人工管理命令不再属于“稍后实现”。

## 6. V0.3后台恢复补充

准备结果和逐单元标记持久化，computing重开退pending、ready不重调模型、已应用单元不重写。每个单元正文／来源／grant／索引待办／标记同事务；stale仅作废本单元，合格内容新job重准备。维护失败或容量错误只记retryAt／后台错误，不设全局paused；前台容量错误保留未完成轮且暂停，不缩小重发。post job另保存短期clientRef映射及程序self_web_read来源，详见记忆实施记录。


## 搜索离线核心落地（2026-10-07）

进程内唯一WebSearchService及四辅助表web_sessions/web_operations/web_materials/self_web_read_sources已接入。全部十一类任务独立run身份，阶段输入、补查、修补和工具请求检查点私有；公开正文缓存按owner释放，数据库材料保留恢复。同阶段重放计0，跨阶段首次取得各计1。正文响应成功后、最终parse前登记实际提供；personal_life的稳定来源及首次operationId进入post job。环境合同在最终parse读取providedUrls。后台共用既有120秒准备槽／signal，不阻塞前台，stop取消后不保存晚结果。

真实provider未配置，webSearch.enabled=false；当前未联网，待选服务后注入provider。网页无人工字符预算或12000截断，真实容量错误不删内容重试。来源语义、表达不新增事实和查阅不变亲历仍由任务提示约束，程序不冒称能判断散文真假。

证据：[搜索实施记录](docs/WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md)、[审核交付入口](docs/IMPLEMENTATION_HANDOFF_20261007.md)。


## 第七轮审核修正同步（2026-10-07）

当前记忆owner不保存／回传action、clientRef、existingLongId、hasNewEventProgress；happenedAt与可选happenedUntil保留已知事件时间范围，lastEventUpdateAt独立。archive及lookup不提前暴露预备长期。维护应用异常整笔回滚后保留ready结果、五分钟再应用，其他待办和聊天可继续。搜索不注入webSources或用其兜底，结果不足保存并向原阶段模型反馈“结果不足”，角色可自然询问用户；20／40及缓存B不变。最终42文件200项回归、类型／构建／离线加载／启动检查通过，独立复核未发现实质问题。详细依据与记录见docs/REVIEW7_FIX_IMPLEMENTATION_20261007.md及四份V0.3权威规范。
