# existingLongId 修复：审核后实施细节（Implementation Plan）

> **For agentic workers:** 用户交付实施任务后，使用`superpowers:executing-plans`逐项执行；本文件不要求增加子代理。完成并保存实际证据后才勾选。本文件是实施交接，不表示代码已修改。

**Goal:** 允许基础memory的create复用已提供short的合法关联long，同时隔离awaken权限，并使lookup／恢复／最终提交执行同一合同。

**Architecture:** 保留SOL方案B和三份权限数组。集中构建引用权限；organizeMemory负责初始输入、确认lookup恢复及新增lookup的权限投影；memoryTask区分操作白名单；MemoryLifecycle在原事务中补最终目标状态检查。通用ModelClient、普通检索及持久协议保持原行为。

**Tech Stack:** Node.js >=22.13.0、TypeScript、Zod 4、node:sqlite、Vitest、仓库已有tsx；无新增依赖。

**Spec:** [原计划§3～5](../../plans/existing-long-reference-20261013/README.md#3-推荐设计合同)＋[审核R1～R3](REVIEW.md)。冲突处以本文件的具体接线和R1新增范围为实施要求；原诊断、原计划、审核探针的基线结论不覆盖改写。

基线：`44cfdbdf2e137a4f699728d4f42659bcb89dec31`，2026-10-13。状态：**待实施**。

## Global Constraints

- 只修该引用合同；版本0.5.1、schemaVersion=3、现有持久协议与模型输出字段不变。
- 保留7／90天、3／30有效日期、100／1000／500容量及引用保护；保留4段／15分钟、15秒合批、原模型／强度、2次格式修补与网页20／40。
- 不提前检索preview正文、不全库扩权、不把关系ID或旧资料变成本轮新来源。hasNewEventProgress=false不续期、不新增唤醒；true沿既有规则。
- 已保存post.result直接复用；旧缺hasNewEventProgress结果仍按原false含义处理，不重新parse成新合同，不重新生成、不重发。
- 使用隔离工作树、合成数据库、假模型／sender；不读私有配置、密钥、原人物背景和正式库，不在运行主目录build。
- 不处理正式旧重复条目、不迁移数据、不自动部署、停止、启动或resume，不升版。Git集成／推送依实际实施任务的用户授权，不从本文件推断授权。

## Review Focus

| 条件 | 必须保持的结果 | 任务 |
| --- | --- | --- |
| 只提供S→preview L | create可引用L，awaken不可，L正文仍不进入普通检索 | T1、T2 |
| 确认lookup含旧／错误权限快照，raw与投影两种格式 | 校验和实际HTTP请求都使用从行重建的累计权限；不重查或重置预算 | T2、T3 |
| pending lookup、contextRefs或仅自称权限 | 未确认行不授予ID，完成后只加入实际行 | T2、T3 |
| 模型结果已保存后目标missing／wrong kind／discarded或别名指向discarded | 原事务回滚、post保留、无另建long／重发／新模型请求 | T3 |
| 四参数旧调用、旧保存结果缺progress、learned／merged别名 | 兼容原合同，别名仅授权明确列出的原ID | T1、T3 |

## 固定接口与文件职责

| 文件 | 改动 |
| --- | --- |
| src/memory/types.ts | 原计划MemoryWritePermissions类型 |
| src/memory/references.ts（新） | 行解码、三类权限扩充及快照复制；不写库、不取目标正文用于提示 |
| src/model/contracts.ts | memoryTask可选第五参数；create只查existingLongIds，awaken仍只查memoryIds |
| src/memory/organize.ts | 初始权限、lookup投影、活动checkpoint恢复归一化及模型接线 |
| src/model/prompts.ts | memory操作权限字段、lookup累计快照优先及关系元数据说明 |
| src/memory/lifecycle.ts | **R1新增：** 关联create最终拒绝discarded规范目标 |
| tests/memory-reference-permissions.test.ts（新） | 白名单、别名、兼容、错误目标 |
| tests/memory-existing-long-flow.test.ts（新） | 真检索、实际HTTP信封及动态lookup |
| tests/memory-existing-long-recovery.test.ts（新） | 文件库、确认／pending lookup、post和事务 |

references.ts的公共接口固定如下；类型导入使用`import type`，不增加存储服务实例：

```ts
export type MemoryReferenceRow =
  Pick<MemoryCandidate, 'id' | 'kind'> &
  Partial<Pick<MemoryCandidate, 'linkedLongId' | 'canonicalMemoryId'>>;

export function memoryReferenceRows(input: unknown): MemoryReferenceRow[];
export function extendMemoryWritePermissions(
  store: Pick<MemoryStore, 'canonical'>,
  permissions: MemoryWritePermissions,
  rows: readonly MemoryReferenceRow[],
): void;
export function snapshotMemoryWritePermissions(
  permissions: MemoryWritePermissions,
): MemoryWritePermissions;
```

`memoryReferenceRows`只解码MemoryContext.retrieved或StageModelInput.resources.owners；忽略detail行。已识别容器中的short／long／learned需非空string id；short的非空linkedLongId必须为string。损坏容器／行报有界本地错误；只有contextRefs／权限声明而没有这两类行容器时返回空集合。不能递归搜任意id字段。`isStageModelInput`现为浅判别，解码器需要核对owners确为数组。

`extend`维持原计划规则：short.id→shortUpdateIds；直接long／learned.id→longAwakenIds；直接long／learned.id及short非空linkedLongId经canonical查验后→existingLongIds。规范目标必须存在、kind=long且非discarded；merged／learned别名沿原canonical。只加入所提供的原ID，别名终点ID不因查询结果被额外加入。按提供顺序去重，先验证本批行，再原地扩充三个数组。不能用数组替换让memoryTask闭包继续持有旧数组。

`snapshot`返回三个新数组。模型提示中的权限不是程序授权来源；新／旧权限声明均不参加权限计算。

organize.ts增加局部函数：

```ts
function projectMemoryLookupResult(
  result: unknown,
  permissions: MemoryWritePermissions,
): StageModelInput;
```

参数接受unknown是因为checkpoint.privateLookupResult的实际类型为unknown；先按上述行解码规则验证，拒绝非对象或损坏的已识别容器。把合法raw／投影result经`stageInput('memory', result)`转成独立副本，并覆盖`context.memoryWritePermissions`为累计快照。返回标准contextVersion／context／resources／roles结构，保留学校、资料和视觉字段；不修改输入对象。原raw顶层权限会被投影到context后覆盖，原投影context中的声明也会被覆盖。不要在通用传输层新增特殊裁决。

## T1：独立权限合同与基线（替换原T1，含R3）

**Interfaces:** 产出上述references接口、权限类型和memoryTask第五参数，尚不接入organizeMemory。

- [ ] 核对工作区、HEAD及用户已有改动，建立隔离工作树。原计划／本review目前可能未提交；必须把两个目录的当前内容带到工作树，不能只checkout HEAD后假定它们存在。记录所用计划指纹，不覆盖主工作区。
- [ ] 在工作树准备锁定依赖（已有可用时复用，无需重复安装）。TEMP/TMP使用工作树`.tmp/existing-long-reference`。后续日志放`docs/v0.5/records/existing-long-reference-20261013/`，不覆盖本review证据。
- [ ] Run: `node docs/v0.5/reviews/existing-long-reference-20261013/evidence/reproduce-from-source.cjs`。期望退出0且bugReproduced=true；记录实际HEAD。此时不build主目录lib，也不把原lib探针的退出0作为唯一判断。
- [ ] 编写原T1列出的合同用例，并用以下断言固定权限分离与兼容：

```ts
expect(p).toEqual({ shortUpdateIds: ['S'], longAwakenIds: [], existingLongIds: ['L'] });
expect(() => memoryTask(['e'], p.longAwakenIds, p.shortUpdateIds, [], p.existingLongIds)
  .parse(linkedCreate('L', false, ['e']))).not.toThrow();
expect(() => memoryTask(['e'], p.longAwakenIds, p.shortUpdateIds, [], p.existingLongIds)
  .parse(awaken('L', ['e']))).toThrow();
expect(() => memoryTask(['e'], [], ['S']).parse(linkedCreate('L', false, ['e']))).toThrow();
```

`linkedCreate`、`awaken`为本测试文件局部fixture工厂，分别返回完整schemaVersion=3结果（另外两数组为空），字段沿`review26-memory-create.test.ts`。L为真实preview，另建未提供U验证existingLongId=U仍拒绝。linked create缺progress、错误布尔或无合法来源也要拒绝。

- [ ] 增加行解码矩阵：raw／投影的short link一致；details不扩权；contextRefs／权限声明没有行时不扩权；已识别的损坏行报错。对learned P→L和merged A→L，只加入P／A，未直接提供L时awaken及create不能偷偷使用L；P／A各自仍能沿canonical合法操作。
- [ ] 增加missing／wrong kind／discarded以及别名指向discarded的helper用例；null link不授关联权限，不把无link当新事件依据。snapshot副本被修改不得影响三个活动数组。
- [ ] Run新文件，确认新增正向能力红灯；实现最小类型／helper和memoryTask第五参数，默认`existingLongIds=memoryIds`。Schema保持动态字符串，不静态enum。
- [ ] Run: `npm test -- tests/memory-reference-permissions.test.ts tests/review26-memory-create.test.ts tests/memory-event-time.test.ts --maxWorkers=1`及`npm run typecheck`，要求0失败。保存红绿后提交本任务（按实施授权）。

## T2：初始／lookup／恢复的同源投影（替换原T2及T3的R2接线）

**Interfaces:** 消费T1；产出实际请求的`input.context.memoryWritePermissions`与`lookupResult.context.memoryWritePermissions`。

- [ ] 先写原T2真实检索用例：S→L，L.retainedFrom=轮时刻+6天；真实MemoryRetrieval只返回S，经真实ModelClient及ChatCompletionsTransport的假fetch返回linked create。断言实际请求包含S.link、三数组，首次memory响应成功且调用数1／repairCount=0；没有隐藏L正文，也没有为该create另建long。
- [ ] 固定false与true控制：false前后L的retainedFrom／expiresAt／lastEventUpdateAt／唤醒日期与计数保持，sourceIds为旧来源与合法新来源并集；true沿旧预备期进展规则，已生效long不重开。复用原review26断言，不改变语义判定机制。
- [ ] 写新lookup用例，初始不包含S或L，合法一次lookup取得S→L。假fetch捕获第二次请求：初始快照不变，lookup累计快照含S/L，校验允许linked create且仍拒绝仅凭关联的awaken。测试有／无IncomingMediaService：使用现有IncomingMediaService接口的合成装配或最小结构化fixture，让`withTurnVisualContext`实际运行raw→投影路径；不能绕过该包装器后声称两种持久形态已覆盖。
- [ ] Run新flow文件确认旧装配红灯，再按以下**固定顺序**接线：

1. 取得本轮context和原sourceIds，使用`builder.retrieval.store`；由初始实际投影的owners建立p，保存初始权限快照。初始input的快照在本次调用内不被lookup原地修改。
2. 通过原turnPhaseOptions取得当前活动session；读取其checkpoint。只有`lookupPending !== true`且有privateLookupResult时，从确认行扩权；自称权限字段全部忽略。
3. 对确认lookup调用projectMemoryLookupResult生成累计快照，用`session.saveCheckpoint({...checkpoint, privateLookupResult: normalized})`保存。只替换此字段；格式、输入、repair、repairCount、lookupUsed、lookupPending、pendingOperationId、toolResults等全部保留。不得open新stage、清checkpoint、清计数或读model_run_records。该保存失败直接沿原报错路径暂停，不继续模型。
4. pending lookup不从旧privateLookupResult预扩权，仍由ModelClient执行原请求；回调成功得到真实行后才扩权并返回projectMemoryLookupResult。ModelClient原确认保存负责持久化结果。没有确认结果就不得给模型授权。
5. 新lookup也复用同一回调和投影函数；最后以p三个原数组创建memoryTask第五参数接线。`withTurnVisualContext`继续负责视觉附加，不另建模型会话。

- [ ] 在memory提示明确写出：short update用shortUpdateIds；awaken用longAwakenIds；existingLongId用existingLongIds。初始名单在input.context；存在lookupResult.context.memoryWritePermissions时其累计名单是当前操作说明；名单之外的关系元数据（含learned.canonicalMemoryId）不能自行扩权。来源仍只使用本轮合法sourceIds，本人网页限制不变。
- [ ] 增加真实请求断言：raw及投影确认lookup带错权限时，归一化后请求中不再出现UNPROVIDED权限，累计集合正确；不是仅检查helper数组。contextRefs或只有权限字段不能授予实际未提供ID；发明ID仍耗用原有最多2次修补。
- [ ] Run: `npm test -- tests/memory-existing-long-flow.test.ts tests/memory-reference-permissions.test.ts tests/context-channels.test.ts tests/prompt-context-views.test.ts tests/prompt-context-transport.test.ts tests/web-memory-sources.test.ts tests/activity-memory-context.test.ts --maxWorkers=1`及`npm run typecheck`。保存请求结构、调用次数和状态对照后提交。

## T3：落库状态与磁盘恢复（替换原T3，增加R1）

**Interfaces:** 消费T1／T2；补MemoryLifecycle关联create最终状态检查，沿用App／finishPostprocessing事务和错误通知。

- [ ] 在临时文件库写已完成输出但未完成提交的turn及合法post.result，关闭并重开。分别使关联目标missing、wrong kind、discarded、merged alias→discarded，然后调用`HdsiApp.resumeUnfinishedTurn()`。断言如下；至少discarded场景必须在旧代码红灯：

```ts
expect(turn.done).toBe(false);
expect(post.result).toEqual(savedResult);
expect(store.owner({ ownerType: 'short', ownerId: `${turnId}:short:0` })).toBeNull();
expect(store.owner({ ownerType: 'long', ownerId: `${turnId}:short:0:long` })).toBeNull();
expect(modelCallCount).toBe(0);
expect(sender.sent).toHaveLength(0); // 指业务发送；允许原错误通知
expect(runtime.paused).toBe(true);
```

- [ ] 在lifecycle.ts现有create分支的幂等跳过之后、创建新short之前，将existingLongId解析成功的判定补充`existing.status !== 'discarded'`；缺失／类型错误维持原拒绝。错误消息只含字段及有界原因，不带正文。不改canonical全局语义，不改awaken或short update业务，不加模型回退。
- [ ] 验证有效别名及旧post.result缺hasNewEventProgress仍能完成一次提交；重复resume不重复建立short、long或grant。保存结果不可重新parse／重生成，已确认输出不重发。事务故障注入需验证前面成功处理的同批变更也回滚，不只断言抛异常。
- [ ] 编写磁盘确认lookup用例（raw和StageModelInput各一）：保存同runId、lookupUsed=true、lookupPending=false、repairCount=1及错误／缺省权限字段；重开后不执行lookup，只发一次模型请求，实际信封使用重建名单。使用最初保存的runId断言phase没有换代。
- [ ] 保存一个网页成功和一个失败后再中断；重开前后读取session.state，确认计数保持（1成功／1失败），工具／格式后续仍按原累计预算执行；repairCount=1不归零，下一无效响应走剩余1次修补，再无效则失败。不要把“总HTTP次数”误当修补数。
- [ ] pending lookup用例：使用可控制的Promise；结果返回前尚未授权其行且不得发下一次completion，完成后只加入返回的真实行。中断重开沿原lookupRequest续办，不凭旧声明先扩权。
- [ ] 确认当前活动checkpoint只在T2指定接点归一化，model_run_records原有行逐条保持；完成任务允许原有清理路径追加历史，不能要求“历史总行数永远不增加”。done轮不重新打开。
- [ ] Run: `npm test -- tests/memory-existing-long-recovery.test.ts tests/memory-v3-recovery.test.ts tests/model-run-history.test.ts tests/web-recovery.test.ts tests/recovery.test.ts tests/review26-memory-create.test.ts --maxWorkers=1`及`npm run typecheck`。保留R1红绿和磁盘证据后提交。

## V1：整批验收、文档与交付（保留原V1，明确关闭映射）

- [ ] 运行源码复现包装器加`--expect-fixed`，必须退出0、bugReproduced=false，其他对照继续通过。`review-boundaries.cjs`断言的是旧基线，修复后discarded断言应失效；不能修改原审核探针冒充转绿，用新正式回归证明R1关闭。
- [ ] 在隔离工作树按原V1完成typecheck、build、全量tests、demo、插件合同和双场景smoke，记录实际通过／失败／跳过数。HDSI_TEST_LIB_DIR用工作树lib，绝不指向运行主目录。
- [ ] 独立最终复核确认三权限未串用、R1最终落库门禁、R2实际HTTP信封／两种恢复格式及原预算、R3源码基线可追溯；问题逐项关闭后再按用户授权集成。
- [ ] 更新当前记忆／上下文／恢复／实现对应及版本导航，新增records交付。填写下表的实际提交、测试名和证据路径，未完成不得标已关闭；原计划、诊断及review保持原状态含义。

| 审核项 | 关闭证据要求 |
| --- | --- |
| 原bug | S→preview L真检索／实际HTTP／一轮无修补复用，源码包装器expect-fixed通过 |
| R1 | discarded及其别名的post磁盘恢复红绿、事务回滚、旧合法结果兼容 |
| R2 | raw／投影确认lookup实际发送名单一致、pending隔离、runId与修补／网页预算持续 |
| R3 | 基线及修复后直接src探针，记录实际HEAD；未用陈旧lib代替源码验收 |

- [ ] 检查文档链接、`git diff --check`和文件清单；交付记录区分代码完成、Git集成、正式部署及服务状态。旧数据语义合并仍另立方案，不随本批自动处理。

## 给SOL的执行提示

从原计划理解根因和范围，然后按本文件T1→T2→T3→V1执行。三任务存在接口依赖，按顺序完成即可。不要只把linkedLongId塞进旧longIds；不要因helper检查过目标而漏掉已保存post结果的最终检查；不要只更新校验数组而遗留旧lookup权限说明。新增范围已经在文件表列明，无需再猜落点。
