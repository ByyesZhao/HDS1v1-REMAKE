# 当前文档与源码同步核对

日期：2026-10-10；源码基线：`726eb00`。返回[版本索引](../../README.md)。

本次核对总架构、8份子系统、3份参考及版本／计划／审核／记录导航，以当前源码和本地配置白名单为准。无需重写架构；修正文档中的过时入口与停止规则歧义，没有新增产品需求。历史计划、审核报告、日志和JSON仍表达产生时的基线，不改写为当前验收。

## 1. 实际修订

- 最新代码交付统一指向安全停止R1；补齐查看资格、新鲜度和安全停止三批的追溯入口。原图片／搜索交付仍保留，取消“最新”标签。
- 修复前的回复错位调查、原停止失败探针明确标为旧基线；当前行为指向相应修复交付。旧报告的RED与修复后的GREEN分开说明。
- 环境／记忆恢复区分默认卸载取消与显式安全停止：前者abort、拒绝晚到发布；后者等待当前在途阶段保存ready，再按恢复资格续办。
- 调度文档补充15秒合批例子：第0秒和第12秒收到两条普通消息，无后续输入时最早第27秒具备处理资格，实际开始仍受调度门禁约束。
- 配置重新按白名单解析；新图识别、browser／Bing搜索已启用，模型与思考强度未改。部署已完成与进程是否运行分别说明，不把一次静态记录当成实时状态。
- 用户已确认普通聊天正常回复；图片识别、真实搜索续调用和长期运行的质量不由本次文档检查证明。

## 2. 源码对照范围

源码路径相对项目根目录。表中“保留”表示实际规则无需修改，不代表本次重跑产品测试。

| 主题 | 实际规则／核对结论 | 源码接点 | 当前说明 |
| --- | --- | --- | --- |
| 系统职责与预约分工 | 预约系统管理内容，调度负责到期资格；自主推进是生活轮 | `src/host/runtime.ts`、`scheduler.ts`、`state.ts` | [总架构](../../architecture/REMAKE_V0.5.md)；保留 |
| 合批与新鲜度 | 最近普通输入后15秒；首次发送尝试前可等待换代，已尝试／封口沿冻结合同 | `src/host/input.ts`、`reply-freshness.ts`、`src/app.ts`、`src/recovery.ts` | [调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md)、[上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md)；补充例子 |
| 查看与睡眠 | 普通专注可读且可沉默；不可读必须有限结束；起床后体力由主叙事评估，无强制满体力规则 | `src/model/prompts.ts`、`contracts.ts`、`src/host/state.ts` | 调度、总架构；保留 |
| 自主与概率 | 150～210分钟；实际故事完成重新安排；概率抽样持久化 | `src/host/state.ts`、`probability.ts`、`src/recovery.ts` | 调度；保留 |
| 世界／学校 | 06:00启动四阶段依赖；冻结准备、ready和串行提交分开；无必需通知免周模型 | `src/environment/*`、`src/school/*`、`src/directors/school.ts` | [导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md)；保留 |
| 学校知情与提醒 | 对象ID不授权最新内容；已读与现场进度按版本判断，通知能触发角色轮 | `src/school/knowledge.ts`、`notices.ts`、`progress.ts`、`src/host/scheduler.ts` | 导演、上下文；保留 |
| 普通原文与活动 | 普通4段，活动整体排除；当前共同活动提供完整获准原文，结束后相关记忆召回 | `src/dialogue/chat-episodes.ts`、`chat-window.ts`、`activity-context.ts` | 上下文；保留 |
| 共同推进与代写 | 60秒／立即推进，默认20硬上限、约10轮目标；代写权限由冻结用户输入选分支 | `src/host/shared.ts`、`src/model/prompt-policy.ts`、`contracts.ts` | [共同活动](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md)；保留 |
| 活动归属 | 新场只迁移明确普通未读，旧活动未读不改归属 | `src/host/shared.ts`、`src/dialogue/chat-episodes.ts` | 共同活动、上下文；保留 |
| 记忆来源与时间 | 每轮合格来源提取；重谈不把当前记录时间扩为事件时间，新进展与保留许可分开 | `src/memory/organize.ts`、`store.ts`、`src/model/contracts.ts` | [记忆](../../subsystems/REMAKE_V0.5_MEMORY.md)；保留 |
| 生命周期与容量 | 短期7天，长期90天、3／30有效日期；池100／1000／500，归档默认90天；归档须真实恢复再晋升 | `src/memory/lifecycle.ts`、`capacity.ts`、`cleanup.ts` | 记忆；保留 |
| 空闲及选批 | 重整理15分钟锚点刷新；完整正文FIFO软目标，首项及依赖可超，不截正文 | `src/memory/idle.ts`、`maintenance.ts`、`src/settings.ts` | 记忆；保留 |
| 检索与预算 | 直接／词法／语义融合，当前semantic=null；输入人为预算默认null，不自动删低相关条目脱困 | `src/memory/retrieval.ts`、`src/model/context-views.ts`、`src/settings.ts` | 记忆、上下文、[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md)；保留 |
| 表达与附件分支 | 固定三条口语规则，第四条按获准本轮图片标记；分段延迟由程序计算 | `src/model/prompt-policy.ts`、`src/output/expression.ts`、`qq.ts` | [表达与表情](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)；保留 |
| 用户图与素材 | 用户图独立观察，可选独立连接；确认观察关闭开关仍获准复用，取图失败为未知；图库另行显式描述 | `src/input-media/*`、`src/output/stickers.ts`、`scripts/stickers.ts` | 表达与表情、上下文、恢复；保留 |
| 网页工具 | 各阶段独立20成功／40失败；同阶段同页不重复计，跨阶段首次缓存取得仍计；不自动换引擎 | `src/web/*`、`src/deployment/web-runtime.ts` | [网页搜索](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md)；保留 |
| 浏览器提取与恢复 | DOM可见性／登录墙判断，页面真实关闭前不释放槽，未知关闭失败不冒充成功 | `src/web/browser/*`、`src/deployment/browser-runtime.ts` | 网页搜索、恢复；保留 |
| 修补和恢复 | 同任务有限修补／工具续调；确认分段不重发，结果未知沿既有重试；旧协议轮使用保存版本 | `src/model/client.ts`、`src/recovery.ts`、`src/deployment/*-upgrade.ts` | [报错与恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md)；保留 |
| 安全停止与取消 | graceful完成当前工作；默认卸载abort后台；关闭失败HTTP500、不成功退出，重复沿失败 | `src/host/runtime.ts`、`src/environment/preparation.ts`、`src/memory/maintenance.ts`、`src/deployment/stop-control.ts`、`browser-runtime.ts` | 恢复§6／7澄清、§12保留 |
| 模型与有效配置 | 13已配置连接Flash，10 low／3 high；用户图复用素材high，整理审核复用整理连接 | `src/settings.ts`、`src/deployment/plugin-runtime.ts`、`src/model/client.ts` | [模型参考](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)；更新核对基线 |

## 3. 验证与证据

运行 `node docs/v0.5/records/document-current-sync-20261010/check-docs.cjs`，结果见[文档检查](evidence/document-check.json)及[有效配置白名单](evidence/effective-models.json)。检查整个v0.5的本地Markdown目标与锚点、当前说明编号和可直接解析的源码路径；历史证据的内容只按原基线使用。`git diff --check`及改动路径检查确认本次仅修改v0.5文档／检查记录。

本次检查：87份Markdown、750个本地目标、14个章节锚点、67个明确源码路径；缺失目标／锚点／源码路径及编号异常均为0。13个已配置连接仍为10 low／3 high的Flash，新图与Bing开关为true、Puppeteer已配置；批准背景映射仍为36段、facts为空且各用途段号与参考一致。元数据白名单不包含背景正文。

最新产品验收仍是[安全停止R1交付](../graceful-stop-r1-20261010/DELIVERY.md)的188文件1009项及工程检查；本次没有重跑产品验收，不以文档链接检查替代模型语义、真实QQ、图片或搜索质量验收。未启动／停止服务、调用网络、加载key.txt或原角色背景文件、修改正式配置／数据库。批准用途文件仅解析映射元数据；检查脚本不输出其中正文、不序列化私有配置全文。

送审仍提供整个 `docs/v0.5/`，从[版本索引](../../README.md)开始。没有新实施计划、目录移动或新rebuttal。
