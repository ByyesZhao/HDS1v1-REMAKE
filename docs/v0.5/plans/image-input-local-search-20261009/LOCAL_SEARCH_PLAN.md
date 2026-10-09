# Local Browser Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 本计划不要求多代理；没有用户明确要求时不得主动启动代理。

**Goal:** 通过本地浏览器搜索并读取公开网页，避免付费搜索API，沿用重制版已实现的20／40、引用与恢复合同。

**Architecture:** 将已复制的旧Puppeteer底层能力适配为现有WebSearchProvider；候选搜索与正文读取仍分开。独立浏览器端口可离线mock，正式由新runtime的Koishi Puppeteer提供。

**Tech Stack:** 现有TypeScript、Koishi、Vitest与WebSearchService；新增可选koishi-plugin-puppeteer及运行依赖／锁；本机Chromium由插件管理。

**Spec:** [设计§1、4～6](DESIGN.md)。日期2026-10-09，状态未实施，基线ddde663。源码路径相对项目根目录；可独立于图片计划交付。

## Global Constraints

- 模型和思考强度全保持现状；不是DeepSeek原生搜索，不调用付费API或自动付费回退。
- 每逻辑阶段20成功正文／40失败，独立计数；同阶段修补／续调用不重置，缓存沿既定B口径。
- 搜索页及摘要不是目标正文；旧字符／token剪裁和20／20不能移植。
- 搜索关闭时不要求浏览器；搜索开启而未装配provider／插件时明确报错。
- 不载入旧HDSI插件、配置或node_modules；旧资料只从本项目references取需要逻辑。
- 不改变睡眠、前台故事串行、环境准备／提交或生活网页入记忆资格；不登录或绕过验证码。

## Review Focus

1. HTTP200导航壳／验证码／真正无结果的区分：S2测试固定。
2. 一段完整超长正文不裁剪，搜索摘要不当正文：S2／S3测试固定。
3. 两阶段共用页槽但计数各自独立；关闭搜索无浏览器也可启动：S1／S4测试固定。
4. 恢复或取消时网络可重读但确认材料／计数不能重复：S3测试固定。
5. 外部提取结果传回原阶段，但不能使角色凭世界／学校参考自动知情：S3／S5测试固定。

## 文件分工

| 文件 | 职责 |
| --- | --- |
| 新`src/web/browser/types.ts`、`koishi-port.ts`、`slots.ts` | 浏览器端口、Koishi桥接及全局页槽 |
| 新`src/web/browser/extract.ts`、`provider.ts` | 搜索结果／正文／访问状态及现有provider适配 |
| `src/settings.ts`、`web/types.ts`、`deployment/web-runtime.ts`、`index.ts` | 新provider配置与正式装配 |
| `runtime/package.json`和锁、根package.json及锁 | 可选peer／开发类型与正式运行插件 |
| 新`scripts/validate-local-web.ts` | 离线／公开页面在线验收 |

### S1：浏览器端口、页槽和生命周期

**Files:** 新types／koishi-port／slots；新增`tests/browser-page-slots.test.ts`、`tests/browser-koishi-port.test.ts`。

**Interfaces:** BrowserPort.openPage和BrowserPagePort.read／close按设计§5.1；`BrowserPageSlots.run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>`，默认maxConcurrentPages=1；Koishi适配器只依赖注入的page工厂。

- [ ] 写失败回归：共享页槽至多1页、FIFO等待、等待时取消不占槽、goto失败／evaluate失败／signal取消均关闭页面、迟到建页关闭、工作结束唤醒下一请求。
- [ ] `npx vitest run tests/browser-page-slots.test.ts tests/browser-koishi-port.test.ts`确认失败。
- [ ] 参考旧public-web-reader实现小端口；单次完整页面操作60秒默认（包括排队／建页／读取），剩余时间用于导航；不要复制旧故事、观察表或模型预算。
- [ ] 接入signal与受控公开网页访问；拒绝本地／私网目标和非HTTP(S)，弹窗关闭，登录／验证码只返回不可读，不新增绕过措施。
- [ ] 同命令转绿；Host先等待既有前台完成，随后dispose端口拒绝新页、关残留页。提交S1。

### S2：搜索候选、正文与可读状态

**Files:** 新extract／provider；新增`tests/browser-search-provider.test.ts`、`tests/browser-page-extraction.test.ts`。

**Interfaces:** `extractSearchCandidates(page: BrowserPageResult, engine: 'bing'|'duckduckgo'): Array<{url:string;title:string}>`；`extractReadablePage(page: BrowserPageResult): {title:string;body:string}`；BrowserSearchProvider.search／read保持WebSearchProvider签名。

- [ ] 写失败回归：Bing与DDG真实结果fixture提取URL；去重；搜索“无结果”返回[]；HTTP200只有导航／验证或登录壳抛不可读；结果摘要不能成为read正文；长正文完整保留，无12000／3000剪裁。
- [ ] `npx vitest run tests/browser-search-provider.test.ts tests/browser-page-extraction.test.ts`确认失败。
- [ ] 从复制的web-page借鉴可见结果选择器与访问判断，支持bing／duckduckgo已知引擎。引擎URL从固定模板生成并encode查询，不允许model随意改引擎配置。Bing跳转链接须按实际公开结果href解析成可访问目标，不把搜索站内部导航当文章候选。
- [ ] read返回实际正文／主内容文字，排除导航壳；不调用模型总结网页。provider.search一次只搜索一页，read一次只读一页；没有隐藏循环／跨引擎／付费回退。
- [ ] provider.signature含引擎及提取器版本；同命令转绿，提交S2。

### S3：接入既有工具合同、计数及恢复

**Files:** deployment/web-runtime；web/provider／service仅有必要适配时修改；新增`tests/browser-web-integration.test.ts`。

**Interfaces:** `assembleWeb(storage, settings, clock, provider?)`继续接受WebSearchProvider；模型工具schema及现有owner／phase身份不变。此任务只使用S1／S2端口，不依赖I任务。

- [ ] 写失败回归：搜索后读正文计成功、搜索失败与读取失败各沿原失败规则；20成功或40失败停；每阶段各自计数、同阶段重复正文不重复计；两阶段公共缓存各首次计1；空候选返回结果不足。
- [ ] `npx vitest run tests/browser-web-integration.test.ts`确认失败。
- [ ] 注入browser provider到现有service，不把搜索结果页另记成功材料；状态区分provider搜索／read调用与浏览器子资源网络请求。
- [ ] 写恢复回归：已确认material不重复读／计、未完成网络read可重试、同一operation step确认幂等、已有signal取消不追加迟到材料、页面错误不持久化登录壳。转绿并重跑`tests/web-phases.test.ts`及web相关现有回归。
- [ ] 保留life本人查阅资格／来源与环境参考边界，提交S3。

### S4：配置、Koishi插件与关闭模式兼容

**Files:** settings、web/types、index、package.json／锁、runtime/package.json／锁、examples/story.sample.json、runtime/check.cjs及smoke fixtures；新增`tests/browser-web-config.test.ts`、`tests/browser-web-plugin.test.ts`。

**Interfaces:** webSearch新增provider默认unconfigured与browser参数；bing默认，navigationTimeoutMs=60000、maxConcurrentPages=1。`createBrowserSearchProvider(ctx, settings): WebSearchProvider | undefined`封装注入检测；关闭模式不建浏览器。

- [ ] 写失败回归：原配置搜索false无需puppeteer；true＋unconfigured启动报错；true＋browser但插件缺失报错；true＋browser＋mock可用；原13模型及强度解析不变，20／40不变。
- [ ] `npx vitest run tests/browser-web-config.test.ts tests/browser-web-plugin.test.ts`确认失败。
- [ ] 替换index的无条件启用拒绝为具体provider／浏览器检查与装配。声明可选peer，运行目录安装koishi-plugin-puppeteer（旧版参考^3.9.0，以实际安装并锁定版本为准）；不从旧目录运行。只读检查只校验配置／装配条件，不能打开页面／修改正式库。
- [ ] smoke继续离线，mock page工厂，不启动真实Chromium或QQ。私有koishi.yml的插件启用留正式配置步骤，不在测试覆盖正式文件。
- [ ] 同命令转绿，提交S4。

### S5：公开浏览验收、费用说明与交付

**Files:** 新scripts/validate-local-web.ts、`tests/local-web-acceptance.test.ts`；更新README、V0.5搜索／实现对应／模型服务参考；记录本任务过程及evidence。

**Interfaces:** 验收脚本默认离线；`--online --engine bing|duckduckgo --report <path>`仅搜索公开固定查询并读取公开页面，不调模型或QQ。模型工具闭环由离线mock验证；真实Flash续调用验收另明确记录范围。

- [ ] 写失败回归：默认离线0真实网络请求、报告分别给搜索候选／正文结果、失败及耗时；无候选／只有壳不判“搜索可用”。`npx vitest run tests/local-web-acceptance.test.ts`确认失败后实现并转绿。
- [ ] 完成`npm run typecheck`、`npm test`、`npm run build`、`npm run demo`、`npm run check --prefix runtime`、`npm run smoke --prefix runtime`；离线通过不代替浏览器实测。
- [ ] 真实浏览公开中文查询、英文资料、动态页与不可读页面；至少证明一个引擎可返回真实候选且成功取正文。保存实际浏览器／插件版本与结果，不把现有HTTP探针当此验收。失败就保持正式enabled=false并说明实际原因，不偷偷接付费服务。
- [ ] 更新文档：无搜索API计次费仍有本机资源／模型续调用费用；仅实际读正文才计成功；SearXNG为后续候选。同步当前状态与报告；原始失败／成功日志分别保留。
- [ ] 如正式配置启用已在执行授权范围，停服备份、启用新runtime Puppeteer与browser provider、确认模型／强度未变，仅离线检查不启动服务；否则交付具体可审配置待用户启用。不安装SearXNG，不自动连接付费API。提交交付，关闭后归档计划。
