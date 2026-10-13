# existingLongId 引用权限修复计划审核

日期：2026-10-13（上海时间）。源码基线：`44cfdbdf2e137a4f699728d4f42659bcb89dec31`，包版本0.5.1。状态：**计划审核完成；产品修复未实施**。审核对象为[SOL原计划](../../plans/existing-long-reference-20261013/README.md)及其整个evidence目录。原计划和原诊断保持原样，文件SHA-256见[输入指纹](evidence/input-hashes.json)。返回[审核索引](../README.md)／[版本索引](../../README.md)。

## 结论

**保留方案B；纳入以下2项P2修订和1项P3验证修订后，可以按[实施细节](EXECUTION_PLAN.md)执行。** 根因判断正确，分离short更新、long唤醒和create关联权限能够修复本次误拒，不能直接扩大旧共用longIds。无需修改普通检索生效门禁、模型输出Schema、数据库协议、模型连接或包版本。

原计划对初始输入、动态lookup、旧格式、源ID和发送恢复已有较充分覆盖。需要补齐的是：保存结果之后的discarded目标校验，以及恢复时累计权限在实际请求中的权威位置。后者是尚未实现的新字段的设计接线缺口，不是声称线上已经发生了权限字段伪造。

## 已独立确认的根因

当前[organizeMemory](../../../../src/memory/organize.ts:33)只把直接long／learned行放入longIds；[投影](../../../../src/model/context-views.ts:18)却会把short.linkedLongId提供给memory。两种操作在[memoryTask](../../../../src/model/contracts.ts:152)仍共用memoryIds。预备long被[检索时效门禁](../../../../src/memory/store.ts:136)排除，故仅得到short时，模型照着已提供关联返回create仍被拒。

原探针和[直接加载src的复现](evidence/reproduce-from-source.cjs)均得到：只提供short、直接long白名单为空、linkedLongId已发送，真实organizeMemory拒绝该ID；仅补关联ID时通过，伪造ID仍拒绝，原生命周期可以复用long且false不改变其期限／事件进展时间／唤醒数。见[源码复现结果](evidence/source-reproduction.json)和[原探针结果](evidence/original-reproduction.json)。

本次没有读取正式库或私有运行日志。因此12:54现场时间、真实轮已完成及潜在重复条目的事实引用SOL的[脱敏诊断](../../plans/existing-long-reference-20261013/evidence/diagnosis.json)，独立证据限于源码与合成重放；不能据此认定两条正式记忆语义上必应合并。

## R1 [P2] discarded目标的提交检查没有被原apply覆盖

**位置：** 原计划§3.1、§3.4、§4及T3；尤其第101、151、159、176行。

计划要求discarded关联目标按引用一致性错误处理，同时让已有post.result沿原apply复用，并原则上不改MemoryLifecycle。但[MemoryStore.canonical](../../../../src/memory/store.ts:89)会返回discarded的long，[MemoryLifecycle.apply](../../../../src/memory/lifecycle.ts:30)只检查存在及kind，没有检查status。已有post.result会直接进入[提交事务](../../../../src/recovery.ts:79)，绕过新增的organizeMemory权限构建器。

**可复现后果：** 合成轮先保存合法的关联create结果，再把L置为discarded；调用真实`HdsiApp.resumeUnfinishedTurn()`后，`turn.done=true`，创建了关联L的新short，post.result被清空，无模型调用、无重发、也未暂停。删除L的对照则报错暂停，保留post.result且没有新short。见[边界探针](evidence/review-boundaries.cjs)和[结果](evidence/boundary-results.json)的`postTargetCases`。这证明“缺失会失败”不足以证明“discarded也会失败”；不表示正常Host已证实有并发删除记忆的路径。

**必须修订：** 将`src/memory/lifecycle.ts`关联create的最终目标状态检查纳入本批。保留原canonical别名解析、幂等跳过和事务边界，在创建新short之前拒绝discarded规范目标。不要对保存的旧结果重新调用新版memoryTask，避免拒绝旧的缺hasNewEventProgress结果或重新生成模型输出。为缺失／错误类型／discarded／别名指向discarded分别验证文件库重开后的回滚、post保留及无重发。

## R2 [P2] 恢复权限必须同时重建发送投影，不能只重建校验数组

**位置：** 原计划§3.2～3.3、§4、T3，尤其第121、140～142、157～158行。

计划要求忽略checkpoint自称的权限、从确认行重建，同时让lookupResult携带更新后的累计权限。接口和任务清单尚未指定：**已确认旧lookup不再调用lookup回调时，由谁改写实际发送的权限快照，以及初始快照与lookup快照谁优先。**

[ModelClient](../../../../src/model/client.ts:34)恢复后直接把`checkpoint.privateLookupResult`传给transport；已确认lookup不会再次执行新回调。[buildCompletionEnvelope](../../../../src/model/resource-pool.ts:31)保留其context字段。仅运行extend helper更新三个数组，或仅在新lookup回调附快照，都不能使旧lookup的快照自动更新。新`input.context.memoryWritePermissions`与旧`lookupResult.context.memoryWritePermissions`可能互相矛盾，使模型重复使用最终会被拒的ID、耗尽原修补预算。

**证据范围：** 探针使用原始MemoryContext和StageModelInput两种确认结果，加入模拟的未来权限字段；当前传输代码均把`input=[L]`、`lookupResult=[UNPROVIDED]`同时发送，lookup没有重跑，repairCount仍为1。见结果的`restoredLookup`。这是新设计字段经现有管线传输的边界试验，不是当前线上字段已存在的事实。

**必须修订：** 在organizeMemory内固定恢复归一化接点：只从确认行扩权，以统一投影函数覆盖旧权限声明，保存到**当前活动checkpoint**后再进入ModelClient；pending lookup只由完成后的实际返回行扩权。保留runId、repairCount、lookupUsed、lookupPending、repair、网页操作及累计计数。初始input保持本次初始快照，存在lookup权限快照时以其累计集合为当前说明；两处快照都由程序生成，校验数组仍是最终门禁。此接线可在organize.ts完成，不要求修改通用ModelClient。不能读或改model_run_records来“修复”恢复权限。

## R3 [P3] T1的复现入口依赖未受控lib，不能直接用于干净工作树

**位置：** 原计划T1及`evidence/reproduce.cjs`第1～10行、最后的退出条件。

原探针从忽略且不入Git的`lib/`加载模块；T1在新建隔离工作树后就运行它，之前没有编译步骤。干净工作树缺lib，主目录lib也不能单凭源码HEAD证明最新。原退出条件还没有要求`bugReproduced=true`，因此单看退出0不能证明当前缺陷已复现。

**修订：** T1改用本审核的[源码包装器](evidence/reproduce-from-source.cjs)：读取未改动的原探针，将其模块加载重定向到src，使用已有tsx依赖，不重建正式lib。基线默认强制要求bugReproduced=true；实施后加`--expect-fixed`强制要求false，其余对照仍需通过。缺依赖时仅在隔离工作树安装锁定依赖。原probe保留，不改写历史证据。

## 其余设计裁决与实施要求

- 三数组及memoryTask第五参数方向成立。保留旧四参数行为，动态数组原地扩充；新existingLongIds不能流入longAwakenIds，也不能变成来源ID。
- 只从本次初始投影和确认lookup的真实行建立权限；去重、对象形状和字段类型必须明确。contextRefs和自称权限数组不授予ID，普通检索不提前暴露preview正文。
- merged／learned授权保持原提供ID。learned.canonicalMemoryId即使作为关系元数据可见，也不自动成为可输出操作ID；本批选择由明确权限数组列出可用ID，别名由原canonical解析。将这一点写入提示与回归，避免再次混淆“能看见字符串”与“哪种操作获准”。
- 真实lookup同时覆盖有／无IncomingMediaService的装配：视觉上下文包装器会把raw结果转为StageModelInput。以HTTP请求中JSON为断言对象，不能仅检查内存变量。
- 原计划V1仍是修复完成后的工程验收，不能用本轮基线51项代替。正式旧记忆合并、部署、升版、启动及resume继续单列，未在本次审核执行。

## 本次验证与限制

`npm run typecheck`通过；既有7文件51项通过，原始输出见[类型检查](logs/typecheck.txt)和[定向回归](logs/baseline-tests.txt)。测试范围为review26-memory-create、context-channels、prompt-context-views、prompt-context-transport、memory-v3-recovery、web-recovery、model-run-history。TEMP/TMP指向工作区临时目录，单worker运行。

两份审核探针直接加载src，使用合成内存数据库及假HTTP，不调用供应商；原lib探针也单独重跑。边界探针最初误用不存在的`recover()`入口而失败，改为实际`resumeUnfinishedTurn()`后才得到上述业务结果；该初次失败不作为产品缺陷证据。

文档链接、原计划指纹及变更范围检查见[审核材料验证](evidence/document-verification.json)。本轮未实施产品修复、未新增正式产品测试、未build覆盖lib、未全量验收、未读取私有配置／人物正文／正式库，未操作服务、Git提交或推送。当前工作区原有SOL的计划和索引改动均保留；本review通过不等于代码问题已关闭。

## 交给SOL的方式

提供原`plans/existing-long-reference-20261013/`和本`reviews/existing-long-reference-20261013/`两个目录。按[EXECUTION_PLAN.md](EXECUTION_PLAN.md)执行；它明确替换原T1～T3的哪些步骤、增加哪些断言及怎样关闭R1～R3，无需让执行者重新猜设计。
