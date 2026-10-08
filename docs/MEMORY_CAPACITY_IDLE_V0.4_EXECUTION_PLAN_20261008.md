# 记忆容量与空闲整理 V0.4 执行计划

最新交付：REVIEW17／18修复及整体复核修正已集成，83文件469项测试通过。原任务1～8的435项为历史基线；最新过程见REVIEW17_MEMORY_FIX_LOG_20261008.md。

> **For agentic workers:** REQUIRED SUB-SKILL: 使用`superpowers:executing-plans`逐任务实施。本计划在当前会话由实施者顺序执行；只有用户另选代理协作时使用`superpowers:subagent-driven-development`。用复选框和实施日志记录真实状态，不将文档编写视为代码完成。

**Goal:** 实现短期100／普通长期1000／归档500的有限记忆工作集、真实清理与引用完整性，以及基础每轮提取、深度空闲15分钟整理。

**Architecture:** 复用MemoryStore／Lifecycle、SQLite段B和SerialHost，容量与清理为同步程序规则；深度整理／索引共享一个后台网络槽，按资格过滤后FIFO。持久化空闲锚点和增量版本，清理时剪除派生副本，准备回调读取新job防止旧快照复活。

**Tech Stack:** 现有TypeScript、Node >=22.13.0、内置SQLite、Zod、Vitest、Koishi；不新增依赖、向量数据库或模型角色。

**Spec:** [实施细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)固定字段、合同及时序；本计划固定文件、任务和验收。DSH第十五轮、CODEX补充及[第十六轮计划审核](../DSH-review/DSH_REVIEW16_MEMORY_CAPACITY_IDLE_PLAN_20261008.md)已折入细化，执行时不再拼接审核文件。

日期：2026-10-08。状态：任务1～8及最终复核修正已执行。实际基线`9e24b0d`；435项测试、类型检查、构建及隔离离线／有限在线验收通过，最终复核见交付记录。正式空库仅只读检查，未升级／清理，未连接QQ或启动服务。实际过程见[实施日志](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_LOG_20261008.md)。

## Global Constraints

- 活跃短期100、普通长期1000（包括未可见preview）、普通归档500个canonical；归档最长90天，超时与超量是OR。独立配置显式null关闭对应约束。
- 归档集合以细化§3.1的isArchivedLong同源判定，计数、查询、清理和升级一致；已保存archiveEnteredAt是本次窗口唯一锚点，后续expiresAt不另开窗口。
- 7天／90天／3个有效日期续期／30个日期常驻候选，canonical＋Asia/Shanghai日期去重不变；重谈不延长短期，处理now不给旧事保鲜。
- 基础每轮提取及details更新保留；深度prepare、重试、ready应用均检查最新空闲15分钟与活动门禁。新输入即时刷新，输出／故事更晚时刻再次刷新。
- 共同活动整体阻挡，普通明确活动未实际结束阻挡；expectedEndAt只作重查，不证明结束。睡眠例外只解除睡眠自身阻挡。
- 计数／转层／少量清理不等15分钟、不调用LLM；前台优先，一次一个清理／应用单元，单元间setImmediate。暂停不提交，stop沿用取消及关闭顺序。
- 一个后台准备网络槽、一个Host定时器；不合格deep ready不挡索引，合格任务createdAt→jobId公平排序，不无限索引优先。
- 人为上下文预算默认null、近期30条、相关性／来源限制保留。memory与memory_consolidation独立Flash/high，允许后续Pro，搜索额度／Embedding配置不变。
- 清理正文、向量、唤醒／grants、退出副本及job快照；有效常驻证据、details、作者背景、原始消息／公开剧情及学校业务不删。不得用deleted标记继续无限留正文。
- 结构升级使用memoryCapacityVersion=1，记忆schema和基础输出schemaVersion仍3；旧库显式停止／备份／检查后升级，新库直接初始化。
- 本计划不启动正式服务。在线场景仅使用此前允许的角色背景及隔离模拟剧情，不发送正式聊天／图片，不连接QQ；验收工具单请求300秒，不误改后台120秒默认。

## Review Focus

1. LLM在途时某个owner被删除，返回／超时不能复活snapshot、checkpoint或vector；无关单元继续（任务3、6）。
2. 活跃short指向已到期／归档long，清理不能制造linkedLongId悬空或强行缩短short7天；真正合并重指（任务2、3、5）。
3. 新输入在旧idle截止／ready应用前到达，等待重新开始；共同活动静默也持续阻挡，环境完成不刷新（任务4、6）。
4. deep ready不合格而索引可运行、或索引持续新增，另一类任务不被永久堵住，过去截止不造成0ms循环（任务6）。
5. 旧库有超过500条历史归档、done job／post_job仍含正文，dry-run必须真只读，apply不凭当前时间续旧期限；新记忆和原始业务资料不误删（任务3、7、8）。

## 文件与接口归属

核心类型／返回值使用细化§3的名字，不另造相近但不兼容的结构。`MemoryCapacity`负责counts／normalize／reactivate；`MemoryIdle`负责record／eligibility／nextDeadline；`MemoryCleanup`负责applyOne／nextDeadline。Store负责专用SQL，Lifecycle仍负责真实日期／grant／canonical，Maintenance负责网络任务与单元应用。

新增测试夹具`tests/memory-capacity-fixture.ts`复用现有`tests/helpers.ts`的Storage／Clock／模型和发送器；不得连正式库／QQ。只有具名行为测试，不用重复实现排序器的测试来代替端到端结果。

每任务按“失败测试→最小实现→具名测试及类型检查→记录并本地提交”完成。旧测试若与本期明确改变的行为冲突，更新对应断言与原因，不删除前台／来源回归。只在新修改／失败需要时重复验证。

## 任务1：配置、类型及可独立检查的存储

**Files:** Create `tests/memory-capacity-fixture.ts`、`tests/memory-capacity-state.test.ts`；Modify `src/memory/types.ts`、`src/types.ts`、`src/storage.ts`、`src/memory/store.ts`、`src/settings.ts`、`tests/model-settings.test.ts`。

**Interfaces:** 产出细化§3全部基础类型和字段；Store初始化dirty／audit两张表并提供按owner版本upsert／读取／完成接口：`queueDirty(owner:OwnerVersion,reason:MemoryDirtyOwner['reasons'][number],at:string):void`、`dirtyOwners():MemoryDirtyOwner[]`、`completeDirty(readVersion:OwnerVersion,resultingVersion:OwnerVersion):void`。dirtyOwners仅返回pending／reserved；done保存处理水位不再调用。证据迁移不在配置解析器里执行。

- [x] 写`capacity_defaults_and_nulls`：解码默认100／1000／500／90、15分钟、睡眠true；显式null只关闭自己的约束，0／负数无效，contextLimits仍null。
- [x] 写`legacy_owner_runtime_normalization`、`dirty_latest_version`及`done_watermark_no_requeue`：旧JSON缺项读为null／[]；dirty同owner新版本取代旧版，重复登记不增条数；同版done补漏不再调用；旧容量标记不自动变1。
- [x] 运行`npm test -- tests/memory-capacity-state.test.ts tests/model-settings.test.ts`，确认失败对应缺失的新字段／接口。
- [x] 实现缺省解码、JSON扩展及专用表，不启用清理或改变schema3。完成dirty记录处理后的resultingVersion水位，仅在队列版本仍等于readVersion时转done，不能吞掉期间新版本。
- [x] 同命令通过后运行`npm run typecheck`；创建实施日志，记录基线、配置与本地提交。

## 任务2：活跃容量、检索与生命周期衔接

**Files:** Create `src/memory/capacity.ts`、`tests/memory-capacity-lifecycle.test.ts`、`tests/memory-capacity-retrieval.test.ts`；Modify `src/memory/store.ts`、`lifecycle.ts`、`retrieval.ts`、`organize.ts`。

**Interfaces:** 消费任务1配置／owner字段，产出细化§3.2的`MemoryCapacity(store,config)`及`MemoryCapacityCounts／CapacityResult`；SQL层统一current／archive与自然到期归档计数。`MemoryLifecycle(store,capacity?)`真实awaken在来源／ID验证后调用`reactivate(id,at)`；段B将本轮恢复的canonical ID传入`normalize(now,protectedLongIds)`，不引入双向构造依赖，保留canonical日期去重和更晚grant。

归档纯函数从`src/memory/capacity.ts`导出`archiveStart(row:MemoryCandidate,now:string):string|null`和`isArchivedLong(row:MemoryCandidate,now:string):boolean`；Store的SQL判定与它们等价，任务3清理和任务7升级直接使用此口径，不各写新的判定。

- [x] 写`short_101_summary_immediate`：第101条后shortActive=100，退出条目摘要当刻可查；day 3提前转层的retainedFrom／initial grant是day 3，原短期截止仍day 7。
- [x] 写`long_1001_includes_preview`、`same_long_multiple_shorts_count`、`canonical_awaken_rank`：1001包含预备项，1000占用=preview+visible；两个short关联一个long仍占2个short；short自身0而关联长期日期不同仍正确排序。
- [x] 写`active_sort_and_protection`及`archive_query_not_reactivate`：重要新事优先保留、稳定时间／ID决胜；受保护long不被挤出；查询归档不唤醒、不清标记。
- [x] 写`capacity_reactivate_same_day`、`active_short_link_to_archived_long`：真实重谈恢复90天且不重复同日日期、不缩晚期限；活跃short的旧归档long保留并记录保护，不自动重置其期限。
- [x] 写`archive_membership_sql_matches_policy`：同一组未到期、仅expiresAt到期（archiveEnteredAt=null）、容量退出、有已保存锚点、durable、merged／discarded、short夹具，纯函数与SQL的归档集合完全相同；longArchive计数与current／archive可见性按同一集合及既有retainedFrom权限处理。
- [x] 运行`npm test -- tests/memory-capacity-lifecycle.test.ts tests/memory-capacity-retrieval.test.ts`确认缺失行为失败，再实现排序／转层／归档／恢复，容量改变只提升stateVersion。
- [x] 通过上述测试和`npm test -- tests/memory-v3-lifecycle.test.ts tests/memory-v3-retrieval.test.ts`及类型检查；在日志记录相对V0.3的查询变化并提交。

## 任务3：真实清理、反向引用及迟到结果

**Files:** Create `src/memory/cleanup.ts`、`tests/memory-capacity-cleanup.test.ts`、`tests/memory-capacity-prune-race.test.ts`；Modify `src/memory/store.ts`、`lifecycle.ts`、`maintenance.ts`、`src/recovery.ts`、`src/web/store.ts`、`service.ts`、`src/environment/runtime.ts`。

**Interfaces:** 消费任务2容量计数／归档判定，产出`MemoryCleanup.applyOne(now)`／`nextDeadline(now)`；Store增加`pruneOwnerFromJobs(owner:MemoryOwnerRef,at:string):void`和对应正文／向量／grants删除SQL。Web服务增加`compactOwnerCheckpoint(ownerType:ModelRunRef['ownerType'],ownerId:string):void`，只压缩已结束模型恢复正文，保留计数与来源。

- [x] 写`archive_501_eviction_before_90_days`和`archive_age_without_overflow`：未满90天也可因501超量清理；只有一条超过90天也删除，OR不是AND。
- [x] 写`archive_oldest_low_awaken_first`及`short_details_expire_after_summary`：归档importance在唤醒数／时间之后；容量退出short至原day 7有详情，截止后有摘要则删除short全文和各revision向量。
- [x] 写`archive_anchor_survives_later_expiry`和`natural_expiry_without_persisted_anchor`：day 10容量退出保存锚点，后到day 90自然截止仍以day 100作为归档90天清理截止；仅自然day 90到期、字段未写时计入归档并以day 180为截止，落地不能改用维护now。真实恢复清空本次标记，后续真实退出才开新窗口。
- [x] 写`protect_and_repoint_references`：活跃short或有效learned证据阻挡删long；真正合并先重指short和learned证据，再去除旧副正文；按canonicalMemoryId删grant，不误删已迁移记录。
- [x] 写`missing_owner_stale_other_unit_applies`：删除一个owner后其unit stale，另一个unit仍可应用；既有contracts.ids⊆readOwners继续成立，应用不用非空断言。
- [x] 用可控Promise写`late_prepare_does_not_restore_pruned_snapshot`、`late_index_no_vector_resurrection`、`timeout_no_pruned_retry`：请求启动后删除owner／剪除job，再返回／超时，数据库没有其正文、snapshot或vector，其他有效unit保留。
- [x] 写`completed_payload_compaction`：done job、post_jobs.result及已完成web checkpoint无记忆正文；未完成前台仍能恢复；在途临时checkpoint至prepare finally后压缩，网页计数／材料保留。
- [x] 运行`npm test -- tests/memory-capacity-cleanup.test.ts tests/memory-capacity-prune-race.test.ts`确认红灯，再实现细化§5跨表事务及prepare回调读新job。日志记录短暂在途副本与最终压缩边界。
- [x] 同测试、`npm test -- tests/memory-v3-maintenance.test.ts tests/web-recovery.test.ts tests/recovery.test.ts`及类型检查通过后提交。

## 任务4：空闲锚点与实际活动判断

**Files:** Create `src/memory/idle.ts`、`tests/memory-idle-policy.test.ts`、`tests/memory-idle-recovery.test.ts`；Modify `src/host/input.ts`、`src/recovery.ts`、`src/host/shared.ts`、`src/model/prompts.ts`、`tests/helpers.ts`。

**Interfaces:** 消费任务1Runtime.memoryIdle；实现`MemoryIdle.record／eligibility／nextDeadline`，并将实例接入Dependencies但尚不更改后台选择顺序。输入、confirmed输出与段B事务使用细化§6写入点。

- [x] 写`input_output_story_latest_anchor`：10:00输入、10:03最后输出、10:04完成，readyAt=10:19；10:18新输入立即变10:33，不等其回复。
- [x] 写`silent_shared_blocks_whole_activity`和`activity_end_full_15_minutes`：共同期间静默60秒节点也不合格；10:30结束、10:32最终完成，最早10:47，不抵扣开始前14分钟。
- [x] 写`ordinary_activity_not_expected_end`、`activity_description_not_identity`、`sleep_exception_only_sleep`：预计结束已过仍不合格；同startsAt润色不当成结束；睡眠例外不解除shared／新输入阻挡。
- [x] 写`environment_and_maintenance_do_not_refresh`、`same_id_duplicate_not_new_idle`、`restart_preserves_ready_at`：环境step完成／维护完成不改变锚点；重放输入不刷新或重排openBatch；纯重启不重新等15分钟，恢复故事真实完成则刷新。
- [x] 运行`npm test -- tests/memory-idle-policy.test.ts tests/memory-idle-recovery.test.ts`确认失败；实现Record的max时刻更新和活动门禁，新增普通活动判断不加额外生活推进。
- [x] 新测试、`npm test -- tests/shared-v3-input.test.ts tests/shared-v3-recovery.test.ts`及类型检查通过；记录InputBuffer真实类名与恢复口径后提交。

## 任务5：增量深度合同、短期合并与固定信息审核

**Files:** Create `tests/memory-idle-contracts.test.ts`、`tests/memory-idle-consolidation.test.ts`；Modify `src/model/contracts.ts`、`prompts.ts`、`src/memory/types.ts`、`maintenance.ts`、`lifecycle.ts`、`store.ts`、`organize.ts`。

**Interfaces:** 消费任务1dirtyOwner、任务2容量与任务3引用处理。扩展`consolidationTask(snapshot:MemoryCandidate[],selectedIds:string[],kind,evaluationAt)`支持细化§7三种新增动作；新增`auditTask(snapshot:MemoryCandidate[],selectedIds:string[])`，ModelTask.name仍为`memory_consolidation`，独立job.kind='audit'。`MaintenanceUnit`显式增加canonicalShortId、targetId／decision字段，保留readSet和来源合同。

- [x] 写`refine_targets_long_summary`：short+long输入时只改long摘要，short详细正文保持；不把DSH“没有摘要路径”误写为修short原文。
- [x] 写`merge_short_same_event_one_or_two_longs`：≥2short同一canonical可合并，不假装满足旧merge≥2long；不同long先正式合并、重指全部相关short／learned，保留日期去重、感受、来源和最大真实进展截止。
- [x] 写`merge_short_tied_created_at_stable_id`：两个short有相同真实createdAt、ID分别s-a／s-b，正序和反序输入都只接受canonicalShortId=s-a；选s-b合同失败。
- [x] 写`merge_short_sources_required_and_allowed`：sourceIds=[]或未知来源均合同失败，可用合法非空来源修补；只有历史快照来源、没有本轮新用户消息也能合法整理，合并成员来源并集不丢失。实现时显式把merge_short加入refine／merge／promote的非空来源及正文硬校验集合。
- [x] 写`merge_does_not_awaken_or_restore_archive`：同事件合并不加唤醒、不以now续期；不因全归档合并转回活跃，旧容量退出short不自动恢复。
- [x] 扩展`merge_does_not_awaken_or_restore_archive`：两个仅自然到期、archiveEnteredAt尚未落地的long分别day 90／day 100到期，在day 110合并后仍取day 90作归档锚点，不能随max expiresAt挪到day 100；有真实活跃成员的合并只继承已有资格／grant，不凭维护now加90天。
- [x] 写`detail_audit_reports_no_fact_rollback`、`learned_review_no_core_rewrite`：本轮details新值立即生效，空闲冲突只存当前建议；learned可retain／建议修订撤回，不自行改作者文件／发联系任务。
- [x] 写`distinct_canonical_evidence`、`selected_covered_sources_required`、`own_apply_no_dirty_loop`：多short同long不凑跨事件证据；所有selected有unit且变更有合法来源；后台改善处理后的版本作为水位，不自循环排队。
- [x] 运行`npm test -- tests/memory-idle-contracts.test.ts tests/memory-idle-consolidation.test.ts`确认红灯；实现合同、依赖补全、正式应用及增量去重，不增加文本长度校验。
- [x] 上述测试、`npm test -- tests/review7-memory.test.ts tests/memory-v3-maintenance.test.ts`及类型检查通过，记录新增合同与审核报告范围后提交。

## 任务6：Host门禁、公平队列与单计时器

**Files:** Create `tests/memory-idle-host.test.ts`、`tests/memory-idle-fairness.test.ts`；Modify `src/memory/maintenance.ts`、`src/host/runtime.ts`、`src/recovery.ts`、`src/app.ts`、相关`tests/memory-v3-host.test.ts`。

**Interfaces:** 消费任务3Cleanup、任务4Idle及任务5两类job。Maintenance保持`startOne(now):boolean`、`applyOneReady(now):'applied'|'stale'|'none'`、`nextDeadline(now):string|null`；两类deep调用同idle资格，index不检查15分钟。Host执行细化§8明确顺序，容量归一在段B，物理清理在前台选择之后。

- [x] 写`inflight_backend_does_not_block_input_story`：后台Promise未返回，普通15秒合批仍完成发送／段B；新输入重置截止，旧ready结果不能随即应用。
- [x] 写`deep_ready_ineligible_index_runs`、`eligible_fifo_no_index_starvation`：不合格ready不挡索引；两类合格时旧deep先于不断新增的index；ready单元仍先提交再准备。
- [x] 写`new_input_between_units_resets_15_minutes`、`cleanup_yields_to_front`：真实setImmediate输入落库后，下一deep等新窗口；多个清理单元之间有前台到期则先故事。
- [x] 写`empty_night_zero_calls`、`eligible_batches_not_every_15_minutes`、`environment_0600_first_not_idle_reset`：无待办零调用，有增量连续合格可处理，06:00新后台准备让位环境；环境不改idle锚点。
- [x] 用fake timers写`blocked_ready_no_zero_timer`、`expiry_without_new_messages`、`retry_pause_stop_gates`：过去idle／未知活动不0ms循环，归档／short截止无人聊天也处理，暂停／重试不绕门禁，stop禁止迟到提交。
- [x] 运行`npm test -- tests/memory-idle-host.test.ts tests/memory-idle-fairness.test.ts`确认失败；实现资格过滤FIFO、增量补漏及Host唯一deadline；旧的“故事完成后立即应用deep”断言改成等15分钟，并保留输入让位回归。
- [x] 通过新测试、`npm test -- tests/memory-v3-host.test.ts tests/world-school-integration.test.ts tests/shared-v3-scheduler.test.ts`及类型检查，记录调度顺序和实际请求数后提交。

## 任务7：显式升级、正式装配与状态说明

**Files:** Create `scripts/migrate-memory-capacity.ts`、`tests/memory-capacity-upgrade.test.ts`、`tests/memory-capacity-deployment.test.ts`；Modify `src/deployment/memory-runtime.ts`、`src/index.ts`、`src/memory/store.ts`、`src/host/runtime.ts`、`package.json`、`examples/story.sample.json`、`README.md`。

**Interfaces:** `npm run memory:capacity -- <db> --config <json> --dry-run`默认只读检查；省略config参数读取项目config.local.json的memory部分，不读密钥或背景。`--apply --stopped`显式结构升级和待办登记。MemoryStore提供`migrateCapacity(at:string):void`，仅在显式升级／新库初始化使用；新库version1，旧标记null不自动清理。`assembleMemory`返回capacity／idle／cleanup并传给正式Dependencies。

- [x] 写`dry_run_readonly_no_ddl`：真正只读SQLite连接执行检查，schema、JSON、日期不变；不经Storage构造器；输出ID／原因／数量，不能输出正文／密钥。
- [x] 写`apply_stopped_and_idempotent`、`legacy_dates_no_now_refresh`：apply需要停止声明和已完成旧轮，schema仍3、容量标记1；第二次不重置日期／idle／grant；旧归档锚点取真实expiresAt，不从升级now另加90天。
- [x] 将`archive_membership_sql_matches_policy`的自然到期未落地／容量已归档夹具复用于`inspection_matches_runtime_archive_count`：dry-run、apply后运行时和清理候选使用相同集合与起点；已有archiveEnteredAt不因旧expiresAt变化被重置。
- [x] 写`legacy_evidence_and_done_payload`：可确认的历史记忆证据归一，常驻保护不漏；done快照／post_job结果压缩，旧computing转pending，ready等新idle，缺失关联报告不假造来源。
- [x] 写`startup_old_marker_named_error`、`fresh_seed_and_status_counts`：旧库缺迁移标记明确报命令，新库装配三组件；status只读数量／阻挡，不加载私聊内容。
- [x] 运行`npm test -- tests/memory-capacity-upgrade.test.ts tests/memory-capacity-deployment.test.ts`确认失败；实现工具／装配、示例配置与README说明。本轮部署时先做数量报告与备份，不能把测试库升级写成正式库已升级。
- [x] 新测试、`npm test -- tests/memory-v3-deployment.test.ts tests/web-deployment.test.ts tests/plugin.test.ts`和类型检查通过后提交；实际正式升级另记数据库路径、备份、前后统计，服务由用户手动启动。

## 任务8：整体验收、文档同步与交付

**Files:** Create `tests/memory-capacity-idle-integration.test.ts`、`scripts/validate-memory-capacity.ts`；Modify `package.json`、本细化／执行计划／实施日志、README。

**Interfaces:** `npm run validate:memory-capacity -- --db <isolated-db>`只接受隔离库，默认离线可控模型；`--online`只在既有授权范围内使用角色背景和该测试库模拟剧情。工具每请求300秒，日志记录模型选择、实际调用／耗时和来源范围，不连接QQ。

- [x] 写`mixed_capacity_idle_and_recovery`：真实Host完成消息→共同活动→结束后15分钟→深度审核→1001／501压力→重开库，检查摘要接续、计数、归档清理和恢复一致；不只直接调用内部排序函数。
- [x] 写`pruned_snapshots_all_surfaces`：先建立pending／computing／ready及已完成副本，删除一项后枚举细化§5删除面，不残留该记忆正文／向量；原始来源、学校、details及常驻证据保持。
- [x] 写`old_library_batch_cleanup_front_priority`：大批旧归档逐单元推进时新输入仍优先；保护有可见差额，解除后归一；没有新输入时到期记录也处理。
- [x] 运行`npm test -- tests/memory-capacity-idle-integration.test.ts`确认红灯，补齐集成工具／剩余衔接，记录三种排序与门禁时刻的实际输出。
- [x] 运行`npm test`、`npm run typecheck`、`npm run build`；构建／全部行为回归通过后才勾选实现完成。不把本轮计划编写、未运行的测试或保留建议写成通过。
- [x] 在隔离库运行验证工具；有限在线场景如执行，检查模型能区分同事件合并、稳定认识多事件证据和事实冲突建议，允许合法retain／结果不足，记录失败及重试，不为凑成功改规则。
- [x] 同步实际字段、任务状态、迁移记录及默认值；新建交付审核记录，说明是否正式升级、服务停止状态、有限清理不可从归档恢复的边界。只提交本次变更，不混入DSH原始审核文件或私密配置。

## 实施日志最低内容

每任务记录：起点／本地提交、触及文件、红灯原因、实际检查命令及结果、合同裁定、未完成项。物理清理记录ID／原因／数量和保护阻挡，不记录私聊正文。真实模型验收记录角色与来源范围、调用量及模型合法不变更结果；正式库检查、备份、结构升级和分批归一分别记状态。

## 交接口径

实际实施只以本计划与[实施细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)为本期主依据，顺序任务1～8。V0.3与共同活动／世界学校文档作为既有接口参考，不重复执行旧任务。原方案和审核文件保留讨论历史，1000／500／真实清理／OR条件／活跃短期保护以本期细化为准。

审核阶段仅编写文档；获实施指令后已按任务1～8顺序执行。有限在线验收只用授权背景及模拟记忆，正式服务由用户手动启动。

第十六轮补充已合并：归档判定及锚点落实在任务2／3／7，merge_short稳定ID与非空合法来源落实在任务5；上述新增用例已实现并运行通过。其余任务顺序及产品推荐值不变，无新增待用户决定项。

## REVIEW17／18 交付修复补充

本轮按获批 rebuttal §5 执行，用户确认归档必须先真实重谈恢复再晋升。以下均已实施：

- [x] 独立 short 身份与实际 QQ 中间件稳定平台 ID；普通／共同消息与推进重复不刷新 idle／batch／shared 时钟；无平台 ID 的独立输入不合并。
- [x] 基础双空白摘要合同；存量 missing_summary 引用保护、同版本一次增量登记、15分钟门禁、合法修复后先短后长清理。只读检查与清理共享保护谓词，归档锚点不变。
- [x] promotionEligible、promotionCandidates(at)、冻结 evaluationAt=job.cutoff、模型输入 promotionEligibleIds；应用时按当前时刻验证同一主项，过期判 stale，其他单元继续。
- [x] 审计按完整报告 ID 字面替换；无超量不执行容量排序。
- [x] 新增 review17 四组回归，全套83文件469项通过；typecheck与build通过；隔离混合验收通过。未运行在线调用／QQ或正式库写入。

过程与最终复核／集成结果见[修复记录](REVIEW17_MEMORY_FIX_LOG_20261008.md)。原任务1～8的435项记录保留为历史基线。