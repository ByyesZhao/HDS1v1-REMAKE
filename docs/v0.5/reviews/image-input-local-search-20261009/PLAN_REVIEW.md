# 图片输入理解与本地搜索计划审核

日期：2026-10-09。状态：**审核完成，原方案可保留，局部修订后实施**。审核基线 `4fe090c`；计划声明基线为 `ddde663`，产品代码沿用 `b9d5514`。计划原文与摘要见 [基线记录](evidence/baseline.json)。

审查对象：[设计](../../plans/image-input-local-search-20261009/DESIGN.md)、[I1～I6](../../plans/image-input-local-search-20261009/IMAGE_INPUT_PLAN.md)、[S1～S5](../../plans/image-input-local-search-20261009/LOCAL_SEARCH_PLAN.md)。本报告审查的是尚未实现的合同；下文参考代码的失败探针不代表新功能已经存在这些 BUG。

## 总体判断

**没有需要推翻两套实施计划的大方向错误。**保留独立图片观察、精确内容缓存、观察文字进入现有资料池，以及本地浏览器适配现有 WebSearchProvider 的选择。继续先图片、后搜索；不需要改模型、改思考强度、并行整个故事轮或引入新任务平台。

但原稿还不宜直接逐项照做。下列 R1～R4 是需要补齐的接口或流程合同，R5 是旧数据适配规则；之后的三组细化应同步写回原设计和任务。均可在原 I／S 编号内解决，无须另立一套替代计划。

| 编号 | 优先级 | 应修订的内容 | 对应任务 |
| --- | --- | --- | --- |
| R1 | P2 | 已识别图片进入后续轮原文、普通主叙事和 lookup 的路径 | I2、I4、I5 |
| R2 | P2 | Puppeteer 服务就绪与 HDSI 启动、重装配的顺序 | S4 |
| R3 | P2 | 页槽释放必须等待真实资源回收，明确 dispose 接口 | S1、S4 |
| R4 | P2 | DOM 正文、搜索空态和动态就绪的可验证依据 | S1、S2、S3 |
| R5 | P3 | 旧图库的用途描述不能直接升级为客观图片观察 | I2、I3 |

上述优先级用于安排计划修订，不表示当前生产功能发生了对应故障。

## R1 补齐历史图片观察的只读装载

**原文位置：**DESIGN 第 83～87 行；IMAGE_INPUT_PLAN 第 82～87 行。

原稿只明确本轮 `prepareForTurn(visible/reconsider/activityContext)` 和 `TurnRecord.visualContext`。投影阶段列出了共同主叙事，却没有列普通主叙事，也没有定义后续轮如何通过历史消息找回观察。

现有 [app.ts](../../../../src/app.ts) 第 122～128、156～161 行每轮重建历史和 lookup；[memory/retrieval.ts](../../../../src/memory/retrieval.ts) 第 31～32 行从消息表取得 recent。[context-views.ts](../../../../src/model/context-views.ts) 第 33～35 行允许普通主叙事读取已读历史消息，[resource-pool.ts](../../../../src/model/resource-pool.ts) 第 10 行不会自动查询旧轮 visualContext。

因此，A 轮看懂图片但没有写入记忆或复述，B 轮问“刚才图里的字是什么”，仅保留 A 轮快照不能保证 B 轮仍看得到图片观察。图片还在四段原文窗口内时，不应只剩占位。

**写回原计划的具体要求：**

1. `message_attachments` 持久关联已确认的 observationRef／观察版本；不要只把关联放在 TurnRecord。内容缓存升级不得悄悄替换旧轮冻结的观察。
2. 增加只读接口，例如 `readConfirmedForMessages(messageIds: readonly string[]): PreparedAttachment[]`。只读已确认记录，不下载、不调用模型，不以同图缓存命中作为消息已被角色读取的证明。
3. 每个阶段先完成现有消息可见性选择，再为最终获准的消息集合补观察，包括 recent、活动历史及 lookup 返回的历史消息。普通主叙事可读**已读历史图片**，仍不能提前观察未读新图。
4. 同轮新图片使用 `prepareForTurn`；历史读取使用只读接口。池中正文按 observationRef 去重，来源和出现位置仍属于各自 messageId／attachmentId。历史观察不会因此进入 `currentSourceIds`。

**必加回归：**两轮对话且首轮不产生任何记忆；数据库重开后纯文字追问；普通主叙事与个人、表达均能读到已授权历史观察；活动历史和 lookup 路径；图片退出原文窗口后不再因全局缓存而注入；未读同图不得借缓存提前可见。以上历史读取的视觉调用数均为 0。

## R2 可选服务注入不能充当服务就绪门禁

**原文位置：**DESIGN 第 135 行；LOCAL_SEARCH_PLAN 第 80～84 行。

原稿同时要求可选 Puppeteer 注入，以及启用搜索而浏览器不存在时启动报错。若直接把当前 [index.ts](../../../../src/index.ts) 第 44 行替换为“可选注入＋apply 中立即检查 ctx.puppeteer”，HDSI 先执行、浏览器稍后就绪时会误报失败。

本地 Cordis 的 `scope.ready` 不等待 optional 服务；服务新增或移除触发重新装配的逻辑只处理 required 依赖。真实 Koishi Context 的 [离线探针](evidence/koishi-inject-probe.cjs) 显示：消费者第一次看到服务不存在，之后注册服务，消费者仍只执行过一次，见 [结果](evidence/koishi-inject-probe-result.json)。这不是仅凭文档猜测的风险。

**写回 S4：**

1. 搜索关闭分支直接装配 HDSI，不等待浏览器。启用分支通过内部 `ctx.inject(['puppeteer'], ...)` 或等效的明确就绪门禁装配，不能以一次同步存在性检查替代服务等待。
2. 将“未安装／未配置插件”“正在启动”“服务启动失败”区分。启动预检报告真正的缺失；服务仍在启动时不得先建立故事 Host 再让其运行到半途失败。
3. 服务移除时停止使用旧 page 工厂，完成该实例的 Host／适配器关闭；服务重新可用时，必须等旧实例收尾后才创建新实例，不能出现两个 Host 同时使用同一故事库。
4. 给装配结果保留生命周期句柄，参见 R3。不要借关闭 HDSI 直接调用整个共享 Puppeteer 服务的 stop。

**必加回归：**真实 Koishi Context 下，消费者先注册、浏览器先注册两种顺序；关闭模式无浏览器；明确缺失与启动失败；服务移除再出现时旧工厂不再接新页、旧 Host 与新 Host 不重叠。单纯传入一个始终存在的 mock page() 不足以覆盖本项。

## R3 页槽绑定完整页面生命周期

**原文位置：**LOCAL_SEARCH_PLAN 第 44～50 行；DESIGN 第 126～130、151 行。

旧参考 [public-web-reader.ts](../../../../references/legacy-web-search/source/public-web-reader.ts) 第 81～84 行只发起 page.close 而不等待；第 128 行工作结束后，第 52～54 行随即释放页槽。延迟 close 的 [原代码探针](evidence/legacy-probe.cjs) 得到：`slotLimit=1`，实际同时存活页面 `maximumOpen=2`，两个 read 返回时还有 2 页未关，见 [结果](evidence/legacy-probe-result.json)。这不需要触发取消即可发生。

原稿虽要求关闭页面及关闭迟到建页，但没有规定**什么时候可以释放名额**。BrowserPort 与工厂返回类型也没有 dispose，和后文关闭要求尚未接上。

**写回 S1 和 S4：**

1. 一次页槽持有期从建页预约开始，到该请求产生的页面实际关闭完成为止。正常、错误、取消均遵守同一规则；不能仅在调用 close 后释放。
2. 超时／取消可以及时结束调用方等待，但仍在途的 page factory 必须留在资源回收跟踪中；迟到的页不导航，关闭完成前不归还其占用名额。
3. 补出显式可等待接口，例如 `ManagedBrowserProvider = { provider: WebSearchProvider; dispose(): Promise<void> }`。dispose 拒绝新请求、处理排队项，并等待本适配器的在途建页及页面关闭结算。它只回收自己拥有的页面，不关闭其他插件共用的浏览器。
4. 关闭顺序明确为：停止新 HDSI 工作→按原合同等待 Host（前台完成、环境／维护取消收尾）→等待图片下载服务及浏览器适配器回收→关闭 Storage。不要依赖不同插件 dispose 回调恰好串行。
5. 若页创建／关闭一直不结算，不得为了表面满足 60 秒而释放名额并无限创建替代页；该适配器进入不可继续接单的失败状态，由生命周期恢复。请求超时与资源清理完成是两个不同结果。

**必加回归：**close 延后完成；取消时建页尚未返回；取消与下一 waiter 同时发生；dispose 期间建页迟到。断言实际活页数始终不超过配置值，dispose 返回后无未跟踪资源，而不只是断言 close 调用次数。

## R4 给提取结果提供明确的 DOM 证据

**原文位置：**DESIGN 第 120～124、141～145 行；LOCAL_SEARCH_PLAN 第 56～61 行。

“只有导航不算正文”和“真正无结果返回空列表”方向正确。但旧参考 [web-page.ts](../../../../references/legacy-web-search/source/web-page.ts) 第 22～29、58～59 行无 article 时回退整页 body 文字；第 77～78 行以全文是否包含“无结果／no results”识别搜索空态。

[离线探针结果](evidence/legacy-probe-result.json)确认：只有“首页／产品／关于我们／联系我们／版权说明”的页面可被旧代码判为成功正文；Bing 页面仅展示查询词 `no results error` 和导航、没有结果项时，也可被判为成功搜索页。照搬后再把空链接变成 []，就会混淆引擎空结果与页面尚未准备好。

**写回 S1～S3：**

1. 在 DOM 读取层取得明确主内容和搜索状态，BrowserPageResult 增加对应字段。至少区分“有结果项”“可见引擎专属空态”“尚未就绪／导航壳”；不要靠查询框文字或全页关键词推断无结果。
2. 正文来自 article、main 或明确约定的主体提取器，记录提取来源。原始整页 text 可用于诊断，不能直接作为无条件成功正文回退。不截断选出的主体正文。
3. 规定有界就绪等待：动态搜索项／主体在 DOMContentLoaded 后出现时，在原 60 秒总预算内等待相应条件，再提取；不是额外导航、隐藏重试或延长总预算。
4. 空态返回 []；加载失败或只有壳按原错误路径处理。直接 webRead 搜索页也不能把结果摘要当作目标正文成功入库。
5. 失败枚举补上既有 `no_candidates`。当前 [service.ts](../../../../src/web/service.ts) 第 40 行及 [store.ts](../../../../src/web/store.ts) 第 41 行会为真正无候选累计一次失败，不能在接 provider 时意外改掉 20／40 语义。

**必加回归：**上述两个反例；无 article 但有 main 的正文；文章讨论“登录／验证码”而非访问壳；查询本身含“无结果”；稍后出现的动态正文；完整长主体与导航分离；空结果一次失败且无成功正文。

## R5 明确旧图库描述的适配资格

**原文位置：**DESIGN 第 73 行；IMAGE_INPUT_PLAN 第 58～63 行。

“精确同图”只证明文件相同，不证明旧描述已经符合新的 ImageObservation 合同。[旧图库提示](../../../../src/model/prompts.ts) 第 16 行要求同时描述画面和适用语境，[图库保存](../../../../src/output/stickers.ts) 第 14～17 行把它们放在同一个字符串。仅设置 uncertain=true，不能自动拆分视觉事实和使用建议。

在 I2 写明 `findLibraryObservation` 的转换资格：已有明确结构化画面事实的记录才可直接返回观察；未经分离的旧 description／tags 只能作为图库用途提示，不能整体填入客观 description、visibleText 或用户意图。建议这类记录仍走首次 incoming_image 观察，再进入内容缓存；不覆盖原 67 项图库，也不重新 embedding。若要保留免调用路径，先提供独立、可核查的结构化适配数据，不能假设所有旧描述都合格。

必加合成用例：旧描述为“画面是一只狗，适合嘲讽对方”，后半段不能变成图上文字或本轮用户心理；图片确有文字但旧描述未记载时，不能凭空生成 visibleText。

## 同步写清的实施细节

### 图片顺序 暂停与恢复

- DESIGN 第 83 行“按附件 ID 排列”改成“按已授权消息的既有顺序，再按消息内 numeric order 排列”。attachmentId 只作身份，不作排序键。保留图文位置、同图多次出现及附件到观察的引用；正文去重不删出现次数。测试逆序消息 ID、同毫秒消息、一条 12 图和 A→B→A。
- I4 的“暂停不触发新角色观察”改为：**暂停阻止新故事轮，已开始的前台轮按现有合同完成，其中后续图片及格式修补可以继续。**当前 Host.pause 只挡新轮，命令本来就叫“暂停新故事回合”。不要为这句话新增半轮暂停／恢复状态机。测试普通叙事挂起时 pause，释放后处理首图／下一图，之后没有新轮启动。
- 把本轮 unrecognized 和 pending/aborted 区分：已经持久化的 ready 或 unrecognized 都属于本轮固定决定；恢复只续未完成项。失败不写成全局成功缓存，后续新消息再次发送同图仍可尝试。测试图 A 已定为不可用、图 B 模型失败，重开后 A URL 又可用，本轮 A 仍不被重新解释。
- 增加资产恢复测试：incoming_image 尚未 ready，但网页正文已确认；文件库重开且原图片 URL 失效，仍用原落盘 asset ref 续调用，图片相同、网页阶段身份和计数不变。该要求是既有设计的具体化，不新增上传 API。

### 验收必须实际指向隔离数据

I6 和 S5 不能仅写“隔离库执行 npm run check --prefix runtime”。当前 [runtime/check.cjs](../../../../runtime/check.cjs) 第 13、21、28 行固定读取 config.local.json 及正式数据库路径，改变工作目录不会变成隔离检查。

在计划已有的 check.cjs 修改任务中加入可注入路径：提取检查函数接收 configPath/databasePath，命令行可提供对应参数；已有正式启动器缺省路径保持不变。离线验收传入生成的合成配置、临时库和假凭据环境，断言不会访问缺省正式路径。文件存在性、模型解析、数据库只读检查仍真实执行。此接口完成后才使用类似命令：

```powershell
npm run check --prefix runtime -- --config <合成配置绝对路径> --database <夹具库绝对路径>
```

完整验收顺序先 `npm run build`，再 `npm run typecheck`、`npm test`、demo、隔离 check、离线 smoke。现有部分测试／插件脚本消费 lib，不能先测旧 lib 再构建新代码。图片与搜索各批仍单独验收。

### 搜索可行性尽早验证

保留图片优先；搜索做到 S1 的最小可用端口后，就提前执行 S5 的最小公开浏览验收：一个固定查询返回真实候选，并读取一个候选正文。成功后继续完成全部适配，失败则先处理实际原因，避免直到 S5 才发现当前机器没有可用搜索入口。这只调整验收顺序，不要求现在安装／启用插件。

60 秒含排队是原稿明确的选择，保留即可，但验收记录 queue/create/navigation/extract 时间；排队耗尽不能报告成“引擎无结果”。首批建议只迁移 Bing／DDG HTML 路径；若确需旧 Bing RSS 路径，还要补齐参考文件未携带的 feed 解析依赖并单独验收，不直接引用旧目录。

## 原计划修订及重新送审清单

- [ ] DESIGN 明确 R1 的历史读取与权限矩阵、R2/R3 的就绪和关闭顺序、R4 的页面证据、R5 的图库资格；同步图片顺序、暂停、未知冻结语义。
- [ ] IMAGE_INPUT_PLAN 的 I2/I4/I5 加入相应接口与精确测试，I6 补真实隔离验收路径和先构建顺序。
- [ ] LOCAL_SEARCH_PLAN 的 S1/S2/S3/S4 加入生命周期、DOM 状态、no_candidates 与真实 Context 测试，提前执行 S5 的最小可行性部分。
- [ ] 更新计划自查和导航状态；保留本 review 的原基线。修订后按原 I1～I6、S1～S5 执行，无需重建编号。

## 核验范围与证据

本次读完四份计划、现有接收／可见性／资源池／模型／恢复／网页路径及旧参考源码，并独立执行上述两个离线探针。Koishi 探针只创建未挂正式插件的内存 Context；旧浏览器探针的页面与网络全部为 mock，未触发的取消辅助函数使用透明异步调用替身，结论限于记录的关闭和提取反例。

```powershell
node docs/v0.5/reviews/image-input-local-search-20261009/evidence/koishi-inject-probe.cjs
node docs/v0.5/reviews/image-input-local-search-20261009/evidence/legacy-probe.cjs
```

两命令退出 0 表示探针执行成功，JSON 中的反例是原参考／依赖当前行为，不能误读成新功能通过验收。本轮未跑全量测试；计划尚未实现，不能据旧代码测试通过宣称新功能已通过。

外部能力也核对了官方资料：Flash 支持图片及现有 image_url 输入路径，符合原方案，不要求更换现有连接；当前说明也列出了格式和图片大小限制。[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/) 本机浏览器由 Puppeteer 服务提供，页面创建和浏览器关闭是不同生命周期；部署仍需确认已安装浏览器与插件兼容。[Koishi Puppeteer API](https://puppeteer.koishi.chat/api.html)、[插件说明](https://puppeteer.koishi.chat/) SearXNG 的 JSON 输出需服务端启用且仍依赖上游查询，作为后续替换候选的定位合理。[SearXNG Search API](https://docs.searxng.org/dev/search_api.html)

本轮只新增审核文档、公开合成探针和导航，没有实现产品功能、安装依赖、读取正式库／私有配置、启停正式服务或调用真实看图模型。真实浏览器在本机能否稳定返回候选和正文，仍须按修订后的公开验收验证。

## 2026-10-09 计划修订跟进

用户随后要求把方案与本 review 细化为可直接交给 SOL 的实施文档。已原地修订 [DESIGN](../../plans/image-input-local-search-20261009/DESIGN.md)、[图片任务](../../plans/image-input-local-search-20261009/IMAGE_INPUT_PLAN.md)、[搜索任务](../../plans/image-input-local-search-20261009/LOCAL_SEARCH_PLAN.md)，新增[执行与验收指南](../../plans/image-input-local-search-20261009/EXECUTION_GUIDE.md)。

原 R1～R5、顺序／暂停／未知冻结、资产恢复、隔离检查和早期浏览验收均有接口、所属任务及测试断言；逐项映射见执行指南 §5。本报告之前的原文行号、清单状态和失败探针继续表示审核 `4fe090c` 时的事实。

**本次仅关闭“计划未写清”的交接缺口，不关闭尚未实施的产品验收项。** SOL 实施后仍需以新代码、测试和公开浏览证据逐项填写 REVIEW_CLOSURE；本轮没有运行新功能测试、安装依赖或修改正式环境。
