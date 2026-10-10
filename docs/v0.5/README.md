# HDSI V0.5：当前文档与审核入口

核对日期：2026-10-10。新增[安全停止](records/graceful-stop-20261010/DELIVERY.md)：stop-hdsi.cmd等待当前整轮及后台阶段保存，187文件1004项及独立审查补修通过，正式部署状态见交付。最新普通回复跟进新消息 T1～T5已实现；184文件990项、类型、构建、演示、双场景插件和隔离只读启动检查通过，见[交付](records/chat-reply-freshness-20261010/DELIVERY.md)。独立复核与部署状态以交付页为准，此前普通回复批已停服部署，服务未由程序启动；此前查看资格正式修正保留原证据。

最新[交付后复核](reviews/freshness-graceful-stop-20261010/REVIEW.md)以086cd07为基线：普通回复新鲜度可接受；安全停止另有1项P2待修（浏览器关闭失败被吞掉，仍报告成功并退出），附[修复执行方案](reviews/freshness-graceful-stop-20261010/FIX_PLAN.md)。既有1004项均有通过记录，新增组合探针复现该覆盖缺口；本次没有修改产品或操作正式服务。

前次[文档核对](records/document-final-audit-20261010/README.md)和[图片／搜索修复交付](records/image-search-post-review-fixes-20261010/DELIVERY.md)保留原基线、原证据及未执行范围，不以本批覆盖历史结论。

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

各模型用途及当前搜索配置见[模型调用与网页搜索参考](reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)。[前次配置白名单](records/document-final-audit-20261010/evidence/effective-models.json)确认13个已配置连接均Flash，10个low／3个high；用户图观察未单独覆盖，复用Flash/high。随后按用户要求[打开新图识别和Bing搜索](records/feature-enablement-20261010/README.md)，搜索provider为browser，Koishi已配置Puppeteer。模型参数保持不变；已配置启用不等于服务已经启动或真实在线质量已验收。

## 最新交付与审核

| 材料 | 状态 |
| --- | --- |
| [新鲜度／安全停止交付后复核](reviews/freshness-graceful-stop-20261010/REVIEW.md)及[修复执行方案](reviews/freshness-graceful-stop-20261010/FIX_PLAN.md) | 新鲜度未发现需修复问题；安全停止R1为P2待修，真实HTTP与离线页面槽组合探针确认错误成功退出；既有187文件1004项经分次复验通过 |
| [普通回复新鲜度方案审核](reviews/chat-reply-freshness-20261010/REVIEW.md)与[细化执行方案](reviews/chat-reply-freshness-20261010/EXECUTION_PLAN.md) | 保留方案 B，补齐等待／事件接管、业务代际、图片冻结、资格重选 4 项合同；原基线8文件35项为方案审核证据；T1～T5现已实现，最新990项及部署边界见[交付](records/chat-reply-freshness-20261010/DELIVERY.md) |
| [回复错位诊断](records/chat-reply-order-20261010/README.md)与[改动方案](plans/chat-reply-freshness-20261010/README.md) | 15秒合批符合本次记录；新消息在生成期间另轮排队，旧候选仍发送；正式只读时间线及4组合成探针，未改产品／服务 |
| [查看消息资格交付](records/phone-access-20261010/DELIVERY.md)及[独立复核关闭](records/phone-access-20261010/REVIEW_CLOSURE.md) | 新规则已实施，合同／协议2／磁盘恢复及停服修复工具有回归；最终测试与正式部署状态见交付页 |
| [查看消息资格计划审核](reviews/phone-access-20261010/PLAN_REVIEW.md) | 设计可继续，无阻断问题；1处非阻断验收措辞澄清，审核时既有定向回归5文件／23项通过；新规则现已实施，见交付记录 |
| [首次QQ连接排查](records/onebot-connection-20261010/README.md) | 连接方向已修正；用户重启后确认管理命令回复，四阶段环境任务已提交；普通聊天、图片与实际搜索仍待真实触发 |
| [图片／搜索正式配置启用](records/feature-enablement-20261010/README.md) | 两项开关打开、browser／Bing与Puppeteer就绪配置；只读启动检查通过，仍由用户手动启动／重启 |
| [最新文档核对](records/document-final-audit-20261010/README.md) | 总架构、8份子系统、实现对应、模型参考与导航按当前代码同步；本地链接／章节检查，配置白名单重新核对 |
| [图片／搜索修复交付](records/image-search-post-review-fixes-20261010/DELIVERY.md) | R1～R5与失败回归；dom-v2；175文件920项、类型/构建/demo/双场景smoke通过；一次独立审查补修完成（原报告与TDD关闭分别保留） |
| [图片／搜索交付后复核](reviews/image-search-post-implementation-20261010/REVIEW.md)及[修复执行方案](reviews/image-search-post-implementation-20261010/FIX_PLAN.md) | 基线2a2e77e；4 P2／1 P3已修，关闭与新证据见[交付](records/image-search-post-review-fixes-20261010/DELIVERY.md)；含真实App／Chrome／Koishi离线复现；主体架构保留 |
| [图片输入交付](records/image-input-20261009/DELIVERY.md) | I1～I6、权限历史观察、冻结恢复、原图清理与显式只读检查；真实图片模型质量未执行 |
| [本地浏览器搜索交付](records/local-browser-search-20261009/DELIVERY.md) | S1～S5、页槽排空、DOM提取、原工具计数与服务生命周期；Bing公开完整验收通过，DuckDuckGo验证码失败保留 |
| [此前文档与模型连接核对](records/document-model-audit-20261009/README.md) | 2026-10-09基线的静态记录；当前配置及文档以本次核对为准 |
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

最新实施合同：[普通聊天回复跟进新消息](plans/chat-reply-freshness-20261010/README.md)及[细化方案 T1～T5](reviews/chat-reply-freshness-20261010/EXECUTION_PLAN.md)。新规则已实现；原诊断和审核探针保留旧基线，工程交付、独立复核及部署状态见[记录](records/chat-reply-freshness-20261010/README.md)。

最新实施合同：[查看消息资格与专注场景](plans/phone-access-20261010/README.md)。针对首次聊天中普通文献整理被设为无结束时间不可读状态的问题，已区分查看资格与回应意愿，并强制不可读活动指定结束时间；代码及正式停服修正已完成，实际状态和未验证范围见[交付](records/phone-access-20261010/DELIVERY.md)。

现已完成[计划审核](reviews/phone-access-20261010/PLAN_REVIEW.md)：保留设计，调整恢复验收措辞后按原任务执行。

| 目录 | 用途 |
| --- | --- |
| `architecture/`、`subsystems/` | 当前架构及8份功能规则 |
| `reference/` | 实现对应、配置和必要参考 |
| [plans/](plans/README.md) | 图片／搜索合同已执行，保留固定路径供本批交付复核；E1～E5及交付后修复已关闭 |
| [records/](records/README.md) | 最近交付、过程、最终日志及目录整理 |
| [reviews/](reviews/README.md) | 本批独立报告、探针和原始证据 |
| [../archive/](../archive/README.md) | 已完成计划、被替代交付、旧审核和早期红绿日志 |
| [runtime/archive/](../../runtime/archive/README.md) | 本地完整回退资料与历史测试产物，默认不送审／入Git |

按[目录原则](../DIRECTORY_POLICY.md)维护功能规则，按任务收纳过程，关闭后归档合同并更新导航。此前移动见[E阶段迁移清单](records/environment-async-20261009/evidence/document-moves.json)；本次没有移动目录或改写原始证据。历史日志和JSON保持产生时内容。

## 验证与送审范围

本地browser provider已接入，正式配置已启用Bing搜索和新图识别，等待用户启动／重启后使用；Bing公开候选和正文读取已通过此前工程验收，实际模型续调用质量未验证；记忆 `semantic=null`，纯语义标定未启用。真实QQ持续收发、供应商模型质量、新图在线描述及数月运行未由本批验证。环境准备有同步冻结／提交成本，合成样本不证明所有查询恒定时间。

审代码时另提供 `src/`、`tests/`、`scripts/`、包和锁文件、公开样例、`runtime/check.cjs`、`runtime/plugin-smoke*.cjs`和两个启动cmd。密钥、私有配置、正式库、人物背景及 `runtime/archive/`不属默认送审材料。旧复现按报告指定基线运行，不要求修复后的代码仍重现旧错误。
