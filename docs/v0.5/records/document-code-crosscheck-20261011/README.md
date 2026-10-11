# 当前代码与 V0.5 文档交叉核对

日期：2026-10-11。核对基线：`9f3c73f8965d649e8b60a5a340314a7e490b1a2b`，产品代码与`d0a9963`相同。状态：文档修订完成。返回[版本入口](../../README.md)。

本轮在[上一轮文档同步](../document-post-remediation-sync-20261011/README.md)后，重新对照总架构、8份子系统、3份参考与相关源码／测试，保留历史计划、报告、日志及原始JSON的基线含义。项目是TypeScript／Koishi单角色QQ生活模拟：前台故事轮串行生成、发送和提交，环境与记忆各有后台准备槽；SQLite保存故事、授权消息、记忆和恢复状态。模型负责语义内容，Host与合同负责资格、时钟、来源、保存和恢复。

## 修订与依据

| 修订 | 当前说明 | 源码／既有测试依据 |
| --- | --- | --- |
| 公开开始确认先启用活动路由，首节点须等开场轮提交；结束轮提交后才转遗留输入，并从完成／输入／既有开放批的最新锚点重等15秒 | [总架构§5](../../architecture/REMAKE_V0.5.md#5-时间与优先级)、[共同活动§1／§7](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md)、[恢复§5](../../subsystems/REMAKE_V0.5_RECOVERY.md#5-共同活动的过渡) | `src/host/shared.ts`、`src/host/scheduler.ts`、`src/recovery.ts`；`tests/shared-v3-flow.test.ts` |
| 总架构补全`【推进】`须无图片／表情附件且去首尾空白后全文匹配，仍遵守未完成轮门禁 | [总架构§5](../../architecture/REMAKE_V0.5.md#5-时间与优先级) | `src/host/input.ts`；`tests/incoming-media-entry.test.ts` |
| 入站图片在线验收的300秒是整次观察准备共用超时，格式修补不重置；区别于其他验收的逐请求时限 | [模型参考§3](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md#3-显式工具与在线验收入口)、[实现对应§5](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md#5-运行参数) | `scripts/validate-incoming-media.ts`、`src/model/client.ts` |
| 记忆／上下文中的映射、Bing启用及语义标定状态明确为前次配置核对；根README避免把当前词法阈值写成质量已达标 | [记忆](../../subsystems/REMAKE_V0.5_MEMORY.md)、[上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md)、[项目README](../../../../README.md) | `src/model/background-views.ts`、`src/memory/retrieval.ts`、`src/deployment/memory-runtime.ts`及[既有检索评估](../comprehensive-remediation-20261011/RETRIEVAL_EVALUATION.md) |
| 文档总入口和计划索引不再把图片／搜索复核写成尚待关闭；新增本轮记录导航 | [文档入口](../../../README.md)、[计划入口](../../plans/README.md)、[版本入口](../../README.md) | [原批修复关闭](../image-search-post-review-fixes-20261010/REVIEW_CLOSURE.md) |

导演与环境、调度、网页搜索、表达／图库和背景映射参考核对后无需修改。已复核的主要规则包括：模型连接与默认值、导演权限及环境四阶段、暂停／停止门禁、回复新鲜度、普通四段与活动隔离、7／90／3／30记忆周期及容量、语义查询门禁、网页20／40与缓存B、dom-v3提取、v2材料引用及图片租约恢复。

## 本轮验证与边界

- `npm run typecheck`通过。
- 既有定向测试4文件35项通过、失败0、跳过0：`shared-v3-flow` 17项、`incoming-media-entry` 2项、`background-stage-views` 3项、`model-settings` 13项，命令与结果摘要见[evidence/validation-results.json](evidence/validation-results.json)。
- 首次测试在沙箱默认临时目录遇到Vitest转换缓存`ENOENT`：1文件17项通过，另外3文件加载失败。仅将`TEMP`／`TMP`设为工作区`.tmp/document-code-crosscheck-20261011`后，同组测试全部通过；未修改产品代码或测试。
- 文档本地链接／标题锚点、历史证据保持和变更范围由[evidence/verify-docs.cjs](evidence/verify-docs.cjs)检查，结果见[evidence/document-verification.json](evidence/document-verification.json)；`git diff --check`通过。

从仓库根目录复跑定向测试：

```powershell
$auditTemp = Join-Path (Get-Location) '.tmp/document-code-crosscheck-20261011'
New-Item -ItemType Directory -Path $auditTemp -Force | Out-Null
$env:TEMP = $auditTemp
$env:TMP = $auditTemp
node node_modules/vitest/vitest.mjs run tests/shared-v3-flow.test.ts tests/incoming-media-entry.test.ts tests/background-stage-views.test.ts tests/model-settings.test.ts
node docs/v0.5/records/document-code-crosscheck-20261011/evidence/verify-docs.cjs
```

本轮未执行全量测试、构建、部署、在线模型／搜索或服务启停，未读取私有配置、密钥、人物正文或正式数据库。217文件1370项仍是[此前综合整改](../comprehensive-remediation-20261011/DELIVERY.md)的验收结果，本轮不新增在线质量或长期运行结论。
