# 世界与学校规划 V0.4 执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 按任务逐项实施。本计划在当前会话顺序执行，任务共享环境步骤、学校版本和故事事务；只有用户另选代理协作才使用 `superpowers:subagent-driven-development`。用复选框和实施日志记录真实完成状态。

**Goal:** 实现06:00世界→校园→课题组→周计划每日检查、稳定学期／科研安排、独立通知与角色实际获知，并安全升级旧配置及数据库。

**Architecture:** 延续单串行Host，环境批次独立持久化、逐步骤让位、模型失败局部重试；学校上游计划由各归属模型写入，周任务唯一展开实例／通知候选，程序统一保存与发布。角色获知和研究经历沿用前台冻结／段B事务，不另开故事系统。

**Tech Stack:** 现有TypeScript、Node >=22.13.0、内置SQLite、Zod、Vitest、Koishi；版本沿用package.json，不新增依赖。

**Spec:** [实施细化](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)是字段／时序依据，本计划是任务／验收依据，[方案](WORLD_SCHOOL_PLANNING_V0.4_PROPOSAL_20261008.md)是产品背景。第十一轮回应、第十二轮[计划审查回应](../../dsh-review/CODEX_REBUTTAL_WORLD_SCHOOL_V0.4_PLAN_20261008.md)及[第十三轮补充](../../dsh-review/DSH_REVIEW13_WORLD_SCHOOL_V0.4_PLAN_SUPPLEMENT_20261008.md)已合并，实施不再拼接审核文件。已有记忆、网页搜索和共同活动文档用于相关接口查询，不重复执行已完成计划；完整阅读口径见细化§11。

日期：2026-10-08。状态：任务1～8实现、场景验收及整分支最终复核完成；终审三项日历修复通过全量336项回归。实际起点`690a5ed`；[实施日志](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_LOG_20261008.md)记录命令、裁定、迁移、提交及主目录交付，[真实验收](WORLD_SCHOOL_PLANNING_V0.4_REAL_STORY_ACCEPTANCE_20261008.md)保留模型的合法选择及失败。设计基线`7da4ace`供追溯。任务中的具名行为部分合并为同一业务测试，以实际文件与报告为准。

## Global Constraints

- 当地06:00单一起点，争取07:00完成；学校没有16:00第二定时，起床／聊天不等待完整晨间链。
- 一次只一项环境步骤或故事；普通15秒openBatch期间不新开环境步骤，每一步之间让出事件循环并重扫前台；正在请求时仍可能延后聊天。
- 模型失败默认300000ms局部重试，不全局暂停、不变成unfinishedTurn；存储／提交错误和人工暂停保持明确边界。旧未完成普通／共同故事仍先恢复。
- 无变化合法；学期／科研计划持续保存，在读研究生允许零常规课程；要求参加不强制参加；只模拟科研，不运行真实实验／代码／论文／发送导师消息。
- 常规本周／下一周、周五生成下周；远期事项当前下发／改期／取消通知不能被周窗口挡住。不增加人工字符、token或条数预算，不自动裁上下文超限。
- 校园／课题组拥有上游，周任务唯一展开实例和通知候选，程序唯一保存／发布／失效；默认announceOnIssue／announceOnChange为true。更正必需集合覆盖已读旧版本，合法本版候选去重；关闭reminders不关闭更正。
- 下发窗口由issuedAt／曾发布／已知判定，远期但已下发事项及时更正；未知未下发草案更新未来候选，不强制当日发布。release只交付publishAt已到且仍合法通知，不以活动生效时间或新增validFrom门禁延后提前通知。发布不更新角色知识。
- 已读是前台实际经历，段B与知识／进展一起提交；relatedEventIds不是已读证据，意图／通知／排程不是完成科研的证据。
- 睡眠／洗澡通知暂存，无已知结束不轮询；共同通知只合并合法节点，不破60秒／不改变无真实输入代写分支；纯通知contactEligible=false。
- 每个实际主叙事前台轮成功后沿用150～210分钟自主重排；客观环境／通知发布／暂存不重排。
- 三个学校模型独立Flash、low，可分别改Pro；原其他角色不变。网页每步独立20成功／40失败，修补／续调用／恢复沿用，不选provider、不伪联网。
- 正式服务保持停止，由用户cmd手动启动。正式库应用只在只读检查、停止与备份后进行；临时库测试先于正式升级。
- 在线验收限已允许角色背景及隔离测试剧情，不发送正式私聊／图片，不连QQ，不执行真实研究；工具请求默认300秒，不冒充正式客户端超时。

## Review Focus

1. 06:00链执行中刚收到普通消息、或世界模型失败：消息落库，下一选择点先前台；重试等待不堵聊天／自主，前序未成功不跑学校（任务2、7）。
2. 角色已知班会旧时间，周中改期却未读更正：旧未读提醒失效，个人／lookup仍只有旧已知版本，不能从关联ID泄漏最新安排（任务4、5）。
3. 睡眠、未知结束洗澡、拒看通知与共同静默：通知不形成立即循环、不额外推进共同场景／关闭代写，合法获知才入记忆（任务4、5、7）。
4. 下月任务今天下发而本周无课，随后角色只是计划研究：当前issue仍交付，不造满课表；没有真实模拟经历不能记录成果／导师反馈（任务3、4、5、8）。
5. 只有旧school的配置＋done=false冻结环境轮＋未完成共同轮：解析先兼容，旧环境显式替代未成功，未提交结果不应用，共同恢复不被排除，重复迁移不重置身份（任务1、6、7）。

## 文件与接口归属

文件职责与完整字段见细化§2～3。以下任务的Create为拟新增文件，并非已经存在；Modify为现有文件。核心类型实际名为 `TurnCandidate`，不得另造不相容Candidate。所有新增类型集中在environment/types及school/types，src/types可按需导出。公共日期算法复用src/time，学校calendar只负责周及重复时段展开。

环境执行使用细化§4的 `EnvironmentGenerator`；生成和冻结分开：模型入口返回变更，runtime分配一次ID并冻结，再事务应用。学校应用不另开数据库连接。测试统一扩展现有setup，避免不同fixture使用不同资格规则。

## 任务1：配置兼容、类型与可独立测试的存储

**Files:** Create `src/environment/types.ts`、`store.ts`、`src/school/types.ts`、`store.ts`、`tests/world-school-fixture.ts`、`tests/world-school-state.test.ts`；Modify `src/types.ts`、`storage.ts`、`config.ts`、`settings.ts`、`src/app.ts`、`index.ts`（仅Store依赖装配）、`tests/model-settings.test.ts`、`tests/helpers.ts`。

**Interfaces:** 定义细化§3所有类型／表及核心新增字段；实现 `normalizeSchoolModels(raw: unknown): unknown`。`EnvironmentStore(storage: Storage)`、`SchoolStore(storage: Storage)`封装相应JSON表的保存／按ID读取／列表，不复制现有Storage事务算法。模型角色及新AppConfig来自细化§2；先不启用Host新路径。

- [x] 写 `legacy_models_before_parse`、`partial_override`、`explicit_invalid_no_fallback`、`all_new_without_old`、`missing_roles_named`、`loader_no_write`：真实loadSettings路径证明只补缺、独立复制、错误明确、文件不改；不是只测试connectionFor。
- [x] 写 `environment_marker_not_auto_upgrade`、`school_records_roundtrip`、`legacy_terminal_predicate`：新库版本1，旧库缺项null；知识保留不同版本；旧superseded不阻挡，普通／共同done=false仍阻挡。
- [x] RED：`npm test -- tests/model-settings.test.ts tests/world-school-state.test.ts`，应因新兼容／字段／表缺失失败；记录实际错误，若测试本身写错先修测试。
- [x] 实现配置解析前补齐、独立模型角色、JSON表与类型。Runtime旧截止保留解码但为退役字段；version getter不得替旧库填1。共享类型新增观察／进展数组按[]兼容；新story refs冻结到TurnRecord及TurnCandidate。
- [x] GREEN：同一命令通过，运行 `npm run typecheck`；必要更新旧fixture的AppConfig字段，不靠关闭新功能让测试通过。
- [x] 日志记录配置兼容矩阵，显式暂未启用调度。提交本任务源码／测试／日志：`feat: add world school planning schema and config compatibility`。

## 任务2：每日批次、逐步骤让位与失败隔离

**Files:** Create `src/environment/runtime.ts`、`scheduler.ts`、`tests/world-school-batch.test.ts`；Modify `src/host/scheduler.ts`、`runtime.ts`、`src/app.ts`、`src/model/client.ts`、`tests/scheduler.test.ts`。world生产生成入口在任务3适配，测试先用注入generator。

**Interfaces:** 实现 `ensureEnvironmentBatch(storage, config, now)`、`selectEnvironmentStep(storage, now)`、`environmentDeadline(storage, now)`、`runEnvironmentStep(d, stepId, generate)`，精确签名见细化§4。产生 `ModelRequestError`，只包装请求／HTTP／响应封装错误。Dependencies的环境／学校Store引用复用任务1，新增generateEnvironment注入点用于本任务假生成器，任务3绑定生产实现；业务时间用Clock。完整正式装配及启动门禁在任务6，不在中间提交启动服务。

- [x] 写 `daily_six_no_drift`、`bootstrap_same_date_once`、`world_before_three_school_steps`、`retry_wait_does_not_block_autonomy`、`model_failure_not_pause`、`storage_failure_not_model_retry`、`pending_dependency_no_hot_deadline`、`ready_restart_no_regeneration`、`cross_date_supersedes_only_uncommitted`。
- [x] 写 `open_batch_yields_before_new_step`及 `input_arrives_during_request`：阻塞fake generator时输入立刻落库，释放请求后先聊天再下一学校阶段；不声称请求中已并行回复。增加 `ready_predecessor_blocks_downstream`、`committed_step_yields_before_next_generation`：ready不能提前生成下游输入，committed后先让位重扫新消息再选择下一步。
- [x] RED：`npm test -- tests/world-school-batch.test.ts tests/scheduler.test.ts`。
- [x] 实现日批次稳定身份、步骤快照→running→ready→committed、固定5分钟模型重试、跨日替代。变更应用与步骤完成同事务，ready只应用不重生成。await一步后让出事件循环重扫，不把4次调用装入一个runTurn。
- [x] 用environmentStepId分流串行busy槽；新环境不创建TurnRecord／outbox／post job，不走前台报错暂停catch。旧环境Kind只在升级／审计识别。Scheduler及deadline移除旧world／school定时来源。
- [x] GREEN：同一测试命令及 `npm run typecheck`通过；确认环境动作没有改narratedUntil、自主、共同轮数或QQ发送。
- [x] 日志记录实际失败分类及已开始请求的限制。提交：`feat: isolate daily environment steps and retries`。

## 任务3：三学校合同、输入和独立网页会话

**Files:** Create `src/school/contracts.ts`、`tests/world-school-models.test.ts`；Modify `src/directors/world.ts`、`school.ts`、`src/model/prompts.ts`、`src/memory/retrieval.ts`、`src/web/types.ts`、`store.ts`、`src/environment/runtime.ts`、`src/app.ts`、`index.ts`（生产生成器绑定）。

**Interfaces:** 实现 `generateEnvironmentStep(d: Dependencies, input: EnvironmentStepInput): Promise<EnvironmentModelResult>`，内部分派world及 `runSchoolCampus/Group/Week(d, input)`；合同为 `schoolCampusTask`、`schoolGroupTask`、`schoolWeekTask`。生产runEnvironmentStep传 `input => generateEnvironmentStep(d,input)`，不能留测试generator替代正式模型；runtime将原始模型结果解析ID后冻为EnvironmentChangeSet。

- [x] 写 `roles_can_differ`、`wrong_owner_rejected`、`empty_updates_keep_plan`、`doctoral_zero_courses_valid`、`plan_is_not_research_result`、`fiction_default_and_provided_urls_only`、`campus_group_context_has_existing_identity`。研究／导师固定背景明确提供，不再只用旧school正则。
- [x] 写 `each_step_has_own_web_session`、`repair_and_retry_keep_counters`、`environment_not_personal_web_memory`、`new_roles_current_only`：20／40按step独立，lookup／repair沿用；新环境所有者不会产生personal_life来源，school_*不开放归档权限。增加 `superseded_step_keeps_web_counters`、`same_step_does_not_reopen_session`、`next_date_step_has_independent_quota`，断言旧终结计数不清零、同身份不重开、新日期step独立0／0，不形成跨日总池。
- [x] RED：`npm test -- tests/world-school-models.test.ts tests/environment.test.ts`。
- [x] 实现新合同及提示词、增量结果归属和clientRef解析，保留world已有事件校验。按细化§6为每步绑定environment owner；网络重试继续同一会话，不重新给网页额度。终态模型失败后的下一attempt按细化规定重置请求修补状态；仍保留成功工具结果／计数和审计。
- [x] 不启用搜索provider，缺服务按已有真实不足信息返回；大计划稳定复用，不强制每日新事件，不用完整私聊做导演输入。
- [x] GREEN：同一测试命令、相关web现有测试及 `npm run typecheck`通过；如工具接口修改，运行对应web checkpoint／session用例并记录。
- [x] 日志列出各任务实际模型键、数据来源和剩余任务4的周展开依赖。提交：`feat: split school planning model roles`。

## 任务4：周实例、通知版本与定时发布

**Files:** Create `src/school/calendar.ts`、`notices.ts`、`tests/world-school-calendar.test.ts`、`tests/world-school-notices.test.ts`；Modify `src/school/store.ts`、`contracts.ts`、`src/environment/runtime.ts`、`src/host/scheduler.ts`、`runtime.ts`。

**Interfaces:** `schoolExpansionInput(storage, now, timezone): SchoolExpansionInput`；`applySchoolChanges(storage: Storage, changes: EnvironmentChangeSet, now: ISOTime): void`在调用者事务中使用；通知三个接口release/select/deadline精确签名见细化§7。任务3周生成入口接入真实calendar输入和合同覆盖校验。

- [x] 写 `friday_next_week_monday_confirm`、`same_slot_same_week_id`、`move_preserves_occurrence`、`no_change_no_duplicate`、`far_future_issue_today`、`tentative_no_two_hour_guess`、`local_day_offset`、`conflicts_are_not_forced_choices`。旧已发生课次不覆盖；周窗口不是人工数量预算。
- [x] 写 `reschedule_requires_correction_notice`、`read_only_old_version_requires_correction_notice`、`cancel_requires_cancellation_notice`、`correction_candidates_not_recreated_after_commit`、`disabled_change_policy_not_forced`：改期／取消缺必需候选拒绝；仅已读旧版也必须更正；只写覆盖记录不算完成，跨日重试义务保留；同版合法候选不重复；明确关闭更正遵守策略。
- [x] 写 `public_far_future_change_not_delayed`、`undisclosed_future_change_waits_for_issue`、`scheduled_notice_is_not_publication`：期限远不阻挡当前下发／更正；未到issuedAt且未发布／未已知的草案更新未来issue候选，不能强行当日change或设已知。周摘要／现场已知与曾发布后被invalidated的旧通知仍使条目进入更正判断，releasedAt在失效后保留。
- [x] 写 `upstream_change_immediately_invalidates_unread`、`read_snapshot_survives_reschedule`、`internal_note_no_reminder_storm`、`overdue_setup_single_meaningful_notice`、`release_without_model_or_autonomy_reset`、`sleep_and_unknown_end_no_hot_loop`、`declined_notice_no_immediate_rewake`、`personal_reminder_requires_known_version`（自己的提醒不泄漏未读安排，机构通知仍可交付）。
- [x] 写 `due_notice_released_before_selection`、`notice_deadline_reaches_host_timer`、`publication_waits_for_publish_at`、`future_effective_event_can_be_notified_now`：刚到publishAt当次collectReady先发布后冻结refs；未来publishAt仍scheduled且唯一定时器取该时刻；未来才生效的事项可提前通知，不新增validFrom检查。暂停／unfinished门禁不发布，恢复后才扫描；程序发布审计不作已读证明。
- [x] RED：`npm test -- tests/world-school-calendar.test.ts tests/world-school-notices.test.ts`。
- [x] 实现稳定occurrence／notice元组身份、日历输入及已知快照、周模型唯一候选与双覆盖判据；上游提交即失效旧未读，不等school_week；保留旧已读及releasedAt历史。依据细化§5.1推导窗口、必需change／cancel和未来最新候选，不能只查invalidated列表或只写SchoolWeek.sourceVersions。公开措辞来自周任务，程序补真实身份／引用／快照，不另起文案模型。
- [x] 终审补验：删除时段／缩短范围／改暂定后旧未来课次取消；已开始课次保持历史，后继未来实例另建ID且再次改期保持该ID；等待重展开时旧客观安排及onsite来源退出，角色已知旧快照保留。requiredOccurrences.status由程序决定；兼容历史缺baseOccurrenceKey，不再提升数据库版本。6个回归变体先RED再GREEN，见日志。
- [x] 在Scheduler.collectReady的closeReady及paused／unfinishedTurn门禁后接入release短事务，再读取／选择；schoolNoticeDeadline并入Scheduler.nextDeadline，由Host现有armTimer处理，不新增发布入口／计时器。已不可读／拒看不反复贡献now。模板使用前1本地日／120分钟、常规60分钟，允许上游策略调整；远期当前issue／change／cancel必处理，未来通知到publishAt才发布。
- [x] GREEN：同一命令及 `npm run typecheck`；精确检查定时器下一截止为未来或null，不仅检查一次collectReady返回null。
- [x] 日志记身份样例及周无变化前后行数。提交：`feat: schedule versioned school notices and weekly instances`。

## 任务5：角色知识、通知故事与研究来源事务

**Files:** Create `src/school/context.ts`、`progress.ts`、`tests/world-school-perspective.test.ts`、`tests/world-school-story.test.ts`；Modify `src/app.ts`、`recovery.ts`、`src/host/scheduler.ts`、`src/model/contracts.ts`、`prompts.ts`、`src/directors/narrative.ts`、`personal.ts`、`src/memory/organize.ts`及相关lookup／引用展开实现。

**Interfaces:** 细化§8的 `narrativeSchoolContext`、`personalSchoolContext`、`prepareSchoolCommits`、`applySchoolCommits`，均用任务1同名类型。narrativeTask扩展schoolObservations／researchProgress，缺省[]；候选保存schoolNoticeRefs及已校验提交，旧前台冻结恢复按[]不重生成。TaskKind不新增学校任务，触发来自独立通知表。

- [x] 写 `personal_keeps_old_known_revision`、`related_id_not_read_proof`、`lookup_and_expression_no_hidden_plan`、`known_course_reused_without_new_source`、`explicit_future_known_query_allowed`、`late_notice_not_read_in_past`、`week_digest_only_declared_entities_known`。
- [x] 写 `pure_notice_life_no_contact_draw`、`unread_not_forced_personal`、`sleep_stashes_notice`、`shared_notice_waits_legal_step`、`shared_notice_does_not_disable_simulated_actions`、`read_and_experience_commit_atomically`、`recovery_no_double_read`、`future_notice_waits_next_frozen_turn`。
- [x] 写 `publication_does_not_update_known_revision`：客观改期已提交、新更正已available但未读时，个人／lookup仍旧已知版本；实际获知并段B成功才更新，不能把“发布”当作“读过”或把旧认知当客观仍有效。
- [x] 写 `research_intent_not_progress`、`notice_not_completion`、`progress_requires_actual_experience`、`mentor_feedback_uses_experience`、`notified_requirement_can_be_refused`、`foreground_success_rerolls_autonomy_only_once`。
- [x] RED：`npm test -- tests/world-school-perspective.test.ts tests/world-school-story.test.ts`。
- [x] 实现客观／已知版本双投影及引用过滤；观察index在分配experienceId后校验，个人本轮可见但段B才正式获知；研究只有实际经历来源。故事主叙事先补生活，通知不伪装用户input；纯通知不抽联系，未读可合法保持未读。
- [x] 扩展freeze和段B，在同一事务提交旧故事结果、通知read、知识、进展和自主重排。模拟提交错误／恢复断言没有已读无经历或重复进展；共同通知不突破窗口／不计真实输入。计划进入意图区，记忆来源仍走现有合法experience／message体系。
- [x] GREEN：同一命令及受影响既有共同／memory来源／recovery测试、 `npm run typecheck`；日志记录程序只能校验结构，自然语言知识泄漏留给真实验收。
- [x] 提交：`feat: commit school knowledge and simulated research experiences`。

## 任务6：旧库检查、停服升级与正式入口

**Files:** Create `src/deployment/environment-upgrade.ts`、`scripts/migrate-environment.ts`、`tests/world-school-upgrade.test.ts`；Modify `src/index.ts`、`src/storage.ts`、`src/host/runtime.ts`、`package.json`及实际恢复诊断入口。

**Interfaces:** `inspectEnvironmentUpgrade(databasePath: string): EnvironmentUpgradeReport`；`upgradeEnvironment(databasePath: string, options: EnvironmentUpgradeOptions): EnvironmentUpgradeReport`。选项及报告见细化§9；增加 `migrate:environment`脚本，命令默认check。入口先配置补缺／校验连接，再只读版本检查，Storage写入／Host启动只在门禁通过后发生。

- [x] 构造真正旧格式临时库，写 `old_ungenerated_environment_superseded`、`old_frozen_not_applied`、`old_success_preserved`、`ordinary_and_shared_unfinished_still_block`、`unexpected_environment_outbox_reported`、`repeat_upgrade_same_batch_and_closed_at`、`paused_not_auto_cleared`、`legacy_active_not_auto_known`、`config_compat_does_not_bypass_db_gate`、`readonly_check_no_writes`、`backup_before_apply`。
- [x] RED：`npm test -- tests/world-school-upgrade.test.ts`。
- [x] 实现备份SQLite／WAL／SHM、同事务导入legacy并保留eventID、终结旧环境、唯一替代批次、清旧截止、写版本1。done=false仍表示未成功，superseded是明确终态；不删旧frozen／post job／网页历史、不运行旧school或应用其未提交结果。
- [x] 全部恢复／统计入口用同一终态口径；普通／共同前台仍保护发送恢复。check明确paused及异常，应用不自动resume／启动。完整接线环境runtime、三模型、通知和学校Store，生产不得使用未装配空实现。
- [x] GREEN：同一命令、 `npm run typecheck`、 `npm run build`；用构造旧库跑CLIcheck／apply／二次check，检查文件、版本及不变记录。
- [x] 只读检查正式库并记报告；按报告停服确认与备份后显式应用，必要异常留在日志并先处理，不能声称正式库一定存在遗留轮。HDSI及SnowLuma保持停止，不通过启动机器人证明迁移成功。
- [x] 提交源码／测试／脚本／日志：`feat: upgrade legacy environment planning safely`；密钥、正式配置、数据库与备份不入Git。

## 任务7：离线集成、示例和已实现文档同步

**Files:** Create `tests/world-school-integration.test.ts`；Modify `tests/helpers.ts`、`tests/environment.test.ts`、`tests/scheduler.test.ts`、其他实际受影响测试、`examples/story.sample.json`、`scripts/demo.ts`、`runtime/plugin-smoke.cjs`、README、实际受影响根目录架构／调度文档及实施日志。

**Interfaces:** 不新增业务API；消费前6任务生产接口。样例显式新学校模型键及environmentDailyAt，旧school仍只作为兼容测试输入。

- [x] 写 `chat_after_failed_morning_step`、`notice_during_shared_and_resume`、`cross_day_partial_batch_and_new_week`、`old_config_upgraded_db_plugin_start`、`fresh_db_bootstrap_chain`集成用例，用同一Host／App真实装配路径和假模型证明顺序、资格及恢复。
- [x] RED：`npm test -- tests/world-school-integration.test.ts`。
- [x] 修实际接线／旧fixture和示例；demo及插件smoke使用临时库／假HTTP，不连QQ。同步文档只写真实实现、指出正在请求仍占串行槽及未选provider；旧审查／历史日志不改成新事实。
- [x] GREEN：`npm test`、 `npm run typecheck`、 `npm run build`、 `npm run demo`、 `node runtime/plugin-smoke.cjs`。从package.json核对命令后运行；记录真实用例数、退出码及输出，不用旧测试成绩代替。
- [x] 保存正式只读／升级报告索引和各任务提交；检查未意外启动服务或纳入私有文件。提交：`test: verify world school planning integration`。

## 任务8：隔离真实多轮验收与交付记录

**Files:** Create `scripts/validate-world-school.ts`、`docs/WORLD_SCHOOL_PLANNING_V0.4_REAL_STORY_ACCEPTANCE_20261008.md`；Modify package.json（新增 `validate:world-school`）、实施日志、本文和细化状态。

**Interfaces:** 验收脚本调用正式模型及生产App／Host、隔离SQLite和记录Sender；`scripts/validate-world-school.ts`自身默认单请求等待／取消上限300000ms，可显式覆盖，仅工具包装Transport／请求signal生效，不新增AppConfig字段，不改正式ModelClient超时语义。必须固定测试目录、时钟推进、目标模型和无QQ装配，不能把手写预期JSON当实际模型输出。

- [x] 先写脚本数据路径／无QQ／授权输入范围检查，离线试跑确认不会读正式messages或写正式数据库；确认300秒只在工具请求包装层、取消signal能终止该请求，不用仅结束等待的Promise.race留下请求写隔离库。RED/GREEN属于工具验证，真实模型语义验收另列。
- [x] `npm run validate:world-school -- --offline` 验证脚本与临时数据准备；实现正式模式后，在已允许角色背景＋模拟测试剧情范围执行 `npm run validate:world-school`。
- [x] 固定案例：周五→周一复用课程；下月科研任务今天issue及当前改期；未来未下发草案更新预排候选而不今日发布；班会前一天／前2小时通知、洗澡待看、必到也可拒；只已读旧日程也产生更正、发布未读仍保持旧知识；共同下一合法节点获知；个人意图→下次主叙事模拟研究→实际导师反馈→有experienceId进展；第二天空变更不重建。
- [x] 审阅输入、输出和数据库证据：是否出现隐藏知识／虚构联网／无时间成果／强制参加／每日换课表／通知空转。模型真实选择与预期不同但合法时记录选择，不强迫得到某个剧情结局；发现合同缺口修复并针对重验，不重复所有已经通过场景。
- [x] 验收报告列模型与思考强度、次数、实际用时、超时／修补、关键turn／experience／notice／版本证据及残留限制；原失败保留，不能只收最终成功。真实角色自由选择的语义风险不能由离线单测替代。
- [x] 完成后更新任务勾选和状态、日志、实际行为说明；运行最后受影响检查及 `git diff --check`，保存本地提交 `docs: record world school planning acceptance`。若验收尚未通过，明确待办并保持未完成，不提前标交付。

## 交付自查

- [x] 配置补缺在Schema前；三个学校模型独立，旧school不运行，06:00是唯一配置起点。
- [x] 模型失败不暂停聊天；ready、重试和跨日可恢复；没有遗留环境turn堵unfinished门禁。
- [x] 周展开、远期下发、通知版本、睡眠／共同资格、个人已知与研究来源均有业务证据。
- [x] 更正包含已读旧版，未来草案与已下发远期事项区分，候选去重与实际发布独立；调度发布在collectReady门禁后／选择前，仍只有一个Host定时器。
- [x] 验收工具300秒只在工具包装生效；正式AppConfig／ModelClient超时语义未被改写，旧跨日网页会话未清零，新日期步骤仍有独立额度。
- [x] 正式库有真实check／备份／升级记录，旧普通／共同恢复未损坏，paused未自动清除。
- [x] 离线集成和真实多轮语义验收分别报告；源码、示例、实际行为文档、日志口径一致。
- [x] 服务仍由用户手动启动；无密钥／私聊／正式数据库入Git，无虚构联网或真实科研执行。

## 第十四轮交付复核修复（原任务1～8不重复执行）

本轮按照已接受回应§6依次执行三组修复；程序和细化为最终口径，详细过程见[修复记录](WORLD_SCHOOL_V0.4_REVIEW14_FIX_LOG_20261008.md)。

- 冻结／ready跨开始的候选保留历史并归一化后继实例、引用及提醒身份；同周新摘要失效旧未读，read和重放状态保留；旧批按自身时区日期退出，配置时区改变替代。
- 普通跨日／离线入口不得在06:00前启动新日常链，bootstrap／显式upgrade例外；取消记录cancelledAt，客观与onsite按有效区间退出，过去安排与角色知识保留。
- 程序为全部weekStarts补全冻结sourceVersions和checkedAt；weekChanges可空或给conflictNotes，错误／重复声明及独立必需通知漏项拒绝。默认提醒按timing、显式策略优先；装配错误暂停并报一次，旧恢复不写退休截止。

验收索引：world-school-review14-calendar（跨请求／ready／pending重试、提醒身份、摘要三状态）、review14-environment（时区替代）、review14-time（午夜／早期例外及取消投影／知识）、review14-contracts（覆盖／已有下周／提醒正向／门禁／running恢复／公开版本／装配／旧截止），以及model-settings的原文件不改写断言。历史running_restart_keeps_attempt_and_ready_blocks_later_steps改名为ready_predecessor_blocks_later_steps_without_freezing_downstream；真正running恢复由新增业务用例验证。

提交前跑全量测试、typecheck、build、demo及plugin-smoke；独立终审只做一次，正式服务不启动，正式数据库不改写，不声称本次重新做过在线多轮验收。

终审补测：completed_batch_timezone_change_reconciles_local_six（05:00／06:00）与same_day_return_to_superseded_timezone锁住已完成后切换及返回终态身份；delayed_request／ready／pending_drops_uncommitted_missed_reminders锁住迟到未入库提醒剔除，already_committed_reminders_keep_delayed_publication保留既有延迟发布。两个Important发现均在同一次修复中完成RED→GREEN；不再派第二轮审查。
