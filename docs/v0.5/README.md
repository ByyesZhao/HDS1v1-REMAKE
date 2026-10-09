# HDSI V0.5：当前文档与审核入口

核对与整理日期：2026-10-09。当前实现包含ASTRA T1～T13、R1及最近T1～T9；后者经[ASTRA最终复核](reviews/post-t1-t9-20261009/REVIEW.md)确认可以关闭。环境异步E1～E5尚未实施，本轮按用户要求暂停开发。

**默认提供整个`docs/v0.5/`，从本文件阅读，并附[目录原则](../DIRECTORY_POLICY.md)。** 当前规则以总架构、8份子系统和实现对应为准；归档不要求审核者先逐份阅读。

## 1. 当前说明与阅读顺序

| 顺序 | 材料 | 审核重点 |
| --- | --- | --- |
| 1 | [总架构](architecture/REMAKE_V0.5.md) | 系统边界、职责、主流程和规则逻辑 |
| 2 | [导演与环境](subsystems/REMAKE_V0.5_DIRECTORS.md) | 学期／科研／周展开、知情和个人提醒 |
| 3 | [调度与生活状态](subsystems/REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、自主、预约、睡眠、概率 |
| 4 | [记忆](subsystems/REMAKE_V0.5_MEMORY.md) | 来源、7／90／3／30、容量、晋升召回、空闲整理 |
| 5 | [共同活动](subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开、动作、代写、计时、收尾和跨活动归属 |
| 6 | [提示与上下文](subsystems/REMAKE_V0.5_CONTEXT.md) | 四段、当前活动、权限、单池、程序分支、查询成本 |
| 7 | [表达与表情](subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图、分段、概率、文本向量图库 |
| 8 | [网页搜索](subsystems/REMAKE_V0.5_WEB_SEARCH.md) | 未装配状态、20／40、缓存B和本人查阅 |
| 9 | [报错与恢复](subsystems/REMAKE_V0.5_RECOVERY.md) | 修补累计、冻结发送、正式提交与后台checkpoint |
| 10 | [实现对应与现状](reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 源码、配置、协议版本、差异和验证边界 |

这10份构成当前系统说明，不需要与旧V0.2拼接。总架构只写职责、规则和逻辑；技术位置及现有限制放实现对应。当前人物用途审批另见[背景映射](reference/BACKGROUND_VIEW_MAPPING_20261008.md)，不是本轮新审批。运行和显式升级命令见[项目README](../../README.md)。

## 2. 最近交付与关闭状态

| 材料 | 当前结论 |
| --- | --- |
| [T1～T9交付](records/current-audit-improvements-20261009/DELIVERY.md)、[实施过程](records/current-audit-improvements-20261009/IMPLEMENTATION_LOG.md) | B1事件日期、B2完整选批已修复；按需上下文、窗口／调度查询、清理回收、资料池优化已交付 |
| [实施者独立复核关闭](records/current-audit-improvements-20261009/REVIEW_CLOSURE.md) | 两项验收矩阵缺口和首次计时口径均已补齐 |
| [ASTRA最终独立复核](reviews/post-t1-t9-20261009/REVIEW.md) | 本批可关闭，无需要先修的已确认业务BUG或阻断；独立137文件776项及类型／构建／演示／双场景插件检查通过 |
| [本轮目录整理](records/document-organization-20261009/README.md) | 文档归类、导航与当前状态检查；没有改产品代码或重做在线／正式库验收 |

ASTRA补验包括1,920次窗口差分、V1中断恢复、选批组合和调度历史样本。相关知识内部成本补测见[summary.json](reviews/post-t1-t9-20261009/summary.json)：固定实体返回1份，随H=0/1000/5000历史，时间函数调用1/1001/5001；这是已注明的末端排序成本，无须本批修代码。

实施者主目录137／776与ASTRA独立137／776是各自执行证据，耗时和结果分别保留；旧122／693、121／681、107／620等在[历史记录](../archive/records/)中保留各批意义。日志不会随着文档整理变成一次新的测试执行。

## 3. 待实施

目前唯一保留在plans的任务是[环境异步E1～E5](plans/environment-async/README.md)，状态为**未实施**。它需要新的冻结与持久恢复合同，当前环境HTTP仍串行。本次不启动开发、升级或正式迁移；776项通过不能代替未来E阶段验收。

已完成的T1～T9、ASTRA T1～T13和R1执行合同已收进[历史plans](../archive/plans/)。旧清单未勾选和原“待实施”文字不表示今天仍待做。

## 4. 目录与新建规则

| 目录 | 用途 |
| --- | --- |
| `architecture/` | 当前总架构 |
| `subsystems/` | 当前8份功能说明 |
| `reference/` | 实现映射、配置及当前必要参考 |
| [plans/](plans/README.md) | 未实施任务；当前只有环境异步计划 |
| [records/](records/README.md) | 最近交付、过程、最终性能证据与本轮整理清单 |
| [reviews/](reviews/README.md) | 最近ASTRA最终review、独立探针和真实验证日志 |
| [../archive/](../archive/README.md) | 旧架构、已完成计划、旧审核、早期过程和旧红绿日志 |
| [../../runtime/archive/](../../runtime/archive/README.md) | 本地历史测试产物与完整回退资料，不默认送审／入Git |

按[目录原则](../DIRECTORY_POLICY.md)新建任务目录，关闭后同步当前功能说明，再归档已被替代材料。不要再创建根目录rebuttal/log或另一套送审副本。文件移动前后位置见[迁移清单](records/document-organization-20261009/move-manifest.json)。

## 5. 验证与送审边界

搜索供应商未选，正式搜索关闭；记忆`semantic=null`，纯语义查询关闭；新图视觉描述、真实QQ持续收发和数月运行仍未验证。既有隔离真实活动样例和图库核对不扩大这些结论。目录更新不改变业务版本、运行配置或正式库状态。

审代码时另提供`src/`、`tests/`、`scripts/`、包与锁文件、测试配置、公开样例、`runtime/check.cjs`、`runtime/plugin-smoke*.cjs`和两个启动cmd。性能样本证明对应工作量，没有证明所有查询与历史规模无关。

密钥、私有配置、正式故事库、人物背景及`runtime/archive/`不属默认送审材料；需要时由用户另行提供。历史复现按报告基线使用，不要求修后的程序仍满足“旧错误发生”的断言。

## 6. 历史追溯

从[归档索引](../archive/README.md)按主题查记忆、共同活动、世界学校、提示上下文、搜索和素材；ASTRA旧审核、R1、DSH各轮回应、V0.5重写和旧zip均在归档内。历史报告不改判定和数字，只修可识别的导航；日志里的原执行路径可通过迁移清单定位。

当前问题优先看当前说明、最新代码和最终复核，按疑点补看归档，不从旧决策中任选一条覆盖现行规则。
