# HDSI V0.5：当前文档与审核入口

当前代码基线为`7138aad`，包版本0.5.2。V0.5是文档体系版本，数据库协议各自独立；版本对应见[实现清单](reference/V0.5_IMPLEMENTATION_MAP_20261009.md#3-版本不能混同)。本次[文档核对](records/document-current-architecture-20261013/README.md)覆盖总架构、8份子系统和3份参考。

总架构和子系统只描述当前结构、规则、实现及仍适用的兼容行为。新增能力直接融入所属章节，不在文末累积版本补丁、部署过程或历次测试数字；更新经过、代码基线和验证证据放在records／reviews，原计划保留其编写时含义。

## 当前说明与阅读顺序

| 顺序 | 材料 | 内容 |
| --- | --- | --- |
| 1 | [总架构](architecture/REMAKE_V0.5.md) | 系统职责、关系和故事主流程 |
| 2 | [导演与环境](subsystems/REMAKE_V0.5_DIRECTORS.md) | 环境链、叙事／个人分工及角色获知 |
| 3 | [调度与生活状态](subsystems/REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、三槽、预约、睡眠与概率 |
| 4 | [记忆与固定信息](subsystems/REMAKE_V0.5_MEMORY.md) | 来源、三类操作权限、生命周期、检索和容量 |
| 5 | [共同活动](subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开、动作、代写、时钟、收尾及活动归属 |
| 6 | [提示与上下文](subsystems/REMAKE_V0.5_CONTEXT.md) | 可见范围、原文窗口、资料池及权限投影 |
| 7 | [表达与表情素材](subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图保真、分段、图库及用户图片 |
| 8 | [网页搜索](subsystems/REMAKE_V0.5_WEB_SEARCH.md) | provider、20／40、缓存、本人查阅及恢复 |
| 9 | [报错与恢复](subsystems/REMAKE_V0.5_RECOVERY.md) | 修补、暂停、提交、补查／保存结果恢复与安全停止 |
| 10 | [实现对应](reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 源码、协议版本、参数和验证边界 |
| 11 | [模型调用与搜索配置](reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | 连接键、用途、默认值及有日期的部署配置证据 |
| 12 | [背景用途映射](reference/BACKGROUND_VIEW_MAPPING_20261008.md) | 批准映射、加载及缺失事实初始化规则 |

## 最新交付与审核

| 材料 | 状态与范围 |
| --- | --- |
| [当前架构文档核对](records/document-current-architecture-20261013/README.md) | 7138aad基线；整合关联记忆权限和恢复规则，分离现行说明与变更记录；类型检查、7文件79项定向回归及源码修复探针通过 |
| [existingLongId修复与0.5.2交付](records/existing-long-reference-20261013/README.md) | 三类引用权限、确认lookup投影和discarded提交门禁已实现；该批完整验收226文件1530项通过、2项既有跳过；部署及最终停止事实见原记录 |
| [该批独立代码复核](records/existing-long-reference-20261013/INDEPENDENT_REVIEW.md) | 无发现；原计划审核R1～R3的关闭证据在交付中逐项列明 |
| [原计划](plans/existing-long-reference-20261013/README.md)与[原审核／实施细节](reviews/existing-long-reference-20261013/REVIEW.md) | 保留修复前基线、原证据及设计过程，不把其中“待实施”解释为当前代码状态 |

此前的记忆重试／起床边界、个人任务合同、综合整改、回复新鲜度、图片／搜索及环境交付均从[记录索引](records/README.md)追溯。历次文档复核也在该索引保留，不叠加为当前架构正文。各批验收数字只表示其原基线，本次定向核对不代替0.5.2完整验收，也不判断当前服务是否运行。

## 目录与后续工作

| 目录 | 用途 |
| --- | --- |
| architecture／subsystems | 当前总架构及8份子系统规则 |
| reference | 实现定位、配置含义、兼容和验证边界 |
| [plans](plans/README.md) | 实施合同、待执行工作；已完成合同以索引中的交付状态为准 |
| [records](records/README.md) | 交付、文档修订、部署及实际验证过程 |
| [reviews](reviews/README.md) | 审核结论、关闭映射和原始探针 |
| [docs/archive](../archive/README.md) | 历史架构、被替代计划、审核与日志 |
| [runtime/archive](../../runtime/archive/README.md) | 本地完整回退资料及历史测试产物，默认不送审／入Git |

按[目录原则](../DIRECTORY_POLICY.md)维护。原计划、审核、日志和JSON保留产生时内容；当前规则更新后，以记录说明变更及验证范围。记忆检索的条件在线实验等独立后续工作继续以[计划索引](plans/README.md)为准，不能随母任务完成一起标为已验证。

## 验证与送审范围

默认提供整个docs/v0.5，从本页阅读；审代码时同时提供src、tests、scripts、包和锁文件、公开样例、runtime/check.cjs、runtime/plugin-smoke*.cjs及启动／停止cmd。原缺陷探针按报告指定基线运行，修复后的验收按交付命令运行。

源码默认值与有日期的私有配置摘要分开解释。本轮未读取密钥、私有配置、人物正文或正式库，也未启动、停止、部署或调用在线模型／QQ；历史部署和在线验证以各自记录为准。供应商质量、真实视觉效果、长期收发及性能上限不能仅由离线回归推定。
