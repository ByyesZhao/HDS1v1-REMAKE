# HDSI V0.5：文档入口与审核清单

核对日期：2026-10-09。当前包含ASTRA审核后T1～T13源码修复及文档同步，修复起点`73774bf`，本次完整离线验收121文件681项通过。最新[交付记录](records/ASTRA_FIX_DELIVERY_20261009.md)、[实施过程](records/ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)与[性能原始数据](records/ASTRA_FIX_BENCHMARK_20261009.json)供复核。过去累计核对保存在[历史快照](../DOCUMENT_AUDIT_PRE_V0.5_20261009.md)，旧数字/行为不当当前验收。没有在线模型、正式库或QQ运行验证。

REVIEW26批准的两项修复已完成：引用已有长期记忆的create路径区分真实进展，记忆文档补同事件合并例外，见[修复记录](records/REVIEW26_MEMORY_CREATE_FIX_LOG_20261009.md)。交ASTRA前的文档检查与补充见[交审前检查记录](records/V0.5_PRE_ASTRA_DOCUMENT_CHECK_20261009.md)。

## 1. 当前说明文档

建议阅读顺序：

| 顺序 | 材料 | 审核重点 |
| --- | --- | --- |
| 1 | [总架构](architecture/REMAKE_V0.5.md) | 系统边界、主流程、程序／模型职责 |
| 2 | [导演与环境](subsystems/REMAKE_V0.5_DIRECTORS.md) | 学期／科研／周展开、客观与知情 |
| 3 | [调度与生活状态](subsystems/REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、自主、预约、睡眠和概率 |
| 4 | [记忆](subsystems/REMAKE_V0.5_MEMORY.md) | 来源、7／90／3／30、容量、归档及15分钟 |
| 5 | [共同活动](subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开／动作、代写资格、时钟、收尾与原文 |
| 6 | [提示与上下文](subsystems/REMAKE_V0.5_CONTEXT.md) | 背景用途、未读权限、四段、单池和分支 |
| 7 | [表达与表情](subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图保真、分段、概率与文本向量 |
| 8 | [网页搜索](subsystems/REMAKE_V0.5_WEB_SEARCH.md) | 未装配状态、独立额度、缓存B和本人查阅 |
| 9 | [报错与恢复](subsystems/REMAKE_V0.5_RECOVERY.md) | 修补、冻结发送、确认／正式提交及不同恢复 |
| 10 | [实现对应与现状](reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 代码、配置、协议版本、差异与验收边界 |

以上10份是当前完整说明，不需再以旧V0.2作为未改行为拼图。部署另读[项目README](../../INDEX_BEFORE_ORGANIZATION_20261009.md)，初次重写过程读[修订日志](records/V0.5_DOCUMENT_REWRITE_LOG_20261009.md)，本次核对与归类见[对照整理记录](records/V0.5_DOCUMENT_ALIGNMENT_LOG_20261009.md)。

当前文档统一归入`docs/v0.5/`：`architecture/`放总架构，`subsystems/`放8份子系统，`reference/`放实现对应，`records/`放修订与相关交付记录。本文件是这一版的阅读入口；旧细化／执行计划和历史审查仍按下表追溯。

## 2. 实现细化与历史

实现审查按主题补阅：

| 主题 | 细化／执行计划 |
| --- | --- |
| 记忆生命周期 | [细化](../MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[计划](../MEMORY_V0.3_EXECUTION_PLAN_20261007.md) |
| 容量／空闲整理 | [细化](../MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)、[计划](../MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md) |
| 共同活动 | [细化](../SHARED_ACTIVITY_V0.3_IMPLEMENTATION_20261007.md)、[计划](../SHARED_ACTIVITY_V0.3_EXECUTION_PLAN_20261007.md) |
| 世界与学校 | [细化](../WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)、[计划](../WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md) |
| 搜索 | [设计细化](../WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)、[计划](../WEB_SEARCH_EXECUTION_PLAN_20261007.md) |
| 最新普通／活动上下文 | [细化§13～15](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[计划任务13～20及REVIEW24补充](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md) |

旧完成任务和测试数字描述当时实现，不代表最终跨批全量。若主题旧文与V0.5现状不同，对照最新代码及后续修复记录，不任意选旧规则。总文档号0.5不改数据和npm包的内部版本。

旧REMAKE_V0.2六份加历史标识，内容不删；DSH-review中的快照／旧zip不更新，不在本轮重新打包。

## 3. 证据与限制

此前活动窗口交付为105文件588项、typecheck/build、demo和两cmd --check通过；正式窗口2备份升级与只读检查通过。见[验收](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)、[日志](../PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。这不是V0.5纯文档整理重新跑出来的数字。

后续REVIEW24局部修复已完成：参数重建／诊断、V1归属检查、绑定报告与初始化等；该代码修复实跑106文件612项及typecheck/build通过。给DSH复核时补充[修复过程](records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md)与当前源码／测试；本次文档核对不冒充重跑测试，没有新在线或正式库验证。

最近一次业务修复REVIEW26实跑107文件620项、typecheck/build通过，日志见[修复过程](records/REVIEW26_MEMORY_CREATE_FIX_LOG_20261009.md)。本次只检查文档与源码对应、文件链接和范围，不重新跑这620项；旧588／612项保持原批次证据。

最新活动上下文两场隔离真实模型合计35次HTTP，Embedding0；不能当数月稳定或语义检索标定。搜索供应商未装配、semantic=null、新图描述未在线验收、真实QQ持续收发待用户运行后核对。服务不因文档整理启动。

## 4. 给ASTRA／DSH的审核说明

请以V0.5说明及实际代码为准，检查跨文档一致性、正常功能遗漏、程序与模型判断边界、信息资格和来源、模拟与现实、候选与公开确认、正式提交与恢复，以及尚未启用／未验收能力是否如实标记。

交给ASTRA时，以本文件的阅读顺序提供当前总架构、8份子系统和实现对应清单，共10份核心说明；附上本文件及[交审前检查记录](records/V0.5_PRE_ASTRA_DOCUMENT_CHECK_20261009.md)。若复核最近修复，再附REVIEW24／REVIEW26两份过程记录。旧方案、细化与rebuttal仅在追溯特定规则时补阅，不需要先读完全部历史才能理解当前系统。

若审核代码，同时提供src/、tests/、scripts/、runtime/check.cjs和两个cmd。纯文档只能核对描述，不能证明程序正确。人物风格需要审查时由用户另行决定提供背景，不把key.txt、私有配置或正式故事库混进普通审核材料。

本轮未新增防御编程、供应商推荐、多进程或语义审核模型；请区分明确矛盾、现有限制和可选新需求，不把用户的初步概括当已实施合同。

## 5. 独立审核结果（2026-10-09）

针对源码基线`73774bf`的文档／代码审核见[审核报告](reviews/ASTRA_REVIEW_20261009.md)，运行结果、覆盖范围和可重跑复现见[证据说明](reviews/AUDIT_EVIDENCE_20261009.md)。此节保留修复前审核证据；后续实际修复见§6及交付记录，历史缺陷描述不当作当前现状。

CODEX 已对照源码并复跑隔离证据，见[核验回复与修复边界](reviews/CODEX_RESPONSE_ASTRA_REVIEW_20261009.md)：F1～F8及D1均有依据，无需反驳核心结论；回复补充适用范围和核验结果；当时尚未实施，现已完成§6修复。

## 6. ASTRA 审核后修复（已实施）

ASTRA 已核对上述回复，接受个人提醒适用路径与“记忆失去检索入口、并非删除”的范围说明。后续实施材料放在 `plans/`，建议先读执行计划，再随任务读取对应细化：

| 材料 | 内容 |
| --- | --- |
| [统一执行计划](plans/ASTRA_FIX_EXECUTION_PLAN_20261009.md) | 13 项任务、依赖顺序、改动文件、回归断言、验证命令及交付门槛 |
| [业务修复细化](plans/ASTRA_FIX_BUSINESS_IMPLEMENTATION_20261009.md) | F1～F4、D1：活动身份、学校知情与个人提醒、晋升召回、旧投影补齐 |
| [流程与性能细化](plans/ASTRA_FIX_OPERATIONS_IMPLEMENTATION_20261009.md) | F5～F8：后台冻结与索引合并、读取与检查成本、状态摘要、双场景 smoke |

T1～T13均已执行并逐项记录；三份文件现标明实施状态。先读[交付](records/ASTRA_FIX_DELIVERY_20261009.md)，再按需要查[过程](records/ASTRA_FIX_IMPLEMENTATION_LOG_20261009.md)与对应细化。既有审核与核验继续保留为修复前证据，未重写旧证据中的失败断言。

## 7. 实施后独立复核

针对 `eb5b29e` 的结果见[实施后 review](reviews/ASTRA_POST_IMPLEMENTATION_REVIEW_20261009.md)。完整121文件681项及构建、类型、demo、双场景smoke、性能探针独立复跑通过；四项业务修复的主要结论成立。另发现1项P2恢复遗漏：维护准备失败后清除了应保留的阶段checkpoint，对应T7仍需补验。该行为在原基线已存在，并非本轮新引入；独立9项复核用例中8项通过、1项复现该缺口。详见报告中的定位、边界与重跑命令。

供 SOL 确认后直接实施的[R1 checkpoint 修复计划](plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md)已补齐：包括具体改动、状态判据、真实恢复测试、执行顺序和验收标准。当前为待实施，尚未关闭 R1。
