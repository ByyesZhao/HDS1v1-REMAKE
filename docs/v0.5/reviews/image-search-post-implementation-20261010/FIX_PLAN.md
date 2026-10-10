# 图片与搜索交付后修复实施方案

> **执行者 SOL：**使用 `superpowers:executing-plans`，或已获授权时使用 `superpowers:subagent-driven-development`，按任务完成红／绿回归。本文件是修复交接，不表示修复已经完成。

**Goal：**关闭 [REVIEW.md](REVIEW.md) 的 R1～R5，保留已经通过的图片授权、恢复、页槽和搜索额度合同。  
**Architecture：**沿现有模块修正分支与证据判断；取图异常在来源边界分类，历史确认优先于新识别开关，DOM 在原页面判断可见性后清洗。验收脚本单独补启动失败出口，不重写正式 Host 生命周期。  
**Tech Stack：**TypeScript、Node.js >=22.13.0、Vitest 5、Koishi 4.18.11、Puppeteer、Readability 0.6.0。  
**Spec：**[原设计](../../plans/image-input-local-search-20261009/DESIGN.md) §3～6；[原执行指南](../../plans/image-input-local-search-20261009/EXECUTION_GUIDE.md)；[本次原始复现](evidence/README.md)。  
**日期／基线／状态：**2026-10-10；`2a2e77e`；原计划状态为待实施；后续已执行，见[修复交付](../../records/image-search-post-review-fixes-20261010/DELIVERY.md)，原清单保留交接时含义。

## 全局约束与实施顺序

- 保持模型、思考强度、提示用途、20 成功正文／40 失败、B 缓存及原有调用权限；不加文本裁剪、自动搜索回退或登录绕过。
- 本轮只修复代码与合成测试，不改正式开关、配置或数据库，不启动正式服务，不调用真实图片模型。
- 不更改本轮 `ready/unrecognized` 终态，不用新识别版本重判历史确认，不把来源失败与模型／数据库失败一并吞掉。
- 不重写原失败 JSON／日志；修复证据放新的 records 批次，逐项链接原 review 编号。
- 顺序建议：**T1 → T2 → T3 → T4 → T5 → 整批门禁**。T3／T4 共同修改 extractor，顺序执行以避免重复改动；其余任务可以单独验证。

| 任务 | 修改文件 | 回归落点 |
| --- | --- | --- |
| T1／R1 | `src/input-media/assets.ts` | `tests/incoming-media-onebot-review.test.ts`、必要时 `tests/incoming-media-assets.test.ts` |
| T2／R2 | `src/input-media/service.ts` | `tests/incoming-media-turn.test.ts`、`tests/incoming-media-integration.test.ts` |
| T3／R3 | `src/web/browser/extract.ts` | `tests/browser-page-extraction.test.ts`、真实浏览器离线夹具 |
| T4／R4 | 同上 | `tests/browser-final-review.test.ts`、`tests/browser-web-integration.test.ts` |
| T5／R5 | `scripts/validate-local-web.ts` | 新增 `tests/local-web-validation-startup.test.ts` |

## Review Focus

五类输入分别由下列任务锁定，不仅验证普通成功分支：

1. 已安装 OneBot API 的失败响应，以及等待失败期间被取消的请求：T1。
2. 已确认图片随延期任务重新进入 prepare，且图片开关已关闭：T2。
3. 样式表／祖先隐藏的正文、访问墙、结果项和空态：T3。
4. 语义 main 中的登录区域，与正文旁独立登录组件的区分：T4。
5. 浏览器服务拒绝启动或始终不就绪时，验收仍可结束并落盘失败：T5。

## T1：统一平台来源失败分类

**接口保持：**`AttachmentResolver.resolve(a, signal?)` 成功返回字节／mimeType；取图来源失败抛 `ImageUnavailableError`；外部取消保留取消原因。`prepareForTurn()` 继续使用现有异常分类。

- [ ] 在 OneBot review 测试中增加 `onebot_get_image_failure_freezes_unknown_and_turn_finishes`。使用真实 `OneBot.adaptMessage` 生成 token，真实 `OneBot.Internal` 的 `_request` 返回 `{retcode:100,data:null}`；经协议 2 的 `HdsiApp.runTurn()` 断言：附件终态 `unrecognized`、`downloadStatus=unavailable`、视觉模型 0 次、turn.done=true、runtime.paused=false、无系统报错。参考本 review 的 `reproduce-images.cjs`，不要只断言 resolver 抛出的错误类型。
- [ ] 运行 `npx vitest run tests/incoming-media-onebot-review.test.ts tests/incoming-media-assets.test.ts`，保留原实现失败记录。预期失败点是 SenderError 外溢及整轮暂停。
- [ ] 将 `getImage` 调用放入专属来源边界 catch：先检查 signal 是否已取消并保留取消；其余平台解析失败转换为 `ImageUnavailableError`。API 返回后也检查取消。catch 不包裹数据库读写、观察 schema 或模型调用。
- [ ] 补取消回归：API 待返回时 abort，再让 API reject；断言不冻结 `unrecognized`，不得伪装成来源不可用。保留现有 token 成功桥接、base64、HTTP 不可用和模型错误上抛回归。
- [ ] 跑绿并独立提交，例如 `fix: classify unavailable OneBot image sources`。

## T2：已确认观察优先于新识别开关

**接口保持：**`prepareForTurn(turnId, ids, signal?)`、`readConfirmedForMessages(ids)` 和冻结结构均不变；不需要 schema 迁移。

- [ ] 增加 `disabled_visual_input_preserves_confirmed_deferred_image`：A 轮合法确认图片，不建立替代图片的文字记忆；停止媒体服务、关闭临时磁盘 SQLite 后重开；B 轮以 `enabled=false` 经 `deferred_reply` 处理原消息，捕获真实 personal／expression envelope。断言二者仍有同一 `observationRef`、内容和 OCR；视觉及下载额外调用均为 0；turn.done=true。表达夹具明确给出 `reply.decision=now`，确保实际执行 expression。
- [ ] 运行 `npx vitest run tests/incoming-media-turn.test.ts tests/incoming-media-integration.test.ts tests/incoming-media-context.test.ts`，确认新增用例在旧代码因 `unrecognized`／观察缺失而红。
- [ ] 在 service 中落实顺序：已有本轮 terminal 直接返回；pending 保持原 assetRef／phase／版本恢复规则；**无本轮冻结项且附件已有确认关联时，先读取该不可变观察**；仅对需要新准备的附件应用平台映射／开关／下载／识别逻辑。复用旧确认时不替换为最新内容缓存版本。
- [ ] 保留并验证反例：关闭后陌生图片仍未知且不下载；已知 face 仍可用；已冻结未知不因后来来源恢复而重判；开启状态的历史观察同样不重看；pending 恢复与原 20／40 接续无回归。
- [ ] 在 I4a 原清单加明确的后续裁决链接，说明“关闭仅 face 可 ready”针对没有既存确认的附件；当前子系统说明同步“关闭不撤销历史观察”。不要把原审核／原红日志改成已通过。
- [ ] 跑绿并独立提交，例如 `fix: retain confirmed images when recognition is disabled`。

## T3：以原页面的计算样式决定可见性

**接口保持：**`extractDomEvidence(document, finalUrl, engine?, ReadabilityCtor?)` 仍返回 `BrowserPageResult`，并保持可独立序列化到浏览器运行。不得让函数依赖未传入浏览器的 Node 闭包。

- [ ] 为下列夹具保存旧实现结果；结构类断言放现有 Vitest，计算 CSS 的断言必须另走真实 Chrome、产品 port/provider，使用 `setContent` 且禁止页面网络请求：

| 输入 | 必须得到的结果 |
| --- | --- |
| `.hidden{display:none}` 的 article 在前，可见 main 在后 | 只读 `VISIBLE_REAL_BODY`，不含隐藏标记 |
| `visibility:hidden` 或 display:none 祖先下的旧正文 | 不构成主体依据 |
| CSS 隐藏 captcha，旁边可见文章 | 文章可读，不误报 captcha |
| 一个隐藏墙节点后另有可见墙节点 | 仍识别实际可见访问墙，不能只检查第一个匹配节点 |
| Bing／DDG 的隐藏结果项或隐藏空态，随后出现可见内容 | 隐藏节点不能提前返回 results／empty；按原截止时间等待 |
| 短正文、fixed 布局正文、可见 main | 正常可读，不加任意字数门槛 |

- [ ] 在仍连接原 document 的元素上读取计算样式，覆盖样式表及祖先的实际隐藏效果；将不可见节点对应地排除于 clone，再执行现有清洗、正文与 Readability 提取。采用一次遍历和原节点／克隆节点对应关系即可，不为每个字符或文本节点重复遍历整棵 DOM。
- [ ] 让阻挡节点、搜索链接、专属空态和正文共享该可见性判断。对访问墙使用所有匹配节点，不能因首个隐藏节点忽略后面的可见节点。不要单凭 `offsetParent` 为 null 判隐藏，以免误伤 fixed 等正常布局。
- [ ] 保留无布局 DOM 夹具的明确 fallback，但交付记录必须区分结构测试与真实 CSS 测试。真实浏览器缺失时应明确失败／未验收，不能把 fallback 当成 CSS 验证通过。
- [ ] 运行 `npx vitest run tests/browser-page-extraction.test.ts tests/browser-koishi-port.test.ts tests/browser-final-review.test.ts tests/browser-search-provider.test.ts`；另运行本目录 `reproduce-browser.cjs`，输出到**新的** JSON。修复后 hiddenArticle 应为可见正文、hiddenCaptcha 应 successReads=1／failures=0，所有页面排空。
- [ ] 更新提取器版本至 `dom-v2/readability-0.6.0`，让 provider signature 反映正文判定变化；T4 同批采用该版本。提交例如 `fix: exclude computed-hidden browser content`。

## T4：登录区域不能充当独立正文

**输入／输出保持：**沿 T3 的可见性结果识别访问状态；不可读登录页返回 `access=login_wall`，provider 按原合同拒绝，WebSearchService 记录一次失败且不保存成功材料。

- [ ] 新增 `main_wrapped_login_is_not_full_body`，分别使用 `<main>`、`<div role=main>` 包裹本 review 的登录夹具；先确认旧实现返回提示文字而失败。
- [ ] 修改第 11 行的语义容器豁免：存在可见凭据表单时，先识别它所在的登录区域，标题／引导文字也属于该区域；只有区域之外存在独立正文依据时才按文章处理。单凭 main 标签或移除 form 后剩余非空提示，均不得解除登录墙判定。实现者可沿现有候选节点清洗组织判断，无需引入 NLP、全文关键词黑名单或固定字数截断。
- [ ] 用反例约束区域边界：可见 article 加旁边独立的登录 dialog／aside 仍读 article；真正文章讨论“登录／验证码”但没有阻挡表单仍读；main 内嵌独立文章与旁侧登录组件不能被整块删除；真正登录主区域则拒绝。搜索结果和普通短正文沿原规则处理。
- [ ] 通过实际 provider 接入 `WebSearchService`，断言登录页 `successReads=0, failures=1, materials=[]`；可读反例为 successReads=1。禁止只改报告文本而保留成功计数／正文缓存。
- [ ] 运行 `npx vitest run tests/browser-final-review.test.ts tests/browser-web-integration.test.ts tests/browser-page-extraction.test.ts`；重跑真实浏览器离线探针，loginMain 应拒绝，R3 两个修复不得退回。提交例如 `fix: reject semantic login shells as article bodies`。

## T5：验收脚本启动失败可结束、可报告

**拟增可测选项：**`validateLocalWeb(options)` 增加 `startupTimeoutMs?:number`，默认 `60000`；仅用于此独立验收脚本的服务就绪等待，不改变产品导航预算或 Host 行为。原 CLI 不传该项时使用默认值。

- [ ] 新增 `tests/local-web-validation-startup.test.ts`，通过进程内替换插件或等价明确注入，在真实 Koishi Context 上覆盖：服务 start 抛原始错误；服务一直不就绪；服务正常就绪。若测试框架需要，沿既有 `createRequire`／Koishi mock 模式，避免加载出两份不同 Context 实现。
- [ ] 对前两项先跑红：旧脚本的返回 Promise 不结算、报告不产生。失败用例的外层测试须有自己的截止时间并在 finally 清理测试 Context，不让整个测试套件挂住。
- [ ] 注册插件前建立就绪 Promise、`internal/error` 监听与 60 秒启动截止时间；任何分支 settled 后移除监听并清 timer。启动与就绪等待合成同一被 await 的失败链，避免先 reject 却尚未接上处理器。失败到原 catch/finally，保留原因、`passed=false`，停止该独立 Context 并保存报告。
- [ ] 断言抛错分支保留 `SYNTHETIC_BROWSER_START_FAILURE`，超时分支报告明确 startup timeout；两个分支均有限时间返回、没有页面、Context 被清理、JSON 落盘；CLI 报失败时退出码非零。正常就绪没有遗留计时器。测试注入较短预算，不实际等 60 秒。
- [ ] 运行 `npx vitest run tests/local-web-validation-startup.test.ts tests/browser-web-plugin.test.ts tests/browser-web-plugin-extra.test.ts`，后两组证明未破坏正式装配合同。提交例如 `fix: settle browser validation on startup failure`。

## 整批门禁与关闭记录

- [ ] 各项保留原红结果、修复提交和绿结果；新增测试数量由实际输出填写，不预设总数。
- [ ] 运行 `npm run typecheck`、`npm run build`、`npm test`。本审核在沙箱 TEMP 下出现 Vitest 缓存 ENOENT，改用工作区 `.tmp` 的 TEMP/TMP 后解决；只读检查的 junction 权限失败需要在允许创建链接的环境补跑，不能改断言绕过。区分环境失败和产品失败。
- [ ] 运行 `npm run demo`、`node runtime/plugin-smoke.cjs`，保留两个既有场景。运行图片协议 2 的完整延期回复／恢复回归、真实浏览器离线 DOM 夹具及启动失败回归。
- [ ] 本批先以离线证据关闭上述缺陷。若重跑公开 Bing 验收，单独记录为公开工程验收；DuckDuckGo 遇到验证码仍按失败保留，不更换成“全部通过”。真实图片模型质量继续单独标注未验收。
- [ ] 在新的 `docs/v0.5/records/image-search-post-review-fixes-20261010/` 写交付和 R1～R5 关闭映射，附提交、测试名及证据路径。更新版本／审核入口；原 review、原始 JSON 与日志保持原基线含义。
- [ ] 提交前确认产品变更仅上述范围，正式配置／数据库／开关未变；最终交付注明有无启动正式服务及有无在线模型调用。无需为本轮修复重跑旧环境迁移或删媒体表。
