# 提示词与上下文优化 V0.1 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 若用户明确选择子代理执行，再使用 superpowers:subagent-driven-development。任务1～12已实施，复选框记录本次交付；证据见实施日志及验收记录。

**Goal:** 保持有效事实、来源和模型职责，消除同次请求副本，并以4个完整对话段替换30条消息原文窗口。

**Architecture:** 沿单串行Host及SQLite事务保存显式段索引，消息正文留在原表。Host完整快照与轻量模型DTO分开；Client每次请求合并资料、选择适用提示。第二批单独收窄表达／背景／环境，并把周计划机械输出移交程序。

**Tech Stack:** 现有TypeScript、Node.js、SQLite、Zod、Vitest；不新增运行依赖。

**Spec:** [实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)。设计审阅基线`6ed66e2`；本次实施起点`f891c48`，设计／审核已确认。

[REVIEW21](../DSH-review/DSH_REVIEW21_PROMPT_CONTEXT_V0.1_PLAN_20261008.md)已整合，具体取舍见细化§12。用户选择B：无必需通知时，即使有日程冲突也不额外调用周模型；角色自由处理自己真正知道的安排。

## 全局约束

- 固定默认`recentDialogueSegments=4`、`dialogueIdleMinutes=15`；段内完整，不叠加旧30条。
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

## 完成标准与审阅入口

任务1～8和9～12分别形成可审核交付；所有必需行为能指向测试／恢复报告，语义质量能指向隔离验收记录。未进行真实验收或未批准背景映射时如实记录，不把相应项目标成完成。

本次已按任务1～12完成代码、回归和隔离语义验收。复核入口为本文、实施细化、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)和[验收与代码复核记录](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)。方案／review／rebuttal用于追溯；未增加自动裁剪、手动脱困或新模型任务。
