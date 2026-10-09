# Local Browser Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 按 SOL 单执行者交接，不主动启动代理。

**Goal:** 本机浏览器搜索公开网页并读取实际正文，接入当前网页工具，不使用付费搜索 API。

**Architecture:** 小型 Koishi 页面端口、按实际页面生命周期计数的共享页槽、可测试的 DOM 提取，最后适配现有 WebSearchProvider。HDSI 单实例由服务就绪门禁及串行关闭链管理。

**Tech Stack:** 现有 TypeScript／Koishi／Vitest／WebSearchService；新增可选 koishi-plugin-puppeteer、@mozilla/readability；runtime/check 解析 Koishi YAML 使用 runtime 的显式 yaml 依赖。

**Spec:** [修订设计 §1、5～7](DESIGN.md)、[执行指南](EXECUTION_GUIDE.md)。日期 2026-10-09；代码基线 `4fe090c`；**待实施**。路径相对仓库根目录。通常接在 I6 后；单独执行时先实现 I5b 的隔离检查接口及执行指南 §4.1 的夹具生成器。

## Global Constraints

- 模型、思考强度和工具 schema 不变；每逻辑阶段 20 成功正文／40 失败，续调用／修补不重置，沿现有 B 缓存口径。
- 搜索摘要不是目标正文，不引入正文裁剪、旧 20／20、隐藏翻页、自动换引擎或付费回退。
- enabled=false 不加载／等待浏览器；true＋browser 等 required 服务，不用 optional 注入后立即同步判缺失。
- 页槽默认 1；整次页面操作默认 60,000ms，包含排队、建页、导航和动态就绪；页面未确认关闭不能归还名额。
- 仅使用本项目 references；首批 Bing／DDG HTML，不移植缺少 feed 依赖的 RSS 路径。
- 只回收 HDSI 自己的页面；Host、媒体、浏览器清理完成后才关闭 Storage；保持前台串行及环境异步现有合同。

## Review Focus

1. 延迟 close／取消时 pending factory 会让表面单槽变实际多页：S1 断言实际活页和 reservation。
2. 查询词带“无结果”、导航壳、文章谈验证码可能混淆提取：S2 用 DOM fixture 验证。
3. 两种服务注册顺序、启动失败、移除再加入会误启双 Host：S4 使用真实 Koishi Context。
4. 在排队中耗尽 60 秒与动态主体稍后到达不是无结果：S1／S2 的时间与就绪测试。
5. 恢复重复确认或跨阶段缓存影响 20／40 和人物知识资格：S3 的核心工具与 memory 来源回归。

## 文件分工及实际顺序

| 文件 | 职责 |
| --- | --- |
| 新 src/web/browser/types.ts、koishi-port.ts | 页面合同、Koishi page 工厂桥接、一次导航和 DOM 就绪 |
| 新 src/web/browser/slots.ts | FIFO、reservation、取消、迟到创建／关闭及 dispose |
| 新 src/web/browser/extract.ts、provider.ts | DOM 证据、正文、候选和 WebSearchProvider |
| 新 src/deployment/plugin-runtime.ts、browser-runtime.ts | 单个 HDSI 实例装配／关闭；服务等待与串行替换 |
| src/deployment/web-runtime.ts、settings.ts、index.ts | 原网页服务装配、配置、入口分支 |
| 新 scripts/validate-local-web.ts | 默认离线，以及 S5a／S5b 的公开浏览器验收 |

**顺序：S1 → S2a（最小实际提取）→ S5a（真实可行性）→ S2b → S3 → S4 → S5b。**仍使用 S1～S5 交付编号，a／b 只是先后执行的小步。S1 提前安装隔离验证所需浏览器依赖；S4 负责正式插件配置与生命周期集成。S5a 失败时先诊断真实原因，不继续把“已可用”的假设写入 S3／S4 交付。

## S1 页面端口、名额与关闭

**Files:** 新 types.ts、slots.ts、koishi-port.ts；修改根和 runtime 的 package.json／package-lock.json。新测 tests/browser-page-slots.test.ts、browser-koishi-port.test.ts。

**Interfaces:** DESIGN §5.1 的 BrowserPort、BrowserPagePort、BrowserReadRequest／Result；`BrowserPageSlots.read(request, signal?)`、`stopAccepting(reason?)`、`dispose(): Promise<void>`。port 只依赖注入 page 工厂；从本任务开始拥有全部资源跟踪，不能留给 S4 再补。

- [ ] **写失败测试。** 假 page 工厂可控制 create／read／close 三个 Promise，维护 opened／closed／maximumOpen。覆盖正常延迟 close、goto／evaluate 异常、排队取消、建页前取消、create 迟到、close 异常及 dispose：

```ts
expect(maximumOpen).toBeLessThanOrEqual(1);
expect(secondOpenStartedBeforeFirstCloseResolved).toBe(false);
expect(latePage.navigateCalls).toBe(0);
expect(disposeResolvedWhileCreatePending).toBe(false);
expect(remainingOwnedResourcesAfterDispose).toBe(0);
```

- [ ] **跑红。** `npx vitest run tests/browser-page-slots.test.ts tests/browser-koishi-port.test.ts`。
- [ ] **实现端口／槽。** 在调用 openPage 前预约名额；关闭完成才释放，队列 FIFO。外部取消／总时限可先 reject caller；另一个清理 Promise 跟踪迟到 factory 与 close。使用注入单调时钟进行可控测试；每次将剩余 deadline 传给 page 导航／等待，不重新开始预算。
- [ ] **落实清理失败行为。** stopAccepting 阻止新请求；dispose 取消排队及在途页面读取并等待真实结算，幂等。factory／close 不结算保持 reservation、停止分配；close 拒绝而无法确认已毁时 unhealthy，不把它当已排空。共享浏览器不由本模块 stop。
- [ ] **声明依赖并锁定。** 根 peerDependenciesMeta 标 Puppeteer 为 optional，开发依赖提供其类型／离线测试；runtime 直接依赖插件，用本次实际兼容版本生成锁文件并记版本。产品运行的类型导入用 import type，关闭搜索时不得因顶层 require 可选插件而失败。不要指向旧 node_modules。此步只准备隔离公开验收能力，不改正式 koishi.yml，不启动正式 HDSI／QQ。
- [ ] **跑绿并提交。** 同命令通过；追加 60,000ms 在队列耗尽不会调用 factory、剩余预算传递及正常长 close 的断言。提交 `feat: manage browser page leases and drain`。真实公开页面提取下一步完成。

## S2a 最小 DOM 提取及真实 provider 路径

**Files:** 新 extract.ts、provider.ts；补 koishi-port.ts；根 package.json／锁新增 @mozilla/readability。新测 tests/browser-page-extraction.test.ts、browser-search-provider.test.ts；fixture 放 tests/fixtures/browser/。

**Interfaces:** `extractSearchCandidates(page: BrowserPageResult, engine: 'bing'|'duckduckgo'): Array<{url:string;title:string}>`；`extractReadablePage(page: BrowserPageResult): {title:string;body:string}`；`createManagedBrowserProvider(port: BrowserPort, config: BrowserProviderConfig): ManagedBrowserProvider`。provider 包装同一个 slots，返回 provider、stopAccepting、dispose 三个成员。

- [ ] **写最小失败测试。** Bing／DDG 一页结果；一篇 article；真实 URL 规范化／去重；results、empty、unready 三态；page 是搜索结果时 read 拒绝。fixture 是有限公开／合成 DOM，不是只手造结果对象绕过 DOM 代码。
- [ ] **跑红。** `npx vitest run tests/browser-page-extraction.test.ts tests/browser-search-provider.test.ts`。
- [ ] **实现搜索及主体最小路径。** encode 查询放固定引擎模板，search 一页、read 一页。DOM 选择器与 evidence 放 extract.ts，Koishi port 导航后执行同一份提取逻辑；测试和真实 probe 不用两套选择器。Bing 公开重定向参数用公开格式解析，不能解码的候选跳过；全部过滤且无空态证据是提取错误。
- [ ] **实现明确正文回退。** article→main／role=main→Readability 克隆文档；剔除导航／表单／隐藏项后提完整文本，null 不回退 body。加载本地依赖脚本，不引用远程 CDN；锁版本计入 extractor signature。
- [ ] **跑绿并提交。** 同命令通过；提交 `feat: extract browser search and article evidence`。**此时先执行 S5a**，再做 S2b。不得等全部插件装好才首次验证引擎可用性。

## S5a 提前的公开浏览器可行性门禁

**Files:** 新 scripts/validate-local-web.ts、tests/local-web-acceptance.test.ts。报告先写未来搜索交付目录的 evidence/public-browser-probe.json，不覆盖旧 public-http-probe.json。

**Interfaces:** 默认离线 `--report <path>`；`--online --probe --engine bing|duckduckgo --report <path>` 才使用独立最小 Koishi Context 启动 Puppeteer、搜索固定公开查询和读取候选。**不加载 HDSI、OneBot、正式 config 或数据库，不调用模型**。Context 自己拥有的测试浏览器在结束时随 Context 关闭，区别于产品共享服务。

- [ ] **写失败测试并跑红。** `npx vitest run tests/local-web-acceptance.test.ts`；默认离线实际网络 0；报告需包含候选和正文两个结果，只搜索到标题不算通过；结束 await dispose。
- [ ] **实现脚本。** 复用 S1／S2a 代码，固定公开查询“中国气象局”和可核查公开文章候选；记录引擎、查询、候选 URL、finalUrl、主体来源、正文字符数、每段耗时、浏览器／插件／提取器版本和失败原因。同命令转绿。
- [ ] **运行真实最小 probe。** 在有可用浏览器的隔离 Context 执行：`npx tsx scripts/validate-local-web.ts --online --probe --engine bing --report <absolute-report-path>`。通过条件：真实合法候选数 > 0，至少一个该候选 read 得到非搜索摘要、非导航／验证壳的正文，所有页正常排空；这是工程门禁，不承诺所有网站都可读。
- [ ] **处理结果。** 失败先区分依赖／浏览器启动、网络访问、引擎 DOM、候选过滤、主体提取、排队超时。可显式再测 duckduckgo，并分别保留报告；这不是运行时自动回退。至少一个已支持引擎通过后才推进；两个均不可用时交付诊断和可审修订，不谎报搜索已完成。
- [ ] **提交可复现工具及公开证据。** `test: add public browser search feasibility probe`。动态 DOM 的实际样本补到 fixture，保留取得日期及来源，排除 cookie／账号信息。S5b 后续仍执行完整验收。

## S2b 动态就绪、访问墙与反例覆盖

**Files:** 延续 S2a；扩展 tests/browser-page-extraction.test.ts、browser-search-provider.test.ts、browser-koishi-port.test.ts。

- [ ] **写失败测试。** 导航壳；查询 `no results error` 只有输入框和导航；专属空态；无 article 有 main；正文讨论登录／验证码；真实登录／验证码阻挡；初始无正文稍后出现；长主体含尾部哨兵；direct read 搜索页。断言依据 DOM，不只传 expected 状态。
- [ ] **跑红。** `npx vitest run tests/browser-page-extraction.test.ts tests/browser-search-provider.test.ts tests/browser-koishi-port.test.ts`。
- [ ] **完成有界等待与证据判断。** DOMContentLoaded 后等结果项／可见专属空态／主体／阻挡；导航和等待共用原 deadline，无额外 goto、无额外 60 秒。访问墙用结构证据，不全文查词。搜索空态选择器以 S5a 真实样本校准；结构不认识时抛错误，不返回 []。
- [ ] **跑绿并提交。** 关键断言：

```ts
expect(queryTextOnly.search.state).toBe('unready');
expect(mainOnly.main?.source).toBe('main');
expect(articleAboutCaptcha.access).toBe('ok');
expect(longArticle.body).toContain('END_OF_FULL_ARTICLE');
expect(longArticle.body).not.toContain('NAV_ONLY_SENTINEL');
expect(dynamicPage.navigateCalls).toBe(1);
expect(totalElapsedMs).toBeLessThanOrEqual(config.navigationTimeoutMs);
```

时间断言针对受控 fake clock／调用方时限，**不把异步资源 drain 时间硬算成必须小于 60 秒**。提交 `fix: distinguish page readiness and readable content`。

## S3 沿原工具计数、缓存与恢复接入

**Files:** 修改 src/deployment/web-runtime.ts；只有确实需要时调整 src/web/service.ts／provider.ts，禁止顺手重写。新测 tests/browser-web-integration.test.ts；复用现有 web 测试。

**Interfaces:** `assembleWeb(storage, settings, clock, provider?)` 保持；consumer 只取 managed.provider，dispose 交 S4 生命周期所有者。不把 BrowserPageResult 直接暴露给模型。

- [ ] **写失败测试。** 每成功正文计 1，20 停；失败 40 停；empty 候选累计 1 次 no_candidates；HTTP 壳、超时沿失败路径；两个阶段共享槽但计数独立；公共缓存跨阶段首次各计 1，阶段内重复不再计。
- [ ] **跑红。** `npx vitest run tests/browser-web-integration.test.ts tests/web-phases.test.ts tests/web-session.test.ts tests/web-recovery.test.ts`。
- [ ] **完成注入。** 不改工具 schema／owner／stageKey，不缓存结果摘要。保留 providerSearchCalls／providerReadCalls 含义，浏览器子资源请求不算模型工具次数。失败理由包括既有 no_candidates，空结果不得变为成功 material。
- [ ] **固定恢复与资格。** 持久 phase 及 operation 后重开 SQLite；已确认正文不重读／重计，未完成 read 允许重试，确认 step 幂等。上层 AbortSignal 到达后迟到读结果不入库；本地 timeout 且未外部取消只记原失败。生活本人查阅仍按原资格，world／school 不自动成为角色记忆。
- [ ] **跑绿并提交。** 同命令及 `npx vitest run tests/web-memory-sources.test.ts tests/web-content.test.ts tests/web-model-tools.test.ts` 通过。提交 `feat: connect browser provider to existing web phases`。

## S4 配置、服务就绪与单实例关闭链

**Files:** 新 src/deployment/plugin-runtime.ts、browser-runtime.ts；修改 src/index.ts、settings.ts、runtime/check.cjs、runtime/package.json／锁、examples/story.sample.json、runtime/plugin-smoke-fixtures.cjs、scripts/prepare-feature-check.ts。新测 tests/browser-web-config.test.ts、browser-web-plugin.test.ts；扩展 tests/runtime-check-paths.test.ts、feature-check-fixture.test.ts。

**Interfaces:**

- `createPluginRuntime(ctx: Context, config: Config, settings: StorySettings, managedBrowser?: ManagedBrowserProvider): Promise<PluginRuntime>`，其中 `PluginRuntime` 暴露 `host: SerialHost`、`stopAcceptingInput(): void`、`close(): Promise<void>`；close 幂等，统一拥有 Storage／media／managedBrowser 的结束顺序。
- `installBrowserRuntime(ctx: Context, config: Config, settings: StorySettings): void` 在 browser-runtime.ts 实现 enabled 分支、required inject、generation 和实例关闭链。待服务时不打开故事库。
- runtime/check 沿 I5b 的显式路径，新增检查所传 koishiConfigPath 的启用插件；不由静态检查启动真实浏览器。
- 为 I6 的 prepare-feature-check 增加 search 模式，启用 browser 配置及对应隔离 YAML；生成器不运行浏览器。

- [ ] **写真实 Context 失败测试。** 用 installed Koishi Context，服务可延后创建／移除，Host 与 Storage 用可计数工厂。覆盖 HDSI 先注册／Puppeteer 先注册、无浏览器关闭模式、browser 未安装／配置禁用、服务启动 reject、移除再注册、整体 dispose：

```ts
expect(hostStartsBeforeServiceReady).toBe(0);
expect(maximumConcurrentHosts).toBe(1);
expect(newStorageOpenedBeforeOldClose).toBe(false);
expect(oldFactoryCallsAfterServiceRemoval).toBe(0);
expect(unrelatedPluginPageClosed).toBe(false);
```

- [ ] **跑红。** `npx vitest run tests/browser-web-config.test.ts tests/browser-web-plugin.test.ts tests/runtime-check-paths.test.ts tests/feature-check-fixture.test.ts`。只有“传入永远存在的 mock page()”的测试不满足 R2。
- [ ] **实现配置与装配拆分。** webSearch provider 默认 unconfigured，browser 的默认 bing／60000／1；关闭直接无浏览器装配，启用 unconfigured 提前报错。createPluginRuntime 从现有 index 移出单实例逻辑，保持源代码的初始化、恢复与后台合同；不改变故事算法。
- [ ] **实现 required 服务与替换。** 内层 `ctx.inject(['puppeteer'], inner => ...)` 使用 inner 管副作用；外层串行 Promise 链＋generation 只接纳最新代。服务消失先 stopAccepting、注销输入再等 close；旧 close 未完成不得新开库。普通停止先 Host.stop，后 media.stop、managed.dispose、Storage.close。异步 start 失败也按已获得的资源逆序收尾，无二次 close。
- [ ] **实现预检与诊断。** runtime 引入显式 yaml 依赖；checkRuntime 从所选 YAML 的 plugins 树判断启用 puppeteer，支持 group 嵌套、带实例后缀 `puppeteer:...`，排除 `~` 禁用插件及禁用 group。启用搜索时缺模块／未配置报具体错误；等待服务不等于缺模块，启动失败保留原 Koishi 异常。无 Koishi 文件的程序化 Context 单测直接测 waiting／failed，不回读正式 YAML。
- [ ] **跑绿并提交。** 同命令通过，再跑离线插件 smoke；mock 浏览器不启动真实 Chromium／QQ。测试关库后写入 0、未结算 cleanup 阻挡替换，以及浏览器断开确认销毁后可完成 drain。提交 `feat: gate browser runtime on service lifecycle`。

## S5b 完整验收、文档和交付

**Files:** 扩展 scripts/validate-local-web.ts、tests/local-web-acceptance.test.ts；更新 README 与 V0.5 当前网页／恢复／实现对应／模型参考；保存搜索批次记录。

**Interfaces:** 完整公开浏览 `--online --engine bing|duckduckgo --report <absolute-path>`；不带 --probe 时覆盖固定中文查询、英文查询、动态页和不可读页。默认仍离线，实际模型续调用质量单列，不与公开页面读取混记。

- [ ] **补失败测试并转绿。** 报告分 candidate／article／dynamic／unreadable／drain；默认离线真实网络 0；拿到验证码或空正文不能报搜索可用。运行 `npx vitest run tests/local-web-acceptance.test.ts`。
- [ ] **运行完整离线门禁。** 按 [执行指南 §4](EXECUTION_GUIDE.md)，build 在最前，check 使用三个显式隔离路径且启用 mock 配置；全量测试通过才记本批离线完成，不重复引用旧批次测试数字。
- [ ] **运行公开完整浏览。** 复用 S5a 已通过引擎；中文与英文候选／正文、动态等待、不可读返回错误、资源全部排空。动态和阻挡 fixture 可用测试浏览器本地 setContent（不经产品公开 URL provider），真实引擎／目标正文必须实际公网访问。报告注明每项是公网还是合成，不能互相冒充。
- [ ] **同步用户可操作配置。** 文档给 browser provider、Puppeteer 启用位置及样例，保留正式 enabled=false 直到按实际部署范围启用；说明没有搜索 API 次费但仍耗本机资源、网络和模型续调用。模型与强度仍原值，失败不自动接付费渠道。
- [ ] **交付与提交。** 形成搜索 DELIVERY／IMPLEMENTATION_LOG／REVIEW_CLOSURE 及独立证据，R2／R3／R4 每项挂测试与文件位置。提交 `feat: deliver local browser web search`。是否正式启用和真实模型验收分别报告，服务仍由用户按既有方式手动启动。
