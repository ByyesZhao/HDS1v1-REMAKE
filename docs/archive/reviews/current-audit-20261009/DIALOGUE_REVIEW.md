# 共同活动、普通窗口与上下文独立审核

审核日期：2026-10-09。源码基线按本次任务指定的 `c9e4599`（已包含最新源码补丁 `b398699`）检查；文档按工作区当前版本读取。只新增本报告及 `dialogue/` 下的审核证据，没有修改 `src/`、`tests/` 或已有文档。没有读取私有配置、密钥、人物背景或正式数据库，没有联网模型、启动服务或运行全套测试。

## 1. 结论

本责任范围没有确认新的功能 BUG，也没有确认两份当前子系统文档与实际实现之间的新矛盾。已有跨活动未读转移、完整活动原文、窗口版本与收尾恢复修复均在当前源码中，不能重新列为待修 BUG。

确认了两类有证据的性能改进，以及一项可跳过工作的流程改进。优先处理原文读取：完整普通生活轮仍逐阶段扫描全部消息和普通段；记忆阶段尤其存在“构造全部普通窗口后立即丢弃”的无用工作。其次把不运行个人导演的分支提前。资料池线性查重可以作为小范围后续优化。

这些建议保持四段、完整活动、阶段可见性与正式来源合同，不增加安全机制或防御性检查。`CONTEXT.md` 第92行已明确说明普通窗口仍可能扫描历史，所以不能把这项已注明现状包装成文档错误或旧修复失效。

## 2. 当前文档与实现对应

已先读 `docs/v0.5/README.md` 与 `reference/V0.5_IMPLEMENTATION_MAP_20261009.md`，再核对以下合同。路径相对仓库根目录，行号来自本次当前源码。

| 当前合同 | 实际实现与检查结果 |
| --- | --- |
| 共同活动的公开开始／结束确认与正式状态提交分离 | `src/recovery.ts:40` 写确认消息；`src/host/shared.ts:59` 的 `recordSharedOutput` 创建／结束公开时钟；`src/host/shared.ts:28` 路由以公开时钟优先；`src/recovery.ts:93` 后续正式提交候选状态。未把候选开始当作已公开开始。 |
| 活动输入立即保存，全文 `【推进】` 为控制，普通输入15秒合批 | `src/host/input.ts:30` 全文去空白匹配控制；`:36` 活动分支不建普通批次；`:57` 普通分支设置15秒。`【推进】` 不进入消息正文池。 |
| 首节点立即、后续按最后确认输入／输出／静默完成计时 | `src/host/shared.ts:34` 的 `sharedDeadline`；`:88` 保存无输出完成锚点。选择阶段 `:6` 冻结轮号、原因和权限。 |
| 静默代写资格依据本轮选中输入，修补恢复保持冻结 | `src/host/shared.ts:17` 以选中ID数量决定权限；`src/model/contracts.ts:54` 克隆元数据并以其生成主叙事分支；`src/app.ts:108` 优先沿用已存活动集合。独立恢复补验通过，见§4。 |
| 首轮公开开场、最终轮公开收尾且结束；无正文不得提前结束 | `src/model/contracts.ts:69`、`:80`、`:98`、`:99` 与 `src/model/prompt-policy.ts:15`、`:16` 对应。正文是否语义上真正完成仍依赖模型，文档已明示。 |
| 场景推进任务由程序维护，模型不可修改 | `src/host/shared.ts:43` 更新 `scene:<activityId>`；`src/model/contracts.ts:108`、`:113` 拒绝增删改该种任务。 |
| 活动不占普通四段；普通窗口按本阶段可见交互排序 | `src/dialogue/chat-episodes.ts:16` 把活动消息的 `chatEpisodeId` 设为null；`src/dialogue/chat-window.ts:5` 先排除活动及不可见输入，再按可见交互给段排名。窗口按完整段取消息，不是旧30条截断。 |
| 活动全文按冻结身份；后到输入不混入；收尾轮继续使用 | `src/dialogue/activity-context.ts:12` 固定ID集合；`:14` 按阶段和已授权输入解析；`src/app.ts:108` 不因候选结束重新选活动；记忆沿用 `src/memory/organize.ts:36` 的本轮集合。 |
| A活动积压不会迁入B；结束后普通调度首次读取 | `src/host/shared.ts:91` 开始迁移要求 `sharedActivityId === null`；`:94` 只移除真正清空的批次；`:106` 结束只将本场未读转回批次。当前跨活动回归覆盖混合批次、原批次时间、回滚和SerialHost完整路径。 |
| 每轮记忆新来源与历史／复议辅助分离 | `src/model/context-views.ts:44` 只把本轮经历、首次可见输入、确认输出及合法本人查阅列为当前来源；活动全文只挂辅助角色。`src/memory/organize.ts:19` 再按首次可见资格筛选输入。 |
| 单池身份去重与学校／细节历史相等引用 | `src/model/resource-pool.ts:6` 按消息ID，`:8` 按对象版本ref；`:34` 在完全相等时建立 `input.context` 路径引用。不同ID同文字与不同版本均保留，定向transport回归通过。 |
| 背景用途需要approved，表达用风格而非整个作者背景 | `src/settings.ts:78` 将故事背景投影为core；`src/model/background-views.ts:6` 按世界／校园／课题组用途；`src/app.ts:169` 给表达style；`src/model/context-views.ts:56` 精简表达状态。没有读取正式背景，故只核对代码能力，不独立背书部署映射内容。 |
| 完整审核与日常工作集检查区分 | `src/dialogue/active-consistency.ts:38`、`:41` 分流；活动迁移的段结构变化在 `src/dialogue/chat-episodes.ts:25`、`:26` 回退完整审核。日常工作集仍含完整当前段／活动，不宣称所有路径定量读取。 |

## 3. 改进建议

### D-PERF-1：让调用者选择资料通道，并把普通四段选择下推至SQL（建议P2，优先）

**位置：** `src/dialogue/chat-episodes.ts:45`，`src/memory/retrieval.ts:66`，`src/memory/context.ts:12`、`:14`。

**正常触发：** 历史逐渐增加后，每一轮普通输入依次构造主叙事、个人导演和记忆资料。`ChatEpisodes.recent` 每次先取 `storage.messages()` 与全部 `chat_episodes`，再在JS筛选四段。记忆的 `ContextBuilder.buildForMemory` 调用同一个完整检索，但最后只返回 `details/retrieved`，刚构造的recent未发给记忆模型。

**本次证据：** `dialogue/context-cost.ts` 用纯内存合成库，历史每段一条已读普通消息，当前只读一条新消息、个人导演不发输出。完整轮只调用 `narrative/personal_chat/memory`。测量包含源码原样执行，无网络、无模型耗时。

| 历史段／历史消息 | 完整轮消息全表读取次数／解码行数 | 完整轮普通段全表读取次数／解码行数 | 完整轮耗时 | 单独buildForMemory耗时 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 3／3,003 | 3／3,003 | 27.1ms | 3.5ms |
| 10,000 | 3／30,003 | 3／30,003 | 100.4ms | 31.6ms |
| 50,000 | 3／150,003 | 3／150,003 | 484.1ms | 143.6ms |

单独的 `buildForMemory` 在50,000历史规模读取50,001消息及50,001段，但返回对象的键只有 `details`、`retrieved`。这里更稳健的结论是读取次数和解码行数；耗时是一次合成测量，不能当正式实例延迟或长期负载估算。

**建议：**

1. 先拆分检索所需通道，记忆正文／记忆补查只请求owner资料，不构造未消费的普通原文。保留实际记忆来源消费的一致性门禁。
2. 对需要普通原文的阶段，SQL先按该阶段实际资格找最近4个普通段，再读取这些段内全部合格消息。保持已关闭段、隐藏未读不改变排序、同时间ID排序、完整段和活动排除语义，不能用“最新4个段的lastInteractionAt”直接替代当前算法。
3. 同轮能复用已确定的只读投影时复用；不同可见性阶段仍须分别选取，不能把个人导演看到的新输入反灌到普通主叙事。

**合同边界：** `REMAKE_V0.5_CONTEXT.md:43` 的最近4个完整普通段及 `:45` 的活动隔离完全保留；`:92` 已承认扫描，所以此项是提高日常读取收益，不是修复文档失真。

### D-FLOW-1：先决定是否运行个人导演，再准备其专属资料（建议P2，可与D-PERF-1一并处理）

**位置：** `src/app.ts:144` 构造查询、`:147` 完整检索、`:148` 学校上下文、`:149` 环境事件，直到`:152` 才计算 `runPerson`，`:156` 才进入条件。

**正常触发：** 到活动预计结束时运行“检查未读”，主叙事确认活动实际延长且仍不能读手机；本轮无新可见输入、无预约／自主／醒来触发、无学校获知时，`runPerson=false`。这时个人检索和学校投影仍已完成，但不进入个人模型；无intent也不会进入表达。这是流程上能够直接消除的工作。

**建议：** 在主叙事更新状态、确定visible和deferred之后，先计算 `contactEligible/kind/runPerson`；仅当将运行个人导演或确有消费方时构造个人检索／个人学校／个人事件投影。共同活动固定要运行个人导演，学校获知与正式提交仍须保持，不能用过早return跳掉这些流程。此项依据当前控制流确认；本报告未额外单独测量该分支，不把§3上一表的耗时归算给它。

### D-PERF-2：资料池用集合维护身份索引，避免每阶段及每次发送重复平方级查重（建议P3，次优）

**位置：** `src/model/resource-pool.ts:6`～`:10`、`:24`；调用来自 `src/model/context-views.ts:34`、`:35`、`:39`。

**触发与影响：** 每次插入用数组 `.some()` 扫描已有元素。消息同时承担原文／可见／活动等角色时会反复遍历，transport建立envelope又merge一遍整个池。普通段与活动全文没有条数截断，长窗口会放大这部分纯CPU成本。

**压力样本：** `context-cost.ts` 让同一组消息同时承担活动原文和可见两个角色，验证投影和envelope最后均恰好N条，不丢正文。预热一次，之后三次的中位数如下。

| 唯一消息数 | stageInput中位数 | buildCompletionEnvelope中位数 |
| ---: | ---: | ---: |
| 1,000 | 7.0ms | 3.7ms |
| 5,000 | 54.5ms | 26.9ms |
| 10,000 | 258.2ms | 135.6ms |

10,000消息是合成压力样本，不是已观察到的正式窗口规模。源码的嵌套线性查找是确定的；数据说明应先把身份索引改为 `Set/Map`，而不是削减原文条数。继续用数组保存稳定输出顺序，分别按消息ID／任务ID／owner ref／素材ID建集合，并保留现有“先插入版本”的行为。不同消息同文字不能合并，不同owner版本也不能合并。

**合同边界：** `REMAKE_V0.5_CONTEXT.md:53` 的单池与 `:59` 的请求内去重不变；不会跨阶段共享可见性，也不引入字符截断。小窗口下收益较低，因此排在原文读取之后。

## 4. 功能补验与排除的疑点

定向测试：9文件42项通过。涵盖跨活动残留批次、旧活动不进入新活动、活动全文、后到未读、结束后的普通读取、活动记忆来源、冻结发送／后处理、普通窗口排序、资料池、相等路径引用、动态权限和背景用途。没有跑全套测试，也不沿用旧批次693项作为本次结果。

另写 `dialogue/recovery-probe.ts`，两项独立断言通过：

- **V2活动生成失败后重生：** `discardUnattempted` 把本轮at从02:01更新到02:21，同时保留已选 `chosen`、原activityContext和 `allowSimulatedUserActions=false`；失败后新增 `late` 未进入重生主叙事资源，仍未读。这里“at更新但活动集合未重新拼”符合 `SHARED_ACTIVITY.md:49` 与 `CONTEXT.md:45`，不是新BUG。
- **V2普通生成失败后重生：** 超过20分钟收到后到消息时，原未完成轮仍持有普通段；重生继续使用原绑定，完成后释放hold，后到消息未成为本轮可见输入。`chatBinding` 不因at更新重建符合未完成回复的持段用途；没有重复计轮或提前消费后到输入。

本次没有把以下事项列为缺陷：正文非空不能证明语义收尾、用户动作语义没有独立裁判、正式背景是否真的approved、世界没有学校式完整知情台账、搜索供应商未启用、压力样本不等于正式历史规模。前三项要么当前文档明确边界，要么超出本次可读材料；不能依据猜测下结论。

## 5. 独立重跑

仓库根目录执行（全部离线）：

```powershell
node node_modules/vitest/vitest.mjs run tests/shared-v3-cross-activity.test.ts tests/activity-context.test.ts tests/activity-memory-context.test.ts tests/shared-v3-recovery.test.ts tests/chat-window-snapshot.test.ts tests/prompt-context-views.test.ts tests/prompt-context-transport.test.ts tests/prompt-policy.test.ts tests/background-stage-views.test.ts

node docs/v0.5/reviews/current-audit-20261009/dialogue/run-ts.cjs docs/v0.5/reviews/current-audit-20261009/dialogue/recovery-probe.ts

node docs/v0.5/reviews/current-audit-20261009/dialogue/run-ts.cjs docs/v0.5/reviews/current-audit-20261009/dialogue/context-cost.ts
```

运行结果分别保存在 `dialogue/target-tests.txt`、`dialogue/recovery-probe.json`、`dialogue/context-cost.json`。`run-ts.cjs` 使用已装TypeScript在当前进程转译，只为避开本沙箱不允许esbuild子进程的问题；没有修改或替换生产加载逻辑。Vitest第一次在受限沙箱启动失败（`spawn EPERM`），随后经自动许可在所需执行权限下运行成功，该启动失败不是业务测试失败。

范围限制：本报告只对分配的共同活动、普通窗口和模型资料投影负责；学校、记忆生命周期、总体恢复、调度和发送的其他问题以主审核合并结果为准。
