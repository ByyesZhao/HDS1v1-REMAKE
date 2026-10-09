# HDSI V0.5：文档入口与审核清单

核对日期：2026-10-09，源码基线43213cf。当前架构以实际代码为准，本轮只重写文档。过去累计核对记录完整保存在[历史快照](DOCUMENT_AUDIT_PRE_V0.5_20261009.md)，其旧数字／行为不当当前验收。

## 1. 当前说明文档

建议阅读顺序：

| 顺序 | 材料 | 审核重点 |
| --- | --- | --- |
| 1 | [总架构](../REMAKE_V0.5.md) | 系统边界、主流程、程序／模型职责 |
| 2 | [导演与环境](../REMAKE_V0.5_DIRECTORS.md) | 学期／科研／周展开、客观与知情 |
| 3 | [调度与生活状态](../REMAKE_V0.5_SCHEDULING.md) | 合批、优先级、自主、预约、睡眠和概率 |
| 4 | [记忆](../REMAKE_V0.5_MEMORY.md) | 来源、7／90／3／30、容量、归档及15分钟 |
| 5 | [共同活动](../REMAKE_V0.5_SHARED_ACTIVITY.md) | 公开／动作、代写资格、时钟、收尾与原文 |
| 6 | [提示与上下文](../REMAKE_V0.5_CONTEXT.md) | 背景用途、未读权限、四段、单池和分支 |
| 7 | [表达与表情](../REMAKE_V0.5_EXPRESSION_STICKERS.md) | 意图保真、分段、概率与文本向量 |
| 8 | [网页搜索](../REMAKE_V0.5_WEB_SEARCH.md) | 未装配状态、独立额度、缓存B和本人查阅 |
| 9 | [报错与恢复](../REMAKE_V0.5_RECOVERY.md) | 修补、冻结发送、确认／正式提交及不同恢复 |
| 10 | [实现对应与现状](V0.5_IMPLEMENTATION_MAP_20261009.md) | 代码、配置、协议版本、差异与验收边界 |

以上10份是本轮新的完整说明，不需再以旧V0.2作为未改行为拼图。部署另读[README](../README.md)，文档更替过程读[修订日志](V0.5_DOCUMENT_REWRITE_LOG_20261009.md)。

## 2. 实现细化与历史

实现审查按主题补阅：

| 主题 | 细化／执行计划 |
| --- | --- |
| 记忆生命周期 | [细化](MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[计划](MEMORY_V0.3_EXECUTION_PLAN_20261007.md) |
| 容量／空闲整理 | [细化](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md)、[计划](MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md) |
| 共同活动 | [细化](SHARED_ACTIVITY_V0.3_IMPLEMENTATION_20261007.md)、[计划](SHARED_ACTIVITY_V0.3_EXECUTION_PLAN_20261007.md) |
| 世界与学校 | [细化](WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)、[计划](WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md) |
| 搜索 | [设计细化](WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)、[计划](WEB_SEARCH_EXECUTION_PLAN_20261007.md) |
| 最新普通／活动上下文 | [细化§13～14](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[计划任务13～20](PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md) |

旧完成任务和测试数字描述当时实现，不代表最终跨批全量。若主题旧文与V0.5现状不同，对照最新代码及后续修复记录，不任意选旧规则。总文档号0.5不改数据和npm包的内部版本。

旧REMAKE_V0.2六份加历史标识，内容不删；DSH-review中的快照／旧zip不更新，不在本轮重新打包。

## 3. 证据与限制

最近实际交付为105文件588项、typecheck/build、demo和两cmd --check通过；正式窗口2备份升级与只读检查通过。见[验收](PROMPT_CONTEXT_OPTIMIZATION_V0.1_DELIVERY_REVIEW_20261008.md)、[日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。这不是本轮Markdown整理重新跑出来的数字。

最新活动上下文两场隔离真实模型合计35次HTTP，Embedding0；不能当数月稳定或语义检索标定。搜索供应商未装配、semantic=null、新图描述未在线验收、真实QQ持续收发待用户运行后核对。服务不因文档整理启动。

## 4. 给DSH的审核说明

请以V0.5说明及实际代码为准，检查跨文档一致性、正常功能遗漏、程序与模型判断边界、信息资格和来源、模拟与现实、候选与公开确认、正式提交与恢复，以及尚未启用／未验收能力是否如实标记。

若审核代码，同时提供src/、tests/、scripts/、runtime/check.cjs和两个cmd。纯文档只能核对描述，不能证明程序正确。人物风格需要审查时由用户另行决定提供背景，不把key.txt、私有配置或正式故事库混进普通审核材料。

本轮未新增防御编程、供应商推荐、多进程或语义审核模型；请区分明确矛盾、现有限制和可选新需求，不把用户的初步概括当已实施合同。
