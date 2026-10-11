# 个人导演任务合同修复 V2 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. T1～T4已按本文实施并离线验收；后续用户授权Git上传、安全停止与放入构建，现场状态另记。

**Goal:** 收窄个人导演任务输出为双方预约，消除与程序消息检查的职责重叠，并保持未尝试生成、冻结发送及后处理各自的恢复语义。

**Architecture:** 在personalTask内部冻结pending预约权限，让模型Schema和parse共用；check_messages继续由程序及reply=later管理。保留主叙事→个人阶段、通用TaskChange和投影。兼容判定按发送尝试／outputComplete／回复代际，不能只看frozenResult。

**Tech Stack:** TypeScript、Zod 4、Vitest、Node.js SQLite、Koishi；无新依赖。

**Spec:** 本文“设计合同与恢复矩阵”为V2规范；故障调查沿用[原设计](DESIGN.md)§1～3的证据边界，审核发现及探针见[方案审核](../../reviews/personal-task-contract-20261011/REVIEW.md)。本方案替代[原执行稿](README.md)，原稿保留，不与V2混用。

日期：2026-10-11。状态：**T1～T4已实施，离线验收通过；现场状态另列**。源码基线：`9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78`，版本`0.5.1`。T1→T2→T3→T4；正式部署／恢复D1另列。

交接实施时同时提供[细化实施文档](EXECUTION_PLAN.md)：本文规定设计合同，细化文档补充准备步骤、具体修改接点、测试夹具、断言、命令及交付要求。两份即可指导Sol执行T1～T4，D1仍不随离线实施自动执行。

实施结果见[交付](../../records/personal-task-contract-20261011/DELIVERY.md)。下列原交接指令的现场／推送限制属于编制时范围；用户随后授权上传Git并安全停止、由用户手动重启。具体授权及实际边界见[现场记录](../../records/personal-task-contract-20261011/DEPLOYMENT.md)，未授权hdsi.resume。

## Global Constraints

- Node.js `>=22.13.0`，版本维持`0.5.1`，数据库协议不变，不新增迁移、后台任务或通用定时器。
- 程序独占check_messages和scene_step；个人导演仍能读取获准主叙事经历，chat/shared仍能reply=later，life的未来意图写nextPlan。
- 不扩大visible/reconsider/seen权限，不改变学校观察触发personal_life、普通回复新鲜度资格或15秒参数。
- 同一逻辑阶段保留repairLimit=2、lookupUsed、工具计数和已确认结果；不通过手动改stageKey、删checkpoint或清零预算换取成功。普通回复合法换代仍按既有程序处理旧阶段，不把“保留”写成禁止程序原有换代清理。
- 首次发送尝试后保留旧候选；本地确认项不重发，未知发送允许重试，不承诺QQ绝对一次。输出已完成的沉默轮也只续后处理。
- 不以本方案改变resumeUnfinishedTurn/discardUnattempted的时钟或重生成规则；不能给应重生成的候选添加“旧Schema通行证”，也不能重验必须保留的候选。
- 实施按using-git-worktrees建立或复用隔离目录；合成配置／库／模型和sender，禁止实际模型、在线搜索和QQ发送。测试、构建、demo、smoke不得覆盖正式lib或数据。
- 原设计的现场状态是历史调查快照；本轮没有重新读取正式日志／数据库。实施交付与实际恢复分别记录。

## 设计合同与恢复矩阵

### 1. 模型权限与程序职责

| 输出／任务 | 合同 |
| --- | --- |
| taskChanges.create | 只允许`{action:"create",task:{kind:"appointment",at,description}}` |
| taskChanges.update | ID只来自构建该personalTask时pending appointment的克隆快照；task允许只改at、description，kind如提供只能为appointment |
| taskChanges.cancel | 同一预约ID集合；同ID重复变更拒绝 |
| 程序任务／越权字段 | create/update/cancel action对象及task对象使用strict；拒绝check_messages、scene_step、checkReason、messageIds、客户端自定create.id等越权字段，不默默删掉后接受 |
| 空预约集合 | 只构造create分支，不生成空枚举；仍允许taskChanges=[] |
| 必填及原有语义 | chat/shared的taskChanges必填，life可省略；保留预约at=本轮at、部分更新、睡眠／动作／shared权限，不擅自新增预约必须未来的规则 |
| 不可读且有真实未读 | 程序沿remainingUnread维护unread检查；已读消息不能当未读重入 |
| 已读后延后考虑 | chat/shared经reply=later和未来reconsiderAt表达；程序维护deferred_reply；life没有reply字段，不新增未来查看手机定时器 |

所有pending任务可继续供模型阅读，但不因此获得修改程序任务的权限。双方确认仍由提示及模型判断，不新增同意证明协议。通用TaskChange／ScheduledTask／projectTaskChanges保持旧持久结果可读；严格限制只作用于新个人输出。旧check→appointment投影兼容测试保留，不能改通用投影来迁就新Schema。

建议私有接点仍为`personalTaskChangeContract(tasks: readonly ScheduledTask[]): { schema: z.ZodType; appointments: ReadonlyMap<string, ScheduledTask> }`。先筛选并structuredClone，再生成ID枚举及校验Map；保留personalTask原公开签名。运行校验复用同一快照，并继续检查重复变更、回复时间、场景、睡眠与动作权限。

### 2. 恢复矩阵（覆盖原设计§6／§7的宽泛说法）

| 保存状态 | 应有行为 | 新合同／时间 |
| --- | --- | --- |
| 无候选，outputComplete=false且无发送尝试 | 经过既有新鲜度／资格检查后，discardUnattempted并重生成 | 同ID更新turn.at为恢复时刻，重新调用主叙事与适用个人阶段，使用新合同 |
| 已冻结但全部outbox仍pending、无firstAttemptAt，且outputComplete=false | 与上一行相同；frozenResult本身不赋予保留资格 | 丢弃未尝试旧候选，不发送旧稿，不保留旧模型check任务；新输出通过新合同 |
| 任意sending/retry/confirmed或已登记firstAttemptAt | 保留整组候选，confirmed跳过，其余按原规则续发 | 保留turn.at，叙事／个人／表达不重算，不用新Schema重验旧candidate |
| outputComplete=true（包括零输出沉默） | 只继续基础记忆／正式提交 | 保留turn.at与候选；已保存post结果直接使用，不重生成或重发 |
| 普通回复已过期／不可读或state=waiting | 按现有等待、重选、换代／事件接管规则处理 | 不能为本次修复强行执行或保住旧generation；原混合学校轮不强加普通回复资格 |

本次事故按原调查是“无候选、无发送尝试”，不是保留14:03轮时间的冻结发送恢复。程序可能在恢复时重算新的经历／活动和查看资格；不能保证仍为小憩、仍无visible消息或仍调用personal_life，也不能承诺恢复后必定醒来。

无replyFreshness的混合学校轮使用`stageKey=personal`；角色从life变为chat时，WebSearchStore.openStage复用runId并更新taskName，原repairCount、repair.original及工具进度继续存在。新的个人请求必须展示新角色的新合同，而不是重放旧个人结果。普通reply阶段键包含generation和taskName，测试断言按各自真实键规则，不能人为共用预算或扩大旧来源权限。

## Review Focus

1. pending appointment集合为空／包含历史终态／构建后原数组被改动：Schema与parse权限不漂移，T1验证。
2. 主叙事转不可读但确实观察学校通知：个人阶段保留、未读由程序正确绑定，T2验证。
3. 有frozenResult但从未尝试发送：必须走新合同重生成；不能保留旧check转换，T3验证。
4. 只有首次retry、没有confirmed，或零输出已封口：仍不重生成；不是“有确认才保留”，T3验证。
5. 恢复时个人角色变化且原repairCount=2：合同更新、预算／已确认工具不重置，T3验证。

## T1：预约专用动态Schema与权限校验

**Files:** 修改`src/model/contracts.ts`、`tests/tasks.test.ts`、`tests/review-fixes.test.ts`；新建`tests/personal-task-contract.test.ts`。不改通用types／task-projection。

**Interfaces:** 保留personalTask公开签名，新增上文私有personalTaskChangeContract；后续通过personalTask消费。

- [x] 写失败测试：chat/life/shared拒绝check创建、check更新／取消／转预约、scene_step、预约夹带check字段；给shared合法sharedMeta，避免无关错误先阻断。create输入只带模型合法基础字段，不用存储行的id/status污染权限断言。
- [x] 写集合测试：pending预约的部分更新／取消成功；unknown/completed/cancelled ID拒绝；重复修改拒绝；空预约仅create；构建后新增／修改原tasks不改变已建Schema／parse。life省略taskChanges、chat/shared必填、原动作与contactEligible=false仍保持。
- [x] 假fetch截获json_object／json_schema请求，检查最终任务Schema分支只有appointment及正确ID；工具分支仍存在。经真实ModelClient触发修补和工具续接，检查合同不漂移，不用整个提示中是否出现“check_messages”作为断言。
- [x] 替换tasks.test旧“模型check→appointment提前醒”测试为拒绝转换及合法新预约提前醒（原08:30→07:00，预约08:00）；review-fixes的未来check允许用例改为拒绝。保留预约NOW和无关记忆／睡眠用例，task-projection的旧转换用例不删除。
- [x] 运行`npm test -- tests/personal-task-contract.test.ts tests/tasks.test.ts tests/review-fixes.test.ts`，记录新增合同测试确因旧权限失败后，实现strict合同和同源validate，再运行至通过。
- [x] 运行`npm test -- tests/task-projection.test.ts tests/model-call-context.test.ts tests/web-model-tools.test.ts`及`npm run typecheck`，复核diff后提交T1。

## T2：提示职责与现场形态业务流

**Files:** 修改`src/model/prompts.ts`；新建`tests/personal-task-contract-flow.test.ts`。只有离线用例证明程序调度另有缺陷才最小改`src/app.ts`，不把计划错误改成产品行为。

**Interfaces:** 沿T1合同、reply=later及maintainTask；沿generateTurn/HdsiApp.runTurn，不增加调度API。

- [x] 三类personal提示说明任务只管预约、检查由程序处理，删除允许模型直接改check期限的旧句。chat/shared延后回应使用reply=later，life未来意图只写nextPlan。正常／修补／工具续接均携带同一职责提示。
- [x] 复用modern()、InputBuffer及学校fixture，显式环境协议2；两条历史已读、一条新输入。选择含真实已发布通知ref的请求，让叙事在合法时间获知通知后转为不可读活动。观察经历时间不得早于通知实际releasedAt／publishAt；可用叙事前已可读状态证明该经历合法，不让fixture先因学校时间校验失败。
- [x] 用例`school_observation_keeps_personal_life_when_phone_is_inaccessible`断言经历和更新后活动进入个人输入，visible/reconsider空，personal_life执行、expression不执行；轮提交，真实新输入seen仍空，unread检查只绑定该新消息且at为活动预计结束；历史seen不变。
- [x] 对照无学校观察且无其他触发的不可读轮可以跳过personal；再次可读后用reply=later维护同一deferred任务、同ID延期仍不改已读状态。学校观察用例本来通过可以保留绿灯，不人为制造红灯。
- [x] 先记录提示测试红灯，再修改提示；运行`npm test -- tests/personal-task-contract-flow.test.ts tests/prompt-policy.test.ts tests/tasks.test.ts tests/task-projection.test.ts tests/personal-stage-preparation.test.ts tests/phone-access-flow.test.ts tests/phone-access-contracts.test.ts tests/world-school-personal-reminder.test.ts`至通过，复核后提交T2。

## T3：按保存状态验证磁盘恢复

**Files:** 新建`tests/personal-task-contract-recovery.test.ts`，参考现有recovery、chat-recovery、reply-freshness-recovery、web-recovery。预期不改恢复产品代码。

**Interfaces:** 真实Storage文件关闭／重开、ModelClient＋假Transport、HdsiApp.resumeUnfinishedTurn／必要的SerialHost.resume。每个fixture重建Storage、WebSearchStore、WebSearchService、上下文组件，不能沿用已关闭连接。

- [x] `unfrozen_recovery_keeps_repairs_with_new_time`：未冻结personal_life失败，checkpoint.repairCount=2；推进时钟再重开。同ID恢复的首次**个人**请求使用新合同，turn.at为恢复时刻，原repair.original仍在。同角色合法响应完成；再次非法check响应立即ModelFormatError且计数仍2，无该轮故事输出／提交。
- [x] `mixed_school_recovery_can_switch_life_to_chat`：冻结输入选择含学校通知、无replyFreshness；恢复叙事改为可读，使新个人角色为chat。断言同personal阶段runId、taskName更新、repairCount仍2，新输入／Schema与chat匹配，旧life repair只作修补材料。合法及非法响应分别验收；不使用静止时钟掩盖角色切换。
- [x] `unattempted_legacy_candidate_is_regenerated_under_new_contract`：构造旧check→appointment候选、全pending outbox、无firstAttemptAt、outputComplete=false。推进时钟并重开后，旧稿不发送、旧变化不直接提交；新个人输出必须通过预约合同。用会记录新叙事／个人／表达的runner，不把它们设成“调用即失败”。
- [x] `attempted_legacy_candidate_finishes_without_personal_reparse`参数化：一个confirmed＋待续项，以及首项retry但没有confirmed。冻结旧check→appointment结果后重开，叙事／个人／表达调用即失败，记忆合法；保持旧at和候选，confirmed不重发，重试项按现有规则完成。这里不能宣称未知QQ结果永不重复。
- [x] `silent_complete_legacy_candidate_only_finishes_post`：零输出、outputComplete=true、旧候选和未完成post；新消息不推翻已封口决定。重开只做后处理；另覆盖post.result已保存时不重做记忆，重复恢复不重复投影任务。
- [x] 同逻辑阶段checkpoint覆盖lookupUsed及20／40计数保留；pendingOperationId分别为未完成和已done但尚未写回checkpoint，后者恢复不得再调用provider。到预算2的工具续接不额外增加格式修补次数；确认结果仅按原合同复用。
- [x] 新合同特有断言在旧代码失败、既有恢复行为允许原本通过；任何fixture错误单独修正并记录，不能据此改产品。运行`npm test -- tests/personal-task-contract-recovery.test.ts tests/recovery.test.ts tests/web-recovery.test.ts tests/chat-recovery.test.ts tests/reply-freshness-recovery.test.ts tests/shared-v3-recovery.test.ts tests/task-projection.test.ts`，检查各分支结果后提交T3。

## T4：工程验收及现行说明同步

**Files:** 三份现行DIRECTORS／SCHEDULING／RECOVERY、实现对应、版本／计划入口；实施时新建`docs/v0.5/records/personal-task-contract-20261011/DELIVERY.md`。

**Interfaces:** 描述T1～T3实际验证后的新合同；原设计和本审核继续保留其基线。

- [x] 在隔离目录依次运行`npm run typecheck`、`npm test`、`npm run build`、`npm run demo`，各退出0才继续；记录实际全量数量和失败／跳过，不复用本审核50项或旧交付1370项。
- [x] 构建后执行`npm test -- tests/plugin-smoke-contract.test.ts tests/plugin-smoke-build-path.test.ts`；将HDSI_TEST_LIB_DIR设为隔离lib的绝对路径，执行`node runtime/plugin-smoke.cjs`，确认两个场景四阶段提交。TEMP／TMP指向隔离目录下已创建的临时目录，结束恢复原环境变量。
- [x] 现行说明写预约专用输出、程序未读／复议入口，以及本方案恢复矩阵；不得把“合同更窄”写成模型绝不生成非法JSON。交付页记录代码基线、红绿证据、原预算恢复及未执行在线范围。
- [x] 检查Markdown链接、`git diff --check`及提交清单，排除生成物／配置／私有库；更新为“已实施，未部署／未恢复”，复核后提交T4。不得把文档审查当成功能交付。

## D1：正式部署及恢复（不在本次审查中执行）

前置：T1～T4完成；按当时用户授权确认部署和可能产生QQ输出的恢复范围。

- [x] 只读重查paused、unfinished turn、frozenResult、outputComplete、每项outbox状态／confirmedAt、firstAttemptAt、replyFreshness代际／scope、消息seen、批次、阶段键和checkpoint。先按恢复矩阵分类，不只统计confirmed数。
- [x] 安全停止并确认成功，无在途写入后创建唯一私有备份，保存一致DB及实际WAL/SHM、lib和配置及hash；停止失败保持现场，不强制结束。不把备份入Git。
- [ ] 部署已验收构建，启动入口`--check`通过且解析到目标lib；启动后确认原暂停仍保留。不能以重启代替resume，也不用check:models当离线检查。
- [ ] 经明确恢复指令执行hdsi.resume；不手改at／seen／任务时间或checkpoint。**无尝试且未完成输出时，允许既有代码自行更新at和重新决定活动／个人角色**；已尝试／输出完成则核对保留旧at。普通waiting分支沿原换代规则。
- [ ] 记录实际恢复角色、阶段身份／预算、旧轮终态、已确认输出未重发及后续任务资格；合法回应不保证仍为沉默，新错误保持暂停和诊断。实际发送可能包括错误通知，不能把“无故事输出”写成“绝无QQ输出”。
- [ ] 部署检查失败且尚无新业务写入时可回退匹配备份；启动后已产生状态写入、发送或提交时先审计，不能直接覆盖旧库。记录“已部署”和“已恢复”的实际完成程度。

D1现场执行：只读分类、安全停止／备份和部署后只读检查已完成，见[现场记录](../../records/personal-task-contract-20261011/DEPLOYMENT.md)。第三项的启动后确认待用户手动启动；resume及其后现场验收未执行。

D1现场执行：只读分类、安全停止／备份和部署后只读检查已完成，见[现场记录](../../records/personal-task-contract-20261011/DEPLOYMENT.md)。第三项的启动后确认待用户手动启动；resume及其后现场验收未执行。

## 自检与交接

T1对应模型权限，T2保留生活／学校／消息职责，T3覆盖完整恢复矩阵和阶段切换，T4确认工程结果，D1仅指导将来现场操作。没有新增产品模块、持久格式、权限放宽或修补预算。审核已运行的6文件50项测试及合成探针仅证明当前基线的行为；该审核证据保留历史含义；T1～T4复选框已按本次执行勾选，D1未执行项仍留空。
