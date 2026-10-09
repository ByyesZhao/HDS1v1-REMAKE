# SDD ledger — plan: docs/WEB_SEARCH_EXECUTION_PLAN_20261007.md

2026-10-07。记忆任务1～7离线核心完成后开始搜索任务1～6。依据搜索业务细化与执行计划，不另开服务／模型／后台槽。真实搜索供应商按用户决定稍后接入，当前仅可替换接口和假provider离线验收。正式服务保持停止，密钥及角色正文不打印、不传作测试。

## 预检与约束

- 复用记忆ModelRunOptions、唯一前台及后台槽、程序self_web_read来源和同步事务。
- 每逻辑run独立20成功／40失败，续调用／修补／恢复不重置；缓存B按session首次正文份数，各阶段各自计1。
- 新增四辅助表；阶段输入及lookup检查点私有，公共缓存仅同owner公开正文。
- 目录无Git，检查点写本ledger，不创建虚构提交或自动额外任务。

## 任务进度

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1 协议与正文 | 完成 | 2文件4测试及typecheck |
| 2 会话持久化 | 完成 | 4文件19测试；临时SQLite部分操作恢复 |
| 3 模型工具循环 | 完成 | 2文件8项；schema／提供时点／私有检查点／容量错误 |
| 4 全阶段与来源 | 完成 | 阶段、来源、恢复及既有回归；最终全量覆盖 |
| 5 配置与宿主 | 完成 | 6文件20项；真实15秒输入、后台网页deferred、pause／stop |
| 6 交付核对 | 离线核心完成 | 独立复核四项修复后39文件177项；typecheck/build/smoke/两个cmd --check通过 |

## 检查点

Task 1 complete — 类型／HTTP URL规范化／正文整理／工具协议／未配置provider已实现。缺模块RED，2文件4项GREEN及typecheck。长正文>12000尾部保留，码点计数含空白，搜索列表不是正文，空正文拒绝；未接真实服务。

Task 2 complete — 四辅助表、稳定stage身份、逐子结果事务、session串行、独立20／40、公开缓存B与owner释放、文件重開恢复已实现。缺模块RED后4文件16项通过；新增旧操作当前counter及全部候选已读无资料测试出现2项RED，修正为重放报告当前计数、无未读候选记no_candidates失败后4文件19项通过。多页2成功／1失败后中止，重开只读剩余一页变3／1，不重新搜或扣旧结果；事务失败正文／counter／位置一起回滚。请求次数、cacheHits与页面额度分别记录；正常步骤未联网。

Task 3 complete — 工具循环／本run私有checkpoint／实际工具schema／逐请求signal接入完成。五项新测试全部RED后实现，连同调用上下文两文件8项GREEN及typecheck；合法webSearch→webRead→lookup→业务JSON不消费修补，错误业务JSON只增加修补；材料随成功HTTP响应实际提供后、最终parse前markProvided；失败模型请求不造来源、不裁上下文重试。已保存pending操作恢复后使用同operationId；lookup及修补不重置。后续补验确认格式修补前已提供的正文也可登记，来源ID和firstOperationId稳定。

Task 4 complete — 故事narrative/personal/expression/memory、环境environment、维护consolidation及独立素材asset入口统一phaseOptions；Flash/Pro与强度仍按原角色连接。四项阶段测试先RED，接入后GREEN；一次失败由SQLite无ORDER BY的随机UUID行顺序造成，修正夹具按名称比较，不改变业务顺序。动态providedUrls允许新URL，未提供正文则拒绝；记忆获本人来源、正文、生活思想／情绪。新增恢复／来源／共享场景／素材补验通过，重放不续期，生活阅读可无聊天来源建短期，details／awaken仍拒绝仅网页来源。查阅知识不变亲历属于提示职责，程序验收来源身份及保留文本，不声称语义判断器。冻结发送失败后不重搜；未冻结重生成保留原run及正文。

Task 5 complete — webSearch默认disabled及20／40，生产唯一assembleWeb，移除getWebMaterials及12000截断；webSources只作模型申请后的初始候选。两项部署测试RED后实现；后台deferred测试初始未起动是夹具只建长期且未满足维护条件，改为真实到期short＋linkedLong后通过。6文件20项及typecheckGREEN：网页未返回时输入立即落库、15秒后发送confirmed且turn done，pause可保存ready但不应用，stop透传Abort且晚到正文不写库。status按session及owner展示数值元数据，不加载query／正文／认证；未接真实provider不能启用，不静默替换为假或Codex服务。

Task 6 checkpoint — 38文件170项完整回归及typecheck通过。web-integration临时文件库在模型失败后重开，四阶段完成、post来源保存、outbox confirmed；新进程公开缓存丢失但原run正文恢复不重读。三／六个月人工规模报告runtime/data/web-context-observation.json：1万条记忆，各返回100相关／0误召、30原文、注入1页21004码点且尾部保留，离线129／107ms；记录请求字符数115663，不转token或供应商容量结论。正式配置及样例均显式webSearch.enabled=false；服务未启动，未发真实网络。

Ruling: 阶段身份采用(ownerType, ownerId, stageKey)唯一键；未冻结重生成即使互斥taskName变体变化，也更新角色元数据并保留同runId／原计数 — 执行计划要求未冻结重生成不补充额度 — 若未来需要同一业务阶段多次独立调用，必须显式扩充stageKey。

Ruling: 配置默认禁用时仍登记私有阶段checkpoint，未提供的web=null不借用别的session — 保持恢复和隔离接口一致 — 代价是SQLite保存各阶段输入，审核时不应分享正式数据库。

Ruling: 来源／恢复及规模测试在已有阶段接入后作为补验新增，不虚构每项曾出现RED；任务3／4／5主要能力均观察到失败再修正 — 后续记录区分开发门禁和复核补验 — 如遗漏行为，最终独立复核与全量回归负责发现。

Task 6 complete — 独立新上下文只读复核发现四项Important，无Critical／单列Minor；memory-final-review四项先4/4 RED，修正闭合合并读写、恢复补查ID、canonical快照与常驻投影后GREEN。同一修复轮补验常驻别名合并先RED后归并投影GREEN，稳定认识新依据及投影stateVersion冲突补验通过。最终2026-10-07 20:22：39文件177项通过，typecheck/build退出0，真实Koishi离线smoke及两个cmd --check通过。详见IMPLEMENTATION_HANDOFF_20261007.md。两计划已完成离线核心；供应商、真实Qwen阈值、背景审阅和QQ联调明确待办，未启正式服务、未新增网络验证。

收尾补验：已Abort的run重放已完成操作仍保存checkpoint，先观察web-model-tools第6项RED（2次保存），调用入口及save均检查signal后GREEN（0保存／0transport）。随后重新全量39文件177项及构建／类型／离线smoke／启动检查通过；未跳过代码变化后的验证。



## 第七轮审核修正（2026-10-07）

用户取消配置来源自动候选及不足兜底：零／部分结果直接保存“结果不足”及requestedPages／obtainedPages，工具续调用交回同模型，角色可按场景询问用户，不强制给答案。非数组provider结果记search_error；非法／非HTTP(S)候选逐项记read_error，确认步骤和失败一起提交、继续合法项，40失败停止，恢复不重计。webSources只保留HTTP(S)兼容配置，不自动抓取。合法工具不占修补；成功接受工具清理旧repair提示而不重置累计次数，违规仍有有限修补。

新网页9项（主要7项先RED再GREEN，40失败和中断恢复两项为补验）通过；保留缓存B与各阶段20／40。无未读候选的新搜索计一次no_candidates，重放旧operationId不计；每页材料／计数／推进同事务，整个操作done／response另事务。21:27完整42文件200项通过，类型／构建／离线smoke／启动检查均通过。后续独立复核及最终结果见REVIEW7_FIX_IMPLEMENTATION_20261007.md；原日志中的初始候选行为是本轮修改前的历史记录。


本轮最终独立复核：Critical／Important／Minor均0，未发现需追加修正项。最终证据为42文件200测试通过，类型／构建／真实Koishi离线smoke／两个启动文件--check全部通过。任务1～5完成，详见REVIEW7_FIX_IMPLEMENTATION_20261007.md；代码与记录留在新项目，服务未启动。
