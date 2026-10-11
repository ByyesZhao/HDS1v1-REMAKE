# 个人导演任务合同细化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 本文交给Sol在同一会话串行执行，不要求另开规划会话。

**Goal:** 实施个人导演预约专用合同，保留程序消息检查、主叙事经历、reply=later及V2规定的恢复行为。

**Architecture:** 只在personalTask生成动态预约Schema并校验同一权限快照，提示同步职责。程序任务、通用投影和恢复状态机保持；使用真实ModelClient、合成业务流及临时文件库验证边界。

**Tech Stack:** TypeScript、Zod 4、Vitest、Node.js SQLite、Koishi；不新增依赖。

**Spec:** [PLAN_V2.md](PLAN_V2.md)是设计规范；本文是其T1～T4执行细化，两份一起阅读。原README／DESIGN及[审核](../../reviews/personal-task-contract-20261011/REVIEW.md)仅供追溯，不覆盖V2恢复矩阵。

日期：2026-10-11。状态：**E0、T1～T4已实施，离线验收通过**。已核对源码`9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78`（0.5.1）。本文编制时未修改产品、未重跑产品测试；此前6文件50项及探针属于方案审核证据。

## 交给Sol的任务指令

> 请先读PLAN_V2.md和EXECUTION_PLAN.md，再按E0、T1、T2、T3、T4完成实现、离线验收、文档同步及本地提交。沿用V2设计，不重新选择方案。每项先写有判别力的测试，记录失败原因再最小实现；既有恢复行为允许原本通过。保留原修补预算和持久恢复语义，完成后给出提交、实际验证结果和未执行范围。此次不执行D1，不操作正式服务、正式数据或解除暂停；不因实施文档含D1就发送QQ消息。若代码基线已有变化，先核对相关差异，不回退现有代码。不要把已有文档改动或未跟踪文件当垃圾清除。

实施结果见[交付](../../records/personal-task-contract-20261011/DELIVERY.md)。下列原交接指令的现场／推送限制属于编制时范围；用户随后授权上传Git并安全停止、由用户手动重启。具体授权及实际边界见[现场记录](../../records/personal-task-contract-20261011/DEPLOYMENT.md)，未授权hdsi.resume。

## Global Constraints

- Node.js `>=22.13.0`；项目维持`0.5.1`，无新依赖、数据库迁移、后台任务或定时器。
- 程序独占check_messages／scene_step；个人taskChanges只管双方预约。生活阶段保留经历、contact资格和nextPlan；chat/shared保留reply=later。
- 不扩大visible／reconsider／seen权限；保留学校观察触发personal_life及普通回复15秒规则。
- 同逻辑阶段repairLimit=2、lookupUsed和工具进度保留；网页默认上限是20次成功读取、40次失败，不是40次总请求。普通回复合法换代仍按现有阶段清理规则处理。
- 未尝试且outputComplete=false时按恢复时刻重生成；已尝试或outputComplete=true时保留旧候选。不能仅看frozenResult或confirmed数量。本地已确认项跳过，未知发送仍可能重试。
- 全部工作在隔离目录，用合成配置、库、模型、sender和web provider。构建／demo／smoke只写隔离目录；不用check:models、正式启动器或在线模型／QQ作为验收。
- 原方案、审核报告及原始证据保持历史含义。新日志用新路径，不覆盖此前审核结果。正式部署／恢复仅按V2 D1另行处理；本轮不自动执行或推送远端。

## Review Focus

1. 空预约集合及completed/cancelled任务：无空枚举、无终态任务修改权限，归T1集合测试。
2. 构建后调用方修改tasks及修补／工具续接：Schema与parse仍用原权限快照，归T1快照与传输测试。
3. 学校通知合法获知后转不可读：经历进入life，只有真实未读进入程序检查，归T2业务流。
4. 全pending、首项retry、沉默已完成输出：分别重生成／保留／只后处理，归T3恢复矩阵。
5. 恢复推进时钟、life→chat且repairCount=2：新输入与合同生效，旧阶段身份／预算不重置，归T3混合轮测试。

## E0：核对并准备执行目录

**文件责任表：**

| 任务 | 产品修改 | 测试及文档 |
| --- | --- | --- |
| T1 | `src/model/contracts.ts` | 新建`tests/personal-task-contract.test.ts`；修改`tests/tasks.test.ts`、`tests/review-fixes.test.ts` |
| T2 | `src/model/prompts.ts` | 新建`tests/personal-task-contract-flow.test.ts`；必要时扩充`tests/prompt-policy.test.ts` |
| T3 | 预期无产品修改 | 新建`tests/personal-task-contract-recovery.test.ts`；既有恢复／投影测试只补断言，不削弱 |
| T4 | 预期无产品修改 | 当前DIRECTORS／SCHEDULING／RECOVERY、实现对应、三处入口、任务交付及验证记录 |

只有新离线用例证明程序存在额外缺陷，才最小修改`src/app.ts`等接点，并单列依据；不要把计划的旧表述改成产品行为。不修改通用TaskChange／ScheduledTask以删除旧kind，也不改task-projection来限制历史结果。

- [x] 在原工作区记录`git status --short`、`git rev-parse HEAD`、`git diff --stat`；确认Node版本及package.json。HEAD不同于本文时核对相关源码差异并记录新基线，不reset回本文提交。
- [x] 按using-git-worktrees检查并复用适合的隔离目录；新建时显式使用已核对的源码ref，分支用`codex/personal-task-contract-20261011`或未占用的同前缀名称，避免默认远端落后于当前代码。
- [x] 若本任务文档仍未跟踪，注意worktree不会自动复制：比对后带入本任务plans／reviews两目录的公开文档及合成证据，并保留三处索引的本任务条目；目标已有不同内容时不覆盖。把它们记录为已有输入，不能stash／clean整个原目录。
- [x] 在隔离目录确保锁定依赖可用，缺失时使用npm ci且不更新锁文件。测试前创建该目录下`.tmp/personal-task-contract`，把TEMP／TMP设为其绝对路径；每个新PowerShell进程都要注入，不能假设上次exec的环境变量仍在。
- [x] 使用以下基线命令确认原行为；退出0且6文件50项才可沿用本文基线数量。若实际数量不同或失败，记录实况，先区分环境、夹具和产品原因，不修改期望强行变绿。

```powershell
npm test -- tests/recovery.test.ts tests/tasks.test.ts tests/review-fixes.test.ts tests/web-recovery.test.ts tests/personal-stage-preparation.test.ts tests/reply-freshness-recovery.test.ts
```

阅读接点以符号为准：[personalTask](../../../../src/model/contracts.ts)、[generateTurn／resumeUnfinishedTurn](../../../../src/app.ts)、[freezeTurn／discardUnattempted](../../../../src/recovery.ts)、[ModelClient](../../../../src/model/client.ts)、[turnPhaseOptions](../../../../src/web/phases.ts)。不要求遍历整个项目重做审核。

## T1：实现预约专用Schema与同源权限校验

**Files:** 按E0 T1行；参考[传输测试](../../../../tests/web-model-tools.test.ts)、[提示权限测试](../../../../tests/prompt-policy.test.ts)。

**Interfaces:** 保留`personalTask(kind, at, tasks, mode, messageIds, sharedMeta?, publicNarration?, eligibility?)`公开签名及返回`ModelTask<PersonalResult>`。在`src/model/contracts.ts`新增私有：

```ts
function personalTaskChangeContract(tasks: readonly ScheduledTask[]): {
  schema: z.ZodType;
  appointments: ReadonlyMap<string, ScheduledTask>;
}
```

- [x] **T1.1 写合同失败用例。** 在新测试文件用NOW、silent及ScheduledTask类型；create的task只放模型合法字段，不能展开带id/status的存储行。核心权限断言形如：

```ts
const check: ScheduledTask = { id: 'check', kind: 'check_messages', at: NOW,
  description: 'check', status: 'pending', checkReason: 'unread', messageIds: ['a'] };
const selected = personalTask('chat', NOW, [check], 'chat', ['a']);
const forbidden = [
  { action: 'create', task: { kind: 'check_messages', at: '2026-10-07T10:30:00+08:00',
      description: 'check', checkReason: 'unread', messageIds: ['a'] } },
  { action: 'update', id: 'check', task: { at: '2026-10-07T10:30:00+08:00' } },
  { action: 'update', id: 'check', task: { kind: 'appointment' } },
  { action: 'cancel', id: 'check' },
];
for (const change of forbidden)
  expect(() => selected.parse({ ...silent, taskChanges: [change] })).toThrow();
```

扩展为`rejects_program_task_changes_in_all_personal_modes`：chat/life/shared均拒绝上述输入及scene_step的create/update/cancel。life的基础输出为`{innerThought:'休息',emotions:[],contact:{willing:false}}`；shared用reply none、mode=shared_online及合法SharedTurnMeta（ongoing、stepNumber=2、maxSteps=10、idleSeconds=60、advanceReason=automatic、controlRequestIds=[]、allowSimulatedUserActions=false，并提供activityId／sceneTaskId），避免先因缺meta失败。

- [x] **T1.2 写strict与集合测试。** `rejects_foreign_task_fields`分别夹带create.id、task.id/status/checkReason/messageIds、update额外字段及cancel.task；必须throw而非strip后成功。`uses_only_pending_appointment_ids`断言pending预约部分更新和取消成功，unknown／completed／cancelled ID拒绝，重复修改同ID拒绝；`empty_appointment_set_allows_create_only`断言create和[]成功，update/cancel拒绝且Schema无空enum。保留`at=NOW`成功、life省略taskChanges成功、chat/shared省略失败、contactEligible=false和原动作／shared校验。
- [x] **T1.3 写权限快照测试。** `freezes_appointment_permissions_for_schema_and_parse`：建task后保存其Schema，修改原pending预约的id/kind/status，再向原数组追加预约；原获准ID仍能update/cancel，新ID拒绝，Schema深度等于构建时快照。新构建的task另取当时快照，不能全局缓存旧集合。
- [x] **T1.4 记录红灯。** 运行`npm test -- tests/personal-task-contract.test.ts`。上述新权限／strict／快照断言应揭示旧代码的开放权限；已有contact或scene_step拒绝可原本通过。记录具体失败测试和原因，不把编译／缺失fixture错误记成产品红灯。
- [x] **T1.5 实现合同。** helper先筛pending appointment并structuredClone，再构建Map和ID枚举。create使用strict的`{action:'create',task:{kind:'appointment',at,description}}`；update使用strict action对象和strict部分task，kind可省略、提供时仅appointment；cancel也strict。空ID集合直接返回create分支；非空再构造create/update/cancel联合，避免空enum。不要给整个personal根对象新增与本次无关的strict限制。
- [x] **T1.6 接入personalTask。** 移除旧通用taskDetails/taskChange在个人模型Schema中的使用；chat/life基础对象其余字段不变，在personalTask内部通过extend注入同一helper的数组Schema，life再optional。最后保留contactEligible=false的willing:false收窄。validate中的ID查找改为同一appointments Map，保留duplicate guard，删除模型check_messages专用校验；保留reply时间、睡眠、shared和动作检查。messageIds参数暂保留，勿借机改调用链。
- [x] **T1.7 覆盖传输／续接。** `transport_keeps_appointment_contract_in_json_modes`用ChatCompletionsTransport的假fetch，分别截获json_object和json_schema。后者检查response_format内任务分支；前者从system的`JSON Schema:`后提取一整段JSON再检查，不把提示或resources中提到check_messages当越权。通过真实ModelClient依次返回一次合法lookup、一次非法程序任务、合法预约，断言lookup仅一次、修补仅一次、各请求task.schema一致且最终成功；可在lookup回调改原tasks复验快照。工具允许时union仍有lookupDetails／webSearch／webRead，最终任务分支仍仅appointment。沿现有假provider做一次webRead续接，不走网络。
- [x] **T1.8 调整旧权限用例。** tests/tasks.test.ts首个check→appointment提前醒用例改成拒绝，并新增合法create appointment提前醒：原sleep为23:30～次日08:30，预约次日08:00，结果wakeAt=次日07:00。tests/review-fixes.test.ts的过去／未来check断言统一拒绝，不再匹配at错误。保留预约NOW、描述更新／未来改期、复议及记忆用例；tests/task-projection.test.ts的旧转换兼容用例不删除。
- [x] **T1.9 验收。** 下列两条均退出0；复核仅改T1范围后提交`fix: restrict personal task changes to pending appointments`。

```powershell
npm test -- tests/personal-task-contract.test.ts tests/tasks.test.ts tests/review-fixes.test.ts tests/task-projection.test.ts tests/model-call-context.test.ts tests/web-model-tools.test.ts tests/prompt-policy.test.ts
npm run typecheck
```

## T2：同步提示与现场形态业务回归

**Files:** 按E0 T2行；参考[modern](../../../../tests/chat-fixture.ts)、[学校fixture](../../../../tests/world-school-fixture.ts)及[审核探针](../../reviews/personal-task-contract-20261011/evidence/recovery-time-probe.ts)。

**Interfaces:** 消费T1的personalTask；保留`generateTurn(d, request, turnId, at?)`、`HdsiApp.runTurn(request)`、`InputBuffer.acceptInput(message)`。测试读取真实DTO的`context.experiences`、`context.state`、`roles.visibleIds`、`roles.reconsiderIds`，不按旧平铺输入断言。

- [x] **T2.1 写提示失败测试。** `personal_prompts_assign_checks_to_program`检查三类personal提示均声明预约专属／程序任务禁止，删除原句“taskChanges 中 create/update 后最终 check_messages.at 必须晚于本轮 at”；chat/shared保留later入口，life不被要求输出reply。经正常请求、T1中的lookup/web续接和修补请求均能看到同一职责，不整段快照固定所有无关提示。先运行`npm test -- tests/personal-task-contract-flow.test.ts tests/prompt-policy.test.ts`记录红灯。
- [x] **T2.2 修改personalRules及角色补充句。** 用以下语义替换旧检查改期句：taskChanges仅管理双方确认的appointment；仅可用获准预约ID更新／取消；check_messages和scene_step由程序维护，禁止直接create/update/cancel；三类均保留经历理解及nextPlan意图。chat/shared说明稍后考虑已见消息用reply=later且reconsiderAt>at；life说明未来私人意图写nextPlan，不提供reply字段。其余回复风格、共同活动及权限提示不改。
- [x] **T2.3 建学校混合轮夹具。** modern()后显式设environmentPlanningVersion=2。先用InputBuffer接收两条合成历史消息，推进15秒、Scheduler选取并以合法silent输出完成一轮，保存两条seenTurnId；再添加schoolItem并expand、接收新消息、推进15秒取得带schoolNoticeRefs的request。清空种子阶段调用记录后再测目标轮，断言request.replyInputRevision为undefined。学校观察happenedAt使用通知已released后的本轮at；初始状态可读，叙事描述此刻获知通知后进入不可读活动，expectedEndAt=本轮at+5分钟。
- [x] **T2.4 验证`school_observation_keeps_personal_life_when_phone_is_inaccessible`。** 叙事含真实noticeId和experienceIndex=0；life返回合法沉默、taskChanges省略或[]。断言个人输入包含该经历与新不可读活动、visible/reconsider均[]、确实调用personal_life且未调用expression；turn.done=true，新消息seenTurnId=null、两条历史seen不变，pending unread检查的messageIds仅新消息、at等于活动结束。此用例可能本来通过，应保留而非为制造红灯改产品。
- [x] **T2.5 验证对照和延期。** `inaccessible_without_observation_can_skip_personal`在无实际学校观察、无预约／autonomous／sleep等其他触发时断言无personal调用。`readable_later_reuses_deferred_id_without_rereading_history`推进到活动结束，让叙事变可读，chat首次reply=later至当前+10分钟；再次到期用later至当前+10分钟，断言同一deferred任务ID改期，首次已见的新消息seenTurnId不改，第二次visible=[]、reconsider仅该消息，历史消息不重入。用业务调度取得request，不手工重置seen。
- [x] **T2.6 验收并提交。** 运行下列命令至退出0，确认没有为修合同删除学校life或让不可读阶段看消息；提交`fix: clarify personal task ownership and message deferral`。

```powershell
npm test -- tests/personal-task-contract-flow.test.ts tests/prompt-policy.test.ts tests/tasks.test.ts tests/task-projection.test.ts tests/personal-stage-preparation.test.ts tests/phone-access-flow.test.ts tests/phone-access-contracts.test.ts tests/world-school-personal-reminder.test.ts
```

## T3：磁盘恢复、旧候选与工具进度

**Files:** 新建`tests/personal-task-contract-recovery.test.ts`。参考[磁盘恢复](../../../../tests/reply-freshness-recovery.test.ts)、[工具恢复](../../../../tests/web-recovery.test.ts)、[工具配额](../../../../tests/web-model-tools.test.ts)。

**Interfaces:** 消费T1合同和T2业务形态。用真实Storage文件、ModelClient＋假Transport，调用`HdsiApp.resumeUnfinishedTurn()`；专门的暂停用例使用`SerialHost.resume()`，不能把直接App恢复误当作Host解暂停。

- [x] **T3.1 在新测试文件内实现`openDiskFixture()`。** 返回`db(): Storage`、`deps(): Dependencies`、`reopen(): void`、`close(): void`、`clock: TestClock`、`sender: RecordingSender`、`requests: CompletionRequest[]`及`setResponse(handler: (request: CompletionRequest) => Promise<unknown>): void`。它在隔离TEMP中mkdtemp创建state.sqlite，初始化角色、协议2 runtime和chat-index元数据；不读取正式文件。每次reopen后重建Storage、SchoolStore、EnvironmentStore、WebSearchStore／Service及依赖，不复用已关闭seed.chat／dialogue／store。让HdsiApp构造新的聊天组件；web默认disabled但仍保存checkpoint，工具用例才注入假provider。记录input／repair／schema快照，不能structuredClone包含parse函数的整个CompletionRequest。旧连接关闭、Host.stop完成后才能重开或清理；close仅删除本夹具创建的已核对临时目录。
- [x] **T3.2 制造真实未冻结失败。** `unfrozen_recovery_keeps_repairs_with_new_time`用混合学校轮和ModelClient先让personal_life连续返回缺metadata的非法check，确认失败阶段为personal_life、repairCount=2、frozenResult=null、无outbox。关闭库、推进10分钟后重开；同角色分支重新给合法不可读活动，expectedEndAt必须晚于新的turn.at，不能复用已过期结束时间。恢复首个个人请求必须含新Schema及旧repair.original；合法生活响应完成，turn ID相同、at=恢复时刻、runId相同、repairCount仍2。
- [x] **T3.3 分离非法恢复分支。** `invalid_recovery_does_not_get_another_repair`从独立失败夹具重开，再返回非法程序任务。断言只计个人阶段的一次响应即ModelFormatError、repairCount仍2、runtime.paused=true、未冻结、无该轮故事输出或业务提交。不要把重复叙事调用计入个人修补次数；fake sender的错误通知单独统计。
- [x] **T3.4 验证角色切换。** `mixed_school_recovery_can_switch_life_to_chat`重开后让叙事转为可读，断言personal_chat、roles.visibleIds包含新消息，输入context.at为新时刻。对无replyFreshness的轮，阶段键仍personal、runId不变、taskName更新、旧repair及预算保留；合法silent回应提交并标见新消息。另参数化非法chat回应：带未来at、有效checkReason和当前visible消息ID的check创建在旧合同本可合法，在新合同必须一次失败，避免只测缺metadata而无法区分新旧权限。普通reply阶段键仍按`reply:<generation>:personal:<taskName>`，不强行套用混合轮断言。
- [x] **T3.5 构造旧持久候选。** 先让真实runTurn在叙事处以合成异常中断以获得合法turn／绑定，再用generateTurn生成合法candidate与items。仅在测试库冻结前，把candidate.taskChanges（需要时personal.taskChanges）换成旧check→appointment update；已有check行使用未来时间以免恢复完成后立即触发额外轮。以freezeTurn保存，不能让新personalTask.parse放行旧JSON。此做法模拟升级前持久结果，产品没有兼容开关。
- [x] **T3.6 逐项覆盖下表。** 每项独立临时库，重开前推进时钟并记录oldAt。断言以保存状态为准，不能统一设置“模型再被调用就失败”。

| 测试名 | 构造和关键断言 |
| --- | --- |
| `unattempted_legacy_candidate_is_regenerated_under_new_contract` | 全pending、无firstAttemptAt、outputComplete=false。恢复叙事／个人／表达正常被调用，输出独特“新稿”，`expect(sentPayloads).not.toContain('旧稿')`；`expect(turn.at).toBe(recoveryAt)`。新个人输出使用新Schema，旧check转换未提交；保留原check或只发生可解释的程序维护 |
| `attempted_legacy_candidate_finishes_without_personal_reparse` | 参数化首项retry无confirmed、首项confirmed＋尾项retry，另覆盖sending。通过sendFrozen和假sender在指定序号失败形成真实回执／消息；sending可模拟进程停在调用前。重开后叙事／个人／表达被调用即失败，memory合法；`expect(turn.at).toBe(oldAt)`，旧转换成为appointment，confirmed回执与对应消息不重复；retry／sending可按现行规则重试 |
| `silent_complete_legacy_candidate_only_finishes_post` | 旧候选零items，经freezeTurn得到outputComplete=true；后处理故障后重开，输入新消息也不推翻沉默。只跑未完成memory／提交，oldAt不变、无故事发送、新消息未标见 |
| `saved_post_result_commits_legacy_changes_once` | 在合成库用现有reject_commit触发器模式让post.result保存后提交失败；重开移除该测试触发器，所有模型调用即失败仍可提交。再恢复一次，任务／经历／记忆行和seen结果不重复，已保存post结果复用 |

全pending用例同时记录旧check的ID／kind，不能只断言turn.done；attempted用例不能用“QQ绝对只发一次”描述假sender断言。完成后的turn.frozenResult会清空，需在提交前捕获候选或断言最终投影，不能在done后要求frozenResult仍存在。

- [x] **T3.7 覆盖工具checkpoint。** `disk_recovery_preserves_tools_without_new_repair_budget`保存repairCount=2、lookupUsed=true、privateLookupResult及真实工具记录。用session.beginOperation创建pendingOperationId；参数化尚未执行与已readPage完成但checkpoint仍指向该operation两种窗口。关闭重开后，前者允许完成原操作，后者provider调用增量必须0；lookup回调不再执行，合法最终个人输出通过。20成功／40失败边界分别从已保存counters验证，不需真的做60次调用；到上限后tools.web=false且provider增量0。首个恢复请求保留旧repair；**模型新响应提出合法web／lookup请求时，现有代码会清理repair内容，但repairCount不清零**，不要把repair.original必须永远存在写成新规则。
- [x] **T3.8 覆盖Host入口。** `host_start_keeps_failure_paused_and_resume_finishes_it`文件库保存paused=true和未完成轮；创建`new SerialHost(new HdsiApp(d), {timers:false, onError})`，start后无模型调用，resume后才恢复。合法分支断言完成及解除暂停；非法分支通过onError捕获ModelFormatError、paused仍true，不对host.resume使用必然reject的断言（pump会经onError报告）。每项finally先await host.stop再关库。
- [x] **T3.9 验收并提交。** 下列命令退出0。新合同断言应能区分旧权限，旧恢复语义本来通过不算缺失红灯；记录夹具修正而非用产品改动迁就。预期提交`test: cover personal task contract disk recovery`，若确有额外产品缺陷单独说明测试与最小修复。

```powershell
npm test -- tests/personal-task-contract-recovery.test.ts tests/recovery.test.ts tests/web-recovery.test.ts tests/chat-recovery.test.ts tests/reply-freshness-recovery.test.ts tests/shared-v3-recovery.test.ts tests/task-projection.test.ts
```

## T4：离线工程验收及交付

**Files:** 修改`docs/v0.5/subsystems/REMAKE_V0.5_DIRECTORS.md`、`REMAKE_V0.5_SCHEDULING.md`、`REMAKE_V0.5_RECOVERY.md`及`docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md`、版本／plans／reviews入口；新建`docs/v0.5/records/personal-task-contract-20261011/DELIVERY.md`并更新records入口。新验证日志和结构化结果归该records任务的evidence／logs。

**Interfaces:** 使用T1～T3的实际结果同步规则；版本、数据库格式及D1边界不变。

- [x] **T4.1 全量验证。** 在隔离目录、显式TEMP／TMP下依次执行，每条必须退出0才继续；失败按实际原因处理。用Vitest JSON报告记录实际文件／测试／失败／跳过数量，不照抄审核50项或历史1370项。

```powershell
npm run typecheck
npm test
npm run build
npm run demo
npm test -- tests/plugin-smoke-contract.test.ts tests/plugin-smoke-build-path.test.ts
```

- [x] **T4.2 插件smoke。** 在同一隔离环境设`$env:HDSI_TEST_LIB_DIR = (Resolve-Path -LiteralPath './lib').Path`，执行`node runtime/plugin-smoke.cjs`；必须退出0且empty_week／required_notice两个场景均完成四阶段提交。先核对解析到的lib属于隔离目录；结束恢复原TEMP／TMP／HDSI_TEST_LIB_DIR。不能指向D:\HDSI-remake正式lib来获取通过结果。
- [x] **T4.3 同步现行说明。** DIRECTORS写预约专用Schema／任务权限，SCHEDULING写程序unread与deferred_reply入口，RECOVERY写V2完整状态矩阵；实现对应写实际文件与测试。个人仍可读经历及later复议；严格Schema不保证模型绝不输出非法JSON，有限修补／暂停保留。
- [x] **T4.4 记录交付并核对。** DELIVERY列实际起止提交、各T1～T3覆盖情况、红绿原因、恢复状态矩阵结果、T4命令／退出码／数量、额外修改依据；状态明确“已实施，未部署／未恢复”。更新V2／本文的实施状态与勾选框，原README／DESIGN／审核证据不改写。检查本地Markdown路径及锚点、`git diff --check`、修改清单和私有／生成文件排除，复核后提交`docs: record personal task contract delivery`。
- [x] **T4.5 交接。** 报告隔离分支／目录、提交序列、测试实数和未执行D1；若尚未合入主目录，明确写出。按用户当前授权处理整合；本实施指令本身不要求远端推送、覆盖正式lib或恢复QQ运行，不为了“全部勾选”执行这些动作。

## 完成条件与方案自检

T1权限／快照及T2业务职责落实，T3逐个保存状态和工具窗口通过，T4工程检查及当前说明同步完成，才可报告离线实施完成。任何未完成检查应列为剩余工作，不用此前审核结果顶替。

本细化已对应V2的T1～T4、五项Review Focus和D1隔离边界；没有新增产品模块、协议或行为决定。采用按任务提交的串行执行，T1→T2→T3→T4；E0是准备步骤。D1仍以[新方案的现场步骤](PLAN_V2.md#d1正式部署及恢复不在本次审查中执行)为准，本文件只交付可执行的离线实施路径。
