# 个人导演任务合同修复 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本文是待实施交接文档；当前请求只编写方案，不启动实施、部署或线上恢复。

**Goal:** 修复2026-10-11约14:00个人生活导演非法check_messages导致的生成失败，统一任务权限并验证旧轮恢复。

**Architecture:** 程序独占未读检查与延期复议，个人导演的taskChanges只管理双方预约。动态模型Schema和parse共用冻结预约权限，通用任务投影及旧冻结结果兼容保持。主叙事经历仍完整进入个人阶段。

**Tech Stack:** TypeScript、Zod 4、Vitest、Node.js SQLite、Koishi。

**Spec:** [修复设计、调查证据与行为边界](DESIGN.md)。返回[计划入口](../README.md)或[版本入口](../../README.md)。

日期：2026-10-11。状态：**未实施**。基线：`9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78`／`0.5.1`。任务顺序T1→T2→T3→T4；D1为另行授权的正式部署和恢复清单。勾选仅在实际完成并保存证据后进行。

## Global Constraints

- Node.js要求 `>=22.13.0`；沿用TypeScript、Zod 4及Vitest，无新依赖。
- 项目版本保持 `0.5.1`，数据库协议版本不变，不执行迁移。
- 保留repairLimit=2、lookup使用记录、网页配额、pendingOperationId和已确认工具结果。
- 不改visible/reconsider/seen权限，不让个人导演绕过不可读状态，不删除学校观察导致的personal_life，也不改混合学校轮的回复新鲜度资格。
- 所有现场复现使用脱敏合成输入和隔离测试库，禁止在线模型、真实QQ发送及写入正式库。
- 实施先按superpowers:using-git-worktrees建立或复用隔离工作目录；后续构建、demo及smoke均在该目录执行，不能覆盖正在运行的正式lib。
- 修改限制在个人输出合同、提示及必要回归；只有测试证明既有程序调度与设计不一致时才修改 `src/app.ts`，禁止为了通过测试改全局投影语义。
- 本轮只编写方案。后续实施的提交按项目要求进行；本文不授权推送、服务重启或hdsi.resume。

## Review Focus

1. 本轮没有可见消息却有学校观察：personal_life仍读取主叙事，程序绑定真实未读消息安排检查；T2覆盖。
2. 无可修改预约／存在历史已完成预约：Schema不产生空枚举或允许非pending ID；T1覆盖。
3. 消息检查改成预约、取消检查或夹带检查字段：新模型输出拒绝，合法预约与睡眠调整仍正常；T1、T2覆盖。
4. repairCount=2且未冻结：恢复保留预算，合法响应可通过，非法响应仍暂停；T3覆盖。
5. 旧冻结结果带原有check→appointment变更且已有确认输出：续办原结果，不重算、不重复发送；T3覆盖。

## 文件和接点

| 文件 | 用途 |
| --- | --- |
| 修改 `src/model/contracts.ts` | 私有模型任务合同与同源运行校验；不修改通用TaskChange |
| 修改 `src/model/prompts.ts` | 三类个人导演共用的任务职责提示 |
| 新建 `tests/personal-task-contract.test.ts` | 动态Schema、parse、真实Transport请求的离线断言 |
| 新建 `tests/personal-task-contract-flow.test.ts` | 协议2下的现场形态与学校观察组合 |
| 修改 `tests/tasks.test.ts` | 显式替换旧模型转换权限测试，保留预约／复议语义 |
| 修改 `tests/review-fixes.test.ts` | 更新旧check权限及错误路径断言；保留无关预约／记忆回归 |
| 新建 `tests/personal-task-contract-recovery.test.ts` | 文件数据库关闭／重开、真实ModelClient与假Transport恢复 |
| 更新现行导演、调度、恢复说明及实现对应 | 实施后记录新权限和实测边界 |
| 新建 `docs/v0.5/records/personal-task-contract-20261011/DELIVERY.md` | 实施后交付证据；当前不创建交付结论 |

### T1：统一模型输出Schema和任务权限

**Files:** `src/model/contracts.ts`、`tests/personal-task-contract.test.ts`、`tests/tasks.test.ts`、`tests/review-fixes.test.ts`。传输断言参考现有 `tests/model-call-context.test.ts`、`tests/web-model-tools.test.ts`。

**Interfaces:** 保留 `personalTask(kind, at, tasks, mode, messageIds, sharedMeta?, publicNarration?, eligibility?) : ModelTask<PersonalResult>`。新增私有 `personalTaskChangeContract(tasks: readonly ScheduledTask[]): { schema: z.ZodType; appointments: ReadonlyMap<string, ScheduledTask> }`，T2/T3经personalTask使用，不导出新公共API。

- [ ] 写失败测试 `personal_task_changes_are_appointment_only`：对chat/life/shared输出中的create check、update/cancel check、check→appointment、scene_step及夹带check字段逐项断言parse抛错；shared提供合法sharedMeta，避免先触发无关错误。
- [ ] 写失败测试 `appointment_ids_come_from_a_frozen_pending_snapshot`：合法pending预约可部分更新和取消；未知、completed、cancelled ID拒绝；构建合同后改动原tasks也不能扩大权限；无预约的Schema只保留create。
- [ ] 用假fetch检查ChatCompletionsTransport的json_object与json_schema两种模式请求：模型合同只给appointment，ID集合同parse；工具分支仍保留。修补及工具续接请求沿用该合同。解析schema结构断言，避免依赖字符串快照或只比源码文本。
- [ ] 将 `tests/tasks.test.ts` 旧 `shortens existing sleep for an explicit future check_messages to appointment rescheduling` 改为拒绝模型转换，并增加创建合法预约提前唤醒测试；时间保持原场景：原wakeAt=2026-10-08T08:30:00+08:00，预约08:00，新wakeAt=07:00。
- [ ] 更新 `tests/review-fixes.test.ts`：未来check create/update/cancel由允许改为拒绝；旧非未来检查测试不再固定匹配at错误，改断言taskChanges权限失败。保留appointment在NOW创建的既有语义及全部记忆断言；全局task-projection旧转换测试不改。
- [ ] 运行 `npm test -- tests/personal-task-contract.test.ts tests/tasks.test.ts tests/review-fixes.test.ts`，确认新增断言因旧合同权限开放失败；保存失败测试名，排除fixture或语法错误。
- [ ] 实现私有合同：clone pending appointment快照，动态构造strict create/update/cancel；空ID集合只构造create；life继续可省略taskChanges。personalTask按角色extend对应schema，validate复用预约Map并保留重复修改检查与其他控制规则。
- [ ] 同一命令转绿，并运行 `npm test -- tests/task-projection.test.ts tests/model-call-context.test.ts tests/web-model-tools.test.ts` 与 `npm run typecheck`。旧全局check投影兼容必须保持。
- [ ] 审查并提交T1代码与测试，建议提交说明 `fix: constrain personal task changes to appointments`；不推送或部署。

### T2：明确提示职责并验收现场业务流

**Files:** `src/model/prompts.ts`、`tests/personal-task-contract-flow.test.ts`；必要时修改 `src/app.ts`。复用 `tests/chat-fixture.ts` 的modern()和 `tests/world-school-fixture.ts` 的schoolItem()/expand()；runtime.environmentPlanningVersion显式设为2。新输入通过InputBuffer接受，沿协议2保留聊天归属，不把legacy saveInput当成协议2完整现场fixture。

**Interfaces:** 沿T1 personalTask合同；沿用 `generateTurn(...)`／`HdsiApp.runTurn(...)`、`reply.decision=later`、`maintainTask(...)`。不新增调度API。

- [ ] 写提示断言 `personal_rules_assign_checks_to_program`：三类personal均说明只管理预约、检查由程序管理；删除旧“taskChanges最终check_messages.at晚于at”的开放管理措辞。正常、修补、工具续接均包含同一规则。
- [ ] 写集成测试 `school_observation_keeps_personal_life_when_phone_is_inaccessible`：合成一条新未读和两条历史已读，真实学校通知观察进入narrative；活动phoneAccess=false、结束时间晚于轮时间，personal_life给合法想法／nextPlan及contact.willing=false、taskChanges=[]。
- [ ] 断言个人输入experiences和更新后活动完整；visible/reconsider均空；narrative→personal_life执行，expression不调用；轮done=true、runtime不暂停，真实未读seenTurnId仍空，程序unread任务只绑定新消息且at为预计结束时间；历史消息seen标记保持。
- [ ] 写对照 `inaccessible_without_observation_may_skip_personal`：既无学校观察又无其他个人触发时仍可跳过；原 `tests/personal-stage-preparation.test.ts` 行为保留。
- [ ] 运行 `npm test -- tests/personal-task-contract-flow.test.ts tests/prompt-policy.test.ts`，确认提示断言红灯，业务组合测试记录修复前结果；已有正确调度可以原本就是绿灯，不人为制造失败。
- [ ] 改personalRules为设计第5节的职责；life未来查看意图只写nextPlan，不伪造reply=later或新增定时器。若集成测试暴露独立调度缺陷，先记录失败证据再做最小修改，否则保持app调度。
- [ ] 运行上一步命令，加跑 `npm test -- tests/tasks.test.ts tests/task-projection.test.ts tests/personal-stage-preparation.test.ts tests/phone-access-flow.test.ts tests/phone-access-contracts.test.ts tests/world-school-personal-reminder.test.ts`；确认同ID复议、不可读延期、预约改期和睡眠语义全部保留。
- [ ] 审查并提交T2，建议提交说明 `fix: clarify program-owned message check scheduling`。

### T3：验证有限修补与旧轮磁盘恢复

**Files:** `tests/personal-task-contract-recovery.test.ts`。复用 `tests/chat-recovery.test.ts`、`tests/web-recovery.test.ts` 的磁盘fixture；假Transport须经真实ModelClient／任务parse。预期无需修改恢复源码；若发现缺陷，先补独立红灯测试及最小修复再继续。

**Interfaces:** 保留 `ModelClient.runModel(...)`、`HdsiApp.resumeUnfinishedTurn()`、`projectTaskChanges(...)`，不新增checkpoint格式或清理工具。

- [ ] 写 `unfrozen_recovery_uses_current_contract_without_resetting_repairs`：在临时文件库保存未冻结轮和repairCount=2、旧非法repair.original；关闭重开后续办，假Transport返回合法个人输出。断言首次请求是新预约合同且保留旧repair，轮可完成；不创建新的额外修补预算。
- [ ] 写同场景非法响应分支：Transport再次返回check_messages，断言一次响应后ModelFormatError、generation暂停，repairCount保持2，未冻结、无该轮输出或后处理提交。响应次数断言只计该personal阶段，避免把恢复重算的narrative算入。
- [ ] 验证工具恢复：保留lookupUsed、工具成功／失败计数及已完成结果；带pendingOperationId的隔离用例沿既有恢复合同完成，不因更新任务Schema重新执行已确认网页操作。
- [ ] 写 `legacy_frozen_task_conversion_finishes_without_reparse`：用合成旧candidate冻结check→appointment变更；关闭重开，令叙事／个人／表达阶段“被调用就失败”，记忆后处理提供合成合法输出；恢复后原预约投影合法提交。含一个已确认输出与一个待续输出，确认已确认项不重发、剩余项最多发送一次，旧业务结果未重新生成。
- [ ] 运行 `npm test -- tests/personal-task-contract-recovery.test.ts`。新增新合同断言应在旧基线失败，已有兼容断言允许原本通过。fixture遵循实际turn/outbox/checkpoint结构，不从生产库拷贝记录。
- [ ] 若前两项发现恢复缺陷，按设计第6节最小修复；禁止删除checkpoint、重置预算、把非法旧JSON直接当成合法结果，禁止为已冻结结果增加新Schema重验。
- [ ] 运行 `npm test -- tests/personal-task-contract-recovery.test.ts tests/web-recovery.test.ts tests/chat-recovery.test.ts tests/reply-freshness-recovery.test.ts tests/shared-v3-recovery.test.ts tests/task-projection.test.ts`，确认离线恢复全部通过。
- [ ] 审查并提交T3测试及确有必要的恢复修复，建议提交说明 `test: cover personal task contract recovery compatibility`。

### T4：工程验收与现行说明同步

**Files:** `docs/v0.5/subsystems/REMAKE_V0.5_DIRECTORS.md`、`REMAKE_V0.5_SCHEDULING.md`、`REMAKE_V0.5_RECOVERY.md`、`docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md`，以及版本／计划入口和新交付页。

**Interfaces:** 文档描述T1～T3已验证的合同；沿项目既有npm scripts和插件smoke，全部使用隔离构建／数据。

- [ ] 运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run demo`。每步确认退出0再继续；全量测试通过数记录实际输出，不复用历史1370项数字。
- [ ] 构建后运行 `npm test -- tests/plugin-smoke-contract.test.ts tests/plugin-smoke-build-path.test.ts`；另在隔离工作目录设置 `$env:HDSI_TEST_LIB_DIR = (Resolve-Path .\lib).Path` 并执行 `node runtime/plugin-smoke.cjs`，确认empty_week／required_notice四阶段提交且退出0，结束恢复原环境值。该入口使用离线fixture，不使用正式runtime启动作为smoke。
- [ ] 更新三份子系统说明及实现对应：写明模型任务只管理预约、程序消息检查入口、主叙事→个人可见性、旧冻结兼容；不宣称模型完全不会生成非法JSON。
- [ ] 写交付页：源码基线、实际修改、红绿证据、测试与构建结果、脱敏复现、未执行线上范围；更新本计划状态及导航。仅完成离线实施时标记“已实施，未部署／未恢复”。
- [ ] 核对修改Markdown链接、`git diff --check`和变更范围；确认无私有聊天、配置、正式库及生成物被加入提交。
- [ ] 审查并提交T4；报告实际通过项及剩余D1边界。

### D1：正式部署与失败轮恢复（单独执行）

前置：T1～T4完成；获得明确的正式部署授权，并在恢复会实际产生QQ输出前获得明确恢复指令。本节当前保持全部未勾选，不作为离线交付条件。

- [ ] 只读重查暂停、unfinished turn、frozenResult、outbox确认状态、输入seen标记、pending批次及网页checkpoint；对照调查快照，状态已推进时按当前数据重定恢复目标。
- [ ] 使用项目安全停止入口并确认成功退出、无在途写入；停止失败保持现场，不强行终止。
- [ ] 停服后创建唯一私有备份目录，保存一致数据库及实际存在的WAL/SHM、当前lib和配置，记录哈希及清单；不将备份入Git。不得只复制运行中主库。
- [ ] 部署已验收构建；用项目启动入口的 `--check` 做只读检查，核对runtime解析到本次lib，版本仍为0.5.1；不用check:models冒充离线检查。
- [ ] 启动服务，确认runtime仍暂停且没有自动恢复发送；若暂停状态变化先停止推进并调查。
- [ ] 依据明确恢复指令执行 `hdsi.resume`；保持旧轮／批次／checkpoint，先续办旧轮。不手动改at、seen标记、任务到期时间，不清除错误轮或重置repairCount。
- [ ] 确认失败轮进入实际终态、此前确认输出未重发，未读／复议任务按当前资格推进，个人导演仍获得主叙事经历；有新错误时保留暂停及诊断，记录本次合法／非法响应结果。
- [ ] 记录部署及恢复结论。部署检查失败可在未产生新业务写入的前提下退回匹配备份；恢复已产生发送或提交时，先审计新增状态，不直接用旧库覆盖。

## 方案自检

设计中的合同收窄、历史消息权限、模型／程序职责、混合学校触发、旧测试替换、有限修补、旧冻结兼容分别由T1、T2、T3覆盖；工程证据与现行文档由T4覆盖；生产恢复由D1单列。新增文件均为回归测试或任务文档，无新模块和依赖。当前仅完成方案编写及导航检查，不把复现或历史验收计为本方案实施结果。
