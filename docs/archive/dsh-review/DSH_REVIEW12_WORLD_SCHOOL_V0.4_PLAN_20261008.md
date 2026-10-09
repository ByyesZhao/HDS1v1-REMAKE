# 世界与学校规划 V0.4 实施细化与执行计划复核（DSH）

日期：2026-10-08。对象：[实施细化](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)、[执行计划](WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md)，对照[方案](WORLD_SCHOOL_PLANNING_V0.4_PROPOSAL_20261008.md)与当前 `src/`。

方式：只读文档与源码，**没有运行测试或服务，没有访问正式库或私有配置，没有修改任何文件**。

结论：**两份文档可以开工，质量高于前几个模块的细化。** 我上一轮提出的两条升级路径问题都已按建议处理（`normalizeSchoolModels` 在 schema 解析前补缺、旧环境轮用 `legacyDisposition` 退出未完成门禁），而且细化把"客观计划／已发布通知／角色已知"三层知识分开落到具体字段，这是本轮最有价值的设计。**有 3 处建议开工前定，另有 4 处小项。**

---

## 1. 上一轮两条的落实核对

- **配置扩容阻塞启动**：细化 §2 新增 `normalizeSchoolModels(raw)`，明确在 `settingsSchema.parse` **之前**运行，只从旧 `models.school` 复制缺失的新键、显式新项优先、格式错误不回退、加载器不写回文件；计划任务1 的六条用例（`legacy_models_before_parse`、`partial_override`、`explicit_invalid_no_fallback`、`all_new_without_old`、`missing_roles_named`、`loader_no_write`）正好覆盖我担心的每个分支。**落实到位。**
- **旧库未完成环境轮**：细化 §3.1 给 `TurnRecord` 加 `legacyDisposition/closedAt/replacementBatchId`，并把未完成查询统一为 `!done && legacyDisposition !== 'superseded'`；§9 第 4 步明确"设 superseded、**保留 `done=false`**、不应用未提交结果、普通／共同未完成轮不动"。这比"标成成功"或"直接排除"都更稳。**落实到位。**

---

## 2. 建议开工前定的三处

### 2.1 上游变化后的更正通知没有进入周任务的必需集合

这条是三个文档串起来看才暴露的。链路是：

- 细化 §5（`applySchoolChanges`）：「上游更改提交时立即使相关旧 scheduled／available 通知 invalidated、标实例 `needsExpansion`；周步骤之后填新实例与**更正通知**」；
- 但 §5 同一段的必需集合定义是：「`required` 集合来自未覆盖／变更上游及已有通知策略」，`requiredNoticeKeys` 的构成里只提了"当前 issue"；
- 计划任务4 的用例里有 `upstream_change_immediately_invalidates_unread` 与 `read_snapshot_survives_reschedule`，**没有一条断言"更正通知必须被生成"**。

也就是说：invariant 部分（旧通知失效、实例标 `needsExpansion`）是程序保证的，而"必须补一条更正通知"目前只是散文要求。如果模型在 `school_week` 那一步返回空变更，覆盖校验会通过，于是**角色会一直按旧时间行动，直到下一次上游改动或下一次定时提醒**——而这恰恰是方案 §7.1 想避免的（"改期及时更正"）。

建议在细化 §5 明确一句："上游 `deliveryRevision` 提升且存在已失效未读通知时，程序为对应实体写入 `requiredNoticeKeys`（kind=`change`），模型必须给出该更正候选，否则覆盖校验不通过。"并在任务4 补一条用例（例如 `reschedule_requires_correction_notice`）。

### 2.2 纯通知轮需要"发布点"落位

细化 §7 写得很完整（选择条件、`contactEligible=false`、睡眠暂存、共同合并、拒看后的 `nextWakeAt`），§8 规定了主叙事／个人的上下文接口，任务5 也有两组用例。但**没有一处写明 `releaseSchoolNotices` 与 `schoolNoticeDeadline` 由哪个模块调用**：

- 细化 §4 的接口清单属于 `src/environment/`（`ensureEnvironmentBatch`、`selectEnvironmentStep`、`environmentDeadline`、`runEnvironmentStep`），没有通知接口；
- 细化 §2 的文件表把 `notices.ts` 放在 `src/school/`，但没有说宿主或环境调度器调用它；
- 计划任务4 的 Files 列了 `src/host/scheduler.ts`、`runtime.ts`，暗示"发布是短事务、可以先处理"（§4 选择规则第 2 条）落在宿主里，但没点名函数。

这会影响实现时的调用顺序：发布必须在"选择"之前完成（否则刚到期、尚未发布的通知当轮看不到），而且它必须是短事务、不占模型槽、不重排自主。建议在细化 §7 或 §4 加一句明确的调用点，例如：

> 宿主每轮在 `closeReady` 之后、`collectReady` 之前调用 `releaseSchoolNotices(storage, now)`；`schoolNoticeDeadline` 与 `environmentDeadline` 一起进入唯一定时器的候选集合。

### 2.3 300 秒单请求上限这句话归"计划"还是"验收工具"要写清

细化 §6 末句写"不把验收工具 300 秒上限写成正式客户端超时，目前正式请求并没有该默认"；而计划任务8 的验收脚本接口写的是"默认单请求 300 秒，可显式覆盖"。两句话放一起容易被读成"计划允许给正式客户端加超时"。

建议在计划任务8 里明确"300 秒只属于 `scripts/validate-world-school.ts` 自身的等待上限，不写入 `AppConfig`、不改 `ModelClient` 的既有语义"，并把它列进交付自查（与"不冒充正式客户端超时"并列）。这一条是措辞范围问题，不是设计分歧。

---

## 3. 四处小项

### 3.1 环境步骤失败后的下游生成时点没有写死

细化 §4 说"每日后续步骤读**最新已提交**上游，不读取前一步未提交生成结果"，但没有回答：**前一步重试期间，下游步骤是否保持 `pending` 而不被选中**（我认为应该如此），以及前一步成功后下游是立刻继续还是等到下一个选择点。建议补一句"下游资格仅由已 `committed` 的上游决定；前序处于 `pending/ready/running/retryAt` 时下游不进入选择"，这样"前序未成功不跑学校"（计划 Review Focus 第 1 条）就有唯一解释。

### 3.2 通知正文的生成者可以更明确

细化 §3.1 说"候选引用已有 ID 或本结果 clientRef"，§3.2 说 `SchoolNotice.payload` 是"公开内容及所宣告实体版本的不可变快照"，§5 要求"模型填公开措辞"。三者合起来说明措辞由 `school_week` 生成。建议在 §3.2 的 `SchoolNotice` 行里直接写"payload 的公开措辞由周任务产出"，避免实现者以为程序要自己拼通知文案。

### 3.3 `requiredOccurrences` 与 `requiredNoticeKeys` 的"未覆盖"定义建议点明

细化的 `SchoolExpansionInput` 里有这两个必需集合，但"未覆盖"是相对什么而言没有写死——是相对 `SchoolWeek.sourceVersions`，还是相对实例／通知的 `deliveryRevision`？建议写成"相对已记录的来源版本与已生成的通知身份"（后者正好是 `SchoolNotice` 的元组身份），这样 `week_no_change_should_not_recreate` 与 `friday_next_week_monday_confirm` 两条用例的判据才是同一个。

### 3.4 跨日替代时"进行中的环境请求"边界可以再收一句

§4 写"上一日期进行中的请求结束后、应用前再检查日期：已提交部分保留；新返回但尚未提交的旧日结果保留为审计并终结 superseded，不应用后再撤销"。这里有一处细节值得点明：**该请求占用的网页会话与配额不应因为这次终结而重新发放**（§6 已说"不因 retry 重新给额度"，但这里是"跨日终结"，属于另一条路径）。建议顺手在 §6 补一句。

---

## 4. 我核对后确认成立、建议保留的设计

- **三层知识分离**（`SchoolKnowledge` 逐次获知 + `school_knowledge` 选"最近已获知版本"、`SchoolEntitySnapshot` 带版本的不可变快照、`narrativeSchoolContext` 与 `personalSchoolContext` 两套投影）是本轮最重要的设计，它把"客观存在"与"角色知道"彻底分开，并且 §8 明确"从 events 回查或 `relatedEventIds` 不能绕过过滤"——正好回应了上一轮我们对 `relatedEventIds` 的讨论。
- **通知身份用元组编码**（`(source/instance/week identity, kind, reminderKey, deliveryRevision)`）而不是描述文本匹配，且 `reminderKey` 区分时距类型与来源，直接解决了"一天两次检查不新造两套提醒"。
- **`deliveryRevision` 与 `revision` 分离**（只在时间、取消、要求或公开内容变化时提升），并有 `internal_note_no_reminder_storm` 用例守住"不因内部备注重发全套通知"。
- **`personal_reminder` 的已知条件**（"只可基于角色已获知的对应安排版本生成和交付，不能借'自己的提醒'让她提前知道未读课表"）是一条不显眼但很关键的约束，任务4 有 `personal_reminder_requires_known_version` 覆盖。
- **环境步骤不创建 `TurnRecord`／outbox／post job**，并复用 `inputSnapshot` + `attempt` + 冻结结果，`ready` 只应用不重生成——这意味着环境链不会污染故事恢复路径，与"旧未完成普通／共同轮仍先恢复"共存。
- **网页会话按步独立**（ownerType 扩为 environment、ownerId=step.id、stageKey='generation'），且明确"新环境所有者不满足 personal_life 的自我阅读来源条件"——这一条正好防止新模块意外获得"角色本人查阅"的记忆身份。
- **`currentOnly` 环境判定要包含三个新 school_* 与旧 school 兼容**（§6 末、任务3 的 `new_roles_current_only`），避免拆任务时意外开放归档／细节历史查询。
- **升级流程**沿用 shared 升级的既有模式（只读检查 → 停服备份 WAL／SHM → 同事务导入 legacy 并保留 eventID → 终结旧环境轮 → 唯一替代批次 → 清旧截止 → 写版本），并有 `readonly_check_no_writes`、`backup_before_apply`、`repeat_upgrade_same_batch_and_closed_at`、`paused_not_auto_cleared` 等用例；`config_compat_does_not_bypass_db_gate` 明确"旧配置能解析 ≠ 数据库已升级"，这一条尤其重要。
- **测试规模与结构**：8 个任务、每个任务都有具名用例清单、RED→GREEN 证据要求、日志与提交主题，最后另有隔离真实多轮验收（任务8）并且明确"不能只凭 JSON 合同通过宣称语义正确"。这套流程与前面几个模块一致，可执行性没问题。

---

## 5. 本次复核的边界

**没有做**：运行测试／构建／demo；连接模型或 QQ；检查正式库；修改任何文件。

**因此无法验证**：06:00 链在真实模型下的实际完成时间；学期计划与周实例在真实使用几周后的稳定性（是否出现"每日换课表"）；通知是否真的不会在真实故事里提前泄露隐藏安排（这需要任务8 的真实多轮验收）；以及旧库升级在真实数据上的兼容性（正式库当前尚未检查）。

**给用户的一句话**：方案里的两个可调整默认（提醒时距、周五生成下周计划）我建议沿用方案默认；本轮不需要你再做产品选择，剩下三条都是实施前把口径写死。
