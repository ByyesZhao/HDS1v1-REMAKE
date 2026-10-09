# HDSI 共享网页搜索模块设计

日期：2026-10-07。状态：搜索业务细化；六任务离线核心已完成，实际验证见WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md。由用户在记忆V0.3终检时提出，配合[记忆实施细化](../memory-v0.3/MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[记忆执行计划](../memory-v0.3/MEMORY_V0.3_EXECUTION_PLAN_20261007.md)和[搜索执行计划](WEB_SEARCH_EXECUTION_PLAN_20261007.md)使用。保留本文件名，不另复制一份同内容的搜索细化；用户已选择先保留可替换接口，稍后选服务。四份是本次记忆＋搜索改造的直接依据，审核历史只作追溯。

本轮已并入[第六轮审查回应](../../dsh-review/CODEX_REBUTTAL_WEB_SEARCH_20261007.md)中的澄清，并加入用户随后确认的生活个人导演查阅内容可进入短期记忆规则。

## 1. 用户已确定的规则

- 所有模型阶段都允许按需要搜索，包括世界、学校、普通／共同主叙事、聊天／生活／共同个人导演、表达、记忆整理、记忆压缩及新表情包描述。
- 各次逻辑模型任务独立计算：最多成功读取20次，失败40次，成功和失败不合并成同一个总次数。
- 失败后，只要成功次数未达20且失败次数未达40，可以继续尝试。
- 生活个人导演代表虚拟角色本人查阅网页，其读到的内容可进入短期记忆；具体来源和经历边界见§3.3。
- 默认不设置人为字符／token输入预算；记忆先相关检索，只发送选中的相关内容。
- 实际接口返回容量错误时保留报错路径，不自动删除低相关历史重试，不修改数据库记忆。
- 当前离线核心已实施，正式服务未启动，未新增真实网络请求；证据见WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md。

## 2. 模块边界

建议建立**HDSI进程内的共享搜索模块**，不另装一个常驻服务或单独启动第三个程序。

同一个WebSearchService提供搜索、候选去重、页面读取、正文整理、来源登记和计数；每个逻辑模型任务建立并沿用自己的WebSearchSession，恢复时不因重新进入runModel就新建session。共享的是实现和搜索适配器，不是剩余额度或可见聊天上下文。

改造前src/index.ts的getWebMaterials只读配置URL并截取12000字符；现已移除。当前可替换provider、模型工具循环及阶段合同已实现；webSources保留兼容配置但不自动注入搜索候选，也不作为不足时兜底；真实搜索供应商尚待接入。

## 3. 会话与计数

### 3.1 会话归属

sessionId绑定逻辑模型调用：故事阶段用turnId＋taskName＋同名调用序号，维护阶段用jobId＋taskName＋调用序号，独立素材工具用自己的任务ID。世界和个人导演分别拥有20／40；同一轮的叙事和个人也分别计数，不共享一池额度。

序号由业务层为新逻辑任务分配一次并持久化，形成runId/sessionId；不是transport.complete请求次数，也不是每次进入runModel函数就自增。恢复同一任务时沿用原runId，只有业务上真正新建任务才分配下一序号。

一个模型阶段内部的多次搜索、搜索后的续调用、局部细节补查后的续调用及格式修补，始终复用同一个session，不重置计数。改变关键词也不获得新配额。任务真正结束后session完成，下一次独立任务才建立新session。

持久化已确认的计数、材料和阶段归属，恢复可复用已保存材料及剩余配额。未知远程结果不臆造为成功，不要求推断供应商侧状态。

每个已确认子结果的材料、计数、步骤去重标记及候选推进位置同事务保存；整个operationId的done／response另用一个同步事务保存，再用于模型续调用。两者之间中断按已确认步骤恢复，不重复读页或扣额。恢复重放已完成操作只读保存结果，不重新请求provider。相同query不等于同一operationId：新操作重新搜索并继续取得未读页面；本期不缓存查询结果列表，公共缓存只含公开正文。

### 3.2 成功、失败与停止

建议采用以下可检查的计数口径：

- successReads：本session首次取得一份可用网页正文，包括从公共缓存首次取得；搜索结果列表不算成功读页。重放已取得的材料不重复计数。
- failures：未取得可用资料的尝试次数，不等于网络故障次数。页面网络错误、非成功状态、不可用／空正文，以及搜索接口错误、无候选均计一次；区分保存原因，同一失败不重复计数，重放已保存失败不再次计数。新搜索没有任何未读可用材料且未记过页面失败时计一次no_candidates，包含“候选已全部读过”，不伪报为网络错误。直接复用本session旧正文或重放同operationId计0。
- 成功与失败互斥计数；失败不占成功20次，成功不消耗失败40次。
- 开始一次操作前检查 `successReads < 20 && failures < 40`；任一上限达到后不再启动新操作。
- 达到目标、候选已耗尽且没有可继续的来源时可以提前结束，不要求凑满20次。
- 同一session已读URL在发请求前去重；重复材料不重复注入。若一份公开正文被另一阶段使用，它仍计入另一阶段自己的成功读取次数。

缓存计数明确采用B：20次约束的是**每个逻辑任务首次取得的可用页面份数**，不是网络抓取次数或服务收费次数。同一故事轮内，主叙事、个人导演、表达、记忆整理若各自申请并首次取得同一份缓存正文，四个session各记successReads=1、各剩19次；不从同一个20次池扣成剩16次，也不重复抓取网页。同session再次提供这份正文计0。这里只规定本地额度，不能据此推断供应商账单；实际是否调用搜索／读页provider另行记录，公共缓存不共享阶段私有上下文或赋予额外来源权限。

不采用同轮跨阶段复用计0的A，否则后续阶段可在复用若干页面之外再首次取得20份材料，改变“各阶段最多读取20页”的口径。也不采用进程全局只计一次的C，以免额度随缓存积累失去对各任务首次取得材料的约束。阶段无需申请的网页不自动注入，不因其他阶段读过就自动扣额。

示例：18成功＋3失败可继续；19成功＋39失败也可尝试下一次；20成功＋5失败停止；8成功＋40失败停止。不能把18＋3=21解释为已经达到成功额度。

上述“搜索接口失败／无候选计失败”是本设计补齐的工具计数口径，用于保证一次搜索动作既有资料进展或失败反馈，不增加第三套随意次数上限。用户给定的20／40独立额度不变。

累计40次无资料尝试后，结束的是当前逻辑任务的网络探索，不永久禁用模型；下一独立session仍有自己的20／40。不用“高度相似query”的模糊判断代替额度控制。

单次webSearch可带requestedPages，默认1；实际新取得数量不超过session剩余成功额度。失败时可换候选继续尝试。模型可分多次用不同关键词搜同一任务，不必首次搜索就用满20次。搜索分页／换候选共享原session。

结果不足时保留已有可用正文，工具反馈message="结果不足"、requestedPages与obtainedPages；没有资料时仍正常反馈。不得自动读取webSources凑结果，不要求强行给出答案。模型可保留未知／不确定；对话个人导演可结合角色处境自然向用户询问或请求补充，通过原reply与表达合同发出，其他阶段不直接发消息。未满足页数本身不补扣缺少页数对应的失败；无新材料尝试仍按上面的no_candidates规则计一次。

适配器返回非数组结果记一次search_error。候选中的非法／非HTTP(S) URL按候选步骤记read_error并继续合法项，确认推进及失败同事务，恢复不重计；达到40失败即停止。配置webSources也限定HTTP(S)，但不自动读取。

1是单次默认需求，20是整个逻辑任务的成功额度；session内逐个派发页面操作并检查门禁，不能先并发发出一批、完成后再发现超过额度。

### 3.3 生活个人导演查阅内容进入短期记忆

用户明确许可personal_life代表角色本人查阅的内容进入短期记忆。这包括值得记住的知识、资料细节，以及生活个人导演实际输出的相关想法和感受；不要求额外找一条聊天消息作来源，也不要求每读一页必建一条记忆。

成功正文作为工具材料实际提供给personal_life后，程序登记稳定的self_web_read来源ID，关联turnId、runId、operationId、materialId、URL、readAt和阶段身份。原WebMaterial仍是external_reference；新增来源表达“角色本人本轮查阅了这份资料”，不改变网页本身的来源性质。恢复时复用同一个来源ID；材料重放本身不再构成一次新查阅经历。

每轮记忆整理实际取得这些本轮来源后，可单凭合法self_web_read ID新增／更新查阅类短期记忆。记录可写“她查阅了资料，了解到……，因此觉得……”，保留知识内容，不只保存访问动作。感受必须依据个人导演的实际输出，不能从网页臆造。网页报道中的他人事件不能写成角色亲身经历，阅读时间和报道事件时间分开。

七天后按通常流程退出详细短期、形成简要长期，并保留查阅性质及来源；不因转长期变成亲历。不将全部网页自动归档，也不直接写入作者核心背景或私人细节。这个许可只扩充shortTermChanges的来源白名单；detailChanges和longTermChanges.awaken仍按原来源规则校验，检索命中本身不能唤醒记忆。其他阶段搜索仍是辅助资料，不自动登记角色本人查阅来源。

## 4. 所有阶段可搜索，但职责与可见性不变

搜索词只能依据该阶段已合法取得的信息；模块不自行读取未看QQ消息或绕过故事门禁。普通主叙事不能从本轮未看私聊生成搜索词。各阶段不把全部角色背景和聊天记录作为搜索query上传。

网页是资料，不是可以覆盖系统规则或修改模型合同的指令。返回材料明确标为external_reference，包含URL、标题、正文、读取时刻和来源ID；缓存不会把其他阶段的私有上下文一并返回。

| 阶段 | 搜索资料的用途与边界 |
| --- | --- |
| 世界／学校 | 获取公共信息或学校相关资料，web_reference事件的引用必须来自本session实际提供的网页，不引用只见过搜索摘要但未取得正文的URL |
| 主叙事／个人导演 | 补充知识、公开背景和与当前可见话题相关的资料；网页资料不自动成为角色已经做过的事 |
| 生活个人导演personal_life | 代表角色本人查阅；实际取得的内容可按§3.3作为查阅类短期记忆来源，保留知识、想法和有依据的感受，不把报道事件写成亲历 |
| 表达 | 可核对草稿既有知识或措辞，继续只表达已决定的回复意图；不引入草稿外的新事实断言、安排、经历或行动 |
| 每轮记忆整理 | 基础来源仍遵守原门禁；新增／更新查阅类短期允许本轮personal_life的self_web_read来源。记忆模型自己的搜索仍是辅助资料，不制造角色亲历或私人事实 |
| 后台记忆压缩 | 在固定业务快照上补充公开知识，不再读取快照之外的正式记忆；网页材料另外保存为本job外部依据，不替代原事件来源，正式应用仍校验stateVersion |
| 表情描述 | 可辅助理解文字／符号背景，实际画面描述仍以图片为依据，不用搜索资料臆造图中内容 |

后台阶段搜索属于原后台准备槽内的计算，不占前台故事槽，不新增并行故事。前台搜索是该阶段主动申请的等待；用户已允许更久等待，其余原串行语义继续保留。

不能将11种任务都乘20当作单个故事轮的220页：普通／共同叙事及三类个人导演各选一种，世界／学校另开环境轮，后台压缩和素材工具独立。按当前控制流，完整普通故事轮至多叙事、个人、表达、记忆四阶段，四者均用满时共80次成功取得正文；缓存命中也计数，不能等同HTTP请求数。保持阶段独立额度，不另加跨阶段总上限；统计可按turnId／jobId汇总。

## 5. 模型调用与接口草案

沿用现有JSON工具请求方式，在ModelClient支持与lookupDetails平行的webSearch请求。搜索结果作为工具材料交回同一模型任务，再续调用；续调用及修补沿用原模型与思考强度，不新增一个“统一搜索模型”。

```ts
interface WebSearchRequest { query: string; requestedPages?: number }
interface WebMaterial {
  id: string; url: string; title: string; body: string; readAt: string;
  bodyCharacters: number; // 实际提供正文的Unicode码点数（含空白），不是上限
  selectionMode: 'full_body' | 'relevant_passages';
  sourceKind: 'external_reference';
}
interface WebSearchCounters { successReads: number; failures: number }
interface WebOperationOptions { operationId: string; signal?: AbortSignal }
// 与记忆执行计划的共享类型一致；仅由程序在personal_life收到正文后登记。
interface SelfWebReadSource {
  id: string; turnId: string; runId: string; operationId: string;
  materialId: string; url: string; readAt: string;
  sourceKind: 'self_web_read'; phase: 'personal_life';
}
interface WebSearchResponse {
  materials: WebMaterial[]; counters: WebSearchCounters;
  stopReason: 'quota' | 'satisfied' | 'no_candidates' | null;
  requestedPages?: number; obtainedPages?: number; message?: '结果不足';
  failures?: Array<{reason: string; url?: string}>;
}
interface WebSearchProvider {
  search(query: string, signal?: AbortSignal): Promise<Array<{url: string; title: string}>>;
  read(url: string, signal?: AbortSignal): Promise<{title: string; body: string}>;
}
interface WebSearchSession {
  id: string;
  searchAndRead(request: WebSearchRequest, options: WebOperationOptions): Promise<WebSearchResponse>;
  readPage(url: string, options: WebOperationOptions): Promise<WebSearchResponse>;
}
```

WebSearchProvider可由HTTP搜索服务或浏览器方案实现；不将当前Codex聊天的工具当成已部署给HDSI的运行时能力。ModelRunOptions增加本次session／runId，不使用全局可变计数。合法且当前可用的工具请求不当成最终JSON合同，也不消耗格式修补额度；两类工具的结果都先回同任务，再要求最终业务JSON。非法参数或工具撤下后仍请求工具，沿既有有限修补处理；最多两次修补机会，持续违规的第三次响应失败，已有repairCount不重置。成功接受合法工具后清理旧repair提示。

模型也可用webRead申请读取一个已知URL或已读页面中的相关链接；readPage与searchAndRead共用本阶段计数，跟进链接不获得新20／40。不自动将配置来源URL加入搜索候选或用作不足兜底；只有模型明确申请的URL才经webRead读取。

世界／学校的URL白名单要随本session实际读到并提供的材料更新，不能在模型开始搜索前冻结为空集合。已确定的材料与计数保存后再继续模型，便于复盘和恢复。

解析最终环境JSON前，合同读取本session已实际提供URL的快照；只有搜索摘要的URL不入白名单。后台webRead可读取业务快照中未出现的公开URL，另存外部依据；业务快照限制正式记忆／状态读取，不限制公开URL集合，stateVersion/readSet校验不变。

检索／正文整理删除导航、脚本、广告等无关部分，选相关资料供模型；不按12000字符硬截正文，也不默认将20页所有HTML一起注入。搜索读取额度约束操作数量，不等于接口上下文容量保证。实际超容量仍遵守用户选择的报错路径。

## 6. 与记忆V0.3的衔接

搜索配置归独立WebSearchConfig，核心参数为maxSuccessReads=20、maxFailures=40；不塞进ContextLimits。记忆两份文档已撤去拟议网页字符配置，以本模块读取规则承接网页能力。记忆的人为预算仍默认关闭。

记忆相关性判断在RRF之前完成：确定key／别名保留精确入口；词法路过滤通用词的弱匹配并按有效词覆盖度筛选，向量路按标定相关性筛选。RRF只负责已合格候选的排序，不负责把所有非零命中认定为相关。不要因搜索模块新增而恢复固定Top K。

搜索适配器、工具循环、恢复与装配已单独列入搜索执行计划；无需重写记忆生命周期。sourceIds门禁仅增加用户明确许可的本轮personal_life self_web_read短期来源，不开放所有external_reference；记忆实施细化及执行计划同步此规则。只完成记忆任务不代表搜索已实现。

## 7. 必须验收的行为

1. world session和personal session各自可成功20次，一个耗尽不影响另一个；相同阶段多关键词／补查／修补不重置。
2. 18成功＋3失败仍可继续；任一到20／40时停止新操作；失败换候选直到目标满足或预算耗尽，不按成功失败之和判断。
3. 搜索结果列表不冒充读页；空查询结果／失败反馈按失败口径记录，不无限续调用；材料去重、来源可追溯。
4. 普通叙事未看私聊不出现在搜索词；网页报道不能成为角色亲历来源，personal_life本轮查阅内容可进入短期；背景压缩只使用快照及已登记外部资料。
5. 同任务工具续调用沿用角色模型／强度；与本地补查并存；格式修补、正常pause、stop及重启计数／材料衔接正确。
6. 超12000字符网页正文尾部默认保留；全库记忆不随搜索请求送出；实际上下文错误不触发自动删历史重试。
7. 阻住后台搜索请求时，前台聊天仍能按原让位规则推进。
8. 40次无候选停在0／40，第41次不请求；15／39再失败停在15／40，19／10再成功停在20／10；19／39最后成功或失败分别停在20／39、19／40，均拒绝下一操作。不能产生25成功／45失败的正常状态。
9. 持久化2成功／1失败后重开，重放仍为2／1且provider零调用；新取得一份材料后为3／1；另一session首次使用公共缓存为自己的1／0。
10. personal_life本轮self_web_read无聊天来源也可建查阅类短期；其他阶段网页ID、未实际提供的材料不能冒充该来源，也不能仅用它修改私人细节或提交唤醒。七天归档后仍保留知识及查阅性质，重放不制造新事件进展。
11. 相关正文保留尾部标记，提供相关段落时标明selectionMode；按阶段观测输入字符数。离线样本验证相关性和输入规模，不用字符数推断已通过供应商容量测试；真实联调记录实际调用数及容量错误数，报错策略不变。
12. 同轮四个不同阶段依次申请同一份可用正文：首个阶段读取provider成功并填入公共缓存，后三个命中缓存，不再次调用读取provider；四个session均为1成功／0失败，各剩19次。同session重放仍为1／0，未申请材料的阶段保持0／0。分别核对session计数、缓存命中和provider读取调用数，不将额度累计值当作网络请求或收费次数。

## 8. 尚需确定的接入项

用户已确认“先保留可替换接口，稍后选服务”。因此目前没有必须追加拍板的搜索业务规则；具体搜索引擎／服务或浏览器接入方式留作上线接入项。若选择需要认证的API，端点及密钥放在本地配置，不发聊天正文。可先以替换适配器做离线验收，不阻止记忆主体实施；未配置真实适配器时不能声称已经能够真实搜索。

本文件不规定额外付费服务，不安装浏览器或依赖，不请求页面。已接受规则及缓存B口径均已同步到直接实施文档和任务清单，用户已授权实施，离线核心已编码并验收，真实服务仍待选择。

## 9. 实施接口及持久化责任

以下细化只固定实现连接方式，不增加第三套搜索额度或模型任务。

- `src/web/types.ts`定义本文件的WebSearchRequest、WebMaterial、WebSearchCounters、WebOperationOptions、WebSearchResponse、WebSearchProvider、WebSearchSession，以及`ModelRunRef`（runId、ownerType: turn/maintenance/asset、ownerId、stageKey、taskName、ordinal）。SelfWebReadSource直接引用记忆共享类型，不重建同名接口。
- `src/web/store.ts`定义`WebSearchStore(storage)`，同步`openStage(ownerType, ownerId, stageKey, taskName): ModelRunRef`、`snapshot(runId): WebSessionSnapshot`、`beginOperation(runId, request): WebOperationRecord`、`commitStep(runId, step: WebConfirmedStep): void`、`finishOperation(runId, operationId, response): void`、`saveCheckpoint(runId, checkpoint: WebModelCheckpoint): void`和`markProvided(runId, materialIds): void`；DTO最低字段见搜索执行计划。业务阶段首次建立身份，重进／恢复读取已存身份；stageKey是业务阶段槽，不用网络请求次数生成。不同业务任务再分配新序号。同轮普通叙事/共同叙事、各类个人导演仍各选一种。
- 新增辅助表`web_sessions`、`web_operations`、`web_materials`、`self_web_read_sources`。分别保存逻辑身份／确认计数／调用检查点，operationId及候选推进／完成结果，session实际取得的正文／实际提供标记，角色本人查阅来源。确认计数、材料和操作进度同事务保存；阶段输入及工具检查点仅供本阶段恢复，不放入公共正文缓存。
- 一次webSearch可能读多个候选，每个确认子结果立即同步提交，operation尚未完成时保留候选位置；恢复跳过已确认子结果，不重置额度。未知在途结果按未确认处理，不要求推断供应商状态。工具请求分配operationId并保存后才调provider，续调用根据保存结果推进；不按query识别重放。
- `src/web/service.ts`定义`WebSearchService.openSession(ref): WebSearchSession`、`providedUrls(runId): string[]`、`selfReadSources(turnId, runId): SelfWebReadSource[]`。来源登记发生在正文实际作为personal_life输入提供之后，其他阶段不登记；最终合同仅用实际已提供集合。ModelClient把operationId、材料、查阅来源和工具续调用检查点关联起来。
- 公共缓存本期只保存同一owner生命周期内可复用的公开正文及提供方签名／URL，不保存query、聊天或业务快照；owner结束后释放该内存缓存。各session已持久化材料仍用于恢复，不随缓存释放丢失。这样不新增跨轮陈旧网页刷新策略；将来扩大缓存范围也必须保持B及来源权限语义。
- 未配置真实provider时搜索工具不宣称可用，正常故事仍可运行；离线测试注入假的provider。具体服务选定后才新增真实适配器、必要认证与联调记录，不调用Codex工具替代HDSI的运行时服务。
- `ModelRunOptions`在记忆任务3建立的signal／lookup基础上增加runRef及本次web session；业务层保持身份，ModelClient管理工具循环，不把当前session存成全局可变调用权限。格式修补仍最多2次、本地补查仍最多1次，合法网页工具不消费格式修补次数。
- 恢复保持原冻结发送／两阶段提交：冻结后按原流程续发／后处理；未冻结阶段重新生成仍取原session及确认计数。`discardUnattempted`清理待发送候选时不删除搜索记录，不用重启或再进generateTurn刷新配额。后台搜索属于原准备任务及其signal，stop由宿主统一收尾；不新增守护进程或后台槽。

