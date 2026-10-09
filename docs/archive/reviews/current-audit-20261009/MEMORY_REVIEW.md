# 当前工作区记忆系统独立审核

日期：2026-10-09。审查对象：当前源码及当前未提交文档，HEAD `c9e4599`，已包括最新源码补丁 `b398699`。本次只审查，未修改 `src/`、`tests/` 或已有文档；未读取私有配置、人物背景、正式库，未调用在线模型或启动服务。

## 结论

确认 **2 项 P2 功能问题、1 项 P2 高收益性能改进、1 项 P3 文档歧义**。没有将已注明的纯语义检索关闭、数月运行尚未验证、依赖闭包可超过主选批次等边界列成缺陷，也没有将历史 R1 失败当作当前失败。

| 编号 | 分类／优先级 | 当前问题 |
| --- | --- | --- |
| M-B1 | 功能／P2 | 重谈已有事件并省略可选事件日期时，程序将旧事件 `happenedUntil` 改成本轮时刻；错误日期会进入后续导演资料 |
| M-B2 | 功能／P2 | 生产使用的增量维护分支忽略 `batchCharacters`，合法非空配置不起作用 |
| M-P1 | 性能／P2 | 每删除一条记忆，重新压缩并重写全部历史已完成维护任务，使逐单元清理成本随历史任务数增长 |
| M-D1 | 文档／P3 | “非主证据不因此永久保留”未区分普通检索到期与有效常驻引用保护下的物理保留 |

P2 表示应修的正常业务或明显成本问题，不表示已观察到正式运行实例损失；P3 为文档精确性修订。

## M-B1：省略可选日期的重谈会扩展历史事件时间范围

**位置**：`src/memory/lifecycle.ts:28`、`:36`；合同入口 `src/model/contracts.ts:38–41`、`:128–135`；下游资料投影 `src/model/context-views.ts:12–13`。

**触发场景**：已有长期记录“10 月 1 日参加考试”，在 10 月 9 日重新谈起并补充详细记录。模型合法输出 `create`、`existingLongId=exam`、`hasNewEventProgress=false`，提供本轮来源，但省略可选 `happenedAt`／`happenedUntil`。这是合同允许的正常省略值，不是非法输入或需要额外防御的恶意值。

**当前路径**：

1. `contracts.ts:38` 把两个事件时间定义为 optional；`memoryTask` 要求已有长期的 create 明确给进展布尔值，但不要求补日期。
2. `lifecycle.ts:28` 为新 short 用 `change.happenedAt ?? at` 与 `change.happenedUntil ?? change.happenedAt ?? at` 填日期；没有利用已经解析出来的 `existing` 事件范围。
3. `lifecycle.ts:36` 无条件执行 `eventRange([long, short])`。即使 `hasNewEventProgress=false`，新的 short 时间仍将旧 long 的事件结束时间推到本轮 `at`。
4. `context-views.ts:12–13` 把两项事件时间直接投影给后续主叙事、个人导演、表达、记忆等阶段；`lastEventUpdateAt` 不在这些常规视图里，不能纠正错误的事件范围。

**独立复现结果**：原事件 `happenedAt=happenedUntil=2026-10-01T02:00:00.000Z`；本轮 `at=2026-10-09T02:00:00.000Z`。`memoryTask.parse` 通过。应用后，`lastEventUpdateAt` 仍是 10 月 1 日，`expiresAt` 未变，但 `happenedUntil` 变为 10 月 9 日。`projectOwner(updated, 'personal')` 同样输出这个错误结束日期。

**影响**：把一个历史单日事件表示为延续到重谈日的事件区间；后续回忆、叙事排序和模型时间理解会收到程序制造的日期事实。此项**不是** REVIEW26 已修的续期／预备窗口回退；本次已明确验证那些字段没有变化。

**文档合同**：当前记忆文档 `docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md:25` 要求新事实有合法本轮依据，`:45` 区分重谈和事件真实进展。更精确的现行模型提示 `src/model/prompts.ts:22` 写明：“happenedAt／happenedUntil只给来源有依据的已知事件时间范围，不能用整理时刻冒充历史事件时间。”当前程序默认值恰好反向制造了这样的时间。

**建议**：已有事件的 create，缺少日期时继承 canonical long 已知的事件范围；只有明确提供且有来源的事件时间才扩展范围。`createdAt`、短期 7 天窗口等记录时间继续使用本轮 `at`，与事件发生时间分离。补充 `existingLongId + false + 省略两个日期`、仅给一个日期、引用 learned 后解析 canonical 的正常分支测试。

## M-B2：增量维护忽略 `batchCharacters`

**位置**：`src/memory/maintenance.ts:58–59`、`:73–87`，尤其 `:86`；正式装配 `src/deployment/memory-runtime.ts:22–23`；配置定义 `src/settings.ts:43`。

**触发场景**：用户合法配置非空 `memory.batchCharacters`，有多个彼此独立的 dirty owner，当前已满足 15 分钟空闲资格。没有共享证据或依赖闭包，也没有单条超目标的例外。

**当前路径**：正式装配总是创建并传入 `MemoryIdle`。`ensureCycle` 因而直接进入 `ensureIncremental`，后者只以 `batchItems` 执行 `slice`，根本不读取 `batchCharacters`。只有没有 `idle` 的旧每日周期分支在 `:68–69` 累加字符并减少主选条数，因此旧分支测试通过不能证明当前正式路径实现了该配置。

**独立复现结果**：`batchCharacters=150`、`batchItems=20`，3 个独立长期每个正文 120 字。固定离线模型收到 `selectedIds=['a','b','c']`、主选正文 360 字；没有任何额外依赖项，任务正常进入 ready。按原合同应只主选首个 120 字 owner。

**影响**：使用该参数控制单批模型成本／上下文规模时，仍会一次发送最多 `batchItems` 条完整正文；单条较长或积压较多时明显扩大准备时长与调用体积。当前默认 null 无行为差异，问题发生于受支持的非默认配置。

**文档合同**：当前实现映射 `docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md:131` 将两项都列为主选后台批次规模控制，并区分依赖闭包。细化合同 `docs/MEMORY_V0.3_IMPLEMENTATION_20261007.md:260` 明确非空字符软目标只减少条数、不截正文，单条超目标仍可独占；容量／空闲细化 `docs/MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_20261008.md:54` 明确沿用此参数，没有记录其在增量路径失效的产品决定。

**建议**：提取统一的主选批次选择逻辑供两条分支共用；先按 FIFO 与 audit/consolidation 分类，再同时应用条数及字符软目标，随后构建完整依赖闭包。缺省 null、单条超目标和依赖追加行为保持原合同。若产品实际上决定弃用此参数，应同步删除或明确弃用配置；不要继续展示为有效控制项。

## M-P1：逐条清理反复重写全部历史 done 任务

**位置**：`src/memory/cleanup.ts:30–31` 调用 `compactCompletedPayloads()`；`src/memory/store.ts:197–202`，尤其 `:199`；已有任务完成时的即时压缩见 `src/memory/store.ts:165–168`。Host 让位点在 `src/host/runtime.ts:69–70`。

**触发场景**：正常运行已积累若干已完成维护任务，出现多条短期到期或长期归档待删。维护任务完成时已经压缩 `snapshot/readSet/result`，但历史统计行继续保留。

**当前路径**：每清理 1 个 owner，在同一同步事务中再次查询两张 job 表的**全部 done 行**，JSON 解析后逐行调用 `saveJob` 重写，即使内容已经完全压缩。`pruneOwnerFromJobs` 也遍历全部维护任务（`:173`）。因此单单元并不等于小固定工作量；前台直到此事务全部完成以后才能让位。清理 K 条、历史 done 任务 H 条，压缩部分执行 K×H 次历史任务写入。

**独立量化**：内存 SQLite、已完成任务本身均为压缩形态，10 条正常到期归档，固定当前工作量；直接包裹 `saveJob` 计数。

| 历史已完成维护任务 H | 删除 owner K | 对既有 done job 的重复写入 | 总清理耗时 |
| ---: | ---: | ---: | ---: |
| 0 | 10 | 0 | 7.19 ms |
| 1000 | 10 | 10000 | 238.30 ms |
| 5000 | 10 | 50000 | 1123.65 ms |

这是一组本机内存库样本，不是正式磁盘延迟预测；决定性证据是可重复的 **K×H 写入数**，不是某个毫秒阈值。5000 条历史记录已经令一次后台让位单元平均约 112 ms，仅为重写早已压缩的记录就反复增加事务与数据库写入。

**影响及收益**：降低历史积累后的事件循环阻塞、无效 SQLite 写入和清理整批耗时。不需要改变容量、保存事实或模型决策，也不依赖新增供应商，属于高收益实现改进。

**文档关系**：记忆文档 `:119–121`、`:129` 声明逐单元提交后让位；代码在形式上确实做到，并未伪称逐单元不存在。此项是单元内部仍包含全部历史工作的性能改进，**不是**把 ASTRA 的固定活动工作集承诺扩大到所有查询，也不是以未声明的“全库恒定成本”为依据判 bug。

**建议**：保留 `saveJob(status=done)`、前台／环境成功提交的即时压缩，把历史修复式全表压缩从每条删除移走，做为显式升级或一次性有进度的补偿。确需后台补偿时只选尚含载荷的少量行，压缩完成后不再处理；`pruneOwnerFromJobs` 仅检索仍可能引用 owner 的未完成任务。保留 R1 的 pending/computing checkpoint 保护，不能为性能重新清空失败任务阶段进度。

## M-D1：非主证据的“永久保留”需要区分逻辑期限与物理保护

**文档位置**：`docs/v0.5/subsystems/REMAKE_V0.5_MEMORY.md:65` 的“非主证据不因此永久保留”，与 `:117` 的有效常驻证据保护及 `:123` 的有效常驻及证据未统一封顶并列，易被理解成非主证据到期后可照常物理删除。

**实现证据**：`src/memory/lifecycle.ts:164–165` 只把主 long 变成 durable；这支持“非主证据不自动晋升常驻状态”。但是 `src/memory/capacity.ts:17` 对 active learned 的主 ID 和全部 `evidenceMemoryIds` 一律保护；`src/memory/cleanup.ts:23–26` 从物理清理候选中排除这些 ID。只要 learned 仍有效引用它们，非主证据即使已归档超期也保留其必要摘要。该行为与当前证据完整性规则一致，不应为修文档而取消保护。

**建议文字**：“非主证据不自动晋升 durable，仍按普通期限退出当前检索；有效常驻引用期间，必要身份与摘要受物理清理保护。”此项仅修精度，优先级 P3。

## 文档与实现对应核对

| 当前合同 | 实现核对 | 本轮评价 |
| --- | --- | --- |
| 本轮合法来源、本人网页来源与唤醒／私人细节分离 | `organize.ts:17–48`、`contracts.ts:128–135`、`lifecycle.ts:17–67` | 主要一致；未把历史资料视为独立本轮来源 |
| 7 天短期／预备摘要、真实进展才延长、90 天许可 | `lifecycle.ts:28–58`、`store.ts:127–141` | REVIEW26 时间许可修复仍在；M-B1 是另一事件日期字段问题 |
| 上海日期去重、三次续期、30 次晋升、归档需显式恢复 | `lifecycle.ts:72–89`、`:159–165`、`capacity.ts:69–74` | 没有把旧归档晋升缺陷列成当前发现 |
| 同事件归并继承已有活跃资格、全归档保最早锚点 | `lifecycle.ts:91–128` | 当前路径对应现行说明 |
| 晋升正文依据与版本、词法及索引文本包含依据 | `lifecycle.ts:130–157`、`store.ts:13–14`、`retrieval.ts:45` | ASTRA 该项修复已存在 |
| 纯语义关闭与五种查询主动跳过 | `retrieval.ts:31–39` | 明确是已注明现状，不列缺陷 |
| 空闲资格、活动阻挡、睡眠选项、后台不刷新锚点 | `idle.ts:9–32`、`maintenance.ts:29`、`recovery.ts:117` | 机制对应；M-B2 为生产增量批量参数遗漏 |
| 每次清理后让位、失败局部重试、应用版本检查 | `runtime.ts:68–74`、`maintenance.ts:152–185` | 机制存在；M-P1 为单元内部成本问题 |
| 未开始刷新、索引合并 FIFO、保留旧 started/unknown 输入 | `maintenance.ts:93–127`、`store.ts:146–155` | ASTRA 最新路径存在，未重报旧失败 |
| R1 pending/computing 保留 checkpoint，ready 应用失败复用结果 | `maintenance.ts:152–158`、`:183–185` | 最新状态门禁存在；本轮不扩大为完整故障注入重验结论 |

## 验证方式与材料

运行：

```powershell
node docs/v0.5/reviews/current-audit-20261009/memory/run.cjs
```

- `memory/reproduce.ts`：两个功能场景和清理写入计数，直接调用当前 `src/`；全部数据库为 `:memory:`，模型／向量提供器固定离线结果。
- `memory/run.cjs`：利用项目已安装 TypeScript 的内存转译加载当前源码，不写编译产物、不启动子进程。
- `memory/reproduction-results.json`：成功执行生成的完整观测值，退出码 0。
- 先尝试的 `node --import tsx ...` 因沙箱禁止 esbuild 子进程而 `spawn EPERM`；这是执行环境限制，未计入产品缺陷。后续使用上述本地转译入口完成了所有本报告复现。
- 主审 agent 已另行运行完整正式离线回归并报告 122 文件、693 项通过，以及 typecheck/build/demo/smoke 通过。本分审未重复跑全套，不把主审结果称为本脚本产生。

本报告不提供代码修复，不改变原有文档或用户工作区未提交内容。建议优先处理 M-B1 与 M-P1；M-B2 与配置文档一起修，M-D1 仅澄清术语。
