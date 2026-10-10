# 图片输入与本地搜索交付后复核

日期：2026-10-10。**状态：审核完成，4 项 P2、1 项 P3 待修复。** 本次没有修改产品代码。

源码基线：`2a2e77e200fede80ffc6597e60e1d43295e15ea8`；与 SOL 提供的 `9641167` 相比，仅新增 DuckDuckGo 诊断资料，产品代码相同。审核范围为 `889805d..2a2e77e` 的 I1～I6、S1～S5 实现、相关测试和交付材料；开始时工作区干净。

依据：[设计合同](../../plans/image-input-local-search-20261009/DESIGN.md)、[执行指南](../../plans/image-input-local-search-20261009/EXECUTION_GUIDE.md)、[最终整合记录](../../records/local-browser-search-20261009/INTEGRATION_20261010.md)、[前轮独立复核关闭](../../records/local-browser-search-20261009/FINAL_REVIEW_CLOSURE.md)。

## 结论

主体实现可以保留，**建议先修复下列问题，再关闭本批交付审核**。不需要重做图片／浏览器架构。问题集中在来源失败分类、历史观察优先级、正文识别及验收脚本启动等待；不是安全加固或推测性的防御编程建议。

| 编号 | 级别 | 已复现的问题 | 影响 |
| --- | --- | --- | --- |
| R1 | P2 | OneBot `get_image` 返回失败时，错误未转换为图片来源不可用 | 普通取图失败使整轮报错并暂停 |
| R2 | P2 | 关闭图片识别后，延期回复把已确认图片冻结成未识别 | 已有观察仍在库中，但本轮后续模型看不到 |
| R3 | P2 | DOM 可见性未考虑实际 CSS | 隐藏文章被读作正文，隐藏验证码误拦可读页面 |
| R4 | P2 | 登录表单被 `<main>` 包裹即可绕过登录墙判断 | 登录提示按成功正文计数并进入资料池 |
| R5 | P3 | 公开浏览验收脚本没有浏览器就绪失败／超时出口 | 启动失败后不返回验收结果、不落失败报告 |

修复步骤、文件、测试断言及验收顺序已写入 **[FIX_PLAN.md](FIX_PLAN.md)**，可直接交给 SOL 执行。R1～R4 是功能关闭项；R5 是验收工具问题，建议同批修正。

## R1：OneBot 图片来源失效会暂停故事

**位置：**[assets.ts](../../../../src/input-media/assets.ts) 第 18 行；[service.ts](../../../../src/input-media/service.ts) 第 47～48 行；[app.ts](../../../../src/app.ts) 第 81～89 行。

`AttachmentResolver.resolve()` 对 HTTP 下载错误做了 `ImageUnavailableError` 转换，但 `await this.getImage(a.platformFile)` 在该转换之外。平台返回非零 `retcode` 时，已安装的 OneBot `Internal` 抛出 `SenderError`；`prepareForTurn()` 只接收 `ImageUnavailableError` 作为受控未知，其余异常交给 `HdsiApp.execute()`，最终设置 `paused=true`。

复现使用真实的已安装 `OneBot.adaptMessage` 与 `OneBot.Internal`，只替换外部请求为 `{retcode:100,data:null}`；经当前协议 2 的真实 `HdsiApp.runTurn()` 执行。结果为：

```json
{"error":"SenderError","paused":true,"turnDone":false,"terminalEntries":[],"attachmentStatus":"pending","modelTasks":["narrative"]}
```

这与“来源不可下载／不可解析形成本轮 `unrecognized`；模型错误仍上抛”的设计不符。预下载吞掉异常不会解决问题：进入合法读取时仍会遇到同一来源错误。它也不同于前轮已修复的 token 解析／`internal.getImage` 绑定问题，当前 token 和桥接都已正确到达 API。

**修复方向：**只在平台来源解析边界把取图失败归入 `ImageUnavailableError`，保留取消语义；随后使用现有未识别终态流程。不要扩大 catch 到存储和模型调用。

## R2：禁用新识别覆盖已确认的历史观察

**位置：**[service.ts](../../../../src/input-media/service.ts) 第 41～44 行；实际触发入口为 [app.ts](../../../../src/app.ts) 第 145～147 行的 `deferred_reply`／`reconsider`。

服务先执行 `!config.enabled → unrecognized`，后执行附件已有 `confirmedObservationRef` 的复用。旧消息因延期回复重新进入 `prepareForTurn()` 时，关闭图片识别会新建一个未知终态；hydration 再按“本轮终态优先”用它覆盖历史观察。

独立探针进行了两个完整的协议 2 故事轮：A 轮启用识别、以 mock 模型确认猫图及 OCR；停止旧媒体服务；B 轮使用关闭识别的新服务，经延期任务重新回应同一已读消息。结果：

| 检查 | 实际结果 |
| --- | --- |
| A 轮确认的观察 | `ready`，description=`cat`，visibleText=`["hello"]` |
| B 轮仍可从附件读到的确认观察 | 1 条 |
| B 轮冻结状态 | `unrecognized` |
| B 轮 personal 资料池 | 保留该消息，`visualObservations=[]` |
| B 轮额外视觉调用 | 0 |

不是所有普通历史读取都会丢图：只纯读历史、不再 prepare 的路径仍能保留观察。已复现的是延期回复等重新准备已读附件的路径。

设计 §4.1 明确“本轮终态 → 该附件已有确认关联 → 后续准备”的优先级；关闭开关限制陌生图片下载与模型调用，并不撤销已确认的历史事实。原 I4a 清单“关闭仅已知 face 可 ready”措辞偏宽，修订时应明确它指**没有既存确认的附件**，以免与该优先级冲突。

**修复方向：**保留已有本轮终态、pending 版本／身份检查；没有本轮冻结项而附件已确认时先复用不可变观察，再处理新附件的关闭开关。不修改历史记录，也不重判已经冻结的未知终态。

## R3：隐藏 DOM 被当成当前可见内容

**位置：**[extract.ts](../../../../src/web/browser/extract.ts) 第 8～10、20～26 行。

`visible()` 只检查 `hidden`／`aria-hidden` 及元素自己的行内样式，忽略样式表和祖先的 CSS。正文分支复制文档后先移除 `<style>`，再从脱离渲染树的副本取文本，隐藏模板由此重新成为正文候选。

在真实 headless Chrome 中使用下列合成页面，经过产品 Koishi port、页槽、provider 和 `WebSearchService.readPage()`：

```html
<style>.hidden { display: none }</style>
<article class="hidden"><p>HIDDEN_STALE_TEMPLATE</p></article>
<main><p>VISIBLE_REAL_BODY</p></main>
```

实际资料正文是 `HIDDEN_STALE_TEMPLATE`，可见正文被遗漏，计数为 `successReads=1, failures=0`。另一用例把 `form#captcha-form` 放进 `.hidden` 祖先、同时保留可见文章，实际变为 `access=captcha`、一次 `read_error`。

**修复方向：**在仍连接到页面的原 DOM 上读取计算后的可见性，把排除结果传递到清洗副本；访问阻挡、结果项、空态、article/main/Readability 使用同一口径。不能在删除样式后的 clone 上重新判断 CSS。真实 CSS 行为须由真实浏览器夹具验证，单独的 linkedom 测试不能证明这一点。

## R4：语义容器使登录提示冒充正文

**位置：**[extract.ts](../../../../src/web/browser/extract.ts) 第 11、24～26 行。

当前条件只在不存在 `article/main/[role=main]` 时把可见密码表单认作登录墙。语义标签本身不证明其中有文章。以下页面被实际 provider 成功读取：

```html
<main>
  <h1>Sign in</h1><p>Sign in to continue reading.</p>
  <form><input type="password"><button>Sign in</button></form>
</main>
```

移除 form 后还留下登录引导段落，满足当前“去掉链接与标题后仍有文字”的检查。最终正文为 `Sign inSign in to continue reading.`，`WebSearchService` 记录 `successReads=1, failures=0` 并保存材料。影响不止标题不美观，而是把无法获得的正文作为已成功查阅的材料提供给模型。

**修复方向：**可见登录表单存在时，必须找到独立于登录区域的实际正文，才能按可读页返回；`main` 存在或 form 外有提示文字不足以充当反证。同时保留真正文章讨论登录／验证码、文章旁有独立登录组件等正常页面。

## R5：验收脚本可能等不到失败结果

**位置：**[validate-local-web.ts](../../../../scripts/validate-local-web.ts) 第 26～28 行。

`ready` 只有 resolve，没有 reject 或截止时间。Koishi 服务 `start()` 拒绝时会发出 `internal/error`，但 `ctx.start()` 可以正常返回，随后脚本永久等待 `ready`；catch／finally 无法执行。

复现仅在探针进程内把 Puppeteer 插件换成真正的 Koishi `Service('puppeteer')`，其 `start()` 抛出明确错误，不启动浏览器。结果：服务启动 1 次、原始错误已发出；观察 1000ms 后 `validateLocalWeb()` 未结算、报告文件不存在，根 Context 未被验收脚本清理。探针随后主动关闭该测试 Context。

1000ms 不是产品应采用的超时时间；未结算现象与源码没有任何失败／超时出口共同确认该问题。Node 是否保持进程还取决于其他句柄，因此不宣称所有机器都会一直占着终端；它也可能在缺少报告的情况下退出。

**修复方向：**在注册服务前建立启动失败监听及有界就绪等待，将异常交给现有失败报告／finally 清理；不修改正式插件 Host 的服务生命周期设计。

## 独立验证与证据

| 检查 | 本次结果 |
| --- | --- |
| 构建、类型检查 | 通过 |
| 原有完整测试 | 首次受沙箱临时缓存路径影响，导入失败；指定工作区 TEMP/TMP 后，172 文件／880 项通过，剩余 1 文件／2 项仅因创建临时 junction 被禁止而失败 |
| 两项只读启动检查补跑 | 经工具批准在沙箱外运行，同一源码的 1 文件／2 项通过；合计覆盖全部 173 文件／882 项，**不是声称一次全量命令零失败** |
| 离线 demo、原插件验收 | 通过；`empty_week`／`required_notice` 均完成，repair=0 |
| R1／R2 探针 | 真实 App、协议 2、mock 模型、内存数据库；HTTP 调用 0；复现上述错误 |
| R3／R4 探针 | Chrome 154、真实 port/provider/WebSearchService；4 个合成页面、页面网络请求 0、打开 4 页／关闭 4 页、剩余 0 页 |
| R5 探针 | 真实 Koishi、进程内替换启动失败服务；未启动 Chrome 或正式服务；复现未结算与缺报告 |

现有测试通过与新增缺陷可以同时成立：旧取图回归只覆盖成功 API；关闭模式测试未覆盖既存观察的延期回复；已有 DOM 夹具没有浏览器计算样式，登录夹具只含裸 form；验收脚本没有失败启动的回归。

原始记录和运行方式见 [evidence/README.md](evidence/README.md)，机器可读摘要见 [verification.json](evidence/verification.json)。缺陷结果分别为 [图片](evidence/image-results.json)、[浏览器](evidence/browser-results.json)、[启动等待](evidence/startup-ready-results.json)。探针成功退出表示**复现程序完成**，不表示产品满足修复后的断言。

## 未列为新问题的事项

- `parse.ts` 与计划里的 `ingress.ts` 职责相符，重命名没有必要。
- 计划保留原路径以稳定审核链接合理；本轮关闭后再统一归档。
- 前轮 OneBot token／内部方法绑定、导航加载壳、popup 排空三项修复仍保留，相关回归通过；本轮问题是不同输入分支。
- 页槽预留、取消后的迟到建页回收、服务重装配串行链、既有 20／40 额度及 B 缓存路径，本次未确认新的缺陷。这是审核范围内的结论，不代表所有第三方网页均可解析。
- Bing 公开验证及 DuckDuckGo 验证码情况沿用 SOL 的交付证据，本次没有重新访问公开站点。真实图片模型质量仍未在线验收，不把它包装成已验证，也不因此否定已经完成的离线工程验证。

本次只新增审核资料与探针、更新文档入口，并重新生成构建；未改产品源码、既有测试、正式配置、密钥、模型设置或正式数据库，未启动正式服务。
