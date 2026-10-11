# 当前文档与源码对应性审核

日期：2026-10-11。状态：文档子审核已完成；本报告不修改产品实现或当前规则。

审核基线：`ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`，开始时 `git status --short` 为空。当前说明标注的源码基线为 `65f0785`；`git diff --name-only 65f0785..HEAD` 仅涉及文档及其核对材料，没有产品源码变化，因此该基线标注本身不是过期缺陷。

范围：`docs/DIRECTORY_POLICY.md`、`docs/v0.5/README.md`、总架构、8 份子系统说明、3 份 reference，以及项目根 README；对照相关源码、CLI、配置 Schema 和既有测试。没有读取密钥、私有配置、正式数据库、人物背景正文，也没有发起外部模型、搜索或 QQ 请求。

## 结论与发现

当前 V0.5 核心规则总体对应实现。没有把历史失败报告、旧批次测试数量、已完成计划中原有待办，或“已配置但在线质量未验收”列为缺陷。发现 1 项运行入口与文档承诺不一致（与网页／媒体审核合并计数），以及 2 项 P3 文档问题。

### D1／P2：当前图库维护命令在已启用 browser 搜索的配置下无法执行

- 文档位置：`README.md:144-145` 推荐对 `config.local.json` 执行图库 import 和 rebuild；`README.md:177` 说明该配置已启用 `webSearch.enabled=true`、`provider="browser"`；`docs/v0.5/subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md:49-53` 将重建解释为沿旧识别文字重建向量，并引导使用 README 命令。
- 实现证据：`scripts/stickers.ts:23` 在判断 rebuild 前执行 `assembleWeb(storage,settings,systemClock)`，没有传入 provider；`src/deployment/web-runtime.ts:7` 直接将该 undefined provider 传给 `WebSearchService`；`src/web/service.ts:14` 使用 `UnconfiguredWebProvider` 并在搜索启用时立即抛出 `web search enabled but provider not configured`。`scripts/stickers.ts:25` 的向量重建分支因此不能到达。
- 影响：用户按当前部署说明停服维护图库，仍会在导入或重建前失败。尤其重建仅需要 Embedding，却被网页装配拦截；更换向量模型、端点或维度后，文档要求的恢复命令也不可用。
- 建议：重建路径绕过无关的网页装配；导入明确实现独立浏览器生命周期，或采用明确、可执行的无网页工具合同。随后同步说明 CLI 的实际工具资格，增加已启用 browser 配置下的 CLI 回归。
- 验证：静态调用链已确认；网页／媒体审核负责仅使用合成配置与内存库的独立复现。该项是同一个产品缺陷的文档暴露面，综合报告只计一次。

### D2／P3：旧载荷回收指向 README，但 README 没有操作命令或备份说明

- 文档位置：`docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md:99` 明确说明旧终态载荷需显式停服分批压缩，并写“命令与备份见 README”。`docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md:141` 又将旧残留回收引向该段。
- 实现证据：`package.json:25` 已提供 `memory:compact-payloads`；`scripts/compact-memory-payloads.ts:3-9` 接受位置参数数据库、`--dry-run`、`--apply --stopped`、批次数及备份目录；`src/deployment/memory-payload-compaction.ts:8-16` 执行停止声明检查、DB/WAL/SHM 备份、有限批次事务回收并返回 `hasMore`。根 README 中检索 `compact-payloads|compactMemoryPayloads|载荷|回收` 无匹配，也没有对应备份路径说明。
- 影响：这是当前说明中解决旧历史正文累积的唯一显式维护入口。运维者被引到无内容的目标页，不能从当前文档得知可先只读检查、apply 必需参数、备份位置或未完成时如何续跑。链接本身存在不代表操作说明完整。
- 建议：在 README 补充 dry-run 与 `--apply --stopped --backup-dir` 示例，说明默认每批 50 行／最多 20 批、`hasMore` 续跑及完整备份恢复；或将现有引用直接指向具有这些内容的当前专用维护说明。不应通过重新编写历史交付证据来补此入口。

### D3／P3：根 README 的当前批次与升级状态仍含无时间限定的旧措辞

- `README.md:13` 将图片／搜索批的 175 文件／920 项称为“最新代码验收”，但 `docs/v0.5/README.md:5,37-38` 已将导演联网软提示／动作限定线下列为较新的交付，记录 189 文件／1034 项。
- `README.md:166` 将“本批代码与部署进度”指向更早的查看资格交付；最新版本入口已指向后续批次。
- `README.md:106` 在当前升级操作章节写“本次开发只升级测试夹具，正式库是否升级由部署时决定”，与同页 `README.md:7,95` 的正式库已经备份升级说明冲突。该句没有注明是环境初始开发批次的历史状态。
- 影响：单独从根 README 判断当前交付与是否需要升级时，会得到不一致结论。问题是无时间限定的“最新／本批／本次”，不是旧数字或历史记录应该删除。
- 建议：旧测试数字继续保留并改称“该批”；当前批次统一引向 V0.5 最新交付入口；将“只升级测试夹具”标明原批次和日期，或移到历史交付，当前命令说明保留通用显式升级前置条件。

## 覆盖矩阵

“已对照”表示阅读当前文档并检查以下关键实现，不表示逐行验证全部实现或重新运行全部历史验收。

| 当前说明 | 本次实际对照重点与源码 | 结果／边界 |
| --- | --- | --- |
| 总架构 | `src/app.ts`、`src/model/context-views.ts`、`src/model/contracts.ts`、`src/model/prompt-policy.ts`；普通／共同／个人／表达／记忆分工、程序与语义约束、工具资格 | 关键职责和限制表述与所查实现一致；其他代理复核调度和存储完整流程 |
| 导演与环境 | `src/model/context-views.ts:62-71`、`src/model/prompts.ts`；世界／校园／课题组背景用途、周通知投影、固定校园身份限制 | 当前文档明确承认校园身份硬编码和世界无学校式知情台账，没有扩大能力；环境依赖和 lease 由运行审核覆盖 |
| 调度与生活状态 | `src/host/state.ts:8-52`、`src/config.ts`、`src/settings.ts`、`src/host/probability.ts`；睡眠／查看资格、150～210 分钟、概率曲线、参数默认值 | 关键值对应源码；并发、事件接管和停止门禁由运行审核覆盖 |
| 记忆 | `src/memory/organize.ts:16-55`、`src/memory/idle.ts`、`src/memory/batch-selection.ts`、`src/model/contracts.ts`；合法来源、本人阅读、无来源免调用、闲置阻挡、完整正文选批 | 这些规则对应实现；长期许可／清理和性能完整路径由存储审核覆盖；发现 D2 操作入口缺失 |
| 共同活动 | `src/model/contracts.ts`、`src/model/prompt-policy.ts`、`tests/shared-v3-contracts.test.ts`、`tests/offline-action-only.test.ts`；首尾要求、静默代写、动作权限和语义边界 | 合同对非空、逐项公开、线索集合的检查与文档一致；文档未把非空检查冒充语义审核 |
| 提示与上下文 | `src/model/context-views.ts`、`src/model/resource-pool.ts`、`src/model/background-views.ts`、`src/model/client.ts`；普通叙事过滤新未读、活动授权、单资料池、版本身份、补查一次、表达投影 | 所查权限／去重／补查合同一致；没有证明全系统零重复或恒定时间 |
| 表达与表情 | `src/output/qq.ts:2-18`、`src/output/stickers.ts`、`src/output/expression.ts`、`src/model/reply-guidance.ts`、`scripts/stickers.ts`；字素间隔、概率与最高相似度、重建、动作和附件提示 | 主要发送／提示规则一致；D1 当前 CLI 不可执行 |
| 网页搜索 | `src/web/service.ts`、`src/model/client.ts:24-69`、`src/model/prompt-policy.ts`；独立计数、缓存、已提供与已取得、配额动态工具、独立本人来源 | 核心口径对应实现；浏览器实际提取、生命周期由网页／媒体审核覆盖 |
| 报错与恢复 | `src/model/client.ts`、`src/deployment/memory-payload-compaction.ts`、`scripts/compact-memory-payloads.ts`；两次修补、完整 JSON、网络错误区别、终态载荷回收 | 所查合同一致；D2 操作引用缺失；完整故事恢复与停止由运行审核覆盖 |
| 实现对应 | `src/settings.ts:10-90`、`src/config.ts`、`package.json`、上述模块；模型键、默认值、14 任务／15 用途、多个协议各自版本、基线差异 | 所查静态映射一致；配置“当前值”只视为其白名单产生时证据，未读取私有配置重验 |
| 模型与网页配置参考 | `src/settings.ts`、`src/model/client.ts:76-108`、`src/model/contracts.ts`、`src/output/sticker-description.ts`；连接复用、Schema 默认强度、HTTP 参数、显式在线工具 | 所查连接／任务映射一致；素材描述独立脚本可用性受 D1 限制 |
| 背景用途参考 | `src/model/background-views.ts`、`src/settings.ts:68-75`、`scripts/prepare-character-background.ts` | 批准状态、缺省背景及只初始化缺失事实对应；未读取正式背景或已批准映射正文，36 段和具体段号不重新认证 |
| 根 README | `package.json`、`runtime/check.cjs`、启动 cmd、维护 CLI | 发现 D1、D2、D3；未运行正式启动器或任何真实库维护命令 |
| 文档入口与目录原则 | `docs/v0.5/README.md`、`docs/DIRECTORY_POLICY.md`、`git diff 65f0785..HEAD` | 当前规则与历史证据角色已清楚区分；本次仅新增任务内报告，不修改历史证据或导航 |

## 验证记录与未验证范围

- 已执行只读 Git 基线检查及 `65f0785..HEAD` 文件差异检查，并使用 `rg` 检查当前 README 的维护入口缺失、最新批次与源文件定位。
- 本子审核没有重跑产品测试；综合审核主任务负责全量测试和工程检查，避免多个代理重复运行相同集合。既有测试文件的阅读只用于核对测试合同，不能写成这些测试本次已经通过。
- D1 的独立离线复现由网页／媒体子审核提供。综合报告应引用其具体证据，不把静态代码推演重复计为第二次动态验证。
- 未验证正式配置此刻状态、实际进程是否运行、正式库内容／版本、真实 QQ 收发、模型输出质量、真实网页可达性或长期性能；既有交付证据仍只证明其原基线。
- 未声称完成所有 Markdown 链接与锚点的自动扫描；本审核重点是内容与代码／可执行命令的对应性。
