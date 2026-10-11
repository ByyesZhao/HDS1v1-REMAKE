# HDSI 当前项目综合审核

日期：2026-10-11。状态：**审核完成，发现项尚未修复，优化尚未实施**。

后续材料：[细化实施方案与SOL交接入口](../../plans/comprehensive-remediation-20261011/README.md)。目前只完成方案；本报告的基线结论、探针和失败证据保持原样。

源码与文档基线：`ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`；审核开始时工作区干净。按 [V0.5 文档索引](../../README.md) 开始，对照当前说明、实现和既有测试。入口所标 `65f0785` 到当前 HEAD 只改文档，不是遗漏了一批产品源码。

## 主要结论

1. **当前 V0.5 文档整体对应实现，但不是完全一致。** 核心架构、阶段权限、记忆规则、冻结恢复和验证边界基本准确；图库维护命令不能在文档所述 browser 配置下执行，另有维护命令缺失和根 README 当前状态措辞陈旧。
2. **发现 5 项代码问题：4 项 P2、1 项 P3。** 均有离线复现。其中暂停问题确认到 Host API 微任务交错层，真实 Koishi 命令到达该窗口尚未验证；其他问题使用真实调用链／CLI 或生产 DOM 算法复现。没有发现达到 P0／P1 证据标准的问题，也不代表所有缺陷均已排除。
3. **高收益提升集中在重复数据处理和检索质量。** 优先减少网页工具循环的正文反复解析、故事提交的全量记忆读取、历史任务扫描；其次整理环境终态载荷、避免无效向量读取，再用更有代表性的语料改善记忆召回。无需先重写架构，也不需要引入上下文截断或改变容量规则。

P2 表示应排入近期修复；P3 表示较低优先级、影响明确的问题。本次没有安全审计或通用防御性编程清单。

## 代码问题清单

| 编号 | 等级 | 触发与后果 | 首要位置 | 证据与修复方向 |
| --- | --- | --- | --- | --- |
| B1 | P2 | 到期预约本轮只修正 description，原到期时间不变，却被写回 pending；无新输入立即再触发一轮。若模型持续更新则连续重复。 | `src/memory/organize.ts:61-72` | [RT-2](RUNTIME_AUDIT.md#rt-2预约的非时间修改错误地阻止完成立即再次触发)。真实 Host 一次 start 自动连续4轮，第四次特意停止更新以结束探针。区分元数据修改与显式再次执行；不禁止合法的当前时刻预约创建。 |
| B2 | P2 | 浏览器已经提取为纯文本，服务再次按 HTML 剥标签；比较式、泛型和字面标签示例被静默删改，仍计为成功阅读。 | `src/web/content.ts:15-18` | [WM-B1](WEB_MEDIA_AUDIT.md#wm-b1--p2浏览器提取出的纯文本被第二次当-html-清理静默损坏网页正文)。`List<String>` 变 `List`，`a < b && c > d` 变 `a d`。明确 provider body 格式，把 HTML 转文本限制在对应适配边界。 |
| B3 | P2 | 按当前文档使用 enabled browser 配置运行图库 import/rebuild，因没有 browser provider 在实际工作前抛错。 | `scripts/stickers.ts:23-25` | [WM-B2](WEB_MEDIA_AUDIT.md#wm-b2--p2启用-browser-搜索的配置使表情-import-和-rebuild-命令必然提前失败)。两个真实 CLI 子进程均退出1；与文档 D1 是同一问题，只计一次。按用途装配依赖，rebuild 不应依赖网页服务。 |
| B4 | P2 | Host 选好请求后、从 await 恢复前收到 pause，未再检查 paused，仍新开故事／接管等待轮。 | `src/host/runtime.ts:66-69,80-89` | [RT-1](RUNTIME_AUDIT.md#rt-1候选选择与暂停交错时暂停后仍开始新的故事工作)。暂停点为0轮／0模型调用，之后仍提交一轮。**仅 API 交错已复现，真实命令窗口可达性未验证**。选择返回后复查暂停，保留已开始整轮继续完成的合同。 |
| B5 | P3 | 嵌套 article／main 时先提取祖先全文，再追加后代全文，同一段重复进入网页材料。 | `src/web/browser/extract.ts:62` | [WM-B3](WEB_MEDIA_AUDIT.md#wm-b3--p3嵌套-articlemain-的正文会被重复拼接)。单个内层标记出现两次。选择互不重叠的正文子树，避免按相同文字去重。 |

以上是源码基线的发现，报告里的探针 exit 0 代表成功复现，**不代表已修复**。没有把格式错误、假设存储损坏或模型必然不配合当作证据。B1 的4轮样本也不等于实际模型必然无限循环。

## 文档对应性

详细覆盖矩阵见 [文档审核](DOCS_AUDIT.md)，覆盖总架构、8份子系统、3份参考、根 README 与入口。

- **D1 与 B3 合并**：表情子系统和 README 的操作承诺与 CLI 可执行性冲突。
- **D2／P3**：恢复说明 §7 写“命令与备份见 README”，但 README 没有 `memory:compact-payloads` 的使用、备份和续跑说明，尽管程序已经提供该工具。
- **D3／P3**：根 README 将旧175文件／920项验收仍称“最新”，将更早查看资格交付称“本批”；升级章节又并列“正式库已升级”和无日期的“只升级测试夹具”。应补原批次／日期或统一指向最新入口，保留历史证据本身。

没有把历史失败日志、旧基线测试数或已执行计划中的原待办误报为当前缺陷。没有重新读取私有配置／人设来认证文档里的当前配置数值；这些数值仍只由原白名单证据支持。本次只新增审核报告并挂接索引，不先行改写当前功能规则或旧交付结论。

## 高收益提升顺序

下表按消除的重复工作、预期业务收益和改动规模综合排序；定量数字来自合成样本，不是正式库实测，也不是优化完成后的承诺。

| 顺序 | 改进 | 现有成本／效果证据 | 建议规模与验收重点 |
| --- | --- | --- | --- |
| 1 | 网页轻量状态查询；正文只保存一份，以 ID 恢复工具结果 | 20页、共2M字符，工具循环产生162次snapshot，累计解析625M正文相关JSON字符；完成后operation和material仍各保存约2M正文 | 中等；保持20/40计数、缓存、已确认操作重放和修补恢复。[WM-O1](WEB_MEDIA_AUDIT.md#wm-o1--优先把网页控制信息与正文快照分开减少-json-重读及重复存储) |
| 2 | 容量／截止计算复用元数据；排序前批量取唤醒数据 | 1600条记忆未超量也物化3200个owner；只超1条长期触发3600次唤醒查询。4K正文样本无超量归一约469ms，位于串行提交事务 | 中等；不改变容量、保护及排序合同。[M1](MEMORY_PERFORMANCE.md#m1优先消除串行容量归一中的全量正文载入和排序查询) |
| 3 | 调度只查 pending／due 并在单次评价复用 | 1万已完成任务、无待办，一次collectReady＋nextDeadline仍物化4万行，样本约100–111ms；已有task_due索引 | 小到中等；保留时区语义、前台优先级和完整历史。[RT-O1](RUNTIME_AUDIT.md#rt-o1用待办工作集替代重复读取历史任务) |
| 4 | 环境终态快照压缩与废弃owner统一收尾 | 仅100条合成detail，已提交world step仍约580KB；现有compactor不覆盖。跨日superseded后网页cache和checkpoint仍保留 | 中等；仅清终态恢复载荷，保持审计身份及未完成任务恢复。[RT-O2](RUNTIME_AUDIT.md#rt-o2压缩终态环境准备快照)、[WM-O3](WEB_MEDIA_AUDIT.md#wm-o3--次优先环境任务-superseded-后回收其临时网页-owner) |
| 5 | 语义通道判断前置，跳过无用途的向量读取与冻结 | semantic未标定时，1000×1024维向量每次仍读4.096MB，随后才放弃语义通道 | 小到中等；保持配置签名与冻结语义，不需要删索引。[M2](MEMORY_PERFORMANCE.md#m2在读取向量前判断语义通道是否可用) |
| 6 | 扩展自然问句标定与独立盲测，改善记忆召回 | 同一记忆关键词能命中，加入“你还记得我送你的…”后分数降至0.6而默认阈值为1；现有夹具仅16例，validation被用于选阈值 | 中等，需样本与模型效果验收；比较漏召回、误召回及成本，不直接降低所有阈值。[M3](MEMORY_PERFORMANCE.md#m3用真实自然语言扩展检索标定比继续堆叠上下文更有价值) |

图片识别前重复读取／base64编码也可合并，见 [WM-O2](WEB_MEDIA_AUDIT.md#wm-o2--次优先合并图片资产的验证和编码读取)；有明确浪费，但相对上述路径优先级较低。

建议先修 B1、B2、B3，并补齐 B4／B5 的定向回归；性能工作先做可保持业务合同的读写优化，再做需要真实标注数据的检索质量改进。报告不是已批准或已执行的实现计划。

## 实际验证

运行环境：Node `v24.21.0`，npm `12.2.0`，Windows；时间使用上海日期。

| 检查 | 本次结果 | 证据 |
| --- | --- | --- |
| 原始全量测试 | 系统sandbox临时缓存模块加载ENOENT，184套件未能加载；不算产品测试失败或通过 | [原始日志](evidence/baseline-tests.log) |
| 指定工作区TEMP/TMP的全量测试 | 187文件／1015项通过；Chrome crashpad启动受限导致17项跳过，目录联接EPERM导致2项失败 | [全量日志](evidence/baseline-tests-workspace-temp.log) |
| 上述两组权限边界复验 | 获准在沙箱外仅跑这两组离线测试，2文件／19项全部通过；浏览器仅加载合成HTML，网络请求数断言为0，启动检查用临时合成库 | [19项复验](evidence/permission-boundary-retest.log) |
| 中途排查启动测试是否阻塞的补跑 | 排除local-web-validation-startup后，186文件／1011项通过，同样2文件权限失败；原全量已确认该startup文件4项通过，故这次不是最终覆盖来源 | [排查日志](evidence/tests-without-startup-probe.log) |
| 类型检查 | `npm run typecheck` 退出0 | [日志](evidence/typecheck.log) |
| 构建 | `npx tsc -p tsconfig.build.json --outDir .tmp/audit-20261011/build` 退出0；隔离输出，没有覆盖部署lib | [日志](evidence/build.log) |
| 离线演示 | `npm run demo` 退出0，覆盖普通消息与共同活动开闭 | [日志](evidence/demo.log) |
| 本次定向审核探针 | 运行时、网页／媒体、记忆成本探针均成功执行，观察值见JSON | [运行时](evidence/runtime-probe-output.json)、[网页媒体](evidence/web-media-probe.json)、[记忆](evidence/memory-performance.json) |
| 审核材料与变更范围 | 5份报告的本地文件／标题链接检查通过，证据JSON可解析；`git diff --check`通过，产品源码／脚本／既有测试／包与runtime无差异 | [材料检查](evidence/document-verification.json) |

因此，**既有189文件／1034项测试经分次复验均有通过记录**；不是声称单次受限命令全绿。现有测试没有覆盖本次发现的这些触发组合，所以它们通过与本报告发现问题不矛盾。

未执行正式启停、构建部署、真实库升级或修复，未调用真实QQ、搜索站点或供应商模型，未重复完整双场景插件smoke。未验证数月运行、正式库增长率、线上暂停窗口、实际模型重复预约的概率。计时样本只用于识别重复工作，不能代替生产负载验收。

本次报告由三个独立范围审核与主审核汇总；另做交叉复核，收窄了暂停与预约的因果表述，确认网页损坏发生在实际生产接口链路。覆盖是基于业务风险的静态审阅与定向动态验证，未声称312个源码／测试文件全部逐行证明正确。

## 阅读顺序与复跑

1. 本页：结论、优先级和验证边界。
2. [DOCS_AUDIT.md](DOCS_AUDIT.md)：文档覆盖矩阵与2类文档问题。
3. [RUNTIME_AUDIT.md](RUNTIME_AUDIT.md)：调度、预约、暂停、环境与任务历史。
4. [WEB_MEDIA_AUDIT.md](WEB_MEDIA_AUDIT.md)：网页、CLI、图片与工具续接。
5. [MEMORY_PERFORMANCE.md](MEMORY_PERFORMANCE.md)：记忆数据路径、成本和检索质量。

从仓库根目录执行三个探针即可复跑本批合成证据；Windows沙箱中可先将 `TEMP`／`TMP` 指向已创建的工作区临时目录：

```powershell
npx tsx docs/v0.5/reviews/comprehensive-audit-20261011/evidence/runtime-probe.ts
node --import tsx docs/v0.5/reviews/comprehensive-audit-20261011/evidence/web-media-probe.ts
npx tsx docs/v0.5/reviews/comprehensive-audit-20261011/evidence/memory-performance-probe.ts
```

这些是审核基线探针，不自动列入 `npm test`；修复实现后应把对应期望改成产品合同并移入正式回归，不让“成功复现旧错误”的断言继续冒充验收。
