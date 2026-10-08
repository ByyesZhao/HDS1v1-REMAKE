# 提示词与上下文优化 V0.1 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 若用户明确选择子代理执行，再使用 superpowers:subagent-driven-development。任务1～12为原交付历史；本次执行任务13～20，当前全部待实施，不启动正式服务。

**Goal:** 在原提示／资料池交付基础上修复已确认缺口，把4段窗口改成独立普通聊天窗口；活动中提供完整本场原文、结束后统一记忆召回。

**Architecture:** 沿单串行Host及SQLite事务新增普通聊天轻量索引，与活动归属分开，消息正文仍在原表。模型单一资料池使用普通recentIds及独立currentActivityMessageIds；Host来源集合／冻结恢复不由资料角色反推。旧混合段保留审计和旧轮兼容，新窗口采用版本2显式升级。

**Tech Stack:** 现有TypeScript、Node.js、SQLite、Zod、Vitest；不新增运行依赖。

**Spec:** [实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)。原设计审阅基线`6ed66e2`；原任务1～12实施起点`f891c48`，设计／审核已确认。

**本次增量：** 2026-10-09整合，参考代码`177561e`；直接执行任务13～20，以细化§13～14为目标合同。任务1～12的勾选保留原实施过程，不保证每个约定测试名都有同名现有用例；本次任务20补准确证据映射，不重用旧通过数。REVIEW22／23和已确认rebuttal意见均已并入，没有待决产品选择。

[REVIEW21](../DSH-review/DSH_REVIEW21_PROMPT_CONTEXT_V0.1_PLAN_20261008.md)已整合，具体取舍见细化§12。用户选择B：无必需通知时，即使有日程冲突也不额外调用周模型；角色自由处理自己真正知道的安排。

## 全局约束

- 固定默认`recentDialogueSegments=4`、`dialogueIdleMinutes=15`；仅普通段计容量，关闭不等于出窗，不叠加旧30条。
- 活动期间双方全部消息（含题外话）及公开动作／旁白／起止均归活动；活动不刷新／保持普通段。当前活动提供完整已授权原文，结束后统一检索记忆，允许多条短期。
- 周计划无必需通知则免调用，有冲突仍保存程序冲突及覆盖；个人导演决定参加、请假或协调，不由周模型自动改日程。
- 不增加输入字数／token预算和默认检索条数限制；超限报错，不自动删减，不增加手动脱困命令。
- Host完整snapshot／readSet／版本不精简；原消息ID、来源、可见权限、记忆周期和容量制度不改。
- 原模型任务名／配置键／强度、普通15秒合批、共同60秒／20轮硬上限、环境每日06:00串行及后台让位不改。
- 来源资格、代写、意图／经历、已确认输出／草稿、已知／未读资料不可因去重合并语义。
- 不启动正式服务。正式升级先检查、停服确认和备份；模型验收用隔离数据并记录授权范围。

## 复核重点

| 易遗漏情形 | 必须看到的结果 | 所属任务 |
| --- | --- | --- |
| 当前段只有普通主叙事不可见新输入 | 不泄漏，也不挤掉第4个可见历史段 | 2、4 |
| 剧情已发，但基础提取仍失败／在途 | 不把后台工作当聊天保持；确认输出不丢 | 3、7 |
| lookup得到同ID新版本，或旧checkpoint含网页全文 | 不误合并不同版本；每次续请求仍有完整可用资料 | 4、5 |
| 无对话但有共同经历或本人网页来源 | 仍正常提取；不能只看聊天数组为空就免调用 | 6 |
| 学校旧running与旧ready并存 | running沿冻结旧合同，ready直接提交原变更集 | 11 |

## 文件结构与顺序

新模块及类型职责见细化§2；不顺便重构其他子系统。第一批任务1～8，交付复核后再执行第二批任务9～12；第一批可独立上线，不依赖背景拆分和学校候选合同。

每个代码任务采用：先加入指定行为测试并确认失败→实现最小变更→指定回归和类型检查通过→日志记录→只提交该任务文件。不要把用户review、密钥或runtime临时目录通过`git add .`带入提交。文档更新附同任务提交，不另造空脚手架任务。

## 第一批

### 任务1：对话段配置、表与旧库升级

**Files:** 新`src/dialogue/types.ts`、`store.ts`、`src/deployment/dialogue-upgrade.ts`、`scripts/migrate-dialogue.ts`、`tests/dialogue-upgrade.test.ts`；改`src/types.ts`、`storage.ts`、`settings.ts`、`config.ts`、`index.ts`、`package.json`、`examples/story.sample.json`和`tests/helpers.ts`。本地配置只更新相关窗口字段，保持密钥及模型选择。

**Interfaces:** 产出细化§3类型、DialogueStore、`inspectDialogueUpgrade(path):DialogueUpgradeReport`、`upgradeDialogue(path,now,{stopped,backupDirectory}):DialogueUpgradeReport`、`ensureDialogueVersion(storage):void`。新库初始化版本1；配置归一化移除旧条数，设置4／15。报告含版本、消息／段计数、模糊边界、在途关联、canApply和backupPath。

- [x] 写`legacy_30_maps_to_four_episodes`：旧30不参与二次裁剪，新值显式优先，其他预算仍null。
- [x] 写`check_read_only`、`apply_backup_atomic_idempotent`：check前后DB哈希相同，不建表／备份；apply要求stopped、备份完整、回滚无半索引、重复apply不重复归属。
- [x] 写`backfill_shared_id_overrides_gap`、`unknown_history_not_globally_merged`、`latest_interaction_is_last_episode`、`inflight_known_can_bind_unknown_rejected`，夹具使用真实messages／turn字段，旧输入时间／正文／seen及记忆不变。
- [x] 运行`npm test -- tests/dialogue-upgrade.test.ts`确认缺失行为失败；实现细化§9的一次性迁移和门禁。DialogueStore提供新表读取／保存，不在构造器偷偷迁移。
- [x] 同测试及`npm test -- tests/storage.test.ts tests/model-settings.test.ts tests/deployment.test.ts`、`npm run typecheck`通过；创建实施日志记录兼容口径及测试，提交任务1。

### 任务2：分段状态机与按阶段近期窗口

**Files:** 新`src/dialogue/episodes.ts`、`tests/dialogue-episodes.test.ts`；改`src/memory/types.ts`、`retrieval.ts`、`context.ts`。

**Interfaces:** 消费任务1类型，产出细化§2的DialogueEpisodes及DialogueRecent。`recent`用阶段可见权限选有可见原文的4段；Retrieval不再`.slice(-recentMessagesLimit)`。写方法由调用者持有事务；nextDeadline只给可关闭段的截止，保持中不排零延时循环。

- [x] 写`four_total_with_or_without_current`：有当前时D＋前3，无当前时最近4；段内40条仍返回40条。
- [x] 写`episode_order_last_interaction_then_opened_time_then_id`：段取lastInteractionAt／openedAt／id稳定排序末4，以旧→新输出；构造建段时间与最后交互排序不一致夹具，不能按rowid选。
- [x] 写`invisible_current_does_not_consume_slot`、`unread_not_leaked`、`visible_after_commit_same_id`：当前未读不能提前进入普通narrative，成为真正可见后仍是原消息身份。
- [x] 写`idle_15_minutes_boundary`、`no_reply_can_close`、`proactive_output_opens`、`silent_background_does_not_open`、`advance_does_not_anchor`，按细化示例使用固定时钟。
- [x] 对窗口用以下精确断言（A～D已闭、E当前且有可见原文；夹具使用任务1的Store）：`expect(recent.episodeIds).toEqual(['B','C','D','E'])`；E含40条时`expect(recent.messages.filter(m=>m.dialogueEpisodeId==='E')).toHaveLength(40)`。无可见E的narrative应为`['A','B','C','D']`。
- [x] 运行`npm test -- tests/dialogue-episodes.test.ts`确认失败；实现归属／保持／关闭／只读窗口，默认保持集合依turn绑定，活动依link，不复用MemoryIdle锚点。
- [x] 通过新测试及`npm test -- tests/memory-v3-retrieval.test.ts tests/memory-capacity-retrieval.test.ts`、类型检查；日志记清窗口排序与权限，提交任务2。

### 任务3：输入、发送、活动及恢复事务接入

**Files:** 新`tests/dialogue-flow.test.ts`、`tests/dialogue-recovery.test.ts`；改`src/app.ts`、`recovery.ts`、`host/input.ts`、`host/shared.ts`、`host/runtime.ts`、`index.ts`、`tests/helpers.ts`。

**Interfaces:** Dependencies接入DialogueEpisodes。入站／确认出站／活动起止与索引同事务，runTurn存DialogueTurnBinding；freeze无回复或最后发送完成释放hold。启动checkConsistency先于输入和故事恢复；既有Host单timer合入dialogue.nextDeadline，到期仅关闭索引，不唤醒故事。不要求私下环境／自主工作创建段。

- [x] 写`segmented_reply_one_episode`、`generation_over_15_minutes_stays`、`memory_after_output_does_not_hold`、`shared_silent_gap_continuous`、`end_anchor_is_confirmation_not_postprocessing`。
- [x] 写`incoming_index_failure_rolls_back_message`、`confirmation_index_failure_rolls_back_local_receipt`、`close_and_new_input_recheck`、`duplicate_input_no_new_episode`、`restart_preserves_binding`、`idle_timer_closes_without_model_call_or_spin`；用可控异常／时钟模拟事务中断和事件顺序。
- [x] 写`deferred_old_source_not_retimestamped`、`start_transfers_activity_without_copying`、`inconsistent_index_errors_without_merge`、`irrelevant_completed_history_warning_only`、`orphan_unread_or_recent_or_reconsider_blocks`；只可证明不影响当前运行的已完成窗外历史报warning，无法确定的关联仍报错；恢复不得修改旧来源或猜测合并。
- [x] 运行`npm test -- tests/dialogue-flow.test.ts tests/dialogue-recovery.test.ts`确认失败；按细化§4接入，保留网络确认与数据库确认的既有区别。
- [x] 新测试及`npm test -- tests/input.test.ts tests/recovery.test.ts tests/shared-v3-recovery.test.ts tests/memory-idle-recovery.test.ts`、类型检查通过；记录所有事务边界及恢复限制，提交任务3。

### 任务4：模型DTO与业务输入资料池

**Files:** 新`src/model/context-types.ts`、`context-views.ts`、`resource-pool.ts`、`tests/prompt-context-views.test.ts`；改`src/app.ts`、`memory/organize.ts`、`memory/maintenance.ts`及对应入口测试。

**Interfaces:** 产出`PromptStage/OwnerViewPurpose/ModelOwnerView/StageInputSnapshot/StageModelInput/ModelResourcePool/ModelRoles`及细化§2投影接口。资源引用是稳定身份；Host的合法来源／可写ID集合不来自模型DTO。第一批expression保留有效资料基线。

- [x] 写`recent_visible_reconsider_body_once_labels_all`、`due_task_body_once`、`owner_exact_duplicates_only`、`shared_null_not_old_public_node`。
- [x] 写`owner_vectors_and_storage_flags_absent`、`learned_basis_and_fact_time_preserved`、`host_snapshot_versions_unchanged`：白名单外字段不发，语义及应用证据不丢。
- [x] 写`memory_public_uses_confirmed_outgoing_ids`、`self_read_material_unique_source_ids_preserved`、`unread_never_enters_narrative_pool`；确认代写和本人网页原来源资格不扩张。
- [x] 运行`npm test -- tests/prompt-context-views.test.ts`确认失败；实现白名单投影、stage联合和资料roles；保留完整原维护snapshot与parse读集。
- [x] 新测试及`npm test -- tests/turn.test.ts tests/memory.test.ts tests/web-memory-sources.test.ts tests/review17-identities.test.ts tests/review17-summary-repair.test.ts`、类型检查通过；记录字段前后映射，提交任务4。

### 任务5：HTTP去重、能力提示和程序权限Schema

**Files:** 新`src/model/prompt-policy.ts`、`tests/prompt-context-transport.test.ts`、`tests/prompt-policy.test.ts`；改`src/model/client.ts`、`contracts.ts`、`prompts.ts`、`src/types.ts`、`src/output/sticker-description.ts`及`src/web/types.ts`的模型投影类型。

**Interfaces:** 产出PromptFacts／PromptPolicy、ModelCompletionEnvelope及buildCompletionEnvelope。`personalTask`末尾增加可选`{contactEligible?:boolean}`，生产life入口必须显式传值；false固定Schema分支。ModelTask可附提示policy元数据，连接task.name不变。

- [x] 写`web_body_once_across_input_results_lookup`、`each_continuation_has_all_available_bodies`、`old_checkpoint_full_result_projects_without_mutation`、`lookup_new_version_kept_distinct`。
- [x] 写`no_lookup_invitation_after_use`、`disabled_web_no_tool_schema_existing_material_rules_retained`、`frozen_permission_not_flipped_by_new_input`、`opening_final_both_rules`。
- [x] 写`contact_ineligible_true_rejected_and_repaired`、`eligible_false_still_legal`、`vision_has_no_activity_expression_rules`、`image_payload_preserved_without_json_base64_copy`、`json_object_keeps_schema`、`json_schema_single_schema_when_configured`。
- [x] 运行`npm test -- tests/prompt-context-transport.test.ts tests/prompt-policy.test.ts`确认失败；纯投影完成累计结果与lookup合并，待修原响应作为独立证据保留；能力每次更新、业务分支固定。
- [x] 新测试及`npm test -- tests/model-call-context.test.ts tests/web-model-tools.test.ts tests/web-recovery.test.ts tests/shared-v3-contracts.test.ts tests/review10-public.test.ts`、类型检查通过；日志记录旧checkpoint兼容和各task适用块，提交任务5。

### 任务6：无用途免调用及维护机械身份

**Files:** 新`tests/prompt-context-call-skip.test.ts`；改`src/memory/retrieval.ts`、`organize.ts`、`maintenance.ts`、`src/model/contracts.ts`、`prompts.ts`。

**Interfaces:** Retrieval在query之前判semantic资格并统计跳过原因；organize无合法新来源直接返回原MemoryResultV3空结果；consolidationTask从冻结snapshot计算canonicalShortId并返回原MaintenanceUnit。

- [x] 写`null_threshold_zero_query_requests`、`wrong_signature_zero_requests`、`no_compatible_candidate_zero_requests`、`valid_semantic_cache_and_fallback_unchanged`，不改变索引生成／表情包调用。
- [x] 写`only_reconsider_no_sources_skips`、`experiences_without_dialogue_do_not_skip`、`self_web_source_does_not_skip_or_authorize_details`：计数实际生成调用而非只看返回值。
- [x] 写`merge_short_canonical_computed_created_time_then_id`、`legacy_wrong_canonical_rejected`、`ready_unit_not_reparsed`、`full_readset_preserved`。
- [x] 运行`npm test -- tests/prompt-context-call-skip.test.ts`确认失败；实现细化§7，先判来源再检索，主动免调用不冒充请求失败。
- [x] 新测试及`npm test -- tests/memory-v3-index.test.ts tests/memory-v3-maintenance.test.ts tests/memory-idle-contracts.test.ts tests/review17-promotion-audit.test.ts tests/stickers.test.ts`、类型检查通过；记录调用数和合同兼容，提交任务6。

### 任务7：前台失败可观测性

**Files:** 新`tests/prompt-context-errors.test.ts`；改`src/model/client.ts`、`src/types.ts`、`app.ts`、`host/runtime.ts`及错误通知入口。

**Interfaces:** ModelRequestError保留task/status/providerCode/kind；Runtime.lastFailure记录细化§8字段。仅前台捕获对应故事失败，环境retry和维护错误分开。保留lastError兼容及显式resume。

- [x] 写`known_context_limit_pauses_with_scene_preserved`、`generic_400_not_assumed_capacity`、`notification_contains_stage_no_body_or_key`、`waiting_and_input_do_not_bypass_failed_turn`。
- [x] 写`resume_same_load_may_fail_again_no_trim`、`postprocessing_error_keeps_confirmed_output`、`background_errors_not_front_failure`。
- [x] 运行`npm test -- tests/prompt-context-errors.test.ts`确认失败；实现安全错误分类／状态显示，不加任何窗口排除、关段或跳轮命令。
- [x] 新测试及`npm test -- tests/review-recovery.test.ts tests/plugin.test.ts tests/world-school-batch.test.ts tests/memory-idle-host.test.ts`、类型检查通过，记录已验证供应商错误形态，提交任务7。

### 任务8：第一批集成、部署检查与审核材料

**Files:** 新`tests/prompt-context-integration.test.ts`、`scripts/validate-prompt-context.ts`；改`README.md`、`docs/IMPLEMENTATION_HANDOFF_20261007.md`、`docs/DOCUMENT_AUDIT.md`、`examples/story.sample.json`、`scripts/demo.ts`、`scripts/check-web-context.ts`、`scripts/validate-shared-story.ts`及实施日志。其余使用旧字段的夹具通过`rg`查出后逐个更新，不隐式兼容成旧30条。

同时核对并同步`docs/MEMORY_V0.3_IMPLEMENTATION_20261007.md`、`docs/MEMORY_V0.3_EXECUTION_PLAN_20261007.md`、`REMAKE_V0.2_MEMORY.md`、`REMAKE_V0.2_INTERFACES.md`、`REMAKE_V0.2_IMPLEMENTATION.md`，并搜索根目录其余REMAKE说明。当前规则／类型／参数改为4段与15分钟；历史已完成测试／交付数字保留当时事实并加“由本期替代”及日志链接。旧方案和review副本只标追溯状态，不批量改掉审查当时的源码事实。此任务实施前旧30条说明仍反映当前程序，不提前写成已落地4段。

**Interfaces:** 验收工具构建隔离库，支持纯离线资料统计与既有授权范围的模拟故事请求；默认单请求300秒。检查脚本不得误用正式库、启动QQ或把密钥输出到报告。

- [x] 写`normal_shared_life_and_empty_memory_full_flow`、`four_episodes_preserve_source_roles`、`manual_start_files_and_offline_check_do_not_start_services`；统计实际HTTP／embedding调用和pool正文副本，不对修补原响应强行全文去重。
- [x] 针对集成测试确认红灯，再装配工具／报告；通过`npm test -- tests/prompt-context-integration.test.ts`和类型检查。
- [x] 跑`npm run typecheck`、`npm run build`、`npm test`，记录实际文件／用例数，不复用历史473项数字。
- [x] 检查正式库版本和迁移报告；正式apply只在已确定停服且备份完成后执行，按报告保留模糊边界。同步说明并提交；报告区分离线证据与真实模型证据。
- [x] 用`rg -n 'recentMessagesLimit|近期原文.{0,8}30|最新30条|最近30条' docs REMAKE_V0.2*.md`逐项检查：生产说明不再有未注明替代的旧30条；原方案、历史记录／review允许保留，但必须明确其追溯角色。PowerShell中根目录通配文件先展开后传给rg，不把未展开的glob当文件名。
- [x] 第一批单独复核可见性、未完成轮、服务停止和已确认来源；真实隔离验收若执行，记录发送范围及质量问题，再决定是否进入第二批。不要用“JSON变短”代替故事质量结论。

## 第二批

### 任务9：表达专用资料

**Files:** 新`tests/expression-context-view.test.ts`；改`src/model/context-views.ts`、`src/output/expression.ts`、`src/app.ts`、表达提示及模拟验收脚本。

**Interfaces:** `buildExpressionView(snapshot:ExpressionInputSnapshot):StageModelInput`，保持draft/intention/actions、输出mode、情绪、必要语境／事实和风格；不确定依赖沿用已检索相关资料，不引入新的LLM相关性判断。

- [x] 写`draft_negation_commitment_time_actions_preserved`、`uncertain_pronoun_keeps_known_context`、`expression_not_given_autonomous_clock`、`segmented_output_and_stickers_unchanged`。
- [x] 新测试红灯→实现细化§10.1→`npm test -- tests/expression-context-view.test.ts tests/output.test.ts tests/stickers.test.ts`及类型检查。
- [x] 隔离样例核对称呼、否定、承诺、动作和信息量；生成质量属于人工／真实模型验收，不仅字符串相等。日志及提交，不在此任务删除作者背景。

### 任务10：作者背景映射与环境资料视图

**Files:** 新`src/model/background-views.ts`、`tests/background-stage-views.test.ts`、`tests/environment-context-view.test.ts`；改`src/deployment/character-background.ts`、`scripts/prepare-character-background.ts`、`settings.ts`、`src/environment/runtime.ts`及DTO模块。

**Interfaces:** `BackgroundViews`保存core/style/world/campus/group及facts来源映射；`backgroundViewsFile`可选。`buildEnvironmentView(input:EnvironmentStepInput):StageModelInput`沿stage提供授权资料，Host原冻结context保留。

- [x] 写`no_mapping_full_background_fallback`、`detail_move_does_not_remove_shared_identity`、`updated_detail_not_overwritten_by_author_copy`、`world_no_private_school_dump`、`group_progress_retains_related_history`；world去私人背景的断言使用已批准并启用的映射夹具，未启用时验证原全文回退；学校列表投影可独立完成。
- [x] 红灯→实现候选工具及阶段投影→`npm test -- tests/background-stage-views.test.ts tests/environment-context-view.test.ts tests/deployment.test.ts tests/world-school-perspective.test.ts`及类型检查。
- [x] 先交付具体候选和来源映射供审阅。未确认映射时不切换生产backgroundViewsFile、不自动删作者段落；可先完成不依赖私有映射的通用逻辑和测试。
- [x] 已确认映射后核对每条事实责任、style及导师／培养阶段等身份，保留作者原文件与变动后details。日志记录确认对象和启用配置，再提交任务10。

### 任务11：周计划机械展开与新旧合同

**Files:** 新`tests/school-week-text-contract.test.ts`、`tests/school-week-contract-recovery.test.ts`；改`src/environment/types.ts`、`runtime.ts`、`src/school/contracts.ts`、`calendar.ts`、`src/directors/school.ts`、提示和验收夹具。

**Interfaces:** 产出细化§10.4的SchoolWeekTextResult；`resolveSchoolWeekText(storage:Storage,result:SchoolWeekTextResult,input:SchoolExpansionInput,now:string):EnvironmentChangeSet`程序生成现行候选并调用原resolveSchoolWeek。`schoolWeekTextTask(input:SchoolExpansionInput):ModelTask<SchoolWeekTextResult>`新任务name仍school_week；旧schoolWeekTask保留版本0。EnvironmentStepInput新增modelContractVersion，缺失视为0；EnvironmentModelResult联合兼容新旧候选，EnvironmentChangeSet不变。

- [x] 写`required_occurrences_generated_without_model_copy`、`fixed_notice_entities_text_per_key`、`no_notice_skips_model_but_commits_coverage`、`conflicts_without_notice_zero_calls_preserved`、`empty_week_notes_cannot_erase_program_conflicts`、`required_notice_never_skipped`、`duplicate_or_missing_notice_key_rejected`。
- [x] 写`notice_descriptor_targets_exact_occurrence_time_location`、`existing_occurrence_reminder_has_descriptor`、`reminder_instance_id_matches_occurrence`、`after_projection_updates_notice_binding`：同课程两次课使用不同key，描述、绑定和快照均指向所选那次；发布时间与上课开始时间分开。程序关联断言不得替代正文语义验收。
- [x] 写`old_ready_direct_commit_no_model`、`old_running_checkpoint_uses_v0`、`new_snapshot_uses_v1`、`cancelled_after_timezone_history_reminders_unchanged`。
- [x] 红灯→实现程序candidate适配和版本分派；保留EnvironmentChangeSet不变，机械空任务仍保存覆盖及冲突信息。
- [x] 运行`npm test -- tests/school-week-text-contract.test.ts tests/school-week-contract-recovery.test.ts tests/world-school-review14-calendar.test.ts tests/world-school-review14-contracts.test.ts tests/world-school-review14-environment.test.ts tests/world-school-review14-time.test.ts tests/world-school-notices.test.ts`和类型检查；日志注明ready／running各自路径，提交任务11。

### 任务12：第二批质量验收与最终交付

**Files:** 扩展`scripts/validate-prompt-context.ts`及`tests/prompt-context-integration.test.ts`；更新实施日志、背景映射说明、架构／部署说明。

- [x] 补第二批集成用例，红灯后实现验收装配；证明投影后角色已知边界、来源、模板版本及实例／通知一致性。
- [x] `npm run typecheck`、`npm run build`、`npm test`通过；新增修改或失败才补充重复检查。
- [x] 在隔离多轮样例检查表达保真、稳定背景与变动事实、学校自然通知、公开开场／收尾、goal／endingCondition语义及结果不足可询问行为；记录模型实际选择，不把程序字符串校验当语义审核。学校通知逐条对照occurrence日期／星期／时刻／地点，覆盖同课程多次课和publishAt≠startsAt；另检查角色已知课程与组会冲突时可自行安排或提出请假，计划不冒充获准结果，不要求模型必选请假。
- [x] 汇总前后资料ID／字段映射、去重数量、实际调用数、迁移与恢复报告、测试结果和已知限制；不默认公开私聊、背景全文或密钥。
- [x] 同步本次文档为已实施状态及日志入口，逐文件复核差异并提交最终交付。服务继续停止，由用户运行已有cmd。

## 原任务1～12完成标准与审阅入口（历史）

任务1～8和9～12分别形成可审核交付；所有必需行为能指向测试／恢复报告，语义质量能指向隔离验收记录。未进行真实验收或未批准背景映射时如实记录，不把相应项目标成完成。

本次已按任务1～12完成代码、回归和隔离语义验收。复核入口为本文、实施细化、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)和[验收与代码复核记录](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)。方案／review／rebuttal用于追溯；未增加自动裁剪、手动脱困或新模型任务。

## 第三批：REVIEW22／23修复与普通／活动窗口分离（待实施）

按13→14→15→16→17→18→19→20顺序执行；任务14定义共享类型，15负责迁移，16接写路径，17接模型视图，18核对记忆，19接启动检查，20作最终装配与验收。中间提交不代表可启动正式服务；直到版本门禁、恢复及装配全部完成后才交付。

### 增量复核重点

| 输入／状态 | 必须结果 | 所属任务 |
| --- | --- | --- |
| 20:00普通聊天后，20:05～20:40共同活动，期间聊题外话 | 普通段20:15关闭但不被活动挤出；20:41普通输入另开段 | 14、16 |
| 某段含已看旧输入和不可见新输入，其他段全未读，旁边还有缺归属消息 | 排名按阶段可见普通正文；无法证明缺归属不影响时阻挡 | 14、19 |
| 活动end已确认，基础提取尚未完成，还有活动内未读消息 | 本轮收尾保留资料；补读直接输入不丢；后续普通不自动带全场 | 17、18 |
| 普通分段发送失败，暂停超过15分钟后resume | 保留冻结输出／普通绑定；最终确认后释放，不自动重试 | 16 |
| 非默认30分钟迁移，旧v0周合同／ready及补查新学校版本同时存在 | check/apply一致；v0路径正确／程序冲突保留；新版本不误去重；ready不重跑 | 13、15、20 |

### 任务13：已确认的HTTP与学校兼容修复

**Files:** 改`src/model/resource-pool.ts`、`context-views.ts`、`context-types.ts`、`src/school/calendar.ts`、`src/deployment/prompt-context-acceptance.ts`；扩`tests/prompt-context-transport.test.ts`、`prompt-context-integration.test.ts`（统计字段更名）、`environment-context-view.test.ts`、`school-week-contract-recovery.test.ts`、`school-week-text-contract.test.ts`、`prompt-context-errors.test.ts`。

**Interfaces:** `buildCompletionEnvelope`沿原签名，在lookupResult新增contextRefs；仅对白名单school/detailHistory确定相等块引用`input.context.<key>`。`buildEnvironmentView`仍返回StageModelInput版本1；school v0投影单层，Host冻结inputSnapshot不变。`resolveSchoolWeek`仍返回原EnvironmentChangeSet。

- [ ] 写`lookup_identical_school_once`、`lookup_new_school_version_kept`、`lookup_different_detail_history_kept`、`different_message_ids_same_text_preserved`；用受控标记检查整份envelope，断言原lookup/input深相等未修改。
- [ ] 写`v0_school_context_flat_and_contract_unchanged`、`v0_repair_continuation_uses_flat_input`、`v0_empty_notes_keep_program_conflicts`、`old_ready_no_reparse`；新增`v1_cancel_timezone_historical_reminders_preserved`组合夹具，取消及after投影仍保留已发布历史通知／提醒。
- [ ] 为维护、环境各写`background_errors_not_front_failure`，确证后台错误不设置前台lastFailure；把已存在的通知安全断言记入名称映射，不为改名字重复造测试。
- [ ] 跑`npm test -- tests/prompt-context-transport.test.ts tests/environment-context-view.test.ts tests/school-week-contract-recovery.test.ts tests/school-week-text-contract.test.ts tests/prompt-context-errors.test.ts`，记录新增用例的实际失败；只修上述确定问题。
- [ ] 重跑同组及`npm run typecheck`；统计名称改为uniqueMessageIds，记录每条意见→实际用例／断言；续写实施日志并提交任务13。无必需通知时仍不调用周模型，不改已正确的policy冻结链。

### 任务14：普通聊天独立索引与状态机

**Files:** 新`src/dialogue/chat-episodes.ts`、`tests/chat-episodes.test.ts`；改`src/dialogue/types.ts`、`store.ts`、`src/types.ts`、`storage.ts`及`tests/storage.test.ts`。

**Interfaces:** 消费细化§13.2字段；新增chat_episodes及chat_index_metadata、ChatEpisode、ChatTurnBinding、ChatRecent、ActivityContextSelection及Runtime.activeChatEpisodeId。`DialogueStore.chatEpisodes():ChatEpisode[]`、`chatEpisode(id:string):ChatEpisode|null`、`saveChatEpisode(row:ChatEpisode):void`供新服务消费。ChatEpisodes实现acceptMessage/bindTurn/confirmOutput/releaseReply/closeDue/nextDeadline/recent精确签名。旧DialogueEpisodes／旧表兼容保留，新库版本2，旧库缺字段不自动升级。

- [ ] 写`activity_never_anchors_or_holds_chat`、`closed_chat_still_eligible_until_four_newer`、`short_activity_can_continue_chat_before_idle`、`silent_life_has_no_chat_episode`、`ordinary_proactive_confirm_opens_chat`。
- [ ] 写`visible_interaction_orders_mixed_seen_unread_episode`、`invisible_current_does_not_take_fourth_slot`、`forty_messages_in_chat_not_trimmed`；最近可见普通消息排序不改持久化锚点。
- [ ] 用固定时钟断言20:00普通、20:05活动、20:40结束：普通截止仍20:15；关闭后recent仍包含该段，20:41普通建立新段。活动消息明确chatEpisodeId=null，不能建立空普通段。
- [ ] 跑`npm test -- tests/chat-episodes.test.ts tests/storage.test.ts`确认新增红灯，再实现普通独立读写及保持逻辑；写方法不自行嵌套事务。
- [ ] 同组及类型检查通过，日志记录版本1／2与模型DTO版本不同，提交任务14；暂不把正式库升级或生产Host切到不完整装配。

### 任务15：迁移实际参数及普通索引版本2升级

**Files:** 新`src/deployment/chat-upgrade.ts`、`tests/chat-upgrade.test.ts`；改`src/deployment/dialogue-upgrade.ts`、`scripts/migrate-dialogue.ts`、`src/index.ts`的启动前检查及`tests/dialogue-upgrade.test.ts`。

**Interfaces:** `DialogueUpgradeParameters={idleMinutes:number,targetVersion:1|2}`；`inspectDialogueUpgrade(path:string,parameters:DialogueUpgradeParameters):DialogueUpgradeReport`与`upgradeDialogue(path:string,now:string,options:DialogueUpgradeParameters & {stopped:boolean,backupDirectory:string}):DialogueUpgradeReport`共享计划参数。报告增加targetVersion、idleMinutes、配置来源及普通／活动统计。chat-upgrade生成纯目标2计划供原入口分派；`ensureDialogueVersion`目标2，并保留旧在途兼容核对入口。CLI默认目标2，读取公开配置，不加载密钥。

- [ ] 写`nondefault_idle_same_check_and_apply`：30分钟配置下20分钟间隔同普通段；check与apply统计／归属一致，不能从state默认15读取。明确参数覆盖及配置来源进入报告。
- [ ] 写`v1_mixed_history_rebuilds_pure_chat`、`activity_does_not_bridge_old_chat_gap`、`old_ordinary_reply_hold_maps_but_shared_hold_does_not`、`missing_active_activity_evidence_blocks_apply`、`closed_old_chat_not_forced_out`。
- [ ] 写`check_no_business_writes`、`apply_backup_then_transaction`、`reapply_v2_idempotent`、`failed_plan_rolls_back`、`parameter_change_not_silent_rebuild`；证明消息ID／正文／时间／已读／记忆／确认outbox及旧混合索引未改，仅新增明确索引与归属。
- [ ] 跑`npm test -- tests/chat-upgrade.test.ts tests/dialogue-upgrade.test.ts`确认红灯；实现check/apply同计划、目标版本分派及旧在途映射，未知当前归属不按【】猜测。
- [ ] 同组及类型检查通过，日志保存隔离报告与备份演练证据，提交任务15。正式库检查／apply留到任务20，不因之前空库假定学校步骤为空。

### 任务16：输入、起止、确认发送和恢复接普通索引

**Files:** 新`tests/chat-flow.test.ts`、`tests/chat-recovery.test.ts`；改`src/app.ts`、`recovery.ts`、`host/input.ts`、`host/shared.ts`、`host/runtime.ts`、`index.ts`、`tests/helpers.ts`。

**Interfaces:** Dependencies新增chat:ChatEpisodes；新轮持久化dialogueWindowVersion=2及chatBinding。入站／outbox确认事务消费任务14；Host timer用chat.nextDeadline。旧windowVersion缺失的轮保留原版本1恢复，确认事务同步普通新索引或活动身份，不重算policy／冻结输入。

- [ ] 写`activity_offtopic_and_actions_excluded`、`start_end_do_not_refresh_chat`、`opening_releases_ordinary_invitation_hold`、`confirmed_opening_and_ending_have_activity_identity`、`advance_no_chat_record`、`short_activity_keeps_ordinary_deadline`。
- [ ] 写`transfer_to_activity_recomputes_chat_anchor_no_empty_episode`、`activity_unread_batch_transfer_keeps_activity_identity`；启动之前真实预约仍普通，已确认活动的结束项仍属活动。
- [ ] 写`incoming_chat_failure_rolls_back`、`confirmation_chat_failure_rolls_back_receipt`、`duplicate_input_no_refresh`、`sending_failure_pause_resume_keeps_chat_binding`、`postprocessing_does_not_hold_chat`。失败发送超过15分钟仍在原普通绑定确认，不自动重试；无声活动可关闭普通段而继续推进。
- [ ] 跑`npm test -- tests/chat-flow.test.ts tests/chat-recovery.test.ts`确认红灯；依细化§13.4接入。同事务更新，不把chatEpisodeId=null当“不需要活动开始／结束确认”。
- [ ] 同组及`npm test -- tests/input.test.ts tests/recovery.test.ts tests/shared-v3-recovery.test.ts tests/memory-idle-recovery.test.ts tests/dialogue-flow.test.ts tests/dialogue-recovery.test.ts`、类型检查通过；旧测试若描述混合窗口须明确标为版本1兼容夹具，不能删掉真实恢复断言；日志及提交任务16。

### 任务17：完整活动上下文与模型单池用途

**Files:** 新`src/dialogue/activity-context.ts`、`tests/activity-context.test.ts`；改`src/model/context-types.ts`、`context-views.ts`、`src/memory/retrieval.ts`、`context.ts`、`types.ts`、`src/app.ts`、`src/output/expression.ts`及对应DTO／表达测试。

**Interfaces:** 实现细化selectActivityContext/activityContextMessages；StageBusinessSnapshot新增currentActivityMessages?:Message[]，ModelRoles新增currentActivityMessageIds?:string[]。在runTurn保存阶段持久化活动选择；模型投影消费授权后原文。生产MemoryRetrieval的recent改用ChatEpisodes，旧windowVersion=1恢复显式选择旧路径，模型DTO仍contextVersion=1。

- [ ] 写`active_activity_all_authorized_messages`：超过4段／30条的本场全部授权消息仍提供；recentIds只普通，活动不占四段，池内每个ID正文一次、多用途标签保留。
- [ ] 写`offtopic_activity_kept_in_active_context`、`other_activity_not_in_current_pool`、`unselected_arrival_not_added_on_repair_or_resume`、`narrative_private_unread_gate_preserved`、`world_school_no_private_transcript`。
- [ ] 写`final_turn_keeps_context_after_state_end`、`next_normal_turn_has_no_finished_activity_fulltext`、`pending_activity_message_visible_without_full_history`；表达投影不因专用白名单漏掉当前活动。
- [ ] 跑`npm test -- tests/activity-context.test.ts tests/prompt-context-views.test.ts tests/expression-context-view.test.ts`确认红灯；实现固定选择与阶段授权，HTTP补查／修补沿同一活动身份集合。
- [ ] 同组及`npm test -- tests/memory-v3-retrieval.test.ts tests/memory-capacity-retrieval.test.ts tests/turn.test.ts tests/model-call-context.test.ts`、类型检查通过；日志记录四段与活动roles相互独立，提交任务17。

### 任务18：活动逐轮多记忆、结束后统一召回

**Files:** 新`tests/activity-memory-context.test.ts`；改`src/memory/organize.ts`、必要的app／model视图接入、`tests/memory.test.ts`、`tests/prompt-context-call-skip.test.ts`及相关提示说明。

**Interfaces:** 保留MemoryResultV3、每轮基础提取与MemoryRetrieval合同；currentActivityMessageIds只辅助理解，currentSourceIds仍由本轮合法来源计算。不得新增结束总结任务或独立活动记忆检索分支。

- [ ] 写`one_activity_multiple_short_memories_with_current_sources`：同场两轮生成不同事件／细节／感受记忆，至少一个本轮来源；可返回多条，也可合法无新记忆，不强制重复历史。
- [ ] 写`activity_history_not_new_source_or_awaken_candidate`、`silent_public_narration_still_extracts`、`activity_offtopic_fact_can_be_remembered`、`ending_extracts_current_closure_without_extra_summary_call`。
- [ ] 写`post_end_recall_uses_normal_memory_retrieval`、`ended_activity_unread_first_visible_extracts`、`old_reconsider_not_first_visible_source`、`failed_end_postprocessing_restores_without_reopen_full_history`；检索相关短／长期，与其他记忆用相同规则，无activity alwaysInclude。
- [ ] 跑`npm test -- tests/activity-memory-context.test.ts tests/memory.test.ts tests/prompt-context-call-skip.test.ts`确认红灯；实现必要投影／来源接线，未改变部分用集成断言验证，不为制造代码差异另写流程。
- [ ] 同组及`npm test -- tests/web-memory-sources.test.ts tests/review17-identities.test.ts tests/review17-promotion-audit.test.ts tests/memory-capacity-retrieval.test.ts`、类型检查通过；日志分别列工作原文、直接输入、新来源和检索记忆，提交任务18。

### 任务19：按实际窗口检查保护范围

**Files:** 新`src/dialogue/window-consistency.ts`、`tests/chat-consistency.test.ts`；改`src/dialogue/types.ts`、`host/runtime.ts`及新升级检查接线。

**Interfaces:** 实现细化checkWindowConsistency及WindowConsistencyReport；消费任务14实际阶段ChatRecent、任务17当前活动选择及原未读／复议／在途／来源集合。Host在输入／恢复前核对，版本1旧在途另按兼容合同，不把版本2活动null关联误当孤立普通消息。

- [ ] 写`phase_visible_older_episode_protected_against_global_cutoff`：五段只有最旧可见，附近缺归属已看消息必须blocking；不拿全库最新4段判断。
- [ ] 写`missing_association_not_filtered_to_prove_safe`、`closed_visible_episode_protected`、`current_activity_and_unread_reconsider_sources_protected`、`modern_missing_chat_association_blocks`、`proven_irrelevant_old_history_warning_only`；段数设2／4证明使用实际配置。
- [ ] 写`legacy_inflight_and_modern_activity_null_are_distinguished`；未知影响始终阻挡，真正窗外无引用历史只警告、不删不并。
- [ ] 跑`npm test -- tests/chat-consistency.test.ts`确认红灯；实现保护证明与Host门禁，不引入固定天数豁免或自动历史修复。
- [ ] 同组及`npm test -- tests/chat-recovery.test.ts tests/dialogue-recovery.test.ts tests/recovery.test.ts`、类型检查通过；日志列每种warning／blocking依据，提交任务19。

### 任务20：集成、实际库检查与增量交付

**Files:** 扩`scripts/validate-prompt-context.ts`、`src/deployment/prompt-context-acceptance.ts`、`tests/prompt-context-integration.test.ts`；更新本文、实施细化、既有实施日志／验收记录、`README.md`、`docs/IMPLEMENTATION_HANDOFF_20261007.md`、`docs/DOCUMENT_AUDIT.md`及相关现状说明。

**Interfaces:** 验收仍单请求默认300秒、隔离库、同一Host夹具；报告uniqueMessageIds与真正envelope副本断言分别列。正式检查含故事与学校步骤／checkpoint，不启动服务。实施起点重查Git和适用AGENTS，用户未要求新聊天或子代理时按既有内联方式执行。

- [ ] 扩集成用例覆盖普通4段→活动含题外话／动作→无台词公开代写→提前收尾→收尾记忆恢复→普通追问检索；明确活动全文只在活动工作阶段、角色输入／来源权限完整、可生成多条短期。
- [ ] 新增集成用例先确认红灯，再装配；通过`npm test -- tests/prompt-context-integration.test.ts`。将`notification_contains_stage_no_body_or_key`等约定名称映射到真实文件／用例／断言，缺失项目不能用历史勾选代替。
- [ ] 跑`npm run typecheck`、`npm run build`、`npm test`并记录本次实际数量；逐文件复核同ID引用、未读门禁、v0/v1学校、版本1在途与版本2恢复。已正确policy链只验证，不追加冻结层。
- [ ] 在已有授权范围内进行隔离真实多轮质量验收：授权背景／测试剧情，无正式聊天或图片、不连QQ；检查活动完整连续、结束后相关召回、多条记忆事件／感受、学校通知及角色已知冲突自由处理。报告实际HTTP／embedding数及失败，不把Schema通过或一场一次成功当稳定语义保证。
- [ ] 服务停止情况下只读检查正式库与学校running/ready；确认索引、参数、在途映射明确后备份并显式升级目标2；如存在阻挡则保留报告，不强制清库／丢轮。check不改业务数据，不能承诺SQLite旁文件绝无变化。
- [ ] 核对根目录REMAKE、记忆／共同活动／部署现状说明：当前普通4段与活动完整／结束记忆合同一致；历史review／日志数字不改成当前证据。记录备份、回退所需代码版本及已知限制，不在正式记录写密钥／完整私聊。
- [ ] 更新任务13～20状态，形成增量验收记录并提交；由用户双击现有cmd运行，开发验收不自动启动HDSI／SnowLuma。

## 本次完成标准与计划自检

实施参考只有[实施细化§13～14](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)与本文任务13～20；历史任务及review/rebuttal只供追溯。准备阶段尚未修改代码、运行模型／测试或升级正式库。

计划已对照源码和REVIEW23自检：独立普通锚点／新索引，阶段可见排序，活动全场授权原文，结束保留本轮处理，未读直接输入不丢，多记忆不扩大来源，lookup新版本不误删，旧学校合同／ready兼容，实际参数升级，保护范围和失败恢复均有明确任务／验证入口。没有新的待用户决定项；实施完成才可把本批checkbox勾选并写“通过”。
