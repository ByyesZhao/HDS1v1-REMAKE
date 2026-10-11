# 个人导演任务合同修复设计

日期：2026-10-11。状态：**未实施**。基线：`9a14ea4b5191deda366bbe0c3d9fcdeb7dfd0e78`，项目版本 `0.5.1`。产品代码与此前 `d0a9963` 相同。本文依据当日约14:00聊天失败的只读调查及当前源码编写；[执行方案](README.md)列出修改和验收步骤。

## 1. 故障与证据边界

以下时间均为 Asia/Shanghai（UTC+08:00）。

| 事实 | 证据与含义 |
| --- | --- |
| 14:04:01进入暂停 | 日志 `runtime/data/logs/2026-10-11-3.log:21` 和正式库 runtime.lastFailure 指向 generation；不是发送阶段失败 |
| 最终错误 | `personal_life: taskChanges.0.task: check_messages requires checkReason and messageIds` |
| 失败轮 | `20653c6a-c492-4a63-b7f5-23d94a6f7e54`，轮时间14:03:24.873；含14:02:51收到的新消息及学校通知引用 |
| 失败前未冻结 | frozenResult为空、outputComplete=false、done=false，无该轮outbox或post_job；该轮没有发送或提交，上一轮已确认输出保留 |
| 个人阶段修补耗尽 | 持久checkpoint的repairCount=2；最后保存的repair.errors为 `taskChanges.0.task.messageIds: unknown visible message ID` |
| 最后保存的非法输出 | 创建未来check_messages，checkReason=unread，messageIds引用两条此前已看过的历史消息；本轮visibleIds、reconsiderIds均为空 |
| 实际主叙事输入 | 主叙事已生成3条经历和不可看手机的小憩活动；学校观察使个人生活导演仍应运行，且个人输入包含这些经历与更新后状态 |

最终报错对应的原始第三次响应没有保存。不能把checkpoint中的上一份响应当成最终响应，也不能断言最终只漏了checkReason或只漏了messageIds。只读离线重放最后保存的响应已复现“unknown visible message ID”。本计划不复制聊天正文、QQ标识、完整checkpoint或私有配置到Git。

调查时运行模块解析到项目根目录的 `lib/index.js`，关键构建内容与源码一致；没有证据表明这是加载旧插件导致的故障。以上状态是调查快照，部署前须重新读取。

## 2. 要修复的问题

1. **模型Schema与运行校验不一致。** `src/model/contracts.ts` 允许三种任务，checkReason/messageIds在Schema中可省略，消息ID是任意字符串；parse随后才要求check任务的元数据和当前可见消息权限。
2. **历史可见与当前可操作权限混淆。** 个人导演可以阅读历史聊天，但历史消息ID不属于当前visible/reconsider集合。不能因为模型能看到历史，就把历史消息当成新未读消息或允许据此建检查任务。
3. **模型与程序共同管理检查任务。** `src/app.ts` 已负责未读检查和reply=later复议；taskChanges却仍允许模型直接建、改、取消check_messages，并可把其改成appointment，造成职责重叠。
4. **现有测试未封住这条现场路径。** 需同时覆盖消息输入、主叙事转不可读、学校观察触发personal_life、有限修补和磁盘恢复，不能只测普通聊天输出。

暂停是有限修补失败后的既有保护行为，保留。个人导演读取主叙事经历的链路已存在，也保留；本次不通过跳过个人阶段来规避错误。

## 3. 方案选择

| 方案 | 效果与代价 | 结论 |
| --- | --- | --- |
| A：继续开放check_messages，只补条件必填和ID枚举 | 修改更少，但本轮无合法消息ID时仍没有可创建的检查任务；两方调度职责继续重叠 | 可作为较小修复，但不推荐 |
| B：程序独占消息检查，个人导演只管理双方预约 | 删除模型直接管理check_messages的权限；reply=later仍可表达稍后回应，未读检查继续由程序绑定真实消息 | **推荐** |
| C：扩大ID权限、丢弃非法taskChanges或增加修补次数 | 可能把已读消息变成未读、掩盖合同错误或增加调用成本，不能修复职责问题 | 不采用 |

B是一次明确的模型输出合同调整，不能包装成完全无行为变化的Schema修正。它不新增泛用定时任务，也不改主叙事和个人导演的职责分工。

## 4. 修复后的任务权限

| 内容 | 决策者与合法入口 |
| --- | --- |
| 当前经历、当前活动、行为结果 | 主叙事生成；个人导演读取更新后的experiences/currentScene/energy |
| 想法、下一步意图、回应意愿 | 个人导演生成；仍使用innerThought、nextPlan、reply/contact |
| 不可读期间有真实未读消息 | 程序以remainingUnread中的真实消息创建／维护checkReason=unread的任务，时间取活动预计结束时间 |
| 已看消息需要稍后考虑 | personal_chat／personal_shared使用reply.decision=later与未来reconsiderAt；程序绑定visible+reconsider消息并维护deferred_reply任务 |
| 没有当前可处理消息，想以后看手机 | personal_life可写nextPlan文字意图；不承诺精确一次性检查时间，后续依既有生活调度推进 |
| 双方确认的共同约定 | 个人导演通过taskChanges创建appointment，或修改／取消本轮输入中的pending appointment |
| 共同活动scene_step | 程序管理 |

所有pending任务仍可作为上下文提供；仅可修改ID集合收窄为pending appointment。模型不能修改、取消程序任务，不能把check_messages转换为appointment，也不能以同名描述绕过双方确认规则。文本上的双方同意仍依赖提示及模型判断，本次不新增同意证明协议。

## 5. Schema、提示和运行校验

在 `src/model/contracts.ts` 内建立模型输出专用任务合同，保留通用TaskChange、ScheduledTask及持久化结构。

- create只接受 `{action:"create", task:{kind:"appointment", at, description}}`。
- update只接受合法预约ID，task字段为预约详情的partial；kind如提供只能是appointment。保留只改description或只改at的现有能力。
- cancel只接受合法预约ID。
- action分支及task详情使用strict，拒绝checkReason/messageIds等越权字段。
- 有合法预约时，update/cancel的ID来自同一冻结预约快照的枚举；没有预约时，Schema只开放create分支，不生成空枚举或虚假ID。
- chat／shared的taskChanges仍必填；life的taskChanges仍可省略。reply/contact和其他可选字段的既有规则保留。
- parse沿用同一快照进行权限、重复修改及最终预约类型检查；JSON Schema不能完整表达的语义约束仍由parse承担。

建议私有接点：`personalTaskChangeContract(tasks: readonly ScheduledTask[]): { schema: z.ZodType; appointments: ReadonlyMap<string, ScheduledTask> }`。先structuredClone筛选出的pending预约；Schema和校验共用结果，防止任务输入被修改后权限漂移。`personalTask(...)`现有公开签名保留。

`src/model/prompts.ts` 的personalRules明确：taskChanges只管理双方确认的appointment；check_messages及scene_step由程序管理；稍后回应现有消息用reply=later；私人未来查看意图用nextPlan。三类个人导演的正常请求、工具返回后继续生成和修补请求均使用同一合同，不为旧非法输出另开权限。

示例：本次不可读小憩阶段，个人导演输出合法生活反应，taskChanges省略或为[]，contact按既有资格为false。程序随后自行为真实未读消息建立unread检查；此前历史消息不会被重新标记为未读。模型若仍输出check_messages，则明确校验失败，继续既有有限修补，耗尽后暂停。

## 6. 兼容与恢复边界

- Node.js要求 `>=22.13.0`；沿用TypeScript、Zod 4及Vitest，无新依赖。项目版本保持 `0.5.1`，数据库协议版本不变，不执行迁移。
- 保留repairLimit=2、lookup使用记录、网页配额、pendingOperationId和已确认工具结果。不得清零预算、删除checkpoint或静默吞错。
- **未冻结轮**继续走当前生成合同；旧checkpoint的repair.original仅作为修补材料，不直接转换为合法结果。repairCount=2时仍可发下一次请求；合法响应可通过，非法响应立即再次失败，不额外获得修补次数。
- **已冻结轮**沿既有发送／后处理路径续办，不把历史candidate重新送进新个人输出Schema。通用任务投影／提交逻辑继续支持旧冻结结果，包括旧check→appointment转换。
- 现有 `tests/tasks.test.ts` 的check→appointment睡眠测试代表旧模型权限；实施时替换为“模型转换被拒绝”及“合法新预约仍能提前唤醒”，并补旧冻结结果恢复测试。保留描述更新、未来改期、同ID复议及不可读延期的语义。
- `tests/review-fixes.test.ts` 还允许未来check创建／修改／取消，并把过去check错误固定匹配为at错误；改为统一的程序任务权限拒绝断言。其预约时间规则及记忆测试保留；`tests/task-projection.test.ts` 的旧类型转换测试继续证明通用投影兼容，不能随模型权限收窄删除。
- 不改visible/reconsider/seen权限，不让个人导演绕过不可读状态，不删除学校观察导致的personal_life，也不改混合学校轮的回复新鲜度资格。

## 7. 验收与现场恢复

离线验收必须包含合同、传输、业务流及磁盘恢复四层，具体任务见执行方案。通过标准：现场形态的合法生活输出提交完成；真实未读保留到可读阶段；无历史消息重读、无多余表达发送；非法模型检查任务仍能明确失败并暂停；旧冻结结果能够完成原有流程。

正式恢复在实施、验收通过后单独执行：重新只读查询状态 → 安全停服并确认停止成功 → 保存一致的数据库及实际存在的WAL/SHM、构建与配置备份 → 部署构建及只读启动检查 → 启动后保持暂停 → 经明确恢复指令执行hdsi.resume → 确认旧轮完成、待办按既有顺序推进。下一次实施指令不自动等于发送QQ消息或解除线上暂停的指令。

恢复依冻结轮时间及当前恢复逻辑，不手动把小憩结束时间改到“现在”，也不承诺恢复时人物立刻醒来。检查失败或再次校验失败时保持暂停，保留诊断；已产生新业务提交后不得直接覆盖旧库回滚。当前文档编写不执行以上步骤。

## 8. 非目标

本次不扩大历史消息权限、不增加通用定时查看手机能力、不改回复等待参数、不改模型供应商或配置、不持久化新的原始聊天输出、不重构全局任务系统。当前架构说明在实际实施验收后再同步；本设计只表示待实施方案。
