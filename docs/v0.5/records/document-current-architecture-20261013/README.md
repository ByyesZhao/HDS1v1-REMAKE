# 当前架构文档与0.5.2代码核对

日期：2026-10-13（上海时间）。源码基线：`7138aadf80bd390bf51a24b0cd027327ee365ce2`；根插件、runtime包及两份锁文件均为0.5.2。开始时工作区干净，本地main与现有origin/main跟踪引用一致，未额外fetch。状态：**文档核对与更新完成**。返回[版本索引](../../README.md)／[记录索引](../README.md)。

用户要求：根据SOL已完成的关联记忆修复核对docs/v0.5；总架构和子系统架构只记录当前结构、实现，更新经过另记。本批仅更新文档和本目录核验材料，未修改产品代码、测试、配置、包版本或原历史证据。

## 1. 核对依据与发现

相对前轮文档提交`44cfdbd`，当前产品源码变化集中于memory/types、references、organize、lifecycle和model/contracts、prompts。T1～T3为`ac47cc6`、`56d657b`、`de597fe`，发布与部署记录为`f491050`、`7138aad`；这次只核验代码及已提交记录，没有执行部署。

核对采用当前架构全文阅读与源码差异复查：未变路径由Git差异确认延续上一轮已核对实现，重点独立检查新增权限、投影及恢复接点，并以本轮定向测试和直接源码探针核验。不将这种文档核对表述为全部产品源码的逐行代码审查。

三类权限分离、确认lookup的实际发送投影和discarded最终提交门禁都在源码中实现。原审核已由SOL交付关闭，详见[产品交付](../existing-long-reference-20261013/README.md)及[独立复核](../existing-long-reference-20261013/INDEPENDENT_REVIEW.md)。本批不是再次实施修复，也没有把修复前探针的失败断言改为当前验收。

发现并处理的文档问题：

| 问题 | 更新 |
| --- | --- |
| 总架构仍称705cccd为最近基线、记忆重试／起床批次为最新交付 | 架构去掉基线和交付经过；版本索引、实现对应统一指向7138aad／0.5.2及本批产品交付 |
| 新关联权限规则附在文末，记忆文档有两个第11节 | 权限归入记忆§2、上下文§5，恢复保留明确的§14并从提交边界交叉引用；去掉补丁版本标题 |
| 多份架构正文混有部署状态、旧配置核对日期、旧测试数字和修改经过 | 保留当前机制与仍适用的兼容规则；背景／配置快照放reference，过程与证据由本记录和既有记录索引承接 |
| 实现对应顶部仍以0.5.1批次说明“版本维持”，新模块只在追加节列出 | 更新当前基线／包版本；将references与organize接线纳入主映射，补三权限、四参数兼容及最终提交定位 |
| 版本入口积累多轮“最新／此前”长段 | 改为12份当前说明、最新交付和分类索引；原材料均可从records／reviews／plans继续追溯 |

## 2. 当前说明覆盖

| 说明 | 核对代码与主要结论 |
| --- | --- |
| [总架构](../../architecture/REMAKE_V0.5.md) | app、host/runtime、recovery及memory；补齐关联引用权限和最终提交门禁，职责与主流程保持 |
| [导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md) | directors、school/contracts、model/prompts；环境链、预约合同及原睡眠阅读边界保持 |
| [调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md) | host/scheduler、state、shared、reply-freshness；合批、优先级、睡眠、自主与安全停止保持 |
| [记忆](../../subsystems/REMAKE_V0.5_MEMORY.md) | references、organize、store、lifecycle、retrieval；关联preview不提前注入正文、不授awaken或新来源，生命周期规则保持 |
| [共同活动](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | host/shared、dialogue/activity-context、recovery；归属、公开确认与提交时序保持 |
| [上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md) | model/context-views、resource-pool、background-views及input-media/context；累计权限说明与独立校验集合对应，背景核心／风格路径明确 |
| [表达与素材](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | output、input-media、deployment/sticker-web-runtime；动作范围、图库与入站观察独立、租约／恢复保持 |
| [网页搜索](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md) | web/service、store、browser及settings；默认关闭／未配置，独立20／40、材料引用及终态收尾保持 |
| [恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md) | memory/organize、lifecycle、model/client、recovery；确认lookup归一化保存后调用模型，pending不预扩权；保存post结果仍经最终目标校验 |
| [实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 新模块、当前包版本、既有协议及测试入口；历史全量结果按原批次归属 |
| [模型与配置](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | settings、model/client、prompts、prompt-policy；连接和参数没有随本次权限修复变化，私有配置仅引有日期记录 |
| [背景映射](../../reference/BACKGROUND_VIEW_MAPPING_20261008.md) | settings.appConfig、backgroundFor、initializeMissingBackgroundFacts；批准用途和缺失事实初始化规则保持，未重新审批或读取人物正文 |

## 3. 从架构正文移出的信息去向

没有删除或重写原交付、计划、审核和日志；正文中的旧基线／部署经过／测试数字由对应材料继续保存：

- 文档核对经过：[705cccd复核](../document-code-recheck-20261013/README.md)、[2eba393核对](../document-code-crosscheck-20261013/README.md)及[记录索引](../README.md)。
- 权限修复与部署：[0.5.2交付](../existing-long-reference-20261013/README.md)；重试／起床、个人任务、停止等变更分别见[重试与起床交付](../memory-retry-waking-20261013/DELIVERY.md)、[任务合同交付](../personal-task-contract-20261011/DELIVERY.md)、[安全停止交付](../graceful-stop-r1-20261010/DELIVERY.md)。
- 配置／映射快照：[模型配置参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)、[背景映射参考](../../reference/BACKGROUND_VIEW_MAPPING_20261008.md)。它们标明证据日期，不能从文档推断当前进程状态。
- 素材迁移和查询偏差、网页公开验收、入站图片及资源生命周期：[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md#8-已有验证证据)、[搜索交付](../local-browser-search-20261009/DELIVERY.md)、[图片交付](../image-input-20261009/DELIVERY.md)、[综合整改](../comprehensive-remediation-20261011/DELIVERY.md)。
- 原窗口性能样本：[T1～T9复核](../../../archive/reviews/post-t1-t9-20261009/REVIEW.md)；检索评估及未执行的条件实验：[检索评估交付](../comprehensive-remediation-20261011/RETRIEVAL_EVALUATION.md)。不把旧样本表述成当前全链路性能重测。

旧持久结构、旧冻结结果和缺字段兼容仍是当前实现，继续保留在架构中；它们不是应删除的变更历史。

## 4. 本轮验证

- `npm run typecheck`：退出0，见[日志](logs/typecheck.txt)。
- 7文件79项定向回归：全部通过、无跳过，见[日志](logs/targeted-tests.txt)。覆盖三权限合同、真实HTTP／视觉包装、确认与pending lookup磁盘恢复、预算、post事务回滚、原create事件时间／进展、上下文传输和不可变历史。
- 直接src复现加`--expect-fixed`：退出0，bugReproduced=false；已提供short的preview关联通过，未提供ID仍被拒，未另建long且保留期／进展／唤醒不变，见[输出](logs/source-reproduction.txt)。
- 文档检查入口：[verify-docs.cjs](evidence/verify-docs.cjs)，报告：[document-verification.json](evidence/document-verification.json)。169份Markdown、1348个本地链接／锚点均通过；9份架构无重复编号或过程记录残留，当前包版本一致，Git变更限于文档，原历史证据未变，空白检查通过。

```powershell
npm.cmd run typecheck
npm.cmd test -- tests/memory-reference-permissions.test.ts tests/memory-existing-long-flow.test.ts tests/memory-existing-long-recovery.test.ts tests/memory-final-review.test.ts tests/review26-memory-create.test.ts tests/prompt-context-transport.test.ts tests/model-run-history.test.ts --maxWorkers=1
node docs/v0.5/reviews/existing-long-reference-20261013/evidence/reproduce-from-source.cjs --expect-fixed
node docs/v0.5/records/document-current-architecture-20261013/evidence/verify-docs.cjs
```

测试TEMP／TMP使用工作区`.tmp/document-current-architecture-20261013`，单worker；全部使用合成资料。本轮未全量重跑、未build覆盖lib、未部署或操作服务、未读正式库／私有配置、未执行供应商或QQ在线验收。0.5.2原226文件1530项及部署状态继续按SOL交付解释，不冒充本次重跑结果。
