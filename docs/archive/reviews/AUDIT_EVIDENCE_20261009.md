# V0.5审核证据与覆盖范围

主报告：[ASTRA_REVIEW_20261009.md](ASTRA_REVIEW_20261009.md)。基线 `73774bfc6502eefa7bffc23dbb0fa9f873c44494`；日期2026-10-09。所有新增夹具仅使用合成内容、内存SQLite或独立临时目录，模拟生成与Embedding，不接触正式故事库。

## 1. 基线验证

在项目根目录执行：

```powershell
npm test
npm run typecheck
npm run build
npm run demo
npm run smoke --prefix runtime
```

前四项通过；原有Vitest为107文件620项，55.09秒，见[原始输出](evidence/baseline-test-result.txt)。第五项退出码1：

```text
Error: expected four daily environment steps, received 3
    at main (D:\HDSI-remake\runtime\plugin-smoke.cjs:30:31)
```

该错误存在两层原因，见主报告F8。不能把这3次调用直接解读为前三个阶段完成。

全量测试是在加入本次临时复现前运行。最终复现存放在docs中，不进入项目原有 `tests/**/*.test.ts` 集合。未修改生产源码、既有测试和smoke原文件；build重生成既有忽略目录lib。

## 2. 六项可重跑复现

在根目录运行：

```powershell
node node_modules/vitest/vitest.mjs run --config docs/v0.5/reviews/evidence/vitest.config.mts --configLoader native --pool threads
```

本次结果 **2文件通过、1文件失败；5项通过、1项失败**，786ms。完整输出：[audit-tests-result.txt](evidence/audit-tests-result.txt)。退出码1是活动归属缺陷的预期复现，不是审核工具未运行。

| 文件 | 项目 | 断言含义 |
| --- | --- | --- |
| [shared.test.ts](evidence/shared.test.ts) | F1 | 断言旧活动身份应保留；当前最后断言失败，批次及流程前提通过 |
| [school.test.ts](evidence/school.test.ts) 第一项 | F2 | 断言目前确实出现提醒不发布、无唤醒；绿色表示错误现状得到证实 |
| 同文件第二项 | F3 | 断言目前确实从已知V2回退V1；绿色不表示业务正确 |
| [memory.test.ts](evidence/memory.test.ts) 第一项 | F4 | 断言晋升前命中、晋升后及补依据后均不命中 |
| 同文件第二项 | F5深度整理 | 断言旧快照先调用并废弃，新快照再调用，共两次 |
| 同文件第三项 | F5索引 | 断言先编码过时revision，再编码当前revision，共两次 |

这些是审核证据，不是已完成的修复回归。实施修复时，school／memory的现状断言应改为目标行为，并移入正式测试；不要要求修复后的代码继续满足旧错误行为。

学校分支还针对调度、输入、概率、V1通知合同、学校知情与旧提醒例外运行了局部8文件40项测试并通过。root独立归档复跑上表6项，核对了生产调用链和关键代码，没有仅依赖分支口头结论。

## 3. 性能及状态文本基准

```powershell
npm run build
node docs/v0.5/reviews/evidence/performance.cjs
```

原始测量：[performance-result.json](evidence/performance-result.json)。Node v24.21.0；消息正文为固定合成文本，每20条一个普通段，每条对应一个已完成的精简轮记录。先进行一次有读取计数的检查，再计5次无计数包装的检查，报告中位数。种子写入和首次检查不计时。

检查数据为1千／1万／5万消息和同等数量轮记录；没有额外学校、记忆、完整冻结候选。每次完整检查消息／段表各读取6遍。统计用于比较随历史增长的成本，不能预测真实模型耗时、磁盘库峰值或正式部署总延迟。

状态文本基准为关闭搜索、每个合成已完成owner建立4个零计数阶段会话，然后调用 `SerialHost.status()`。正式完成流程只压缩checkpoint，并不删除这些会话统计，所以这里衡量的是正常留存数据的增长。测量字符数为JavaScript字符串长度；内容为合成ID，不含真实用户数据。

脚本依赖本项目构建产物，并在内存创建所有数据，运行结束关闭数据库。若未来代码已优化，重跑结果可能与已保存的本次原始数据不同。

## 4. Smoke根因隔离

```powershell
node docs/v0.5/reviews/evidence/smoke-probe.cjs --stage-only
node docs/v0.5/reviews/evidence/smoke-probe.cjs
```

脚本读取当前smoke源码，只在内存编译副本，不写回原文件。它沿用原smoke的独立临时库和离线fetch。

- 第一条只将模拟分流从 `input.stage` 改成 `input.context.stage`，仍因4次HTTP断言失败。
- 第二条同时把空周期望调用数改成3，本次退出码0，并通过原smoke后续“四步骤committed、两套计划及初始化”的检查。

这不是正式修复交付：原smoke文件仍失败，等待逻辑及有通知的V1周模拟还需要按主报告建议完善。脚本对预期源码片段作检查，未来smoke代码改变后应重新审查该诊断方式。

## 5. 文档—实现覆盖矩阵

从docs/v0.5/README.md出发阅读10份核心说明及最近修复记录，按以下责任域交叉检查。源码目录共81个文件；“覆盖”表示主流程及其相关实现经过审阅，不表示每一行都获得形式化正确性证明。

| 说明／主题 | 主要对照代码 | 结论 |
| --- | --- | --- |
| 总架构、实现对应 | app、index、storage、settings、部署与版本检查 | 主要分层／状态／版本关系对应；无需要整体重构的证据 |
| 导演与环境 | directors、environment、school | 每日串行链、周文本V1与免调用成立；F2、F3、D1需处理 |
| 调度与生活状态 | host/runtime、scheduler、state、input、probability、time | 合批、资格、睡眠、自主及概率主规则对应；F6为增长成本 |
| 记忆 | memory全部及对应模型合同 | 生命周期／容量／应用版本检查基本对应；F4、F5有确认缺口 |
| 共同活动 | host/shared、dialogue、app/recovery活动路径 | 时钟、公开确认、末轮及冻结规则主路径对应；F1违反归属约定 |
| 提示与上下文 | model全部、dialogue/activity-context、chat-episodes | 资源池、分支、权限、四段与当前活动选择对应；F6涉及查询实现 |
| 表达与表情 | output、app输出组装、发送恢复、素材工具 | 分段／字素间隔、抽样、描述文本向量路径对应；未做在线语气和新图质量验收 |
| 网页搜索 | web、deployment/web-runtime、model/client | 阶段额度、缓存B、来源及恢复有代码／离线测试支持；F7为状态展示增长 |
| 报错与恢复 | recovery、app、storage、host/runtime及相关测试 | 冻结候选、确认输出与正式提交边界主要对应；不将外部未确认发送当绝对一次 |
| README开发验收 | package脚本、runtime/plugin-smoke.cjs、demo | typecheck/build/demo通过；smoke存在F8协议漂移 |

对原有V0.5的16份Markdown做了本地相对文件目标检查，没有发现指向不存在文件的链接。检查不包含所有标题锚点和外部URL有效性；没有为了审核修改原说明的历史结论。

## 6. 明确未作为缺陷的现有限制

以下已由V0.5如实披露，本次没有将其重复包装为新问题：搜索供应商未选、语义阈值为空、校园提示存在固定人物身份、世界事件未采用学校同等知情台账、默认无人工上下文预算、表情最高相似度无阈值、在途串行请求不能即时被聊天抢占、QQ未确认窗口可能重发、07:00仅为目标、真实QQ与长期运行尚未验收。

当前人物配置、素材数量和实际模型配置未重新读取核验；本报告关于相应启用状态依据交接文档及装配代码，实际缺陷复现使用公开样例／合成配置。未运行启动脚本的正式配置检查、数据库迁移或在线供应商验收。

尚未建立充分证据的疑点没有列成缺陷，例如仅靠旧细节值发起查询的召回体验。环境步骤与网页会话的owner身份一度看似不一致，进一步追踪发现双方都是 `JSON.stringify([batchId, stage])`，已排除，不要求修改。
