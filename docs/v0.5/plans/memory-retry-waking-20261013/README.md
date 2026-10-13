# 记忆整合重试与起床时间边界修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans，按任务串行实现，完成后做一次独立整批复核。步骤使用 `- [ ]` 跟踪。本轮只交付计划，未执行实现、部署或恢复。

**Goal:** 将记忆整合限时设为600秒，首次执行失败后最多自动重试2次，耗尽后报错停止；保留历史错误和checkpoint；修复起床轮学校通知阅读校验的时间边界。

**Architecture:** 为记忆整合增加独立的超时参数与持久重试周期，通过现有SerialHost串行报告终态失败。历史取证快照独立于活动checkpoint保存，原恢复、压缩和权限规则继续生效。主叙事保留实际睡眠区间，学校获知校验与输入使用同一时间事实。

**Tech Stack:** TypeScript、Node.js SQLite、Zod、Vitest、Koishi；不新增依赖。

**Spec:** 本文§2～5为设计合同，§6为实施与验收步骤；两部分一起交接。

日期：2026-10-13。状态：**待审核，未实施**。源码基线：`b73023971d4050fddde0be0ec22779c316143399`，版本`0.5.1`。返回[计划入口](../README.md)／[版本入口](../../README.md)。

## 1. 依据与范围

2026-10-13上午只读调查结果：

| 时段（上海时间） | 可确认的活动 |
| --- | --- |
| 10月12日11～13点 | 11:30学校通知轮；11:45起6批整合，102个不同选中对象，无跨批重复选择 |
| 10月12日21～24点 | 23条输入，14轮故事、54个逻辑模型阶段；22点启动3批整合 |
| 10月13日0～4点 | 无新故事轮；03:21／03:42有整合结果及索引更新，03:42新增1批收尾整合 |
| 10月13日08:02:27 | `narrative: school notice not readable at experience time`，自动暂停 |

10批维护调查时均为done。实际配置为120秒后台限时、失败后5分钟重试、记忆与整合使用high思考、允许睡眠期间维护。多个首次启动间隔接近120秒，超时重试是持续消耗的强烈嫌疑；终态记录已清理错误／checkpoint，**不能把该推断写成已证实的逐次请求历史**。本方案预防无限重试并补取证，不追补无法还原的旧记录。

起床错误已离线只读重放：正式状态sleep为10月13日00:06～08:01，模型输入sleep却为null；保存的修补稿把读通知写在08:00:40。原校验失败，仅把阅读经历改为该轮at则三条观察通过。清掉校验用睡眠状态也会通过，但那会放宽睡眠期间阅读权限，**不作为修复方案**。最后一次无效响应未保存，08:00:40是此前保存的修补稿时间，不能冒充最后一稿的逐字内容。

范围包括记忆整合／审核任务、模型错误与checkpoint留存、起床轮输入和校验。Token用量不记录；不改模型、思考强度、聊天15秒规则、4段窗口、记忆容量／字数预算、学校发布时刻及发送恢复规则。

## 2. 600秒与最多2次重试

### 2.1 参数和计数

| 参数／含义 | 约定 |
| --- | --- |
| `memory.consolidationTimeoutMs` | 新增，缺省`600000`，本次正式配置明确设为`600000` |
| `memory.consolidationMaxRetries` | 新增，缺省`2`，非负整数，本次正式配置明确设为`2` |
| 适用任务 | `memory_maintenance_jobs`的consolidation及audit，同一整合执行路径 |
| 向量索引 | `memory_index_jobs`继续沿用`backgroundTimeoutMs=120000`及既有策略，不因整合调整变成600秒 |
| 重试等待 | 保留`retryDelayMs=300000`，受现有空闲／睡眠／暂停资格约束 |
| 重试次数 | 首次执行＋最多2次自动重试，第三次失败即终止该周期；不是总共两次执行 |
| 格式修补 | 沿用ModelClient的`repairLimit=2`；同runId的预算、lookup与工具进度跨后台重试保留，不清零换成功 |

后台执行次数与HTTP请求数不同：一次执行仍可能包含已有格式修补或工具续接。重试上限约束后台执行周期，不能声称全部HTTP最多3次；不额外放宽既有工具额度。

`MaintenanceJob`新增兼容字段：`retryCycle`、`executionAttemptCount`、`failureCount`、`failedAt`，status增加`failed`。首次新周期为1／0／0／null；派发前原子增加executionAttemptCount并记attemptId；每次prepare或结果提交失败增加failureCount。第一次／第二次失败安排重试，第三次失败置failed且retryAt=null。成功计算及中间unit提交不重置failureCount；提交失败复用ready结果，不重新调用模型。

重启不清零计数，也不能把第三次computing无限转回pending。对遗留computing记录，无成功结果时标记该次interrupted并消耗一次失败预算，再决定等待重试或failed；以attemptId去重。新版本开始前的旧任务重试次数未知，缺字段记录为legacy基线，不伪造旧次数；新周期从0开始计数，此后必须持久化。

### 2.2 耗尽后的停止和手动恢复

**用户已明确确认：暂停整个HDSI，保留现场，手动恢复。** 本节将该语义写成实施合同；本轮只编制文档，不执行现场停止或恢复。

- failed任务、失败历史和`runtime.paused=true`在同一事务提交；`lastFailure.stage='maintenance'`，带jobId、retryCycle、task和安全摘要。
- 停止新故事／新维护派发；已在途的前台轮沿原发送和提交协议收尾，不并发发送维护错误通知。
- SerialHost在检查paused并退出前消费维护终态错误，日志报告一次，`sender.sendError`发送一次“记忆整合重试耗尽，程序已暂停”。通知失败不能覆盖原失败、恢复派发或反复刷屏；`hdsi.status`展示失败任务和次数。
- failed任务仍保留对选中对象的占用，不让ensureIncremental换个jobId绕过上限。同进程反复wake、服务重启均不派发它。
- 人工`hdsi.resume`针对本次导致暂停的failed整合任务显式开启新retryCycle，保留同jobId、原记录及可用checkpoint，重置该周期执行／失败计数；其余任务不批量清零。格式修补／lookup／工具预算仍不重置。仅人工resume开启新周期，启动不能等同resume。
- 若暂停来自主叙事等其他阶段，resume保持既有恢复含义，不改整合任务计数。安全停止沿原等待协议，不把正常排空当后台失败；强制中断后按上述interrupted规则处理。

## 3. 错误和checkpoint保留

采用独立、只供取证读取的`model_run_records(id TEXT PRIMARY KEY, data TEXT NOT NULL)`，与现有SQLite风格一致。新增表属于兼容性增量建表，不改memory／dialogue／environment版本，不回填不存在的历史。

记录类型为`failure`或`checkpoint`，包含ownerType／ownerId、runId／stageKey／taskName、retryCycle／attemptId（适用时）、发生时间、失败阶段／类别、错误内容，以及checkpoint快照。格式失败另存该次原始无效响应，**包括预算耗尽的最后一稿**。不保存API密钥、认证头、token用量或计费信息。

具体行为：

1. ModelClient每次解析失败，在检查repair预算并抛出前先保存错误与当前输入／修补／工具快照；网络失败／超时由所属执行者登记。后台失败记录绑定对应整合attempt，不能只留覆盖式lastError。
2. 成功／取消／换代／终态压缩要清活动checkpoint前，先保存不可变快照。清理所有入口统一经过archive-before-clear，包括WebSearchStore、MemoryStore及payload-compaction中的SQL路径；重复清理幂等，不重复制造同一快照。
3. 归档与清活动checkpoint同事务，归档失败不得先清空现场。正在恢复的checkpoint不为留存而被提前清理；取证记录绝不被自动用作活动恢复输入。
4. 快照保存完整输入与repair，并保持工具结果／material引用可解析；已有网页材料和图像观察引用不能被本批清理打断。原资产正常生命周期继续，记录不得宣称永久保有已清理的图片像素。
5. 成功、resume、压缩旧payload、purgeOwner和服务重启均不能删除历史错误或取证快照。此批不设自动过期／滚动覆盖；未来清理另行设计，数据库与备份保持私有，不把正文传入新的模型上下文或Git。

保留历史不等于禁止压缩done任务的活动payload；只有在完整快照可靠保存后才能继续压缩。数据库增量建表对新库、旧库和只读打开分别测试；只读Storage不得执行DDL。

## 4. 起床轮修复

推荐修法是保留睡眠事实并约束叙事，沿现有睡眠与手机权限校验。拒绝“waking=true就允许整个过去区间读通知”及把08:00:40直接改写为08:01的宽松补丁。

- `generateTurn`保存`stateBefore`克隆。narrative输入的`state.sleep`保持原sleepAt／wakeAt，另有原有`waking=true`；生成后再给personal及候选nextState清除已结束sleep。不在校验／模型调用前写正式character。
- narrative提示明确：waking只说明本轮到达或越过既定wakeAt，不授权提前醒；通知获知不得早于wakeAt、publishAt和releasedAt，经历仍落在from～at内。
- `prepareSchoolCommits`继续以同一轮原状态的睡眠区间判定；醒来后、已经发布且实际可读的通知可获知。保留手机不可读活动、合法新活动和真实学校经历的原权限规则。
- 不依赖happenedAt与带毫秒turn.at完全相等来放行醒来后的阅读；08:01:00.000到08:01:00.008区间按真实wakeAt判断。睡眠前／睡眠内／尚未发布／未来经历仍拒绝。
- 本次失败轮未冻结、无发送尝试、outputComplete=false；将来明确恢复时按既有逻辑使用恢复时刻重生成，保留runId和repairCount=2。已尝试候选与已封口沉默轮的处理完全沿原恢复合同。

## 5. Global Constraints与Review Focus

- Node.js `>=22.13.0`，版本维持`0.5.1`，无新依赖；只新增兼容表／JSON字段，不提升持久协议版本。
- 产品实现用隔离worktree及合成库、假模型／sender，TEMP／TMP指向隔离临时目录。禁用在线模型、搜索、真实QQ和正式数据写入作为验收。
- 现场仍保持当前暂停；本轮仅文档。部署、配置生效及可能发送QQ输出的resume另列，不能因执行计划完成自动执行。
- 不更改主叙事获知权限、预约合同、格式修补上限、Web20／40额度、15秒与4段参数。
- 五个复核重点：重启绕过上限（M2）；超时后迟到响应／ready提交失败重复请求（M2）；压缩绕过历史归档（M1）；睡眠／发布／手机不可读边界（W1）；旧失败轮预算2恢复与已尝试候选（W1）。各项均有下面的判别用例。

## 6. 实施任务

### E0：基线与隔离准备

- [ ] 记录HEAD／工作区／Node版本，核对相对本文的源码差异；不得reset用户变化。按using-git-worktrees使用原生工具建立隔离目录，显式选择已核对ref。
- [ ] 保留本任务输入文档及既有未跟踪文件；配置仅复制合成示例，不带认证或正式库。记录当前相关回归实际数量，不复用此前220／1412。

### M1：持久错误与checkpoint取证

**Files:** 新建`src/model/run-history.ts`、`tests/model-run-history.test.ts`；修改`src/storage.ts`、`src/model/client.ts`、`src/deployment/plugin-runtime.ts`、`src/memory/types.ts`、`src/web/store.ts`、`src/web/service.ts`、`src/memory/store.ts`、`src/memory/payload-compaction.ts`。

**Interfaces:** 导出`ModelRunRecord`及`ModelRunHistory(storage: Pick<Storage, 'prepare'>, clock: Clock)`；提供`append(record: ModelRunRecord): void`、`archiveCheckpoint(ref: ModelRunRef, checkpoint: WebModelCheckpoint, reason: 'completed'|'superseded'|'cancelled'|'compacted'): void`、`list(owner: WebOwnerRef): ModelRunRecord[]`。构造器不做DDL，表由Storage可写初始化创建；各清理调用者以事务／SAVEPOINT包住归档和清理。快照ID由runId＋内容摘要＋reason去重；失败ID由attemptId＋调用内序号区分。

ModelClient现有三参数保持，新增第四可选参数`history?: ModelRunHistory`，生产装配注入正式Storage与Clock。ModelRunOptions新增可选`executionAttempt?: { retryCycle: number; attemptId: string }`供M2关联错误；不进入模型输入。保存路径不得依赖webSearch.enabled或provider存在；没有runRef的调用仍可记录task与临时诊断runId，但不能伪造持久owner或创建恢复checkpoint。

- [ ] 写红灯用例：`records_final_invalid_response_when_repair_budget_is_exhausted`断言budget=2的最后无效raw也保存；`archive_before_each_compaction_entrypoint`覆盖四类压缩路径；`history_survives_success_resume_purge_and_reopen`断言成功后历史仍在、活动checkpoint为空；`archive_write_failure_keeps_live_checkpoint`断言事务回滚；`readonly_open_does_not_create_history_table`及`history_is_not_automatically_retrieved`验证兼容与上下文隔离。
- [ ] Run: `npm test -- tests/model-run-history.test.ts`；记录旧代码真实失败原因。实现接口和归档入口，保留现有引用完整性，不加usage记录。
- [ ] Run: `npm test -- tests/model-run-history.test.ts tests/web-persistence-v2.test.ts tests/web-recovery.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-capacity-prune-race.test.ts`及`npm run typecheck`；通过后提交`feat: retain model errors and checkpoint history`。

### M2：600秒、有限重试与停止传播

**Files:** 修改`src/settings.ts`、`src/deployment/memory-runtime.ts`、`src/memory/types.ts`、`src/memory/maintenance.ts`、`src/memory/store.ts`、`src/host/runtime.ts`、`src/types.ts`；新建`tests/memory-maintenance-retry-limit.test.ts`，扩充`tests/model-settings.test.ts`、`tests/memory-idle-host.test.ts`。

**Interfaces:** MaintenanceOptions新增`consolidationTimeoutMs?: number`、`consolidationMaxRetries?: number`；MemoryMaintenance新增`takeError(): unknown | undefined`及`restartFailedCycle(jobId: string, now: string): void`供Host显式resume使用。M1记录结构绑定jobId／cycle／attempt；Runtime.lastFailure增加maintenance阶段和可选jobId／retryCycle。

- [ ] 写红灯用例：`consolidation_times_out_at_600_seconds_not_120`用假时钟，599999ms未中止、600000ms中止；`index_timeout_remains_120_seconds`；`third_failure_pauses_host_and_reports_once`断言最多3次prepare、2次5分钟等待、failed／retryAt=null／paused与通知1次；`successful_second_attempt_keeps_first_error`；`retry_limit_survives_disk_reopen_and_computing_interruption`；`manual_resume_opens_only_failed_owner_cycle`。
- [ ] 补`ready_result_commit_failure_never_regenerates_model_output`、`failed_owner_cannot_be_recreated_to_bypass_budget`、`late_response_after_timeout_cannot_commit_or_clear_checkpoint`、`graceful_stop_does_not_count_successful_drain_as_failure`。保留`maintenance_errors_not_front_failure`对前两次可重试失败的原语义，第三次另断言全局暂停。
- [ ] Run: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/model-settings.test.ts tests/memory-idle-host.test.ts`，记录红灯后实现参数、持久计数、事务终止和Host报告。只捕获整合耗尽升级为全局暂停，Embedding旧行为不扩大。
- [ ] Run: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-idle-host.test.ts tests/memory-idle-recovery.test.ts tests/memory-idle-fairness.test.ts tests/memory-v3-maintenance.test.ts tests/model-settings.test.ts`及`npm run typecheck`；通过后提交`fix: bound memory consolidation retries and pause on exhaustion`。

### W1：保留睡眠区间与起床恢复

**Files:** 修改`src/app.ts`、`src/model/prompts.ts`；必要时最小修改`src/school/progress.ts`，不得删readable校验。新建`tests/waking-school-notice.test.ts`，扩充现有学校／睡眠回归。

**Interfaces:** 沿用`prepareSchoolCommits(storage, turn, narrative, experiences)`及原narrative／personal模型签名；narrative的state保持原睡眠区间，personal与nextState只在醒来后清除。若实现必须新增时间参数，先统一所有调用者与测试，不偷偷从“空sleep”推导过去可读。

- [ ] 构造原睡眠00:06～08:01、通知08:00:00.012释放、turn.at=08:01:00.008的合成fixture。`waking_narrative_receives_original_sleep_window`在旧代码应失败；`read_notice_before_wake_is_rejected`断言08:00:40拒绝；`read_notice_at_or_after_wake_is_allowed`断言08:01:00.000合法，不要求精确等于turn.at。
- [ ] 补未发布通知、phoneAccess=false、合法新活动、睡眠内阅读、未来经历、非起床轮及shared对照；断言personal输入sleep=null、正式character仅在原B事务提交后更新。
- [ ] `failed_waking_turn_reopens_at_new_clock_with_repair_budget_two`关闭／重开临时文件库，推进时间，保留同turnId／runId／repairCount=2；假模型合法首次个人流程完成，再次非法立即保持暂停。另验已尝试／沉默封口候选不重生成。
- [ ] Run: `npm test -- tests/waking-school-notice.test.ts`，记录输入用例红灯，权限拒绝用例原本可绿；最小实现后运行`npm test -- tests/waking-school-notice.test.ts tests/world-school-review14-time.test.ts tests/world-school-personal-reminder.test.ts tests/personal-task-contract-recovery.test.ts tests/recovery.test.ts tests/phone-access-flow.test.ts`及`npm run typecheck`。通过后提交`fix: preserve wake timing in narrative and notice validation`。

### V1：整批工程验收与当前说明

- [ ] 复核M1／M2／W1需求与差异，做一次独立整批审核；修复阻断发现，保留原意见与关闭证据。
- [ ] 隔离目录`npm run typecheck`、`npm run build`、`npm test`、`npm run demo`均退出0。先build确保新工作树的插件测试不依赖正式lib。记录实际通过／失败／跳过数量。
- [ ] Run: `npm test -- tests/plugin-smoke-contract.test.ts tests/plugin-smoke-build-path.test.ts`；HDSI_TEST_LIB_DIR指向隔离lib后`node runtime/plugin-smoke.cjs`，两个场景各四阶段提交，退出0。
- [ ] 同步现行MEMORY／DIRECTORS／RECOVERY说明、参数参考与索引；新建对应records交付，不改历史证据含义。检查本地Markdown链接、`git diff --check`和暂存清单，排除配置／库／lib／认证。
- [ ] 提交`docs: record memory retry and waking fix delivery`，列明已实施与尚未部署／恢复范围；本批不要求记录token数量。

## 7. 将来的正式部署与恢复

本节只是步骤合同，**本轮不执行**。先完成离线验收，再按当时用户授权决定上传、停服、放入构建与resume。

1. 只读复核当前暂停／失败轮／outbox／整合任务，不能把本调查状态当实时状态。安全停止成功后唯一备份一致DB及实际WAL／SHM、旧lib和配置。
2. 部署已验收lib，并将私有配置新增`consolidationTimeoutMs=600000`、`consolidationMaxRetries=2`；原backgroundTimeoutMs仍为120000。`start-hdsi.cmd --check`通过，确认本地参数、模块解析及新增表的只读兼容性。
3. 增量表仅在受控可写初始化中创建；若启动检查先于建表，历史读取须兼容表不存在，不能让--check偷偷执行DDL。记录首次建表与原状态保持的结果。
4. 启动由用户／明确授权者执行，原暂停必须保留。另有明确恢复指令后才执行hdsi.resume；当前未尝试失败轮允许既有代码自行更新at和重生成，不手改通知readAt、睡眠、seen或checkpoint。
5. 分别记录“已部署”“已启动”“已恢复”，核对失败历史可读、修补预算仍2、实际新轮终态与通知获知时刻。旧done任务已丢失的历史不能凭新功能还原。

## 8. 计划自检

用户要求对应M2（600秒、最多2次重试、报错停止）、M1（错误／checkpoint保留且不记tokens）、W1（起床错误），V1负责工程结果，§7限制现场操作。停止范围已由用户确认整体暂停，保留现场，手动恢复。所有实施复选框未勾选；本次没有产品测试／代码修改／数据迁移／配置修改／服务操作。
