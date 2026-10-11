# 文档同步、整体验收与交付实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 使用未勾选步骤跟踪实际完成情况。

**Goal:** 关闭已实施发现项，提供能够复核的功能／成本／兼容证据，明确代码交付、历史数据处理和正式部署的状态。

**Architecture:** 子任务以离线夹具完成红绿回归，批次边界统一做类型／构建／全量与插件验收；当前规则只同步实际代码，历史审核证据保持原样。编译输出隔离到工作区临时目录，避免测试时覆盖正在使用的lib。

**Tech Stack:** 现有PowerShell、Node、npm、TypeScript、Vitest与Koishi离线smoke；不增加依赖。

**Spec:** [综合审核](../../reviews/comprehensive-audit-20261011/README.md)、[文档问题D2/D3](../../reviews/comprehensive-audit-20261011/DOCS_AUDIT.md)、[目录原则](../../../DIRECTORY_POLICY.md)、[总执行入口](README.md)。日期2026-10-11，基线`ce7e88e`，状态**未实施**。

## Global Constraints

- 本次计划撰写没有执行产品修改；下述命令是未来实施步骤，不是本次验证记录。
- 原审核目录、日志、JSON与“复现旧错误”的探针不改成绿色；新日志写`docs/v0.5/records/comprehensive-remediation-20261011/`。
- 只读检查不得产生DDL或改正式库；真实迁移、启停、部署必须与代码验收分开，只有后续明确包含这些动作的执行任务才运行。
- 不因全量测试通过就把暂停命令线上可达性、真实供应商质量或长期性能写成已验收。
- 旧二进制未必能读取网页v2正文引用或已压缩环境步骤；回退必须核对格式兼容，必要时代码与完整备份库成套恢复。

## Review Focus

1. 编译后测试实际仍加载旧lib：V0明确隔离库路径并验证标记。
2. Windows沙箱路径／Chrome／junction导致假失败：V1分别记录并定向复验，不跳过当通过。
3. 旧未完成任务丢失修补／已发送信息：V2重启矩阵验证具体状态和请求次数。
4. 计时变快但改变业务结果：V3同时验证选择结果与确定性工作量。
5. 更新README时宣布未执行部署：D1和V4区分状态，保留历史事实日期。

## V0：让离线验收明确加载本次隔离构建

**文件：**修改`runtime/plugin-smoke.cjs`、`tests/runtime-check-readonly.test.ts`；必要的覆盖测试置`tests/plugin-smoke-build-path.test.ts`。不改正式启动器的默认加载路径。R4也会修改smoke的环境摘要断言，顺序为V0先、R4后，避免并行改同文件。

**接口：**只对验收工具支持环境变量`HDSI_TEST_LIB_DIR`，值为隔离构建的绝对目录。`runtime/plugin-smoke.cjs`从该目录require `index.js`和`time.js`；未设置时保持现有`../lib`。readonly测试的合成目录junction也指向该目录，未设置时仍指向现有`lib`。不得让正式插件运行依赖这个测试变量。

- [ ] **1. 失败回归。** `smoke_uses_requested_build_path`构造临时最小模块标记或子进程，确认设置变量时确实选择该目录，不误加载根lib；`readonly_fixture_uses_same_build`断言synthetic检查使用同一编译版本。只检验路径分派，不再复制所有业务smoke。
- [ ] **2. 实现并绿测。** 该能力只影响验收脚本，路径缺文件明确报错，不能默默fallback到旧lib。执行`npx vitest run tests/plugin-smoke-build-path.test.ts`。
- [ ] **3. 独立提交。** 默认正式行为完全不变。后续V1始终显式设置变量；在隔离worktree执行时也沿用相同验收方式。

## D1：补齐当前文档与维护入口

**对应：**审核D2、D3；D1／B3的CLI说明在W2交付后同步。源文件：根`README.md`、`docs/v0.5/{README.md,subsystems/REMAKE_V0.5_RECOVERY.md,subsystems/REMAKE_V0.5_MEMORY.md,subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md,reference/V0.5_IMPLEMENTATION_MAP_20261009.md}`。

- [ ] **1. 修正文档状态。** 原175／920只称“图片／搜索修复该批验收”，保留对应链接；“最新／本批”统一引用当前交付入口。把“本次只升级测试夹具”加原批次日期／适用范围，不能与当前正式升级记录并列成两个现状。不要通过再读私有库猜当前部署状态。
- [ ] **2. 补现有回收命令。** 逐项说明实际默认`batch-size=50`、`max-batches=20`、`hasMore`续跑、无待回收内容时不创建备份；默认备份根在数据库旁`backups/memory-payloads/<uuid>/`，自定义`--backup-dir`下仍创建uuid子目录，包含实际存在的DB/WAL/SHM。复用现有工具，不编写“复制主DB即可回退”的简化说明。
- [ ] **3. 文档中的示例明确是运维动作。** 下例不在写文档时执行；数据库路径由未来部署任务明确提供：

```powershell
npm run memory:compact-payloads -- <数据库绝对路径> --dry-run
npm run memory:compact-payloads -- <数据库绝对路径> --apply --stopped --batch-size 50 --max-batches 20 --backup-dir <备份目录>
```

- [ ] **4. W2完成后补CLI能力表。** `rebuild`只重建向量，不启动浏览器；`import`按已启用配置独立启动网页工具，失败及排空退出语义按实际实现写。不可通过临时关闭正式webSearch来让示例可用。
- [ ] **5. R4／W5完成后再次对齐。** 说明新增environment终态回收和web正文引用迁移各自覆盖范围、命令、只读／apply边界与兼容矩阵。`--include-environment`是明确opt-in，默认`memory:compact-payloads`范围保持，默认dry-run的零残余不能证明环境残余为零。两工具不能共用同一含糊“升级”描述。
- [ ] **6. 验收。** 检查本地Markdown链接和锚点、命令参数与CLI解析完全一致；在合成库的既有CLI测试通过后才说“命令可执行”。纯文字修正不另写镜像式产品测试。提交文档同步并列出仍未部署事项。

## V1：每批工程验收

**适用批次：**A为R1/R2/W1/W2/W3/D1；B为性能与存储任务。Q1/Q2另行走其评估交付，但工具代码同样做类型与相关测试。各任务红绿回归完成后才进入批次门，不每改一行重复全量。

- [ ] **1. 创建本批证据目录并隔离编译。** 以下PowerShell从执行工作区根运行；`$PWD`只读，不改写系统路径变量。TEMP/TMP仅对本次shell进程生效。

```powershell
$evidenceRoot = Join-Path $PWD 'docs/v0.5/records/comprehensive-remediation-20261011/evidence'
$testTempRoot = Join-Path $PWD '.tmp/comprehensive-remediation-tests'
$compiledRoot = Join-Path $PWD '.tmp/comprehensive-remediation-build'
New-Item -ItemType Directory -Force -Path $evidenceRoot,$testTempRoot | Out-Null
$env:TEMP = $testTempRoot
$env:TMP = $testTempRoot
$env:HDSI_TEST_LIB_DIR = $compiledRoot
npm run typecheck
npx tsc -p tsconfig.build.json --outDir $compiledRoot
```

每条独立检查退出码0，失败就保存实际错误，不能让最后一条成功掩盖前条失败。证据按`batch-a/`、`batch-b/`等新子目录保存，避免覆盖上一批红测／通过日志。

- [ ] **2. 全量与演示。** 执行`npm test -- --reporter=dot`、`npm run demo`、`node runtime/plugin-smoke.cjs`，各自保存日志和退出码。smoke需分别通过empty_week／required_notice，明确加载V0指定的新编译目录。
- [ ] **3. 沙箱处理。** 如果Vite临时缓存ENOENT，使用上述工作区TEMP/TMP重跑；如果仅Chrome或junction被权限阻挡，仅对这些测试申请工具级适当权限复验，保持临时合成库与无网络约束。拒绝或仍失败就如实记录未通过范围，不把skip算pass。
- [ ] **4. 数量核对。** 审核基线189文件／1034项仅是起点，新增回归后以实际输出为准；跨次覆盖要列每次集合与交集，不能把总数直接相加。
- [ ] **5. 版本核对。** 记录HEAD、工作树差异、Node/npm版本、构建路径、测试路径；执行`git diff --check`。本批不要求为文档重跑所有历史在线验收。

## V2：持久恢复与兼容总矩阵

**文件：**在各分项计划指定的集成测试中落实；汇总结果写`records/.../evidence/recovery-matrix.json`。不必另造一套大测试框架。

| 固定夹具／中断点 | 必须断言 |
| --- | --- |
| 旧普通冻结候选已确认第1条、未确认第2条 | 第1条不重发；本批不重写旧内容／时间／抽样；恢复只续第2条和后处理 |
| 新鲜度waiting，被pause与事件选择交错 | 不新调用、不提交；resume后沿现有事件接管合同处理，不丢输入 |
| memory pending未开始／computing已开始／ready未应用 | 未开始可按既有规则刷新；已开始冻结材料和repairCount保留；ready复用结果不重发模型 |
| environment preparationVersion0或缺字段 | 保留串行兼容及完整payload，不被R4压缩；旧任务结果不因新摘要格式读空 |
| environment v1 running跨日，晚到provider结果 | 旧代结果不提交；执行settle后才收尾，缓存/checkpoint不会在清理后复活；新批次可继续 |
| web v1/v2，pendingOperationId或lookupPending，修补1次后重启 | 原额度、确认步、材料、已提供标记和修补计数一致；已确认操作不重读、不重复计数 |
| 已完成环境/网页，旧残留分批工具中途失败 | 已提交批保留，失败批回滚；续跑幂等；未完成任务字节／引用未被压缩 |
| 图观察pending、已有同版本观察、原图清理 | 恢复同一观察／模型上下文；同版本不重新识别；优化编码不能放开未读图片资格 |

关键：B1修复覆盖新生成轮，以及旧未done轮尚未提交的任务状态；旧冻结nextState/输出不重算，恢复按R1写明的业务选择合同处理，不能在此矩阵临时再定另一套状态规则。网页存储v2兼容读由W5唯一负责，R4不能顺带解析或改写其内部格式。

## V3：性能比较与退出条件

- [ ] 从原审核探针复制合成数据构造方法到本批benchmark，不修改原探针。正确性断言改成产品目标；旧探针“缺陷存在”断言不得作为绿测。
- [ ] 用相同构建参数、依赖、数据量与Node环境，分别运行固定baseline和after提交的隔离构建；记录各自产物／源码身份，不能两边误用同一个lib。记录确定性工作量、峰值或载荷体积的实际口径，再记录至少7次计时样本和中位数。时间测试避免与全量测试并行，硬件差异只比较相同环境。
- [ ] 各项硬门槛以W4/W5、R3/R4、M1/M2、W6/W7各自工作量合同为准：减少全文物化／解析，保持消息输出、owner选择、到期资格、排序顺序和恢复请求次数一致。不得用降低20/40、删除必要正文、缩短历史窗口或减少召回条数换取数字。
- [ ] 某项时间没有改善而工作次数达到目标时，给出完整结果及原因；不得宣称已达到“469ms→某绝对值”或真实生产内存减半。若工作次数目标也不达成，该项不能关闭。

## V4：交付、合并与正式部署边界

- [ ] 新建本批`records/.../README.md`、`DELIVERY.md`、`evidence/closure-matrix.json`，逐项映射B1-B5、D2-D3、RT-O1/O2、WM-O1/O2/O3、M1/M2/M3。每项写commit／测试证据／已修或未执行／运行部署状态。
- [ ] 更新当前入口指向新交付和实际关闭情况。原审核文内“未修复”是旧基线状态，保留正文及原失败JSON；可在入口另加关闭链接，不改写原始证据。
- [ ] 每批独立审核差异，重点旧格式、实际CLI、任务投影和资源收尾；根据有效发现补修后重跑受影响检查。报告只声称已经执行的检查。
- [ ] 代码开发完成可以提交到执行分支（默认`codex/`前缀），不要仅因完成代码就推送、合并或部署。交接记录写明分支／commit供后续明确操作。
- [ ] 正式部署任务另行启动时：先核对当前服务与未完成工作；显式停服成功后备份完整DB/WAL/SHM、配置和旧构建，再替换构建。按各工具dry-run判定是否需要旧数据压缩／转换，不把优化当强制全库迁移。无残留时不运行无意义apply。
- [ ] 回退演练只用副本：未写新格式时允许普通代码回退；已写web v2或终态摘要后，必须验证旧二进制读取能力，未兼容则恢复配套完整备份。不能声称将代码切回就能恢复已删除的恢复正文。

**交付文档必须回答：**修了什么、哪些验证已做、哪些质量实验／正式动作没做、存储格式是否已切换、旧二进制能否读、回退所需备份在哪里。该清单用于技术交付，不要求把内部版本术语塞进聊天产品的用户提示。
