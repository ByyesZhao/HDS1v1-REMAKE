# 记忆V0.3及共享搜索：实施交付与审核入口

> 历史累积文档：2026-10-09起当前架构说明由[V0.5总架构](../REMAKE_V0.5.md)及其子系统文档替代。本文保留各次修改、旧规则和当时证据，不再作为当前系统入口；请勿将旧正文与最新规则混用。

提示词／上下文V0.1现状：普通聊天默认最近4个完整普通段，普通双方实际消息后空闲15分钟关闭，当前计入；共同活动整体不占4段、不刷新普通锚点。活动工作阶段使用本场完整授权原文；结束后由逐轮短期记忆统一检索召回，跨结束未读输入仍直接可见。关闭普通段仍可在4段窗口内，无30条二次裁剪。模型资料按身份合池和阶段职责投影；无新来源免记忆整理，明确超限报错暂停且不自动裁剪。历史测试数字只描述原交付。本期入口：[实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)、[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。


日期：2026-10-07。用户授权顺序为记忆执行计划任务1～7，再搜索执行计划任务1～6；两计划离线核心已完成。正式HDSI/SnowLuma未由本次检查启动，未新增真实供应商请求。当前目录无Git，源码／文档保留在本目录，原始文件及正式库备份在runtime/implementation-backup-20261007；不虚构分支、提交或合并。

## 已实现范围

- 详细短期七天；同时建立简要预备长期，通常七天后生效，重要经历立即生效。长期九十天，按上海日期去重，三次有效重谈续期，三十个有效日期进入常驻评估。来源、真实进展、合并身份和期限由程序执行，叙事真伪及感受含义由任务提示约束。
- 固定细节、短期、长期及learned投影统一检索。Embedding独立配置、归一化Float32索引、1500ms查询超时及词法回退；相关性在RRF60之前筛选。默认人工字符／条数预算均null，近期原文窗口4个完整对话段／15分钟。真实语义阈值未标定时不启用semantic-only。
- 压缩和索引共用一个异步准备槽。结果先保存ready，旧轮／到期环境／故事优先，合批期间不应用维护；每个同步单元后真实setImmediate让位并重查输入。readSet／stateVersion防止覆盖前台新进展；后台超时120秒、失败五分钟后重试，不全局暂停。
- 进程内共享WebSearchService，四张辅助表保存阶段、操作、正文及本人阅读来源。十一种角色按需搜索，各逻辑阶段独立20成功正文／40失败，任一到限停止；缓存B跨阶段首次取得分别计1，同阶段重放计0，HTTP调用数另记。
- 请求、修补、一次本地补查及工具续调用的私有检查点持久化。未冻结重生成及恢复保留身份／计数；正文成功提交模型后、最终JSON解析前登记实际提供。世界／学校最终URL白名单由实际提供快照产生。
- 只有personal_life实际阅读产生self_web_read，可无聊天来源支持查阅类短期。记忆整理获得正文及个人思想／情绪，七天摘要保留查阅性质；仅网页来源仍不能修改私人details或提交awaken。已冻结发送按旧流程续发，不重新搜索。
- 各任务仍独立Flash/Pro连接：八项low，记忆整理／压缩／新图描述三项high。真实搜索provider未选，webSearch.enabled=false；没有假供应商生产回退，不新增服务或模型。

第七轮审核修正：archive同样尊重预备长期生效时间；控制字段不落库或回传，事件已知范围与常驻投影元数据同步；应用失败整体回滚后五分钟再应用ready结果。搜索取消配置来源候选／兜底，不足反馈“结果不足”和实际取得页数，角色可询问用户；非法候选按步骤记失败并继续。详见[第七轮修正记录](REVIEW7_FIX_IMPLEMENTATION_20261007.md)。

## 最终验证

| 检查 | 最终结果 |
| --- | --- |
| npm test | 42文件，200测试通过（21:27审核修正完整回归；此前20:22为177项） |
| npm run typecheck | 退出0 |
| npm run build | 退出0，lib已重新构建 |
| npm run smoke --prefix runtime | 真实Koishi Context离线加载通过，含人工细节后台索引应用 |
| start-hdsi.cmd --check | 插件／本地配置／schema3及67素材就绪，未联网 |
| start-snowluma.cmd --check | 启动文件及Node版本通过，不启动服务 |
| 人工三／六个月规模样本 | 各1万条记忆，100相关／0误召、30原文、1页21004码点，长正文尾部保留 |

规模文件：[web-context-observation.json](../runtime/data/web-context-observation.json)、[memory-retrieval-calibration.json](../runtime/data/memory-retrieval-calibration.json)。记录的是人工数据和离线时延；请求字符数不是token换算或供应商容量验收，小规模标注不能代表实际人物聊天效果。web:check、memory:check均为离线检查命令。

## 独立复核及单轮修复

按executing-plans技能做一次新上下文、只读复核；无Critical，四项Important，无单列Minor。复核不读取密钥／真实背景、不联网、不启动服务；报告由主执行者收录。四项均先写回归，观察4/4失败，再修正通过，最后全量177项通过，没有另派重复复核。

| 问题 | 已落地修正 | 证据 |
| --- | --- | --- |
| merge只引用短期而越过readSet写长期 | 要求短期所关联长期同单元；canonicalId必须长期，至少两项长期；涉及learned投影的版本由程序补入readSet | memory-final-review第1项；既有维护冲突回归 |
| lookup中断恢复漏合同ID | 恢复私有lookup材料时恢复可操作short／long／learned ID；不再次补查或重置修补 | memory-final-review第4项 |
| durable主记录变化但召回旧投影 | durable_experience正文／版本／索引同步；stable_understanding保留多事件结论，附当前projectionBasis并纳入检索文本和版本保护 | memory-final-review第3、6项 |
| 合并后短期关联旧副ID导致压缩无解 | 维护快照把linkedLongId解析为canonical身份；原记录保留追溯 | memory-final-review第2项 |
| 同一问题的合并补验 | 两个常驻经历合并后重复投影标merged，旧learned ID继续解析主身份；有效投影只返回一份 | memory-final-review第5项，先RED后GREEN |
| 停止收尾补验 | 调用入口及每次checkpoint保存前检查Abort；即使重放已完成操作也不在stop后写检查点 | web-model-tools第6项，先RED后GREEN |

索引文本模板已升级memory-v3-text-2，投影新依据参与索引，旧配置／旧revision不混用。稳定认识新依据的语义理解仍依靠模型；没有增加自动人格重写或语义审核模型。

## 仍需后续接入／审阅

| 项目 | 当前状态 |
| --- | --- |
| 正式库迁移 | 已备份并迁移schema3；迁移时无未完成轮、故事记忆0、固定细节0、素材67；16项初始细节在用户首次启动故事时初始化 |
| 真实Qwen语义标定 | 待授权发送实际标注样本后标定；当前词法门槛来自分离的人工训练／验证集，semantic-only关闭 |
| 核心背景与可变细节拆分 | 私有候选及来源／差异已生成；selection为空，核心候选仍含全部原文，未切换生产背景入口；不自动删段 |
| 搜索供应商 | 用户明确延期选择；接口／离线核心完成，尚不能真正搜索。选择服务后定义认证配置并注入provider |
| 真实人物效果、QQ与供应商容量 | 本次离线范围不能验证；启动和正式联调由用户后续安排 |

## 实施取舍及代价

这是两份ledger的Ruling汇总；不是未修复缺陷。

1. 无Git时直接在获准项目实施，以备份和ledger代替提交。若回退，需按备份逐文件恢复。
2. 记忆先定义self_web_read合同，搜索后实现实际登记。只开放短期操作；如果后续扩充其他来源，须另改相应合同。
3. 用(ownerType,ownerId,stageKey)固定逻辑身份；重生成变体不补额度。未来同阶段多次独立业务调用须显式区分stageKey。
4. 禁用搜索时仍保存阶段私有检查点，web=null不借其他会话。代价是正式SQLite包含阶段输入，不属于可直接交审的脱敏材料。
5. 已有能力的来源／恢复／规模测试作为补验，不冒称每项都先RED。主要新增能力有RED→GREEN证据，最终另做独立复核与全量回归。
6. 稳定认识保留原多事件结论并附更新依据，不用单事件摘要自动重写结论。模型须理解projectionBasis；语义效果仍需真实人物联调。

复核暂不判断的真实provider、Qwen／容量、背景切换及QQ均按上表明确延期，不用离线证据补成已验收。没有遗留的独立复核Minor。

## 交给DSH的材料

优先交本文件、四份直接细化／执行文档和两份实施ledger；若审核实现，同时交src/、tests/、scripts/、package.json、examples/story.sample.json、runtime/check.cjs、runtime/plugin-smoke.cjs及两份启动脚本。特别检查上述四项修复与源代码合同、版本保护及恢复是否一致。

四份规范：[记忆细化](MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[记忆计划](MEMORY_V0.3_EXECUTION_PLAN_20261007.md)、[搜索细化](WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)、[搜索计划](WEB_SEARCH_EXECUTION_PLAN_20261007.md)。过程：[记忆记录](MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md)、[搜索记录](WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md)。根目录六份REMAKE文档已同步其他行为；DSH-review及旧zip继续保留历史，不充当新交付包。

密钥、正式背景、config.local.json、正式SQLite及私有候选不在通常脱敏审核材料中；需要审核人物内容时由用户决定提供范围。



本轮最终独立复核：Critical／Important／Minor均0，未发现需追加修正项。最终证据为42文件200测试通过，类型／构建／真实Koishi离线smoke／两个启动文件--check全部通过。任务1～5完成，详见REVIEW7_FIX_IMPLEMENTATION_20261007.md；代码与记录留在新项目，服务未启动。
