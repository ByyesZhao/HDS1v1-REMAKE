# 共同活动 V0.3 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 按任务逐项实施。本计划推荐在当前会话顺序执行，任务共享活动身份、时钟与恢复接口；如用户另选代理协作，再使用 `superpowers:subagent-driven-development`。步骤采用复选框跟踪。

**Goal:** 实现共同活动的手动推进、双方静默60秒推进、普通活动约10轮自然收尾的提示词软目标及最多20轮硬上限，以及统一的前台空闲自主周期。

**Architecture:** 沿用单故事串行 Host 和既有冻结发送／段 B 事务。新增 shared 辅助模块集中维护计时及唯一 scene_step，输入与发送只更新真实锚点，模型负责剧情与角色选择。已有记忆、搜索模块只延续合同边界，不建立第二套故事系统。

**Tech Stack:** 现有 TypeScript、Node.js 内置 SQLite、Zod、Vitest、Koishi；不新增依赖。版本沿用 package.json，Node >=22.13.0。

**Spec:** [实施细化](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_20261007.md)，同时阅读[方案](SHARED_ACTIVITY_V0.3_PROPOSAL_20261007.md)。字段／时序以细化为准，步骤以本计划为准；第九轮审核及[已接受回应](../../dsh-review/CODEX_REBUTTAL_SHARED_ACTIVITY_PLAN_20261007.md)的修改已并入这两份执行依据，不再要求从审核文件拼接规则。现有源码／根目录架构文档为基线，记忆及搜索的参考范围见细化§1.1，不重新执行已完成任务。

日期：2026-10-07；交付更新：2026-10-08。状态：任务1～7及第十轮修正已实施；正式库已停止备份升级到共同版本1，隔离真实多轮验收执行中。最新状态见[第十轮记录](REVIEW10_FIX_LOG_20261008.md)。实施起点`eaf0b53`，原设计基线`880b6ad`保留为历史。原始RED/GREEN、提交和裁定见[实施日志](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md)。

当前目录已有本地Git：首提交 `880b6ad` 记录于2026-10-07 21:41:57 +08:00。记忆／搜索在初始化Git之前实施，历史检查点以备份及ledger为准；此后任务使用本地提交，不改写旧记录的当时事实。

## Global Constraints

- 普通输入 15 秒合批；共同输入立即保存、等待双方最新输入／确认输出后默认 60 秒；无输出轮以 completedAt 补充锚点；首节点立即。
- 全文精确 `【推进】` 是绑定私聊控制信息，独立持久化；不进 messages、近期原文、未读、记忆来源。活动外固定提示“当前没有共同活动”，不创建故事触发；wake仍可处理独立到期工作。全文是原顺序text拼接trim，非text沿用既有未支持口径。
- 默认最多 20 个成功段 B 共同轮；准备轮不计，首节点计 1，静默轮计；默认 17～19 收束，20 必须公开收尾并 end。失败／恢复不另计。
- 普通活动以约10轮自然收尾为提示词软目标，目标前2～3轮开始收束；共同主叙事和个人导演共用该节奏提示。没有5轮硬下限、不在10轮强制结束，不改变程序phase；已完成／用户要求／角色生活需要可更早结束，复杂活动可更长，仍遵守实际maxSteps及最多20轮。已确认内容与真实时间优先，不能为软目标改换goal或假称完成。小上限活动在其上限内开场收尾，maxSteps=1可同一公开正文兼顾两者。
- 每个实际运行角色 narrative 的前台轮冻结一次 150～210 分钟整数抽样，以成功 completedAt 重排自主；睡眠为 null；后台不重排；不恢复旧截止或累加延期。
- 真实用户动作原文保留；`【动作：…】` 的含义通过共同合同说明，不新增parser。选轮时双方无新输入，程序只给主叙事发送允许代写双方活动动作的分支；有输入则只发送禁止新增用户动作的分支。全部代写公开为`【…】`，不替双方新增台词／心理／活动外承诺；个人导演仍负责角色感受、台词与下一步。
- 代写不能新增用户稳定性格、能力、偏好或关系设定；活动内行动选择及合理结果仍允许，无一轮一两个动作的数量配额。
- outline在opening/ongoing可建立必要线索；已有走向的wrap_up只保留／删除原字符串条目；final的openThreads为空。goal/endingCondition语义稳定依提示词及必做真实多轮验收，不以字符串相等当含义审核。
- 成功公开代写作为共享模拟经历，沿用合法来源和段 B；无已读／在场归属机制，不变成现实用户背景事实。
- 合法共同活动清醒参与，旧睡眠计划不硬阻断；普通睡眠／不可读门禁保留。当前输入、核心背景不因容量错误自动裁剪，无新增人为输入预算。
- 各任务沿用用户确认的独立 Flash 配置和思考强度；原任务修补最多两次；搜索会话各自 20 成功／40 失败，不新增 provider。
- 先完成未完成轮，保留生成中输入／控制请求；一次只一条活动节点，无按离线时长追补和过期定时器空转。
- 环境截止持续参与定时选择；60秒窗口无可运行前台时可运行环境，持续可运行前台时让位到可用空档，不承诺固定最长延迟。
- 测试使用临时 SQLite、假时钟／模型／Sender；不启动 QQ 或 SnowLuma，不发送正式角色背景或密钥。正式升级需停止、备份及检查实际旧活动。

## Review Focus

1. 开始／结束标志已发送而记忆未提交时，紧接的新输入按用户看到的边界接收，推进请求不绑定错误活动（任务 2、5）。
2. 生成、分段发送、后处理期间又来消息／多个推进，旧候选提交保留它们；同到期手动和自动只一轮（任务 3、5）。
3. 活动跨过旧 sleepAt 和 wakeAt，不误睡、不伪起床；结束回普通模式正确清自主或重新计时（任务 3、5）。
4. 双方无人回应仍可推进完；第20轮修补失败不偷清场、不发21轮；成功公开代写能成为共享记忆。目标／结束条件及用户稳定设定不能无依据漂移（任务4、5及任务7登记的必做真实验收）。
5. 重开数据库、无输出轮、过期自主／检查任务及旧活动升级，不重复计数、立即循环、丢控制请求或从零再给 20 轮（任务 1、3、5、6）。

## 文件和接口归属

| 文件 | 改动责任 |
| --- | --- |
| `src/types.ts`、`storage.ts`、`settings.ts`、`config.ts` | 细化 §2 的类型、控制表、配置默认值与快照。 |
| 新 `src/host/shared.ts` | 细化 §5 的六个同步接口，另导出 `hasValidSharedScene(state: CharacterState): boolean`，仅判断合法 shared 字段；版本门禁由装配处理。 |
| `src/host/input.ts`、`runtime.ts`、`src/index.ts` | 输入分类、路由、固定系统反馈、唤醒及串行门禁；入口身份校验保留。 |
| `src/host/scheduler.ts`、`state.ts` | 共同选择、前台优先、节点／自主／睡眠定时资格统一。 |
| `src/model/contracts.ts`、`prompts.ts`、`src/directors/narrative.ts`、`personal.ts` | 走向、显式代写清单、末轮合同及动作／职责提示词。 |
| `src/app.ts`、`recovery.ts`、`src/memory/organize.ts` | 参数传递、冻结、确认边界、段 B 最新状态合并与来源上下文。 |
| 新 `src/deployment/shared-upgrade.ts`、`scripts/migrate-shared-activity.ts` | 只读检查、停止备份、普通旧库初始化及旧活动诊断。 |
| `tests/shared-v3-*.test.ts`、新 `tests/shared-v3-fixture.ts` | 下面各任务指定的业务断言；复用现有 setup/TestClock/ScriptedModels/RecordingSender。 |
| `examples/story.sample.json`、`scripts/demo.ts`、`runtime/plugin-smoke.cjs`、现有受影响测试 | 配置与固定模型返回兼容；不改正式私有配置来完成测试。 |
| README、受影响的根目录 `REMAKE_V0.2*.md`、新实施日志 | 功能实施后才改实际行为说明，保留历史记录与未联调边界。 |

所有 shared 类型使用细化 §2 的同一名称。shared.ts 不依赖 host/state.ts，避免合法性／睡眠函数互相导入。公共时间工具继续在 src/time.ts，不建立另一套时区算法。

## 任务 1：类型、配置和活动时钟基础

**Files:** 新增 `src/host/shared.ts`、`tests/shared-v3-fixture.ts`、`tests/shared-v3-state.test.ts`；修改 `src/types.ts`、`storage.ts`、`settings.ts`、`config.ts`；`src/app.ts` 仅适配开始时新字段初始化；按类型错误更新既有夹具。

**Interfaces:** 定义细化 §2 全部类型；实现 `hasValidSharedScene`、`sharedRoutingActivity`、`sharedDeadline`、`refreshSharedStep`。其余三个 shared 接口在任务 3／5 实现，暂不导出空实现。测试辅助 `makeSharedFixture(d: ReturnType<typeof setup>, overrides?: Partial<NonNullable<Scene['shared']>>): void` 设合法 online 活动、同身份 clock、新版本及远期环境截止，避免环境调用干扰断言。

- [x] 写 `defaults_and_snapshot`：settings 默认 60/20；0 秒和 maxSteps 21 拒绝；正在进行活动保留旧 idleSeconds/maxSteps，重新开始才取新配置。
- [x] 写 `clock_uses_latest_real_anchor`：startedAt 为 10:00:00，用户 10:00:10，最后表情确认 10:00:30，截止为 10:01:30；新用户 10:01:00 改为 10:02:00；后台消息不改变结果。
- [x] 写 `first_step_and_single_projection`：completedSteps 0 时截止立即；完成数 1 后采用 60 秒；重复刷新只有一个 `scene:${activityId}`，任务 at 等于 Scene.shared.nextStepAt。
- [x] 写 `silent_and_reopen`：最后静默完成 10:03:00，截止 10:04:00；临时文件保存、关闭重开后 anchors/关联任务相同。旧缺版本读为 null；新库版本为 1。
- [x] 运行 `npm test -- tests/shared-v3-state.test.ts`，确认因新字段／公式缺失失败；修正夹具错误后保留真实 RED 证据。
- [x] 实现上述基础接口和配置校验，新 JSON 表接入现有事务；旧字段缺失不自动填成已迁移。开始初始化增加身份和快照，暂不改变现有选轮节奏。
- [x] 运行同组测试及 `npm run typecheck`，全部通过后记录结果。提交仅本任务文件：`feat: add shared activity state and clocks`。

## 任务 2：输入控制、动作原文和公开边界路由

**Files:** 修改 `src/host/input.ts`、`runtime.ts`、`src/index.ts`、必要的普通未读查询；新增 `tests/shared-v3-input.test.ts`，扩展 `tests/input.test.ts`、`plugin.test.ts`。

**Interfaces:** `InputAcceptance = { kind: 'message' | 'advance'; systemReply: string | null }` 在 src/types.ts 导出。`InputBuffer.acceptInput(message: IncomingMessage): Promise<InputAcceptance>` 和 `SerialHost.acceptInput` 同返回类型；后者保存成功后唤醒并返回。index 只对 systemReply 使用既有私聊发送能力，固定反馈不写角色消息。消耗任务 1 的路由／时钟接口。

- [x] 写 `exact_control_is_not_a_message`：`'  【推进】  '` 创建 pending 控制且 messages/openBatch 不增加；句子内推进、`【动作：推进】` 仍为普通消息；其他用户／群聊由入口排除。
- [x] 写 `inactive_control_is_cancelled`：活动外得到“当前没有共同活动”、cancelled/null 活动记录；没有模型调用、待生效请求或新消息。
- [x] 写 `advance_before_start_confirmation_is_inactive`：准备轮已有冻结start候选但开始标志未确认，推进仍cancelled、无messages/批次／待生效请求；随后开始段B不转交它。普通内容在同一窗口仍按15秒路由并可转交。
- [x] 写 `shared_input_keeps_action_text`：线下 `【动作：推门】你好` 原文、顺序及平台 ID 保留；batchId null，更新 lastInputAt，不建普通 15 秒窗口；chat 输入仍是 receivedAt+15秒。
- [x] 写 `published_boundary_routes_before_B`：模拟 clock active 而正式 character 仍 chat，新推进绑定该活动；模拟 clock ended 而正式 character 仍 shared，新文字进普通批次、新推进 cancelled。两个测试随后由任务 5 使用真实 sendFrozen 补集成验证。
- [x] 运行 `npm test -- tests/shared-v3-input.test.ts tests/input.test.ts tests/plugin.test.ts` 获取 RED。
- [x] 实现分类／返回值、控制记录和输入关联；输入事务内刷新最新活动截止。普通 unread 路径不得把 batchId null 的共同队列误交付。
- [x] 运行同组测试、typecheck，记录并提交：`feat: route shared inputs and advance controls`。

## 任务 3：共同选轮、前台优先和统一定时资格

**Files:** 修改 `src/host/scheduler.ts`、`runtime.ts`、`state.ts`，补 `src/host/shared.ts`；新增 `tests/shared-v3-scheduler.test.ts`，更新 `tests/scheduler.test.ts`。

**Interfaces:** 实现 `selectSharedMeta(storage: Storage, now: string, inputMessageIds: string[], taskIds: string[]): SharedTurnMeta | null`。Scheduler 原 collectReady/nextDeadline 签名不变；返回请求增加 sharedMeta。isSleeping/canRead 签名不变，合法共同场景采用清醒参与，普通门禁保留。collectReady 与 nextDeadline 使用相同的 shared／foreground／autonomous 资格，不能各写一套例外。

- [x] 写 `manual_and_due_share_one_selection`：活动截止与两条 pending 控制同到期，只有一个请求，两个控制 ID 固定；选择后新控制不出现在已选集合。输入集合也只取选轮时已有 ID。
- [x] 写 `wait_60_and_first_immediate`：第 1 轮立即；后续 at=截止-1毫秒无共同请求，截止时可选；新输入延后；先合并手动、自动、预约，同轮不另跑一次。
- [x] 写 `phase_and_quiet_permission`：默认 step17 为 wrap_up、20 为 final；maxSteps=3 的第3轮 final；有新输入禁止代写、无新输入允许；已看复议不算新输入。completedSteps=maxSteps 不产生下一共同请求。
- [x] 写 `foreground_before_environment_and_autonomous`：可处理消息／共同节点优先于尚未启动 world/school；60秒等待可运行环境；前台与自主同到期无 autonomous 原因。未来预约不会抑制无干扰自主。
- [x] 写 `environment_deadline_remains_in_shared_wait`：最后输出22:31:30，共同节点22:32:30，world截止22:31:40；无手动／预约、当前22:31:35时nextDeadline=22:31:40，到时collectReady选择world且sharedMeta为空。持续有可运行前台则先选前台，首次空档再选到期环境，不强插环境轮。
- [x] 写 `suppressed_deadlines_do_not_spin`：过期自主+共同等待、过期 check_messages+共同未到期、普通 openBatch，都不返回旧的立即自主截止；共同期间跨旧 sleepAt/wakeAt 无 sleep 原因；普通睡眠保留 wakeAt 门禁。
- [x] 写 `appointment_exception_and_maintenance_yield`：具体预约早于60秒可选共同协调；reply later 到期只能合并下一节点；维护应用一单元后真实输入到达，下一单元让位给该输入可运行的轮。
- [x] 运行 `npm test -- tests/shared-v3-scheduler.test.ts tests/scheduler.test.ts tests/memory-v3-host.test.ts tests/review7-maintenance.test.ts` 获取 RED。
- [x] 实现合并选择、共有资格判断与前台优先；任务 1 的唯一节点刷新负责截止，不再由模型调度。保留未完成轮与暂停门禁、不可读普通消息暂存。
- [x] 同组 GREEN、typecheck，记录并提交：`feat: schedule shared turns with foreground priority`。

## 任务 4：走向、公开代写及末轮合同

**Files:** 修改 `src/model/contracts.ts`、`prompts.ts`、`src/directors/narrative.ts`、`personal.ts`、`src/types.ts` 的 narrative 结果类型；`src/app.ts` 适配 sharedMeta 保存／透传、走向结果及删除旧模型时间赋值；新增 `tests/shared-v3-contracts.test.ts`；更新 `tests/shared-scene.test.ts` 和受影响的 shared 固定输出夹具。

**Interfaces:** narrativeTask原参数之后加 `sharedMeta?: SharedTurnMeta | null`，其后再加 `previousOutline?: SharedOutline | null`；runNarrative在options后按相同顺序追加这两项并传工厂。personalTask在messageIds后、runPersonal在options后追加sharedMeta，再追加publicNarration?: string | null，不加previousOutline；app传本轮同一份公开正文，首节点要求非空开场，提前end要求已有非空公开正文。app传入本轮正式状态的旧outline，首节点为null。共享结果必填outline和simulatedUserActions，删除nextStepAt；普通合同／返回值保持原约束。

- [x] 写 `shared_result_has_no_model_deadline`：共同结果含 outline/空代写清单通过；尝试提供模型 nextStepAt 不成为内部调度字段；共同调用缺 sharedMeta 拒绝。
- [x] 写 `simulated_actions_must_be_public`：false 权限却有清单拒绝；true 权限且动作只在 experiences 没在 publicNarration 拒绝；公开包含每个清单原文通过。普通私聊不能走此授权。
- [x] 写 `final_requires_public_close_and_end`：final 空旁白拒绝，个人不 end 拒绝；非空收尾+end 通过；非 final 可以提前 end。拒绝个人模型创建／更新／取消 scene_step，保留合法预约和检查。
- [x] 写 `outline_closes_by_phase`：旧openThreads为`['取餐','结账']`；ongoing可加入必要条目，wrap_up保留或删为`['结账']`通过，新增`'逛新店'`或把保留项改写成新文本拒绝；final非空列表拒绝。首节点previousOutline=null可建立，maxSteps=1的首节点final必须空列表。校验字符串集合包含，不创建线索ID类型。
- [x] 写 `prompts_keep_actor_and_fact_boundaries`：共同提示明确用户动作／外部发言、角色自愿行为、无用户台词／心理、公开共享模拟经历及outline是未来意图；增加“不得据代写建立用户稳定性格／能力／偏好／关系设定”和goal/endingCondition须有依据才能调整的断言。真实动作原样，活动内选择及合理结果仍允许；不加动作数量校验。测试验证合同与传递，不声称真实语义质量。
- [x] 第十轮用户追加确认：narrativeTask以冻结allowSimulatedUserActions选择互斥提示片段，共用叙事规则；静默分支允许双方动作，有输入分支不新增用户动作，simulatedUserActions只列用户。实际HTTP测试覆盖两种system提示与修补不切换，恢复测试覆盖晚到输入不改旧轮；不新增数据字段或迁移。串行角色输出归旧轮，不预判后续回复。
- [x] 运行 `npm test -- tests/shared-v3-contracts.test.ts tests/model-call-context.test.ts tests/shared-scene.test.ts` 获取 RED。
- [x] 实现结构校验及提示词，复用原角色的格式修补，不新建规划／语义审计调用。app保存／重建request时透传sharedMeta，给两个共同模型相同轮号和权限；共同主叙事透传previousOutline，按细化§6做收束集合及final空列表校验，再保存新outline、删旧模型nextStepAt赋值。直接调用app的共同测试先用任务3接口构造sharedMeta，夹具符合新合同；公开边界和段B接入留给任务5。
- [x] 同组 GREEN、typecheck，记录并提交：`feat: constrain shared narration and final closure`。

## 任务 5：流水线、确认边界、段 B 与恢复

**Files:** 修改 `src/app.ts`、`recovery.ts`、`src/host/shared.ts`、必要的 `state.ts` 及 `src/memory/organize.ts`；新增 `tests/shared-v3-recovery.test.ts`、`tests/shared-v3-flow.test.ts`；更新 `tests/turn.test.ts`、`recovery.test.ts`、`shared-scene.test.ts`、`tasks.test.ts` 中被新策略替代的断言。

**Interfaces:** 实现 `recordSharedOutput(storage: Storage, turn: TurnRecord, item: OutboxItem, confirmedAt: string): void`、`finishSharedTurn(storage: Storage, turn: TurnRecord, completedAt: string): void`。二者由既有事务调用，不嵌套 transaction。继续任务4的 sharedMeta 透传，恢复未尝试稿仍保留它；done 的 TurnRecord 仍保留它。generateTurn 现有参数后增加 `retainedInterval?: number | null`，execute 从 TurnRecord.autonomousIntervalMinutes 传入；freeze 首次保存、discardUnattempted 保留，复用已抽间隔。

- [x] 写 `begin_publish_before_post`：实际发送开始标志后阻塞 memory，接收输入和推进；它们绑定活动但不能开新轮。释放后计数仍0，立即第一共同节点，首节点完成为1。
- [x] 写 `end_publish_and_late_input`：最后结束标志确认后阻塞 post，新文字进入普通15秒批次、新推进活动外提示；段 B 不覆盖它们。此前未看共同输入按细化重组，已看不重复，遗留控制取消。
- [x] 写 `late_inputs_survive_frozen_commit`：生成期间新 input/control，发送期间分段文字／表情，后处理超60秒；旧轮只消费固定ID，最新 anchors 和 pending 保留，下一步只一轮；手动替代原节点不再次触发。
- [x] 写 `deadline_uses_last_send_confirmation`：实际sendFrozen，生成时22:31:00，分段文字／表情最终22:31:30确认，nextStepAt=22:32:30而非22:32:00；后处理到22:31:45不把可见输出轮截止挪到22:32:45。后到的新用户输入仍按max公式延后。
- [x] 写 `environment_commit_preserves_shared_clock`：共同等待中真实执行假world环境轮；提交前后completedSteps、sharedClock各锚点、共同／自主截止和narratedUntil相同，仅环境事件及对应nextWorldAt按既有规则变化。
- [x] 写 `silent_20_steps_natural_close`：假模型可无角色对话自动持续，成功提交第17收束、第20非空旁白并最后结束；计20、无第21模型调用。无输出普通共同轮完成+60秒，不立即循环。末轮修补后仍不合格则暂停、未提交轮数不增加、不自动清场。
- [x] 写 `recover_exact_same_step`：临时文件在发送一部分／输出完整未post／已post事务待恢复处重开；已确认不重发，角色最终计数只增加一次，控制只消费一次，轮号／权限／已冻结抽样不改变。未尝试稿重生成仍同选轮号／输入／控制集合；普通及共同冻结未尝试稿都复用原间隔，断言恢复不增加自主抽样调用数。
- [x] 写 `first_freeze_retains_interval_once`：首次freeze前TurnRecord无留存，第一次freeze保存候选150～210分钟中的本次值；discardUnattempted、普通／共同重生成、已尝试稿恢复及post重试均不清、不改该值，也不再抽自主间隔；done记录仍保留它。
- [x] 写 `sleep_and_idle_cycle`：shared 跨23:00和次日旧wakeAt不伪起床；结束时旧sleep窗口有效则自主null，新sleepAt未来则自主completedAt+180分钟，过期sleep清理不生成伪wake。普通睡眠不能因推进开始活动。
- [x] 写 `all_foreground_resets_once`：普通对话、预约、起床、共同、仅 narrative／沉默前台均从各自completedAt+180分钟安排；pure环境／保存输入／维护不重置；已冻结同轮恢复不再抽样或累计。真正自主轮的主动联系资格保留，前台合并不抽联系。
- [x] 写 `life_and_shared_memory`：连续前台以最后已提交 narratedUntil 补生活、不泄露普通未看正文；公开代写可作为带合法来源的共享模拟记忆；outline／隐藏代写不作为新事实，生成中用户回来纠正留下一轮，已发送记录保留。
- [x] 运行 `npm test -- tests/shared-v3-recovery.test.ts tests/shared-v3-flow.test.ts tests/turn.test.ts tests/recovery.test.ts tests/shared-scene.test.ts tests/tasks.test.ts` 获取 RED。
- [x] 接入生成／冻结／发送事务回调，集中替代 app 内旧模型 scene_step 维护；完成段 B 最新 clock 合并、控制消费、单次计数、入退场批次、作息与自主重排。记忆仅补合同上下文，继续原来源机制。
- [x] 同组 GREEN、typecheck，记录并提交：`feat: commit and recover bounded shared activities`。

## 任务 6：旧库检查、停止升级与装配

**Files:** 新增 `src/deployment/shared-upgrade.ts`、`scripts/migrate-shared-activity.ts`、`tests/shared-v3-upgrade.test.ts`；修改 `package.json`、`src/index.ts`、配置装配及 `tests/deployment.test.ts`、`plugin.test.ts`。

**Interfaces:** 在 shared-upgrade.ts 导出 `SharedUpgradeReport`，字段 `version: number | null`、`mode: string | null`、`activeLegacyShared: boolean`、`unfinishedSharedTurnIds/oldSceneTaskIds: string[]`、`committedSharedTurnCount: number`、`canInitialize: boolean`、`requiresUserDecision: boolean`、`backupPath: string | null`。导出：

```ts
inspectSharedUpgrade(databasePath: string): SharedUpgradeReport
upgradeSharedActivity(databasePath: string, now: string, options: { stopped: boolean; backupDirectory: string }): SharedUpgradeReport
ensureSharedActivityVersion(storage: Storage): void
```

inspect 使用只读 SQLite，不能调用会建表／初始化的 Storage 构造器。upgrade 仅支持无旧共同活动的明确初始化，已版本1直接幂等返回；旧活动报告并拒绝猜测性升级。ensure 在调度启动前检查，缺版本提供 shared:migrate 指引。CLI 参数：`--database <路径> --check` 或 `--database <路径> --apply --stopped --backup-dir <目录>`，默认 check；报告不包含正文。

- [x] 写 `readonly_check_does_not_initialize`：缺字段旧普通库 check 后文件数据／schema不变，canInitialize=true；有旧共同状态／未完成旧共同轮 requiresUserDecision=true，并列出实际 ID；不能凭 memories=0 认定没故事。
- [x] 写 `stopped_backup_then_upgrade`：无 stopped 拒绝；旧普通临时库 apply 先有可打开备份，再新版本／控制表，普通输入、tasks、memories和未完成普通轮均保留；重复apply不改截止、不重排自主。
- [x] 写 `legacy_shared_is_not_reset`：旧活动／旧未完成共同轮 apply 拒绝，原 shared/turn/outbox 保持，不伪结束、不初始化20轮；新版本活动重开保留计数和请求。
- [x] 写 `entry_checks_before_host_start`：新库正常装配；未升级库在故事启动前明确报错，QQ不收到伪活动标志；配置60/20贯穿AppConfig，普通status/pause/resume保留。
- [x] 运行 `npm test -- tests/shared-v3-upgrade.test.ts tests/deployment.test.ts tests/plugin.test.ts` 获取 RED。
- [x] 实现只读报告、停止备份／事务升级和启动检查；package添加 `shared:migrate`。仅用临时库验证CLI，不运行正式库 apply。
- [x] 同组 GREEN、typecheck，记录并提交：`feat: inspect and migrate shared activity state`。若正式检查以后实际发现旧活动，另向用户给具体接续建议，不在本任务猜测接续。

## 任务 7：整体验证、示例及实施记录

**Files:** 修改 `examples/story.sample.json`、`scripts/demo.ts`、`runtime/plugin-smoke.cjs` 及确需适配的测试夹具；更新 README、根目录 `REMAKE_V0.2.md`、`REMAKE_V0.2_LIFE.md`、`REMAKE_V0.2_INTERFACES.md`、`REMAKE_V0.2_RECOVERY.md`、`REMAKE_V0.2_IMPLEMENTATION.md` 的受影响说明；新增 `docs/SHARED_ACTIVITY_V0.3_IMPLEMENTATION_LOG_20261007.md`。记忆文件仅在实际合同说明受影响时最小更新。

**Interfaces:** 无新运行接口。sample 明列默认60/20；demo/smoke 的共同固定返回与合同一致；runtime smoke 继续使用真实 Koishi Context、假 HTTP、临时库，不连接 QQ。

- [x] 核对 Review Focus 五项均有对应测试名称和断言；初次执行全部 `npm test`，如果回归失败，先区分新策略替代的旧断言与真正故障，记录原因。不能仅为了全绿删除原来源、恢复或睡眠测试。
- [x] 适配离线demo/smoke与样例。更新“共同15秒／模型nextStepAt／聊天不重排自主／共同硬睡眠”旧行为，并明确更新 `REMAKE_V0.2_RECOVERY.md` §6.1：未完成轮先恢复，新轮可运行前台优先、其次到期世界／学校、再符合资格的自主。说明环境窗口、阶段outline合同、控制、60秒、20轮、代写共享经历及升级入口；历史实施记录保留日期。
- [x] 依次运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run demo`、`npm run check --prefix runtime`、`npm run smoke --prefix runtime`。测试零失败、类型／构建退出0，demo/smoke离线完成且无真实QQ操作才算通过。失败修复后重跑相关项和被影响的整体验证。
- [x] 写实施日志：每任务提交、实际RED/GREEN命令及数量、必要方案偏差、迁移临时库证据、正式库尚未升级／故事尚未联调状态；登记下节真实多轮验收为必做待办，分别标“离线开发完成”和“真实语义验收待办／通过”。完成的复选框与实际交付一致，不把本项登记等同真实验收已经通过。
- [x] 做最终 diff 自查：只提交必要代码／测试／样例／文档；无 key.txt、背景、正式数据库、私有配置或构建产物泄露。提交：`docs: record shared activity delivery and validation`。

## 交付门禁与后续运行

任务1～7完成表示离线实现及验证完成。实际正式库先check，再按明确结果停止、备份和升级；若有旧活动，用户先决定具体接续。正式背景语义、动作理解、连续静默推进及自然收尾的真实模型验收另记结果，不能由模拟测试替代。

### 真实多轮语义验收：必做，单独记录

代码交付后安排真实模型多轮故事，不因字符串集合测试通过而省略。原始任务1～7不发起在线调用；第十轮修正已获准隔离真实模型验收，见新增修正计划；正式消息或服务启动仍由用户掌握。实施日志在实际验收前一直保留待办状态。至少核对：

- 连续静默推进，逐轮检查goal/endingCondition是否仍围绕已确认活动；变化是否有真实输入或明确场景依据，是否由此前代写自我放大。
- 代写是否全部公开，是否新增用户台词／心理、稳定性格／能力／偏好／关系；本次行动结果与用户真实固定属性分开。角色感受和用户动作主体正确。
- 覆盖wrap_up及final：原条目保留／删除，目标与结束条件有语义连续性，剩余事项合理交代，无戛然而止或把暂停谎称全部完成。活动提前自然完成可正常结束，另补能覆盖收束阶段的场景，不为凑轮强留已完成活动。
- 用户通过`【动作：…】`参与、途中返回并纠正公开代写时，主叙事与个人导演按真实输入澄清／继续，不私改已发历史。

记录活动／轮号、阶段、目标及结束条件变化、必要剧情摘录和逐项结论。若发现语义漂移，调整对应提示词并重验相关场景；不把goal/endingCondition字符串相等或mock合同通过写成语义验收通过。

用户仍通过根目录两个cmd手动启动服务。正式服务及真实消息未启动；第十轮已获数据授权开展隔离在线验收并完成正式库升级，逐项结果单独记录。

## 文档自查

已按方案逐项映射并实施任务1～7：输入／时间／计数／职责／共享记忆／生活补齐／睡眠／自主／前后台让位／恢复／升级均有归属。第九轮接受项已落实；previousOutline参数顺序与细化一致。原开发阶段登记的真实多轮待办已在第十轮授权补验，正式库版本1升级亦完成；实际覆盖、失败样本与有限语义结论见第十轮记录，不以程序合同通过代替文字审阅。


第十轮已接受修正的执行入口：[修正计划](REVIEW10_FIX_PLAN_20261008.md)、[逐项修正／部署验收记录](REVIEW10_FIX_LOG_20261008.md)。选择时的代写权限为冻结快照，生成期间新消息留下一轮。status可刷新确定性投影，但不更新真实锚点、轮数或自主截止。

### 2026-10-08追加确认：验收等待与普通活动节奏

- [x] 隔离验收工具单请求默认等待改为300秒，仍保留调用方取消；不改正式调用超时／重试策略。
- [x] 共同主叙事的两种授权分支及共同个人导演共用约10轮软节奏提示；保留maxSteps=1～20、程序phase与公开正文/end合同。
- [x] 扩充合同兼容检查：maxSteps=2首节点正文、第3轮可提前结束、第10轮可以继续也可以公开结束。全量51文件268项、typecheck/build通过，细化／方案／README及受影响根文档同步。
- 本次未重新运行在线故事；既有quiet测试明确约定20关，用于覆盖硬上限。普通活动软节奏的实际平均轮数尚未统计，后续实际故事观察另记，不用mock测试证明模型语义。
