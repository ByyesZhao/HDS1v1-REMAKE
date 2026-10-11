# 记忆检索质量评估与候选标定实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 使用未勾选步骤跟踪实际完成情况。

**Goal:** 交付可复现的自然问句检索评估、独立盲测与可选择的标定候选，不以提高召回为由盲目降低正式阈值。

**Architecture:** 评估器复用真实 MemoryStore／MemoryRetrieval／ContextBuilder，数据只来自合成夹具或另行明确提供的脱敏语料。标定集选参数，冻结的盲测集只评价已选候选；输出报告及候选标定文件，正式配置默认不变。

**Tech Stack:** 现有 TypeScript、Vitest、Node SQLite、tsx；不增加运行依赖。

**Spec:** [审核M3](../../reviews/comprehensive-audit-20261011/MEMORY_PERFORMANCE.md)、[当前记忆规则](../../subsystems/REMAKE_V0.5_MEMORY.md)、[总执行入口](README.md)。基线 `ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`，日期2026-10-11，状态**未实施**。

## Global Constraints

- 正式缺省仍为 lexical.fact=1、lexical.experience=1、semantic=null；本方案不自动改私有配置、既有标定文件或模型参数。
- 保持 scope、detailHistory、有效期、直接键、alwaysInclude 和 RRF60 的业务规则；相关内容仍不设置新的数量／字符上限。
- 任何查询规范化不得反向扩大原始请求确定的权限。本批先比较现有词法算法的标定阈值，不增设“关键词改写模型”。
- 离线默认不调用 Embedding／对话模型；真实语义标定仅在执行任务另有明确在线授权与可用配置时运行。无授权或无凭据不阻塞Q1／Q2交付，Q3记为未执行，不能编造供应商结果。
- 不覆盖审核里的16例旧数据或历史报告；新增夹具版本、报告路径和数据摘要。

## Review Focus

1. 同一事件的不同问法跨split泄漏：Q1必须按family整体分组。
2. 相似经历和人物混淆：Q1每个正例至少带三个近似但不相关候选；Q2比较误召回。
3. 自然问句申请到的归档／历史权限被改写扩大：Q1直接调用真实makeRetrievalRequest和lookup校验。
4. 没有相关记忆时强行召回：Q1全负查询、Q2零新增此类错误门槛。
5. 用盲测反复调参或供应商签名漂移：Q2锁候选后一次盲测，Q3按签名冻结向量。

## Q1：构建数据集与真实检索评估器

**文件：**

- 新建 `tests/fixtures/memory-retrieval-v2.json`。
- 新建 `scripts/lib/memory-retrieval-evaluation.ts`、`scripts/evaluate-memory-retrieval.ts`。
- 新建 `tests/memory-retrieval-evaluation.test.ts`。
- 读取并复用 `src/memory/{store,retrieval,context,types}.ts`、`src/model/context-views.ts`，不修改运行时选择算法。

**接口：**评估器导出 `evaluateRetrievalDataset(dataset: RetrievalDatasetV2, calibration: RetrievalCalibration, options: { splits: RetrievalSplit[]; indexFactory?: (store: MemoryStore) => MemoryIndex }): Promise<RetrievalEvaluationReport>`。具体类型在同一脚本库导出，`RetrievalSplit='development'|'calibration'|'holdout'`；report包含逐query实际owner keys、expected keys、TP/FP/FN、无相关查询误命中次数、分类型指标、物化向量字节及远程请求数。不能只调用lexicalCoverage代替真实检索。

数据合同：

| 字段 | 必须内容 |
| --- | --- |
| 顶层 | `version:2`、`datasetId`、固定`at`、`families`、`queries`；文件哈希写入报告 |
| family | `id`、`split`、`group:fact\|experience`、`owners:Omit<MemoryCandidate,'normalizedVector'>[]`、`messages:Message[]`、`turns:TurnRecord[]`、`detailHistory:DetailHistory[]`；复用源码类型，不用任意object。合成来源按已有测试helpers建立，JSON保存完整确定种子；同family所有改写和干扰条目留在同split |
| query | `id`、`familyId`、`text`、`phase`、`at`、`candidateOwnerKeys`、`expectedOwnerKeys`、`category`、`permissions:RetrievalPermissions`、`scope`、`includeDetailHistory`、人工标注理由；字段取现有请求类型 |
| owner key | 用 `ownerType:ownerId`，不得只用id把detail和long混为同一条 |

规模固定为60个合成family：fact／experience各30；development各16、calibration各8、holdout各6。每family六条query：直接问法、口语长句、同义改写、多话题、时间／状态变化、全负问句，共360条。前五类至少一条合法相关记忆及三个干扰候选；全负类expected为空。事实种子含key／alias／value，经历含状态、保留时间与sourceIds。用合法合成经历来源，涉及message的样本须通过真实对话夹具建立索引，不能直接塞损坏消息绕过合同。

每条query使用全新`Storage(':memory:')`，种入该family中`candidateOwnerKeys`声明的完整owner以及关联canonical／来源／历史所必需的闭包；闭包owner也会被真实SQL看见，必须纳入期望标注或明确为干扰项，不能评估后再按candidateOwnerKeys过滤。请求通过真实`makeRetrievalRequest`／`resolveLookupRequest`构造，候选资格完全由MemoryStore决定。记录实际存入的owner keys以便复核。生成ContextBuilder结果后，再调用`stageInput('personal_chat'|'personal_life'|'personal_shared',{history:context,...合成场景输入})`，记录`resources.owners`和roles引用，确认最终个人导演得到的资料与相关owner选择一致；三种个人阶段分别有回归。

- [ ] **1. 写失败测试。** `family_never_crosses_splits`、`duplicate_query_id_rejected`、`expected_keys_exist`、`six_query_categories_per_family`、`fact_and_experience_stratified` 明确检查上述数量及分组；缺一个类别／跨组重复family应失败。
- [ ] **2. 增加业务断言。** `evaluation_uses_real_retrieval` 用有直接alias、已过期long和alwaysInclude的夹具，断言返回结果等于同配置直接调用MemoryRetrieval；`negative_query_has_empty_expectation` 单独统计误命中；`lookup_does_not_expand_permissions` 断言未授权archive/history被拒；`memory_context_matches_personal_evidence` 断言报告记录实际提供owner，而非只有独立词法分数。
- [ ] **3. 红测。** `npx vitest run tests/memory-retrieval-evaluation.test.ts --reporter=verbose`；必须因缺接口／预期结果不符失败，而非环境权限失败。
- [ ] **4. 实现数据读取与评估CLI。** 必需 `--dataset <json> --report <json>`；可选 `--calibration <json>`，未提供用现有defaultCalibration。只在显式report路径写出，禁止固定写`runtime/data`；禁止仅因读取数据就写正式库。`--splits`默认且Q1仅使用`development,calibration`；含holdout必须显式指定，并校验已有冻结候选文件／hash，不能在Q1生成holdout错误报告。
- [ ] **5. 独立检查并冻结标注。** 另一审核者检查所有holdout期望及至少development/calibration各10个family；争议在未调参前修订，再冻结数据hash。标注复核只看语料与期望，不运行holdout检索或把其错误交给调参者。不是调用实际模型替人定义正确答案。
- [ ] **6. 绿测并生成开发／标定基线。** 仅对development/calibration运行baseline，记录每类precision/recall及逐query错误，写本批records的Q1目录；holdout的baseline和candidate留到Q2同次评价。事实／经历分别计算micro TP/FP/FN；0预测正例precision记null，0真实正例recall记null，不把空集合当满分。alwaysInclude单独报告，避免无条件注入抬高相关检索分数。
- [ ] **7. 提交边界。** 提交数据、评估器、测试和基线报告摘要；运行时检索结果与旧版本完全相同。

**完成标准：**360条query全部有可追溯期望；报告能定位错召回／漏召回；同一命令相同输入得到相同owner选择和TP/FP/FN。时间允许浮动。

## Q2：仅在标定集选择词法阈值，盲测决定是否推荐

**文件：**扩展上述脚本库和CLI；新增 `tests/memory-retrieval-calibration-split.test.ts`。无需修改`src/memory/lexical.ts`或默认配置。

**接口：**导出 `selectLexicalCalibration(dataset: RetrievalDatasetV2): Promise<{calibration:RetrievalCalibration;selection:LexicalSelection}>`，只消费`split=calibration`的标签。`LexicalSelection`明确包含`datasetHash`、`split:'calibration'`、`groups:{fact,experience}`；每组为`{baseline:EvaluationMetrics;candidates:Array<{threshold:number;metrics:EvaluationMetrics;eligible:boolean;reasons:string[]}>;selectedThreshold:number}`。`EvaluationMetrics`包含TP/FP/FN、precision/recall/F1（number|null）与negativeFalseHits。

候选阈值仅由该组标定样本的现有`lexicalCoverage`正分数及1产生；所有precision/F1/负例指标均`await evaluateRetrievalDataset`取得真实检索结果，不用原始分数自己伪造资格／排序。fact／experience分别选择，评价一组时另一组固定1。先过滤precision为null或低于0.95、或全负误召回比基线更多的候选；剩余按F1、precision、阈值由高到低选，任一指标null不作为合格推荐。没有合格候选则该组保留1。`semantic`始终null。

“0.95”是本次方案的工程验收门槛，不是已达成的指标；数据不足以支持提升时，合格结论可以是维持当前参数。

- [ ] **1. 写失败测试。** `holdout_labels_cannot_change_selected_threshold`：只替换holdout标签，选出的阈值完全不变；`precision_constraint_beats_recall`：低阈值召回更多但precision低于0.95时不得选；`ties_choose_higher_threshold`；`no_candidate_keeps_baseline`。
- [ ] **2. 红测后实现。** CLI增加 `--select-lexical --candidate <json>`，选择器固定且仅使用calibration，不受`--splits`改变；先写候选文件/hash，再按显式`--splits holdout`比较baseline/candidate。报告保存数据hash、候选hash、所选阈值与baseline差异。输出形状含现有可读取的 `{calibration:{lexical:{fact,experience},semantic:null}}`，额外审计信息置顶层，不改变当前runtime loader协议。
- [ ] **3. 对照真实检索。** 运行baseline与candidate，两者使用同一内存种子和权限。断言直接键、alwaysInclude、归档授权和有效期不因阈值配置变化而被改写。
- [ ] **4. 一次盲测裁决。** 冻结数据与候选后，才在同次命令中评价baseline/candidate的holdout。推荐候选必须在fact／experience两组precision均≥0.95；baseline precision非null时还须不低于它，baseline为null仅不做相对precision比较，绝不能当作0分。全负误命中数不增加；总recall至少增加0.10（至少10个百分点）。候选指标为null或任一条件不满足，报告`recommendation=keep_current`，不再按holdout调参。记录该holdout已使用；继续研究须使用新family构成的未查看holdout。
- [ ] **5. 生成交付。** 保存逐query差异、推荐／不推荐原因及候选文件；用现有settings的calibrationFile接入只在合成配置测试，确认JSON兼容。私有正式配置仍不变。
- [ ] **6. 提交边界。** 评估工具、split隔离测试和候选证据一个提交。无收益也是有效评估交付，不把“工具完成”写成“实际聊天记忆质量已提高”。

运行形式：

```powershell
npx vitest run tests/memory-retrieval-evaluation.test.ts tests/memory-retrieval-calibration-split.test.ts tests/memory-v3-retrieval.test.ts
npx tsx scripts/evaluate-memory-retrieval.ts --dataset tests/fixtures/memory-retrieval-v2.json --report docs/v0.5/records/comprehensive-remediation-20261011/evidence/q2-report.json --select-lexical --candidate docs/v0.5/records/comprehensive-remediation-20261011/evidence/q2-candidate.json --splits holdout
```

## Q3：语义通道候选实验，单列前置条件

**范围：**评估同义改写的收益，运行时MemoryIndex签名、1.5秒queryTimeout、检索融合规则不改。依赖Q1及 [M2向量门禁](MEMORY_PLAN.md)。默认在Q2后执行，新建`tests/fixtures/memory-retrieval-semantic-v2.json`：保留Q1的48个development/calibration family，以fact／experience各6个全新family替换12个已查看的holdout family，每family六类问法，仍为60 family／360 query，其中新holdout为72条。不是追加旧holdout；JSON schema version仍为2，但datasetId/hash不同。独立标注冻结后才采集并评估，向量包绑定新datasetHash。没有在线授权时先完成下面的离线工具／测试，供应商执行仍列未执行。

**文件：**新建 `scripts/prepare-memory-retrieval-vectors.ts`；扩展评估器；新建 `tests/memory-retrieval-semantic-evaluation.test.ts`。

**接口：**向量包包含 `version:1`、datasetHash、`configSignature`（原MemoryIndex端点／模型／维度／模板签名）、ownerKey→revision／vector、queryId→vector及各项源文本hash。预生成后，评估只读取这个包，以假EmbeddingProvider重放，不重复远程请求。分别记录`collectionNetworkRequests`、`replayProviderCalls`、`replayNetworkRequests=0`；MemoryIndex的`stats.remoteRequests`会计入假provider调用，不直接当网络成本。实际API key只能经已有环境配置读取，不能写报告或向量包。

评估库增加`selectSemanticCalibration(dataset:RetrievalDatasetV2,vectors:RetrievalVectorPack):Promise<{calibration:RetrievalCalibration;selection:SemanticSelection}>`；`SemanticSelection`保留数据/向量包hash、每个完整候选阈值及两组/总体EvaluationMetrics、资格原因、所选候选与全局关闭比较。CLI增加`--select-semantic --vectors <json> --candidate <json> --splits holdout`，与`--select-lexical`互斥，顺序同样为calibration选参→保存候选hash→新holdout一次比较；无向量或未齐备时明确incomplete，不进入质量裁决。

- [ ] **1. 离线红绿。** `rejects_dataset_or_signature_mismatch`；`vectors_are_reused_without_network`；`query_missing_vector_is_reported`，不能把缺向量样本移出分母；`uncalibrated_baseline_makes_zero_queries`；`empty_or_no_compatible_candidate_still_skips`。测试用小型已知向量，不把它当真实效果证据。
- [ ] **2. 完成向量准备CLI。** 必需`--dataset --config --output`，真实请求还必须显式`--online`；无该flag只报告计划请求数和签名，不发请求。每个唯一文本hash及相同签名只编码一次，支持已有同签名输出断点续跑，未完成状态写在报告中。输出路径必须显式提供，避免复用正式memory索引。
- [ ] **3. 有授权时执行一次向量采集。** 用现有memoryEmbedding连接和维度，输入仅是已审查数据集。报告实际请求数、失败及向量覆盖；没有齐备向量则本次质量裁决为incomplete，不自动降低阈值。
- [ ] **4. 在calibration选择语义候选。** 候选集合为fact/experience各组有限相似度阈值（含1，均在[-1,1]）的笛卡尔积，加全局`semantic=null`基线；每个启用候选都必须包含完整fact/experience数值及签名。现有runtime不支持仅一组null，不用阈值1冒充关闭。通过真实异步检索评估，precision／全负约束沿Q2；词法两组固定1。可行候选按总F1、总precision、fact阈值、experience阈值降序选择，先写候选hash再评价新holdout。若无合格候选保留全局关闭。盲测门槛沿Q2，另报句型分类和网络／回放成本；不扩大线上timeout。
- [ ] **5. 分开报告效果与上线。** 通过门槛的向量候选也只交付标定文件和启用说明；是否写入正式calibrationFile由后续明确部署任务决定。届时应按整个候选签名核对当前provider，不能只拷两个阈值。

**交付命令形状：**在实现上述CLI后，先执行`npx tsx scripts/prepare-memory-retrieval-vectors.ts --dataset <本批数据路径> --config <专用标定配置> --output <本批向量包>`获得只读计划；只有授权在线验收后才增加`--online`。尖括号参数是执行时明确输入，不在本方案提供私有正式路径。

## 完成与回退

- Q1／Q2的代码与离线结果可独立完成，不依赖真实模型。
- Q3区分工具完成、供应商执行完成、质量门槛通过、正式启用四个状态。
- 本批默认没有产品行为切换，因此无需正式库迁移；后续启用候选的回退是恢复原标定配置文件，不删除记忆或重新整理故事。
- 更新当前记忆说明时只写实际启用状态。若只交付评估器，仍保留“semantic=null、纯语义未启用”的事实，不把候选结果写成正式验收。
