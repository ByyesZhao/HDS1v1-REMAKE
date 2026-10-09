# HDSI V0.5：当前文档与审核入口

更新：2026-10-10。图片输入理解I1～I6与本地浏览器搜索S1～S5已交付；最新全量离线验收173文件／882项；独立整批复核3个Important已修，见[最终关闭](records/local-browser-search-20261009/FINAL_REVIEW_CLOSURE.md)。见[图片交付](records/image-input-20261009/DELIVERY.md)与[搜索交付](records/local-browser-search-20261009/DELIVERY.md)。正式两项开关保持关闭。此前实现包含 ASTRA T1～T13、R1、T1～T9、环境异步 E1～E5及回复规则／图片表情分支。该回复规则批离线验收为150文件／840项，见[本批交付](records/reply-guidance-20261009/DELIVERY.md)。环境独立复核提出的两处来源快照问题已修复，详见[关闭说明](records/environment-async-20261009/REVIEW_CLOSURE.md)。

交付后对 `cc963f8` 的[独立复核与修复实施方案](reviews/environment-async-20261009/post-delivery/REVIEW.md)已完成：全量146／804及公开离线验收重跑通过，其确认的P2 Host门禁竞态和P3报告计数错误已修复；独立差异复核无新发现。正式升级后的只读启动检查问题也已修复，详见[修复与正式升级关闭](records/environment-post-delivery-fixes-20261009/DELIVERY.md)。原报告的待修清单属于原基线。

默认提供整个 `docs/v0.5/`，从本文件阅读，并附[目录原则](../DIRECTORY_POLICY.md)。当前功能说明为以下10份；归档仅按疑点查阅。

## 当前说明与阅读顺序

| 顺序 | 材料 | 审核重点 |
| --- | --- | --- |
| 1 | [总架构](architecture/REMAKE_V0.5.md) | 职责、规则、主流程 |
| 2 | [导演与环境](subsystems/REMAKE_V0.5_DIRECTORS.md) | 四阶段依赖、冻结准备和串行提交 |
| 3 | [调度与生活状态](subsystems/REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、三槽等待、睡眠和预约 |
| 4 | [记忆](subsystems/REMAKE_V0.5_MEMORY.md) | 来源、生命周期、容量、空闲整理 |
| 5 | [共同活动](subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开、动作、代写、推进和归属 |
| 6 | [提示与上下文](subsystems/REMAKE_V0.5_CONTEXT.md) | 四段、活动原文、权限和检索 |
| 7 | [表达与表情](subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图、分段、概率和图库 |
| 8 | [网页搜索](subsystems/REMAKE_V0.5_WEB_SEARCH.md) | 20／40、缓存、本人查阅和checkpoint |
| 9 | [报错与恢复](subsystems/REMAKE_V0.5_RECOVERY.md) | 修补、冻结发送、恢复、lease和版本兼容 |
| 10 | [实现对应与现状](reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 源码、配置、差异和验证范围 |

背景用途参考为[已批准映射](reference/BACKGROUND_VIEW_MAPPING_20261008.md)，不是新审批。运行和显式升级命令见[项目README](../../README.md)。

当日[文档与模型连接静态核对](records/document-model-audit-20261009/README.md)已补清调度／预约分工、前后台并发及搜索接入状态；模型列表和待选服务见[模型调用与网页搜索参考](reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)。该记录没有新增产品实现或在线验收，不替代上述代码交付证据。

本批[主目录整合与最终验收](records/local-browser-search-20261009/INTEGRATION_20261010.md)已完成，173文件882项重跑通过；正式两项开关仍关闭。

## 最新交付与审核

| 材料 | 状态 |
| --- | --- |
| [图片输入交付](records/image-input-20261009/DELIVERY.md) | I1～I6、权限历史观察、冻结恢复、原图清理与显式只读检查；真实图片模型质量未执行 |
| [本地浏览器搜索交付](records/local-browser-search-20261009/DELIVERY.md) | S1～S5、页槽排空、DOM提取、原工具计数与服务生命周期；Bing公开完整验收通过，DuckDuckGo验证码失败保留 |
| [文档与模型连接核对](records/document-model-audit-20261009/README.md) | 文档静态核对与正式配置白名单解析；全部Flash，10个low／3个high；历史静态核对，不代表后续provider状态 |
| [回复规则历史交付](records/reply-guidance-20261009/DELIVERY.md) | 三条固定口语规则、第四条程序附件分支、纯图输入与沉默控制；150文件840项；无正式迁移或在线调用 |
| [前批修复／正式升级交付](records/environment-post-delivery-fixes-20261009/DELIVERY.md) | R1／R2及只读启动检查关闭；原批148文件826项；正式库环境2、67图库完整保留 |
| [R1／R2独立差异复核](reviews/environment-async-20261009/post-delivery/FIX_DIFF_REVIEW.md) | 7文件40项、无新发现；未覆盖后续启动检查附加修复和正式部署 |
| [交付后复核与修复实施方案](reviews/environment-async-20261009/post-delivery/REVIEW.md) | 基线cc963f8的原报告；1 P2／1 P3现已关闭，原复现／未勾选清单保留历史含义 |
| [E阶段交付与复跑](records/environment-async-20261009/DELIVERY.md) | 已交付；前台聊天、环境准备、记忆准备可并行等待，业务写入仍串行 |
| [实施过程](records/environment-async-20261009/IMPLEMENTATION_LOG.md) | E1～E5、失败回归、裁决和验证 |
| [独立复核原报告](reviews/environment-async-20261009/INDEPENDENT_REVIEW.md) | 基线272437f→2a6b981，1 Important／1 Minor；原结论保留 |
| [修复关闭说明](records/environment-async-20261009/REVIEW_CLOSURE.md) | 两项已修，新增3项回归及全量804项通过；未冒充第二次独立重审 |
| [工作量证据](records/environment-async-20261009/evidence/workload-final.json) | H=0／90／180，每档5样本，15/15聊天先于环境响应完成 |
| [目录整理记录](records/document-organization-20261009/README.md) | 前批整理范围与原迁移清单 |

环境新库版本2；旧库必须显式停服备份升级，旧冻结任务保留串行兼容。**正式库已显式停服备份升级1→2**；[部署及只读复核摘要](records/environment-post-delivery-fixes-20261009/evidence/formal-upgrade-summary.json)与[检查后指纹](records/environment-post-delivery-fixes-20261009/evidence/formal-postcheck.json)确认图库及非协议数据保持。T1～T9的137／776与其ASTRA复核已收进[历史记录](../archive/records/)和[历史审核](../archive/reviews/)，各自只证明原基线。

## 目录与后续工作

| 目录 | 用途 |
| --- | --- |
| `architecture/`、`subsystems/` | 当前架构及8份功能规则 |
| `reference/` | 实现对应、配置和必要参考 |
| [plans/](plans/README.md) | 图片／搜索合同已执行，保留固定路径供本批交付复核；E1～E5及交付后修复已关闭 |
| [records/](records/README.md) | 最近交付、过程、最终日志及目录整理 |
| [reviews/](reviews/README.md) | 本批独立报告、探针和原始证据 |
| [../archive/](../archive/README.md) | 已完成计划、被替代交付、旧审核和早期红绿日志 |
| [runtime/archive/](../../runtime/archive/README.md) | 本地完整回退资料与历史测试产物，默认不送审／入Git |

按[目录原则](../DIRECTORY_POLICY.md)维护功能规则，按任务收纳过程，关闭后归档合同并更新导航。此次移动见[E阶段迁移清单](records/environment-async-20261009/evidence/document-moves.json)。历史日志和JSON保持产生时内容。

## 验证与送审范围

本地browser provider已接入，正式搜索关闭；Bing公开候选和正文读取已通过工程验收，实际模型续调用质量未验证；记忆 `semantic=null`，纯语义标定未启用。真实QQ持续收发、供应商模型质量、新图在线描述及数月运行未由本批验证。环境准备有同步冻结／提交成本，合成样本不证明所有查询恒定时间。

审代码时另提供 `src/`、`tests/`、`scripts/`、包和锁文件、公开样例、`runtime/check.cjs`、`runtime/plugin-smoke*.cjs`和两个启动cmd。密钥、私有配置、正式库、人物背景及 `runtime/archive/`不属默认送审材料。旧复现按报告指定基线运行，不要求修复后的代码仍重现旧错误。
