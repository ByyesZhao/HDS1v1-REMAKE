# V0.5 文档与最新代码复核

日期：2026-10-13。基线：`705cccd22bc09b9b0e9b7e733d3120267437fc2a`；开始核对时本地工作区干净，`git ls-remote origin refs/heads/main`确认远端main为同一提交。状态：文档修订、验证及独立复核完成。返回[版本索引](../../README.md)。

## 项目结构与核对范围

当前运行包为0.5.1，V0.5是文档版本。系统是单角色、一对一QQ生活模拟：Koishi插件接收目标私聊，SerialHost串行调度故事轮，App协调叙事、个人决策、表达、冻结发送与基础记忆提交。环境四阶段和记忆准备可在后台等待，业务提交仍在串行边界核对；SQLite保存正式状态及恢复进度，ModelClient统一合同修补、工具续调用与历史取证。模型任务并非独立常驻服务。

本轮按调度／导演／共同活动、记忆／恢复／上下文、搜索／表达／模型连接三个领域并行对照源码及现有测试，覆盖总架构、8份子系统、3份参考。入口与运维命令另与包脚本及装配代码交叉检查。主要机制、版本和默认数字对应，没有需要改产品实现的结论；修订集中于以下边界。

## 修订与源码依据

| 修订 | 文档 | 实现依据 |
| --- | --- | --- |
| 维护失败阈值是配置重试数加1，默认第三次，设0则首败暂停 | 总架构、记忆、恢复、实现对应 | [配置Schema](../../../../src/settings.ts)、[MemoryMaintenance.fail](../../../../src/memory/maintenance.ts)、[零重试回归](../../../../tests/memory-maintenance-retry-limit.test.ts) |
| 三个容量数量上限及归档年龄可设null；不取消长期自身有效期或引用保护 | 记忆 | [容量配置](../../../../src/settings.ts)、[容量归一](../../../../src/memory/capacity.ts)、[清理条件](../../../../src/memory/cleanup.ts) |
| 每轮基础记忆输入包含核心背景 | 上下文 | [organizeMemory](../../../../src/memory/organize.ts)、[appConfig](../../../../src/settings.ts) |
| 睡眠限制新轮选择；已开始轮按冻结时刻、普通候选换代及恢复合同续办 | 调度 | [foreground／autonomousEligible](../../../../src/host/scheduler.ts)、[App生成与恢复入口](../../../../src/app.ts)、[冻结发送](../../../../src/recovery.ts) |
| 新搜索跳过同阶段已读候选；全已读且无新正文会计no_candidates失败。预算未耗尽时显式重读复用材料，已确认操作重放不重复计数 | 网页搜索 | [WebSearchService.execute](../../../../src/web/service.ts)、[既有搜索回归](../../../../tests/web-session.test.ts) |
| 区分格式修补、上层任务重试与传输错误；没有传输层自动HTTP重试或统一模型请求时限，后台／页面／验收超时各有作用域 | 模型调用参考 | [ModelClient及ChatCompletionsTransport](../../../../src/model/client.ts)、[后台计时](../../../../src/memory/maintenance.ts)、[插件装配](../../../../src/deployment/plugin-runtime.ts) |
| 运维README补清理前checkpoint归档，避免把载荷回收理解为整库旧输入消失 | 项目README | [载荷回收](../../../../src/memory/payload-compaction.ts)、[网页存储](../../../../src/web/store.ts)、[不可变历史](../../../../src/model/run-history.ts) |

导演、共同活动、表达／素材、背景映射四份也已核对，未发现需要修订的实质偏差，保持原文。背景映射仅核对加载和用途选择代码，未读取私有人物正文。历史计划、交付、审核、失败日志和既有JSON均保留原基线；[前轮文档核对](../document-code-crosscheck-20261013/README.md)仍独立有效。

## 本轮验证

- 类型检查通过，见[原始输出](logs/typecheck.txt)。
- 主任务运行5文件57项既有定向测试，全部通过，见[原始输出](logs/targeted-tests.txt)：web-session、web-model-tools、model-run-history、model-settings、scheduler。
- 记忆领域复核者另运行4文件53项既有测试通过：memory-maintenance-retry-limit、background-stage-views、memory-capacity-cleanup、prompt-context-views。首次执行有3组因沙箱临时目录ENOENT加载失败；将TEMP/TMP指向工作区并使用单worker后通过。这组结果来自本轮工具输出，未另存原始日志。
- 全部V0.5 Markdown、项目／文档总入口共163份Markdown、1370个本地链接及标题锚点检查通过，错误0、非文档变更0、历史证据修改0，空白检查通过，见[文档验证](evidence/document-verification.json)。

独立审查逐项对照新增规则与源码，并复核最终记录和验证范围，未发现阻断问题。两项措辞建议已落实：显式网页重读补充额度尚未耗尽的前提；模型参考区分前轮静态核对与本轮定向测试，避免混用基线。

从仓库根目录复验：

```powershell
node docs/v0.5/records/document-code-recheck-20261013/evidence/verify-docs.cjs
npm run typecheck
$env:TEMP = 'D:\HDSI-remake\.tmp\document-code-recheck-20261013'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
npm test -- tests/web-session.test.ts tests/web-model-tools.test.ts tests/model-run-history.test.ts tests/model-settings.test.ts tests/scheduler.test.ts --maxWorkers=1
git diff --check 705cccd
```

检查器沿用前轮实现，仅更新本轮基线和报告位置，不覆盖既有证据。本轮未重跑全量测试、build、demo、插件smoke或在线模型／搜索／QQ验收，1491项通过等历史产品验收仍按原交付解释。

未读取密钥、私有配置、原人物背景或正式数据库；未变更产品代码、依赖、运行包、配置、数据或服务状态，未部署、启动或resume。源码中的默认值与旧配置白名单区别保留，不据静态审查推断当前进程状态。
