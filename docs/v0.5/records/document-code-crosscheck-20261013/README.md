# 最新代码与 V0.5 文档核对

日期：2026-10-13。核对基线：`2eba393cc93b0915ef5b04ba4b3775a3211433ed`。状态：文档修订与独立复核完成。本轮只更新文档，覆盖总架构、8份子系统、3份参考和版本导航；历史计划、审核、交付、日志和原始JSON保持原含义。返回[版本索引](../../README.md)。

最新产品交付为[记忆重试与起床边界](../memory-retry-waking-20261013/DELIVERY.md)。它已经补充主要记忆／恢复规则，本轮发现跨章节的遗漏、旧交付指向和少量过宽表述，按实际源码修正如下。

## 修订及依据

| 修订 | 文档 | 源码／既有测试依据 |
| --- | --- | --- |
| 总览同步预约专用合同、程序消息检查、维护有限重试与持久历史；“最新交付”指向当前批次 | [总架构](../../architecture/REMAKE_V0.5.md)、[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | [个人合同](../../../../src/model/contracts.ts)、[维护执行](../../../../src/memory/maintenance.ts)、[Host](../../../../src/host/runtime.ts)、[插件装配](../../../../src/deployment/plugin-runtime.ts) |
| 600000／2从“待部署”改为已在2026-10-13部署写入；600秒覆盖一次准备的工具／修补续调用，不逐请求刷新；运行状态只引用记录时间 | [实现对应§5](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md#5-运行参数)、[模型参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | [配置默认](../../../../src/settings.ts)、[维护定时器](../../../../src/memory/maintenance.ts)、[公开部署摘要](../memory-retry-waking-20261013/evidence/deployment-summary.json) |
| 维护失败耗尽全局暂停、所属任务周期人工恢复、存储故障门禁与安全停止排空边界 | [调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md) | [Host](../../../../src/host/runtime.ts)、[维护](../../../../src/memory/maintenance.ts)、[现有回归](../../../../tests/memory-maintenance-retry-limit.test.ts) |
| 起床叙事和学校校验保留原睡眠事实，个人导演收到清除过期睡眠的候选；repairCount=2只描述已经耗尽修补的失败轮 | [导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md)、[上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md)、[调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md) | [App](../../../../src/app.ts)、[学校校验](../../../../src/school/contracts.ts)、[起床回归](../../../../tests/waking-school-notice.test.ts) |
| 到期消息复议不能独自提前启动共同节点，只随合法节点处理 | [共同活动](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | [共同节点选择](../../../../src/host/shared.ts)、[调度选择](../../../../src/host/scheduler.ts)、[现有回归](../../../../tests/shared-v3-scheduler.test.ts) |
| 记忆删除和终态载荷回收不删除不可变历史，也不保证整库旧正文消失；历史不受三个记忆池容量约束或自动注入新上下文 | [记忆](../../subsystems/REMAKE_V0.5_MEMORY.md)、[恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md)、[上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md)、[网页搜索](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md) | [历史存储／先归档后清理](../../../../src/model/run-history.ts)、[业务记忆清理](../../../../src/memory/store.ts)、[载荷回收](../../../../src/memory/payload-compaction.ts)、[历史回归](../../../../tests/model-run-history.test.ts) |
| 逐响应错误历史需注入ModelRunHistory；正式插件具备，当前图库CLI没有注入，但其网页checkpoint清理仍归档；入站资产引用与图库内嵌图片输入分别描述 | [恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md)、[表达／素材](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)、[模型参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | [ModelClient](../../../../src/model/client.ts)、[插件装配](../../../../src/deployment/plugin-runtime.ts)、[图库CLI](../../../../scripts/stickers.ts)、[素材描述](../../../../src/output/sticker-description.ts)、[网页存储](../../../../src/web/store.ts) |
| core用途明确为叙事／个人／基础记忆；无映射回退仅适用于backgroundFor使用方，正式表达只接批准style，维护与新周通知不另附作者背景 | [背景用途映射](../../reference/BACKGROUND_VIEW_MAPPING_20261008.md) | [背景选择](../../../../src/model/background-views.ts)、[App表达输入](../../../../src/app.ts)、[维护快照](../../../../src/memory/maintenance.ts)、[阶段视图](../../../../src/model/context-views.ts) |

其余主要规则已对照：导演权限与环境四阶段、个人预约合同、15秒合批／60秒共享时钟、普通四段与活动隔离、7／90／3／30记忆生命周期、检索门禁、网页20／40累计预算与材料引用、原图租约及观察复用。未因本轮核对改动这些代码或规则。

## 验证与范围

本轮验证全部V0.5 Markdown及项目／文档总入口的本地链接、标题锚点、变更范围和空白格式，并检查历史证据未修改。可从仓库根目录运行：

```powershell
node docs/v0.5/records/document-code-crosscheck-20261013/evidence/verify-docs.cjs
git diff --check 2eba393
```

根任务与独立复核均检查162份Markdown、1336个本地链接，错误0；非文档变更0、历史证据改写0，空白检查通过。独立复核另对新增重试／暂停、起床、历史留存、CLI记录器、图片引用和背景用途表述逐项对照源码及既有测试，未发现需继续修正的问题。

实际检查结果见[文档验证JSON](evidence/document-verification.json)。检查器沿用2026-10-11的实现，在本批新路径使用新基线输出，不覆盖旧结果；历史源码行号仍按原报告基线理解。本轮没有重跑产品测试、类型检查或构建；1491项通过、2项跳过仍是a4e781f实现交付的既有验收，不能称为本轮重跑。

未读取私有配置、密钥、背景正文或正式数据库，未进行模型／搜索调用、服务启停、部署或人工resume。当前配置说明引用已公开的旧白名单及本次实现交付的部署摘要，不推断本轮实际进程状态。没有新实施计划或目录迁移。
