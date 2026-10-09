# HDSI V0.5：文档入口与审核清单

核对日期：2026-10-09。当前已包括ASTRA T1～T13、R1 checkpoint以及本次当前审核改进T1～T9；源码基线c9e4599，本批代码与验证见[交付](records/current-audit-improvements-20261009/DELIVERY.md)。独立环境异步E1～E5尚未实施。

**可以直接提供整个 `docs/v0.5/`，从本索引开始阅读。** 当前规则以总架构、8份子系统和实现对应清单为主；已完成计划与原始审核材料用于追溯。旧报告中的缺陷、失败日志和快照中的“待实施”不代表当前状态。

## 1. 当前说明与阅读顺序

| 顺序 | 材料 | 审核重点 |
| --- | --- | --- |
| 1 | [总架构](architecture/REMAKE_V0.5.md) | 系统边界、主流程、程序／模型职责 |
| 2 | [导演与环境](subsystems/REMAKE_V0.5_DIRECTORS.md) | 学期／科研／周展开、客观安排、知情版本与个人提醒 |
| 3 | [调度与生活状态](subsystems/REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、自主、预约、睡眠和概率 |
| 4 | [记忆](subsystems/REMAKE_V0.5_MEMORY.md) | 来源、7／90／3／30、容量、晋升召回及15分钟整理 |
| 5 | [共同活动](subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开／动作、代写资格、时钟、收尾及跨活动未读归属 |
| 6 | [提示与上下文](subsystems/REMAKE_V0.5_CONTEXT.md) | 背景用途、未读权限、四段、单池、程序分支与一致性门禁 |
| 7 | [表达与表情](subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图保真、分段、概率与文本向量 |
| 8 | [网页搜索](subsystems/REMAKE_V0.5_WEB_SEARCH.md) | 未装配状态、独立额度、缓存B、本人查阅与状态摘要 |
| 9 | [报错与恢复](subsystems/REMAKE_V0.5_RECOVERY.md) | 修补累计、冻结发送、确认／正式提交及后台 checkpoint 接续 |
| 10 | [实现对应与现状](reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 源码、配置、协议版本、差异与验收边界 |

这10份构成完整的当前说明，不需要拼接旧 V0.2 才能理解规则。总架构只写职责、规则和逻辑；源码位置、配置键及验证证据集中在实现对应清单。运行与显式升级命令另见[项目 README](../../README.md)。

本次整理范围、源码对照及文档检查结果见[再次送审检查记录](records/V0.5_RESUBMISSION_DOCUMENT_CHECK_20261009.md)。

## 2. 最近修复与验收状态

再次独立审核见[当前审核总报告](reviews/current-audit-20261009/README.md)，其中B1／B2及本批T1～T9已修复。原审核和失败证据保留基线事实；当前结果见[交付](records/current-audit-improvements-20261009/DELIVERY.md)及[独立复核关闭记录](records/current-audit-improvements-20261009/REVIEW_CLOSURE.md)。环境异步E1～E5仍是后续独立批次。以下ASTRA T1～T13及R1是此前已完成批次。

| 批次 | 当前结论 | 证据 |
| --- | --- | --- |
| 当前审核改进T1～T9 | 日期与字符选批BUG、按需上下文、窗口／调度定向查询、有限旧载荷回收及资料池索引 | [交付](records/current-audit-improvements-20261009/DELIVERY.md)、[过程](records/current-audit-improvements-20261009/IMPLEMENTATION_LOG.md)、[窗口与清理工作量](records/current-audit-improvements-20261009/benchmark.json)、[调度工作量](records/current-audit-improvements-20261009/scheduling-query-results.json) |
| ASTRA T1～T13 | F1～F8、D1 已实施：活动身份、学校知情／提醒、晋升召回、后台任务、查询与检查成本、状态摘要及 smoke | [交付](records/ASTRA_FIX_DELIVERY_20261009.md)、[过程](records/ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)、[性能数据](records/ASTRA_FIX_BENCHMARK_20261009.json) |
| 实施后 R1 | 已关闭：维护准备失败／停止保留完整阶段进度，最新持久任务 ready／done 才压缩 checkpoint；应用重试复用结果 | [补验交付](records/ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md)、[过程](records/ASTRA_R1_CHECKPOINT_FIX_IMPLEMENTATION_LOG_20261009.md)、[复核报告及关闭补充](reviews/ASTRA_POST_IMPLEMENTATION_REVIEW_20261009.md) |

最新全量离线验收为本批137文件776项通过，typecheck、build、demo和双场景smoke通过；详情和复核状态以本批交付为准。R1的122／693与此前121／681保留各批历史含义。

此前 REVIEW24（106文件612项）和 REVIEW26（107文件620项）修复已包含在当前代码中，分别见[窗口修复记录](records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md)、[记忆 create 修复记录](records/REVIEW26_MEMORY_CREATE_FIX_LOG_20261009.md)。更早的数字保留原批次含义。

目前没有数月运行验证。搜索供应商未选、正式搜索关闭；记忆 `semantic=null`，纯语义查询关闭；新图视觉描述及真实 QQ 持续收发尚未验收。此前隔离真实活动样例与图库核对不扩大这些结论。此次未读取私有配置、角色背景或正式库，未调用在线模型或启动服务。

## 3. 目录如何使用

| 目录 | 用途 |
| --- | --- |
| `architecture/` | 当前总架构 |
| `subsystems/` | 当前8份子系统说明 |
| `reference/` | 当前实现映射与现有限制 |
| `plans/` | 当前审核T1～T9已完成合同、独立E待执行方案及此前修复合同，状态分列；见[计划入口](plans/README.md) |
| `records/` | 每一批实际修改、验收、性能与文档整理记录，数字按批次保留 |
| `reviews/` | 原始审核、核验回复、关闭补充及证据；见[审核材料入口](reviews/README.md) |

优先复核当前说明，再按疑点查实现、测试和最近交付。原始审核、`evidence/`、`postfix-evidence-20261009/` 与 `original-docs/` 是历史证据，不能把其中旧失败断言或待修状态直接当作当前验收要求。R1 新结果保存在 `reviews/r1-fix-evidence-20261009/`。

旧材料与当前说明发生差异时，查最新源码及后续修复，不任选旧规则。文档版本0.5不改变 npm 包版本、数据协议版本或正式库状态。旧 DSH-review 副本及 zip 保持当时快照，不持续同步。

## 4. 给审核者的范围说明

请检查跨文档一致性、正常功能遗漏、程序与模型判断边界、信息资格与来源、模拟与现实、候选与公开确认、正式提交与恢复，以及未启用／未验收能力是否如实标明。最新重点包括事件时间默认、字符选批/FIFO、SQL窗口等价、学校定向知情、终态载荷有限回收，以及跨活动未读归属、已读学校计划推导提醒、知情版本防回退、晋升事件依据召回，以及后台失败后的累计修补进度。

若审核代码，同时提供 `src/`、`tests/`、`scripts/`、`package.json`、锁文件、测试配置、公开样例、`runtime/check.cjs`、`runtime/plugin-smoke*.cjs` 和两个启动 cmd。纯文档审核不能证明代码正确；性能探针也不证明所有查询都已与历史大小无关。

密钥、私有配置、正式故事库及人物背景不属于默认送审材料。人物风格或正式配置需要审核时，由用户另行提供所需内容。请区分实际矛盾、已注明限制和可选新需求；此次没有增加防御编程、供应商、多进程或语义裁判模型。

## 5. 按需追溯旧实施材料

| 主题 | 细化／执行计划 |
| --- | --- |
| 记忆生命周期 | [细化](../MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[计划](../MEMORY_V0.3_EXECUTION_PLAN_20261007.md) |
| 容量／空闲整理 | [细化](../MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)、[计划](../MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md) |
| 共同活动 | [细化](../SHARED_ACTIVITY_V0.3_IMPLEMENTATION_20261007.md)、[计划](../SHARED_ACTIVITY_V0.3_EXECUTION_PLAN_20261007.md) |
| 世界与学校 | [细化](../WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)、[计划](../WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md) |
| 搜索 | [设计细化](../WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)、[计划](../WEB_SEARCH_EXECUTION_PLAN_20261007.md) |
| 普通／活动上下文 | [细化§13～15](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[计划及 REVIEW24 补充](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md) |

版本切换及早期检查见[重写日志](records/V0.5_DOCUMENT_REWRITE_LOG_20261009.md)、[归类记录](records/V0.5_DOCUMENT_ALIGNMENT_LOG_20261009.md)、[首次交 ASTRA 前检查](records/V0.5_PRE_ASTRA_DOCUMENT_CHECK_20261009.md)和[旧累计索引快照](../DOCUMENT_AUDIT_PRE_V0.5_20261009.md)。这些材料按需要追溯，不作为再次送审的必读前置。
