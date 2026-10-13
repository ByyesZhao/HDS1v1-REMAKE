# existingLongId 引用权限修复计划（Implementation Plan）

> **For agentic workers:** 实施时使用 `superpowers:executing-plans` 逐任务执行；如用户另选代理分工，可使用 `superpowers:subagent-driven-development`。下列复选框仅在完成并保存实际证据后勾选。当前交给 Astra 审核，不进入实施。

**Goal:** 使基础记忆提取能正确复用已提供短期的真实关联长期，消除上下文中可见 ID 被校验白名单误拒，同时保持长期唤醒与本轮来源权限。

**Architecture:** 为短期更新、长期唤醒和 create 的 `existingLongId` 分别维护引用集合。基础输入、合法本地补查和恢复复用同一权限构建逻辑；普通检索不提前开放预备长期正文，关联 ID 不自动获得唤醒资格。结构合法后仍由原 MemoryLifecycle 解析规范身份、应用变化并事务提交。

**Tech Stack:** Node.js >=22.13.0、TypeScript、Zod 4、node:sqlite、Vitest；无新增依赖。

**Spec:** 本文§3～5是待审核的设计合同；§6是执行计划，审核两部分后才实施。

日期：2026-10-13（上海时间）。状态：**待 Astra 审核，未实施**。
源码基线：`44cfdbdf2e137a4f699728d4f42659bcb89dec31`，当前包版本 `0.5.1`。
返回[计划索引](../README.md)／[版本索引](../../README.md)。目录遵循[文档原则](../../../DIRECTORY_POLICY.md)。

## Global Constraints

- 本次仅写计划与审阅证据，不改产品代码、正式配置、数据库或服务状态，不启动／停止／resume，不发送 QQ，不提交或推送 Git。
- 后续实施先建立隔离工作树，记录实际 HEAD；不得覆盖用户改动。使用合成数据库、假模型和假 sender，TEMP／TMP 指向工作树临时目录。
- 包版本维持当前0.5.1；不把前次有条件的0.5.2请求视为本批升版授权。各持久协议、schemaVersion=3及模型输出字段保持。
- 保留7天短期、90天长期、真实进展与重谈区分、3／30有效日期、100／1000／500容量及引用保护。
- 不改变普通检索的生效／归档门禁、语义标定、4段／15分钟窗口、15秒输入合批、模型／思考强度、2次格式修补及网页20／40额度。
- 不自动纠正已完成轮或合并正式库记忆；现场旧条目另列，须先审阅同事件依据及独立数据处理方案。

## Review Focus

1. **短期可见、长期仍是预备摘要：** create可以引用其已提供关联；该目标不能因此被awaken或进入普通长期检索（T1、T2）。
2. **同一ID的权限串用：** 不能把existingLongIds加入longAwakenIds，也不能因数据库中存在而放行任意未提供ID（T1、T2）。
3. **lookup及重启：** 动态扩充的校验集合与模型实际取得的资料一致；不读取不可变取证历史来恢复权限，不重置repair／lookup／网页预算（T2、T3）。
4. **合并别名及损坏引用：** 原提供ID可沿既有canonical解析；不存在、错误类型或discarded目标不能静默改成新事件（T1、T3）。
5. **已输出与已完成轮：** 更窄的权限构建不能重生成已封口输出，也不能重写历史失败／成功；本轮新来源规则和事务恢复继续有效（T3、V1）。

## 1. 本次发现与可核对证据

### 1.1 现场事实

2026-10-13 12:54:08.943，起床轮的基础memory阶段出现 `existingLongId: unknown memory ID`。这不是数据库不存在错误：

- 实际输入只有2条short，直接提供的long／learned为0；本次无lookup。
- 失败响应引用其中一条short的 `linkedLongId`，该ID实际位于发送的 `resources.owners`。
- 停服备份证明关联目标在本次运行前已存在，是未合并的long。其 `retainedFrom` 为10月19日，晚于本轮10月13日，所以按当前规则不进入普通长期检索。
- `organizeMemory` 的longIds只收集直接检索出的long／learned，本次为空；`memoryTask` 因而拒绝模型刚从short读取的真实关联。
- 1次格式修补后轮完成；最终第3条short关联了本轮新建long，而不是原拟复用目标。**同事件重复风险成立，是否确实应合并仍需语义审阅；不据ID关系自动修历史数据。**

本批的[公开诊断摘要](evidence/diagnosis.json)只保留结构、时间及结果，未附人物、聊天、原提示词、原始响应、密钥或正式库。

### 1.2 源码因果链

| 位置 | 当前行为 | 与问题的关系 |
| --- | --- | --- |
| [store.ts](../../../../src/memory/store.ts) selectCandidates | long需retainedFrom<=request.at | 预备long不作为普通检索正文，规则本身合理 |
| [context.ts](../../../../src/memory/context.ts) buildForMemory | 组合直接检索的short／long／learned | 未构造关联引用权限 |
| [context-views.ts](../../../../src/model/context-views.ts) projectOwner | memory投影保留short.linkedLongId | 模型确实收到该ID |
| [organize.ts](../../../../src/memory/organize.ts) organizeMemory | longIds只取long／learned的id；lookup亦只按kind归类 | 关联引用和校验集合不一致 |
| [contracts.ts](../../../../src/model/contracts.ts) memoryTask | existingLongId与awaken共用memoryIds | 直接扩大该数组会顺带扩大唤醒权限 |
| [lifecycle.ts](../../../../src/memory/lifecycle.ts) apply／canonical | existingLongId可解析并复用真实long；false不刷新进展／初始许可 | 应保留的落库机制，不以新建long绕开校验 |

### 1.3 已执行诊断与限制

原响应离线重放：原白名单稳定拒绝；只补已提供short的真实关联ID后通过；伪造ID仍拒绝。在内存库应用原响应能复用目标，且保留期限、进展时间、唤醒数不变。

既有定向3文件18项全部通过：
`review26-memory-create`、`context-channels`、`prompt-context-views`。
这是旧行为诊断，**不是修复验收**；现有用例直接传允许ID，没有覆盖“检索仅返回short，而其preview关联被模型复用”的完整装配路径。

送审可运行[合成复现](evidence/reproduce.cjs)；它不访问正式库，不调用模型或网络。在当前基线应报告bugReproduced=true，其他对照检查通过。本计划新回归尚未编写，红灯／绿灯和工程验收均未执行。

## 2. 方案比较与选择

| 方案 | 收益 | 问题／裁决 |
| --- | --- | --- |
| A：隐藏short.linkedLongId | 不再展示这个引用入口 | 失去正确复用已有事件的机会，容易另建long；不推荐 |
| B：分操作权限，授权已提供关联 | 保留普通检索规则，同时修复真实关联引用 | 必须覆盖lookup／恢复及canonical；**推荐** |
| C：全库放行或直接扩大共用longIds | 能绕过这次拒绝 | 允许未提供ID，或误增awaken权限；拒绝 |

不把预备长期全部提前检索；不把“目标存在”当作“模型有权操作”。B只授权本次确实提供的关联边，不新增来源，不把历史记忆当本轮事实。

## 3. 推荐设计合同

### 3.1 三份独立权限

在 `src/memory/types.ts` 定义：

```ts
export interface MemoryWritePermissions {
  shortUpdateIds: string[];
  longAwakenIds: string[];
  existingLongIds: string[];
}
```

三者按本次提供顺序去重，生命周期只限一次逻辑memory调用。定义：

- **shortUpdateIds：** 直接提供的short.id，沿原短期更新权限。
- **longAwakenIds：** 直接提供的long／learned.id，沿原唤醒权限及其canonical处理，不加入仅从short.linkedLongId取得的目标。
- **existingLongIds：** 直接提供long／learned.id，以及直接提供short的非空linkedLongId。每个候选经现有 `store.canonical(id)` 确认能解析到真实long且目标不是discarded；允许preview，不因其尚未生效拒绝关联。

授权的是**模型实际看到的原ID**。merged／learned别名沿原canonical解析，不额外放行模型没看到的其他canonical ID；如需返回新的规范ID，必须显式投影并单独证明权限，不能隐式扩充。

关联目标缺失、类型错误或discarded视为引用一致性错误，保留当前阶段并沿既有错误流程报告，不静默删link／新建事件。非关联的数据库ID不得加入集合；禁止全库扫描。直接long／learned的原awaken业务校验不因本批改变。

### 3.2 一个权限构建入口

新建 `src/memory/references.ts`，接口建议固定为：

```ts
export type MemoryReferenceRow =
  Pick<MemoryCandidate, 'id' | 'kind'> &
  Partial<Pick<MemoryCandidate, 'linkedLongId' | 'canonicalMemoryId'>>;

export function extendMemoryWritePermissions(
  store: Pick<MemoryStore, 'canonical'>,
  permissions: MemoryWritePermissions,
  rows: readonly MemoryReferenceRow[],
): void;
```

消费的是受程序控制且已提供的记忆行，既支持MemoryContext.retrieved，也支持旧checkpoint内StageModelInput.resources.owners。解析关系只检查目标身份，不能把目标完整正文、作者背景或隐藏记忆借机投影给模型。关联解析失败时抛有界的本地引用错误，错误只含字段／对象ID。

在 `organizeMemory` 创建权限对象，复用 `builder.retrieval.store`，用同一入口处理初始检索、原活动checkpoint的privateLookupResult，以及这次合法lookup返回；不得从checkpoint自己宣称的permission数组取权，也不得读取model_run_records来补权。

### 3.3 合同兼容与权限投影

保持memoryTask现有前四个参数含义，添加可选第五参数：

```ts
memoryTask(
  sourceIds: string[],
  memoryIds: string[],
  shortIds: string[] = [],
  selfReadIds: string[] = [],
  existingLongIds: string[] = memoryIds,
): ModelTask<MemoryResult>
```

- memoryIds只校验awaken；existingLongIds只校验create.existingLongId。
- 旧四参数调用仍采用原相同集合，不偷偷扩权。
- organizeMemory显式传入三份数组；lookup更新必须原地扩充，parse持有的集合不能与模型收到的集合脱节。
- 初始业务输入增加可选 `context.memoryWritePermissions` 的快照；lookupResult也携带更新后的累计权限快照，供模型解释当前可用操作。旧checkpoint缺此字段时从真实已提供行重建。
- stageInput会克隆资料；初始快照不能假装被异步lookup修改。lookup续调用实际信封必须携带更新快照，初始input继续保留原样。
- 提示明确：existingLongId只取existingLongIds；awaken只取longAwakenIds；short update只取shortUpdateIds；关联目标并非新的本轮来源。校验仍是最终门禁，提示不替代校验。
- Schema仍保留可动态补查的字符串ID，不为初始集合生成会冻结lookup扩权的静态enum。错误说明应区分“未获准引用”与“关联目标不存在”，不得把合法但未授权一概解释为数据库丢失。

### 3.4 来源、时效与事务

create继续要求合法本轮sourceIds及hasNewEventProgress布尔值。false不续期、不新增唤醒；true仅遵守原预备期进展规则。仅本人网页来源仍不能用于awaken／私人details更新。

正常检索不返回该preview long正文，其他阶段不增加关联权限；复用只发生在基础memory写入操作。apply仍使用原MemoryLifecycle与故事提交事务，不增加跨阶段直接写库。

权限不等于目标永远可用；模型等待后若目标无法再由原canonical解析，原apply拒绝并回滚，保留结果。不得再调用模型、静默fallback到新事件或部分提交。此批不新增“任意旧checkpoint对象可写”规则。

## 4. 补查、恢复与既有结果

- 无lookup时由初始retrieved构建集合；允许一次lookup的原机制、权限范围及budget不变。
- 新lookup成功后，把确实提供的行及其关联加入操作集合；无新增行或只是contextRefs不能凭空放行ID。数组与补查投影同一次返回构造完成，随后才继续模型。
- 恢复时原runId、repairCount、lookupUsed、lookupPending及20／40计数不变。已确认privateLookupResult中的行重建权限；pending lookup继续原请求，结果确认后才扩权。
- 支持旧原始MemoryContext和已投影StageModelInput两种持久lookup格式；不按任意对象中碰巧有id字段扩权，不信任旧权限数组。
- post_jobs已有合法结构化result时复用结果，沿原apply处理，不重生成、不扩大来源；outputComplete=true或已尝试输出不重发。
- 当前失败轮已经done；这次代码修复不会重跑它、改历史checkpoint或自动删除新long。

## 5. 拟修改文件

| 文件 | 责任 |
| --- | --- |
| src/memory/types.ts | 共享操作权限类型 |
| src/memory/references.ts（新） | 集中构建关联引用权限及canonical验证 |
| src/memory/organize.ts | 初始、lookup、恢复接线与权限投影 |
| src/model/contracts.ts | 分开existingLongId／awaken校验，保持四参数兼容 |
| src/model/prompts.ts | 基础memory的操作权限说明 |
| tests/memory-reference-permissions.test.ts（新） | 单元权限、别名、损坏引用、来源与时效 |
| tests/memory-existing-long-flow.test.ts（新） | 真实检索→投影→ModelClient→提交及lookup |
| tests/memory-existing-long-recovery.test.ts（新） | 临时文件库、活动checkpoint及post恢复 |
| V0.5现行记忆／上下文／恢复／实现对应及导航 | 仅在实施通过后同步规则，另建records交付 |

原则上不改MemoryLifecycle、普通retrieval或ModelClient；如实施发现必须修改，先记录具体失败证据和新增范围供复核，不能顺手放宽全局查询。

## 6. 实施任务

### T1：分离合同与引用构建（含基线准备）

**Interfaces:** 产出§3.1～3.3类型、helper和memoryTask第五参数；不接入正式运行。
**Files:** types.ts、references.ts、contracts.ts及memory-reference-permissions.test.ts。

- [ ] 核对HEAD及本文路径，建立隔离工作树，配置合成fixture；运行公开复现，记录原基线及预期拒绝。
- [ ] 写 `linked_preview_is_allowed_for_create_but_not_awaken`：提供short S→preview L，无直接long；existingLongIds=[L]，longAwakenIds=[]，原响应create通过而awaken拒绝。
- [ ] 写 `unprovided_existing_database_id_is_rejected`、`four_argument_contract_keeps_old_permissions`、`merged_alias_only_authorizes_provided_id`、`missing_wrong_kind_discarded_target_is_reported`、`linked_create_still_requires_progress_and_current_source`。
- [ ] Run: `npm test -- tests/memory-reference-permissions.test.ts --maxWorkers=1`。确认缺接口／集合不一致的用例真实红灯；负向已有门禁可原本为绿。
- [ ] 实现helper和独立校验，不把新增existingLongIds传给awaken。
- [ ] Run: `npm test -- tests/memory-reference-permissions.test.ts tests/review26-memory-create.test.ts tests/memory-event-time.test.ts --maxWorkers=1`、`npm run typecheck`；要求0失败。
- [ ] 保存证据后提交 `fix: separate memory create-link and awakening permissions`。

### T2：接入初始上下文与动态lookup

**Interfaces:** 消费T1接口；产出context／lookupResult.memoryWritePermissions快照及累计集合。
**Files:** organize.ts、prompts.ts、memory-existing-long-flow.test.ts；必要时扩充既有prompt-context-views。

- [ ] 写 `real_retrieval_short_only_can_reuse_preview_without_repair`：合成S→L，L.retainedFrom=本轮+6天，真实MemoryRetrieval只返回S。实际ModelClient捕获HTTP装配信封含link和操作集合；第一次合法模型响应复用L，memory阶段调用数1，repairCount=0，关联这条create没有另建long。
- [ ] 在该用例比较前后retainedFrom／expiresAt／lastEventUpdateAt／唤醒日期与计数；false均不变，原始来源保留并追加合法本轮来源。普通检索仍不返回preview L。
- [ ] 写 `lookup_related_id_updates_transferred_and_validator_permissions`：初始无L，一次lookup取得S→L；后一模型请求确实收到更新集合，create通过，awaken仍拒绝。
- [ ] 写 `context_refs_or_permission_claims_cannot_authorize_unprovided_id`、`self_read_only_cannot_awaken`、`invented_id_uses_original_bounded_repair`，确认资料投影没有隐藏long正文。
- [ ] Run: `npm test -- tests/memory-existing-long-flow.test.ts --maxWorkers=1`，记录旧装配真实红灯；实现同源接线与明确提示。
- [ ] Run: `npm test -- tests/memory-existing-long-flow.test.ts tests/memory-reference-permissions.test.ts tests/context-channels.test.ts tests/prompt-context-views.test.ts tests/prompt-context-transport.test.ts tests/web-memory-sources.test.ts tests/activity-memory-context.test.ts --maxWorkers=1`、`npm run typecheck`。
- [ ] 保存信封结构、调用计数和状态对照后提交 `fix: align memory context with linked long reference permissions`。

### T3：恢复、canonical及事务验收

**Interfaces:** 保持原runId及活动checkpoint格式；不读取model_run_records来恢复。
**Files:** memory-existing-long-recovery.test.ts；实现修正只限T1／T2文件。

- [ ] 写 `disk_reopen_rebuilds_permissions_from_confirmed_lookup_rows`：文件库重开，旧raw及StageModelInput lookup两种格式；同runId／lookupUsed=true／repairCount=1接续，未重查，合法引用通过。
- [ ] 写 `pending_lookup_does_not_authorize_until_confirmed`：原查询中断／重开，完成前不能引用尚未提供ID；完成后只增加实际行及关联。
- [ ] 写 `confirmed_lookup_permissions_ignore_forged_permission_arrays`：旧快照混入未提供ID权限声明，不被信任；现场权只由行与真实关系重建。
- [ ] 写 `ready_post_result_reuses_original_link_without_model_or_resend`、`target_removed_before_commit_rolls_back_without_fallback`；仅在合成库中删除目标，断言已保存post.result和未完成状态保留、无半提交或另建long。
- [ ] 写 `completed_turn_is_not_reopened_by_upgrade`、`repair_and_web_budgets_survive_restart`；原model_run_records只读，历史不改、输出不重发、预算不清零。
- [ ] Run: `npm test -- tests/memory-existing-long-recovery.test.ts --maxWorkers=1`，记录失败后最小修正；随后加跑 `tests/memory-v3-recovery.test.ts tests/model-run-history.test.ts tests/web-recovery.test.ts tests/recovery.test.ts` 及 `npm run typecheck`。
- [ ] 保存文件库重开、事务回滚与请求计数证据后提交 `test: cover linked memory permissions across recovery`。

### V1：整批验证、文档与交付

- [ ] 独立复核三份集合、preview／alias、lookup及恢复边界；逐项对应Review Focus，保留发现及关闭证据。
- [ ] 隔离工作树依次运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run demo`；记录实际文件／通过／失败／跳过数，不沿用本轮18项或前批1491项。
- [ ] 构建后运行 `npm test -- tests/plugin-smoke-contract.test.ts tests/plugin-smoke-build-path.test.ts --maxWorkers=1`，再令HDSI_TEST_LIB_DIR指向隔离lib运行 `node runtime/plugin-smoke.cjs`；两个离线场景各四阶段提交。
- [ ] 同步当前功能文档及实现对应，新增本批records交付；计划、诊断、Astra原意见仍保持原基线。
- [ ] 检查本地链接、`git diff --check`、文件清单；不纳入私有配置、库、响应、人物正文、lib或认证。
- [ ] 按用户后续授权决定集成／推送；本计划不自动部署、启动、resume或升版。

## 7. 已产生条目与部署边界

本次完成轮的旧响应原拟复用关联，成功修补后新增了一个long。这是需要单独审阅的潜在重复条目，不属于实现验收必须修改的正式数据。

本批允许先交付代码预防后续重复。若以后授权处理旧条目，先停服一致备份，核对两条记忆的事件范围、来源、摘要、感受、保留许可、唤醒及引用；编制单独可回退方案。不能通过改一条linkedLongId、删除新long或补一个唤醒来冒充安全修正。

正式服务目前正在运行。需要部署时另行确认时机，使用原安全停止、备份、验收构建及只读检查流程；服务由用户手动重启，不能把写计划或Astra审核通过解释为已部署或已恢复。

## 8. 给 Astra 的审核重点与交接

请以本文源码基线及[公开诊断](evidence/diagnosis.json)为依据，重点审阅：

1. 是否准确区分“ID确实存在”“模型已获提供”“该操作获准”，是否确实需要独立existingLongIds。
2. short关联preview可以复用、仍不能awaken的合同是否完整；直接learned与merged别名是否保持原canonical语义。
3. lookup累计集合、实际发送信封和磁盘恢复能否保持一致；旧格式是否有遗漏或偷偷扩权。
4. 拟定的引用错误、目标失效及post复用是否与原事务／暂停／发送恢复合同冲突。
5. 回归是否覆盖真实装配而非仅手传白名单；是否存在以放宽检索或修补新建掩盖问题的路径。

本轮只编写计划和合成复现；Astra尚未审核，新产品测试未实施。审核意见宜单列到 `docs/v0.5/reviews/existing-long-reference-20261013/`，后续修订另记版本和意见关闭映射，不覆盖原诊断。用户将自行交给Astra，本聊天不代发。

