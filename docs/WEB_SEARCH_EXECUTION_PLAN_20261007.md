# HDSI 共享网页搜索执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让各模型阶段独立按需搜索和读页，保持20成功／40失败额度、恢复一致性及生活个人导演的查阅类记忆来源。

**Architecture:** HDSI进程内一个WebSearchService，共享公开正文缓存和可替换provider；各逻辑任务自己的持久化session、权限与检查点。接入现有ModelClient工具循环和记忆后台准备槽，不另开服务或故事槽。

**Tech Stack:** 现有TypeScript、Node.js >=22.13.0、node:sqlite DatabaseSync、Zod、Vitest、Koishi；真实搜索供应商稍后选择，不为本计划安装浏览器或调用Codex搜索能力。

**Spec:** [搜索业务细化](WEB_SEARCH_SUBSYSTEM_DESIGN_20261007.md)，尤其§3、§5、§7、§9；来源合同同时遵守[记忆实施细化](MEMORY_V0.3_IMPLEMENTATION_20261007.md)§2.3／§4.1。

日期：2026-10-07。状态：六任务离线核心已实施，最新验证及复核见WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md。前置顺序为[记忆执行计划](MEMORY_V0.3_EXECUTION_PLAN_20261007.md)任务1～7，再执行本计划任务1～6。接口桩和离线provider可先探索，但正式装配不抢先修改另一计划正在改造的共享文件。当前目录不是Git仓库，检查点记录到docs/WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md，不执行虚构提交，不自动创建代理或新聊天。

## Global Constraints

- 每逻辑任务maxSuccessReads=20、maxFailures=40；操作前successReads<20且failures<40，任一到达后停止新操作。无候选属于无资料尝试计失败，原因区分；没有第三套查询次数上限。
- 缓存B：本session首次取得可用正文计1，包括公共缓存；同session重放计0，同轮不同阶段首次取得各自计1。计数不是供应商收费或HTTP请求数。
- requestedPages默认1，只读剩余成功份额；session内页面操作串行，确认一个子结果就保存进度，不能并发超扣。
- 逻辑runId／序号由业务层持久化。续调用、补查、修补、恢复和未冻结重生成不重置session；未知远程结果不臆造成功。
- 所有11类模型任务均可按需搜索；不新建搜索模型。原各角色Flash/Pro与low/high独立配置保留，工具续调用沿用本角色。
- 初始均Flash：narrative、narrative_shared、personal_chat、personal_life、personal_shared、expression、world、school使用low；memory、memory_consolidation、sticker_description使用high。各自后续可改Pro，不建立统一路由。
- 无网页字符／token预算，不增加webMaterialCharactersLimit或max_tokens；正文去导航／脚本、可选相关段落，但不按12000字截断。真实容量错误保留前台暂停／后台待办，不删历史重发。
- personal_life实际取得并接收的正文才登记self_web_read，可独立支持本轮查阅类短期；其他网页不自动成为亲历来源，不放宽details／awaken来源规则。
- 正式业务快照、输入可见性、冻结发送、15秒合批、原单故事槽与单后台准备槽保留；后台搜索不得被前台active等待，也不能绕开stateVersion/readSet。
- 所有数据库事务同步，不含网络await；stop后不写已关闭库。在途pause可完成保存，stop按原宿主停止规则收尾。
- 当前只做可替换接口和离线验收；未配置真实provider不宣称能够真实搜索。密钥留本地，正式服务由用户双击.cmd运行。

## Review Focus

1. 一个webSearch已确认部分成功／失败后中断，恢复只推进未确认候选，旧材料重放不扣额（任务2、3）。
2. 主叙事先取得某页，personal_life命中公开缓存；两者各计1，但只有生活阶段产生本人查阅来源（任务2、4）。
3. 环境模型读取一个初始白名单没有的URL，最终JSON前实际提供白名单已更新；只有摘要则拒绝引用（任务3、4）。
4. 后台压缩正在等待网页，真实新输入照常落库、15秒闭合并完成前台故事；stop同时取消后台且关库前收尾（任务5）。
5. 真实provider未配置，故事照常运行且工具明确不可用；不能因离线假provider测试通过声称已联网（任务5、6）。

## 文件与接口约定

| 文件 | 职责 |
| --- | --- |
| src/web/types.ts | 搜索请求、结果、逻辑身份、操作检查点与store DTO；SelfWebReadSource引用src/memory/types.ts |
| src/web/store.ts | 四张辅助表、逻辑身份与操作进度同步持久化、提供记录及查阅来源 |
| src/web/provider.ts | WebSearchProvider可替换接口与未配置状态，不绑定具体厂商；离线假实现放tests/helpers或夹具 |
| src/web/content.ts | URL规范化、正文整理、相关段落标识及bodyCharacters计算，不按字符截断 |
| src/web/service.ts | session20／40、候选推进、同owner公开缓存、来源登记、signal透传 |
| src/model/client.ts | 本次runRef／web工具循环、续调用检查点、HTTP容量错误与格式修补分开 |
| src/app.ts、directors/、output/、memory/、recovery.ts、index.ts | 业务阶段身份、合法输入与来源、后台槽和生产装配 |

类型最低字段：

- `ModelRunRef`及WebSearchRequest／WebMaterial／WebOperationOptions／WebSearchResponse／WebSearchSession沿用细化§5／§9；不重复建立同名类型。
- `WebOperationRequest = {kind: 'search'; request: WebSearchRequest} | {kind: 'read'; url: string}`，模型只给业务请求，operationId由程序分配。
- `WebSearchResponse`增加可选requestedPages、obtainedPages和message:'结果不足'；保留已取得材料，不自动用webSources兜底；该反馈沿同任务工具续调用保存和提供，角色可在原个人导演／表达合同内询问用户。
- `WebOperationRecord`：operationId、runId、request、candidateUrls、nextCandidateIndex、status: pending/running/done、已确认材料ID／失败原因／本次结果。候选和子操作索引保存后可恢复。
- `WebSessionSnapshot`：ref、counters、materials、providedMaterialIds、operations、nextOperationOrdinal、repairCount、lookupUsed；可选pending工具请求／续调用检查点。lookup结果及阶段输入按本run私有保存，不进入公共缓存。
- `WebModelCheckpoint`：input:unknown、repairCount:number、lookupUsed:boolean、pendingOperationId:string|null、toolResults:WebSearchResponse[]、可选privateLookupResult及repair原始响应／错误。运行时进度由程序写入，不把这些字段交给模型决定。
- `WebConfirmedStep`：operationId、stepIndex、成功material或失败reason二选一、推进位置；唯一(runId,operationId,stepIndex)，重复提交不二次扣额。
- `WebSearchConfig`：enabled:boolean（默认false，真实provider尚未配置）、maxSuccessReads:number（20）、maxFailures:number（40）；不添加默认字符上限或跨阶段总上限。provider实例由装配注入，具体端点／认证schema在供应商接入时定义。
- `ModelRunOptions`在记忆计划的signal／lookup上增加`runRef?: ModelRunRef`、`web?: WebSearchSession|null`；生产业务显式传身份，web=null明确禁用，未传options的旧测试入口不偷用其他session。

## 任务1：请求协议、正文整理与离线provider

**Files:** 新增src/web/types.ts、provider.ts、content.ts；新增tests/web-content.test.ts、tests/web-provider.test.ts及人工构造的网页夹具。

**Interfaces:** 消费记忆共享SelfWebReadSource；产生细化WebSearchProvider、`normalizeWebUrl(url: string): string`、`normalizeMaterial(input: {id: string; url: string; title: string; body: string; readAt: string; selectionMode: 'full_body'|'relevant_passages'}): WebMaterial`。

- [x] 写正文测试：包含导航／脚本及>12000字符正文和尾部标记，正文整理后尾部保留；Unicode码点含空白计数；选相关段落时selectionMode明确，不冒充完整HTML。
- [x] 写请求协议测试：webSearch query及requestedPages、webRead URL可解析；结果列表不能充当正文；空正文判为无可用资料。协议不要求模型给operationId／计数。
- [x] 运行`npm test -- tests/web-content.test.ts tests/web-provider.test.ts`，确认新增能力未实现导致失败。
- [x] 实现这些类型、正文整理及provider注入接口；假provider覆盖搜索、成功正文、空结果、读页错误、deferred和Abort，不实现真实供应商。
- [x] 运行上述测试和`npm run typecheck`，通过后记录检查点，标明真实provider仍未配置。

## 任务2：持久化session、候选推进及缓存B

**Files:** 新增src/web/store.ts、service.ts；修改src/storage.ts的辅助表初始化／同步SQL入口；新增tests/web-session.test.ts、tests/web-store.test.ts。

**Interfaces:** 消费Storage及WebSearchProvider，产生`WebSearchStore(storage)`、`openStage(ownerType: ModelRunRef['ownerType'], ownerId: string, stageKey: string, taskName: string): ModelRunRef`、`snapshot(runId: string): WebSessionSnapshot`、`beginOperation(runId: string, request: WebOperationRequest): WebOperationRecord`、`commitStep(runId: string, step: WebConfirmedStep): void`、`finishOperation(runId: string, operationId: string, response: WebSearchResponse): void`、`saveCheckpoint(runId: string, checkpoint: WebModelCheckpoint): void`、`markProvided(runId: string, materialIds: string[]): void`。WebSearchService构造注入store/provider/clock/config，产生`openSession(ref: ModelRunRef): WebSearchSession`、`providedUrls(runId: string): string[]`、`selfReadSources(turnId: string, runId: string): SelfWebReadSource[]`。

- [x] 写边界测试：18／3继续；15／39再失败停15／40；19／10再成功停20／10；19／39两种最后结果各停止。下一操作provider零调用；requestedPages超过剩余额度只读剩余份额。
- [x] 写40次空结果测试：停在0／40、第41次不请求，原因no_candidates不是网络错误；下一独立session仍可请求。搜索报错及读页错误各只计一次失败。
- [x] 写缓存B测试：同turn四阶段依次取得同正文，读取provider一次、四session各1／0、各剩19；同session重放计0；未申请阶段0／0；公开缓存不含私有query／聊天／lookup结果。
- [x] 写文件库恢复测试：2／1重开及重放仍2／1、provider零调用；新材料后3／1。多页操作只确认前两子结果后中断，恢复跳过两者、不重扣，只处理剩余候选；事务异常材料／计数／推进位置一起回滚。
- [x] 写逻辑身份测试：再次进入相同owner／stage仍同runId／序号；续调用／修补不分配新身份，新业务owner独立。相同query的新operation可继续未读候选，不按query误判成重放。
- [x] 第七轮补验：非法URL逐项确认read_error后继续合法候选；非数组返回search_error；40非法候选不再读第41项；中断恢复跳过已确认坏URL。新搜索无未读可用材料计一次no_candidates，旧operationId重放及直接旧材料复用计0。每页材料／计数／步骤位置同事务，最终done／response另事务。
- [x] 运行`npm test -- tests/web-session.test.ts tests/web-store.test.ts`确认失败，再实现四辅助表及同步事务、串行读页门禁、确认子结果逐次保存、公共缓存和恢复。
- [x] 实现owner结束时释放公开内存缓存，session已保存材料保留恢复；未确认远程结果不计成功。公开缓存键含provider签名／规范化URL，阶段权限与本人来源另外校验。
- [x] 运行上述测试、任务1测试及typecheck，记录实际结果。

## 任务3：模型工具循环与恢复检查点

**Files:** 修改src/model/client.ts、prompts.ts、contracts.ts、src/types.ts；修改src/web/store.ts、service.ts；新增tests/web-model-tools.test.ts，扩展tests/model-call-context.test.ts。

**Interfaces:** 消费任务2session及ModelRunOptions；CompletionRequest增加本run工具材料／工具反馈／允许工具的schema。ModelClient为工具操作保存请求及operationId，透传signal；最终业务JSON仍由原task.parse校验。

- [x] 写工具顺序测试：webSearch→webRead→一次lookup→最终JSON，均同run／模型／强度；两次格式修补仍同session。合法工具请求不消费修补次数，多次补查不增加原一次本地额度。
- [x] 第七轮补验：不足反馈确实传回当前模型，允许正常问句完成而不编造资料；合法工具成功后清旧repair提示、不重置repairCount。非法参数或schema撤下后继续请求工具沿原有限格式修补，不能无限免费续调用。
- [x] 写json_schema模式测试：请求schema包含本任务业务JSON及实际启用的工具请求分支；工具JSON先路由，不交业务parse。json_object／prompt模式同样支持工具，不改变任务输出合同。
- [x] 写隔离测试：并发前台／后台各自signal、lookup、web和修补计数独立；web=null不回退其他任务session；工具正文为external_reference，不能覆盖系统提示。
- [x] 写恢复测试：已保存工具请求／子结果后重新runModel，沿同runId重放旧结果，不重新调provider，不将修补或lookup计数恢复为零；正文继续提供前保存材料，模型响应后最终parse前markProvided。
- [x] 写容量错误测试：transport抛出的容量错误直接沿原错误路径，无缩小正文的第二次请求；中止跳出工具循环，不被当格式错误。达到网页额度后反馈quota并要求使用已有材料返回业务JSON，不重建session。
- [x] 运行`npm test -- tests/web-model-tools.test.ts tests/model-call-context.test.ts`确认失败，再实现工具循环和私有调用检查点；修补最多2次、lookup最多1次，不增加网页模型或额外意图分类器。
- [x] 实际提供标记在材料随续调用提交且transport成功返回后、最终业务JSON解析之前登记；personal_life登记的self_web_read ID以runId＋materialId稳定生成并记录首次operationId，不因恢复重放改ID。模型调用失败／只有搜索摘要不新增本人来源。
- [x] 运行上述测试和typecheck，核对各角色路由及既有格式修补测试，记录检查点。

## 任务4：全部阶段接入及生活查阅记忆

**Files:** 修改src/app.ts、directors/narrative.ts、personal.ts、world.ts、school.ts、output/expression.ts、memory/organize.ts、memory/maintenance.ts、recovery.ts、scripts/stickers.ts；新增tests/web-phases.test.ts、tests/web-memory-sources.test.ts、tests/web-recovery.test.ts；扩展tests/turn.test.ts、environment.test.ts、memory.test.ts、shared-scene.test.ts。

**Interfaces:** 业务调用前openStage并透传runRef/web。故事owner=turnId，stageKey=narrative/personal/expression/memory，环境使用environment；维护owner=jobId、stageKey=consolidation；素材owner为本次工具任务ID、stageKey含图片身份。环境合同`environmentTask(..., urls)`扩为`urls: string[] | (() => readonly string[])`，最终parse读取providedUrls快照，旧数组形式继续兼容。

- [x] 写11类角色接入测试：narrative、narrative_shared、personal_chat、personal_life、personal_shared、expression、memory、world、school、memory_consolidation、sticker_description都可申请；互斥变体不同时执行，不把11种任务当一轮必跑11阶段。
- [x] 写输入门禁测试：未看私聊不能进入普通叙事输入／自动query；缓存只共享公开正文，不共享另一阶段查询及聊天；expression只核对草稿，不藉工具增加行动／事实；看图仍以实际像素为依据。
- [x] 写环境引用测试：webRead新URL取得并实际提供后最终JSON可引用；只搜索摘要或未提供正文的URL仍修补。合同白名单取parse时快照，不取首次空集合。
- [x] 写生活来源测试：叙事读某页后personal_life命中缓存，两者各计1，只有生活阶段登记self_web_read；记忆实际收到来源及所需正文／个人输出后，可无聊天来源新建查阅短期。其他阶段网页、未提供／其他轮ID不能冒充；details／awaken规则保持。
- [x] 写七天知识归档测试：短期保留知识／细节／有依据感受，预备摘要及维护后仍是查阅所得，不变成报道事件亲历；重放不制造新进展或刷新窗口；仅允许的来源不等于必须保存所有页面。
- [x] 写故事恢复测试：冻结后发送／后处理沿原流程，不重新搜索；未冻结重生成及discardUnattempted保留原session／确认计数／查阅来源ID，记忆post job重开可读原来源，不重建新额度。
- [x] 运行`npm test -- tests/web-phases.test.ts tests/web-memory-sources.test.ts tests/web-recovery.test.ts tests/turn.test.ts tests/environment.test.ts tests/memory.test.ts tests/shared-scene.test.ts`确认失败，再逐入口透传与装配来源，复用记忆任务2的按操作来源合同。
- [x] memory_consolidation只用固定业务快照，lookup=null；新URL另登外部依据，不查其他正式记忆，stateVersion/readSet照常校验。运行上述测试和typecheck，记录检查点。

## 任务5：生产配置、旧网页入口替换及调度

**Files:** 修改src/settings.ts、config.ts、index.ts、host/runtime.ts、memory/maintenance.ts、scripts/stickers.ts、examples/下实际样例；新增tests/web-deployment.test.ts、tests/web-host.test.ts，扩展tests/plugin.test.ts、deployment.test.ts。实际config.local.json仅写非秘密字段。

**Interfaces:** 装配唯一WebSearchService及store，业务层按owner取得session；WebSearchConfig独立，不进入ContextLimits。webSources只保留兼容配置，不注入候选或不足兜底；取消旧getWebMaterials批量抓全URL及.slice(0,12000)。后台网络仍用原maintenance signal和120秒准备超时，不另加网络槽。

- [x] 写配置测试：enabled默认false、20／40默认值，网页无字符字段／跨阶段总上限；未配置真实provider不广告可用工具，正常故事可完成，不能静默调用假的或Codex的搜索服务。显式启用却缺provider给清晰配置错误。
- [x] 写旧入口迁移测试：配置多条webSources但模型未申请时provider零调用；申请后读页用该session；>12000正文尾部保留；不恢复旧固定截断或记忆里的网页字符开关。
- [x] 写真实输入后台等待测试：压缩申请网页、provider deferred未释放，host.acceptInput立即落库，15秒闭合后完成前台发送／故事；后台完成只保存ready，正式应用仍按记忆单元让位规则。
- [x] 写pause／stop测试：pause不新建后台或应用ready，在途可保存；stop立刻向后台signal发Abort并等前台／后台收尾才close；取消后返回不写ready／wake，正常已保存session结果可恢复。
- [x] 写实际观测测试：status展示每session成功／失败、cacheHits、实际providerSearchCalls／providerReadCalls及按owner汇总；不输出query、网页正文、聊天或认证数据，不将quota总数标成费用。
- [x] 运行`npm test -- tests/web-deployment.test.ts tests/web-host.test.ts tests/plugin.test.ts tests/deployment.test.ts`确认失败，再替换旧入口、装配配置和生命周期；CLI素材工具使用独立asset owner，不启动QQ正式进程。
- [x] 运行上述测试、typecheck及记忆host回归，记录当前仍只有接口／离线provider，真实服务待选。

## 任务6：覆盖核对、规模观测与交付记录

**Files:** 新增tests/web-integration.test.ts；更新README.md、REMAKE_V0.2_INTERFACES.md、REMAKE_V0.2_IMPLEMENTATION.md、REMAKE_V0.2_MEMORY.md、REMAKE_V0.2_RECOVERY.md、REMAKE_V0.2_LIFE.md、REMAKE_V0.2.md、docs/DOCUMENT_AUDIT.md、docs/IMPLEMENTATION_LOG.md、docs/WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md。DSH-review旧快照保留。

**Interfaces:** 无新增业务接口；按细化验收项1～12逐项关联到以上测试及记录，不重复建设监控系统。

- [x] 写端到端离线测试：临时SQLite＋假模型／provider＋模拟sender完成四阶段搜索、生活来源记忆和恢复；查询／材料／格式修补计数、URL白名单、outbox确认及post完成可观察。
- [x] 写三／六个月相关候选与长正文样本，记录阶段输入字符规模、相关性及实际注入材料数；100相关候选／30原文窗口复用记忆测试，不当新上限。不用离线字符到token换算声称供应商容量已通过。
- [x] 运行`npm test -- tests/web-integration.test.ts`并完成测试映射；未配置provider时真实搜索结论写“待接入”，而非用离线结果填“已验证”。
- [x] 运行`npm run typecheck`、`npm run build`、`npm test`、`npm run smoke --prefix runtime`、`./start-hdsi.cmd --check`、`./start-snowluma.cmd --check`；这些是未来交付检查，后两条仅检查，不弹出正式运行服务。
- [x] 同步运行文档和真实检查结果，逐项记录真实Qwen标定、背景切换、生产迁移、搜索服务接入及供应商容量观测的未完成状态。明确本计划离线核心完成与正式联网可用是两个验收范围。

## 计划自检与实施入口

覆盖：协议／正文→任务1；20／40、缓存B、持久化／部分操作恢复→任务2；工具续调用／schema／隔离／提供标记→任务3；11角色、URL白名单、查阅记忆／故事恢复→任务4；配置／旧截断移除／后台让位／停止→任务5；端到端与交付→任务6。细化验收项1～12都有对应任务，不从历史rebuttal临时补规则。

本次改造直接读四份：记忆实施细化、记忆执行计划、本搜索业务细化、本搜索执行计划。实施从记忆任务1开始；具体真实搜索供应商延期确定，不妨碍离线核心开发。用户已授权从记忆任务1开始实施。两计划离线核心已执行；实际QQ／真实Qwen语义标定／背景切换／搜索provider及供应商容量仍分项待办。检查不启动正式服务；生产迁移仅按已记录的停机备份流程完成。
