# 综合整改后的当前文档核对

日期：2026-10-11。核对基线：`5b92794`，产品代码与`d0a9963`相同。状态：源码对应核对与文档更新完成。

本次核对`docs/v0.5`的现行总架构、8份子系统、3份参考和导航，逐项对照当前代码与相关测试定义；历史计划、审核、交付与原始JSON保留各自基线含义。当前运行状态不从旧部署记录推断。

范围为文档更新与本地Git提交；没有修改产品代码、私有配置或正式数据库，没有重跑模型、检索盲测、产品测试或部署。217文件1370项是此前综合整改的验收结果，见[交付](../comprehensive-remediation-20261011/DELIVERY.md)。

## 核对结论

现行说明的主体机制与代码对应，但上轮整改后仍有版本、规则范围和导航状态遗漏。本轮更新11份现行说明及4份索引；上下文说明核对后无需修改。未改动旧计划、审核正文、交付报告和原始验收数据，也没有把历史失败探针改写为通过。

| 发现与更新 | 说明入口 | 主要依据 |
| --- | --- | --- |
| 审核索引仍称5项代码问题尚未修复，部分入口仍将65f0785及更早交付称为最新；改为整改已关闭，区分本轮文档核对与历史验收 | [版本入口](../../README.md)、[审核入口](../../reviews/README.md)、[总架构](../../architecture/REMAKE_V0.5.md) | [整改交付](../comprehensive-remediation-20261011/DELIVERY.md)、[关闭矩阵](../comprehensive-remediation-20261011/evidence/closure-matrix.json)、[最终复核](../comprehensive-remediation-20261011/reviews/FINAL.md)与[Q3复核](../comprehensive-remediation-20261011/reviews/Q3.md) |
| 暂停保护不仅覆盖普通候选，还覆盖全部新轮选择及等待轮普通续办／事件接管；已进入故事的整轮继续完成 | [调度§1](../../subsystems/REMAKE_V0.5_SCHEDULING.md#1-调度中枢)、[恢复§2](../../subsystems/REMAKE_V0.5_RECOVERY.md#2-错误类型与暂停) | `src/host/runtime.ts:66`、`:80`；`tests/host-pause-selection.test.ts` |
| 补齐pending工作集复用、写后失效及未来预约范围；改期按冻结turn.at判断。旧轮“不重新生成”的说法过宽，收窄到已有发送尝试或已完成输出 | [调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md)、[导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md) | `src/host/scheduler.ts:17`、`src/host/task-projection.ts:14`、`src/app.ts:74`、`src/environment/snapshot.ts:32`；`tests/scheduler-task-workset.test.ts`、`tests/appointment-update-host.test.ts` |
| 区分终态步骤保留的身份／时间与terminalAudit摘要，补无结果null、事务回滚、旧v0正文保留及不扫历史；网页收尾须等原执行退出，错误交回Host | [恢复§6](../../subsystems/REMAKE_V0.5_RECOVERY.md#6-环境步骤恢复) | `src/environment/payload-compaction.ts:7`、`src/environment/preparation.ts:42`、`:57`、`:181`、`src/environment/runtime.ts:29`；`tests/environment-payload-compaction.test.ts`、`tests/environment-web-finalization.test.ts` |
| 正文提取器参考仍为dom-v2，改为dom-v3；补纯文本边界、独立图库CLI、轻量元数据读取、材料引用持久化及维护参数范围 | [网页搜索](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md)、[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md)、[模型调用参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | `src/web/browser/extract.ts`、`src/web/content.ts`、`src/web/store.ts`、`src/deployment/sticker-web-runtime.ts`、`scripts/compact-memory-payloads.ts`；`tests/web-light-state.test.ts`、`tests/web-persistence-v2.test.ts` |
| 补充一次图片观察的资产租约，覆盖续调用、修补与等待，最后释放时清除内存字节／编码；冻结观察与pending缓存读取边界保持 | [表达与素材](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | `src/input-media/assets.ts`、`src/input-media/service.ts`；[W6复核](../comprehensive-remediation-20261011/reviews/W6.md) |
| “已标定词法”容易被理解为质量已达标，改成当前词法阈值；补Q1/Q2 keep_current、Q3离线工具与真实质量／启用的区别 | [记忆§6](../../subsystems/REMAKE_V0.5_MEMORY.md#6-相关检索与上下文) | `src/memory/retrieval.ts:15`、`scripts/evaluate-memory-retrieval.ts:44`、`scripts/prepare-memory-retrieval-vectors.ts:23`；[既有检索评估](../comprehensive-remediation-20261011/RETRIEVAL_EVALUATION.md) |
| `【推进】`控制必须无图片／表情附件且trim后全文匹配；带附件或夹有其他文字仍按消息接收 | [共同活动§2](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md#2-动作与纠正) | `src/host/input.ts:34`；`tests/incoming-media-entry.test.ts:16` |
| 配置与部署断言补原核对日期；当前代码能力与此前私有配置记录分开，不用旧停止记录推断当前进程状态 | [模型调用参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)、[背景映射参考](../../reference/BACKGROUND_VIEW_MAPPING_20261008.md)及相关说明 | [此前配置白名单](../document-current-sync-20261011/evidence/effective-models.json)、[此前部署指纹](../comprehensive-remediation-20261011/evidence/deployment-postcheck.json) |

`memory:compact-payloads`有两项独立范围：默认可清已确认终态owner的网页checkpoint，包括环境owner；`--include-environment`额外控制准备版本1终态环境步骤的三份恢复正文及摘要。该参数并非清环境网页checkpoint的必要条件，工具不据年龄或asset类型推断终态。

## 覆盖与保留

12份现行说明包括总架构、导演、调度、记忆、上下文、共同活动、表达／素材、网页搜索、恢复，以及实现对应、模型调用、背景映射3份参考。逐份阅读说明并对照相关源码和测试断言，测试源码阅读不计为本轮测试执行。

已核对且无需调整的主要规则包括：导演可见权限和调用顺序、学校安排／通知获知、普通四段与活动隔离、上下文资料去重、记忆生命周期和容量、批量唤醒排序、查询向量门禁与环境冻结向量、共同活动时钟及收尾、逐项发送确认和后处理恢复。对应[上下文说明](../../subsystems/REMAKE_V0.5_CONTEXT.md)整份保留。

历史计划、评审、记录用于解释原基线，不要求全部改成当前产品说明；现行入口已接上最新交付。本轮不搬迁这些目录。配置白名单和部署hash仅保留原检查时间含义，没有重新读取私有配置、背景正文、正式DB或当前进程。

## 本轮验证

全目录136份Markdown共1017处内联本地链接及其标题锚点检查通过，缺失目标／锚点为0；变更限定在`docs/v0.5`，历史计划／审核／交付正文及证据变更为0，`git diff --check`通过。新记录列出的完整源码路径及行号也已检查存在性。明细和文档指纹见[evidence/document-verification.json](evidence/document-verification.json)。该检查覆盖历史文档的导航可达性，不代表重做历史验收。

本轮未执行产品测试、构建、部署、模型调用或线上搜索，没有启动、停止或重启HDSI。以前的217文件1370项、合成性能样本与部署检查仍由原交付提供证据。本轮结论是现行文档已按所核对源码修订，不新增QQ并发、模型质量或长期运行保证。
