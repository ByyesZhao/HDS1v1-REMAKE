# Web、媒体、模型续接与输出审核

审核日期：2026-10-11。源码基线：`ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`（开始时工作区干净）。本报告只新增审核材料，不修改产品代码、配置、索引或服务，不读取密钥、私人配置、正式数据库。

已读当前 `docs/v0.5/README.md`、WEB_SEARCH、CONTEXT、EXPRESSION_STICKERS 三份子系统说明，并追踪 `src/web/`、`src/input-media/`、`src/model/`、`src/output/`、发送恢复及对应插件／CLI 接入。发现 **2 项 P2、1 项 P3**；另有 3 项有证据的性能／生命周期改进。WM-B2 与 DOCS_AUDIT 的 D1 是同一问题，合并计数。

## 复现入口与边界

```powershell
node --import tsx docs/v0.5/reviews/comprehensive-audit-20261011/evidence/web-media-probe.ts
```

- 探针：[web-media-probe.ts](evidence/web-media-probe.ts)。最终运行退出码 0；观察值与断言写入 [web-media-probe.json](evidence/web-media-probe.json)。断言确认当前缺陷／成本存在，不表示产品修复通过。
- 网页使用 linkedom 合成 DOM，再经过真实 `extractDomEvidence → managed browser provider → WebSearchService`；没有启动浏览器或访问网站。
- CLI 使用真实 `scripts/stickers.ts` 子进程、临时合成配置与临时 SQLite；占位环境键，预加载禁止 `fetch` 的脚本。结束清理临时目录；没有调用正式模型／Embedding。
- 图片只测资产读取与编码链路；使用合成 PNG 头字节和假模型响应，不证明真实图片解码或视觉质量。最初资产准备遇 Windows sandbox 临时目录 rename EPERM，未作为产品问题；最终直接构造合法 ready 资产状态，隔离本次要测的读／编码路径。
- 全量现有测试由主审核执行。本分项没有重复跑全量，也未做真实模型工具续调用／QQ 长期发送／在线视觉验收。

## 已确认问题

### WM-B1 · P2：浏览器提取出的纯文本被第二次当 HTML 清理，静默损坏网页正文

**定位：**`src/web/content.ts:15–18`；上游 `src/web/browser/extract.ts:81–85` 返回 `page.main.text`，`src/web/service.ts:55` 无差别交给 `normalizeMaterial`。

**触发条件：**正常正文包含比较符、泛型、字面 HTML 示例等已经由 DOM 解码的 `<...>` 文本。不是错误响应或异常配置，教程／技术资料的合法正文即可触发。

**实际链路：**DOM 提取器已删除真正的导航等节点，并返回纯文本；`normalizeMaterial` 仍执行标签删除及实体解码。于是文字里的尖括号重新获得了 HTML 含义。探针记录：

| 原始页面可见文字（DOM 提取结果） | 最终保存并供模型使用的正文 |
| --- | --- |
| `关系：a < b && c > d。` | `关系：a d。` |
| `类型：List<String>。` | `类型：List。` |
| `字面 HTML 示例：<nav>保留这段示例</nav>。` | `字面 HTML 示例：。` |

此操作仍记录 `successReads=1, failures=0`。损坏结果进入公共缓存及阶段资料，后续阶段复用同样损坏的内容。严重程度取决于页面：可能失去关键逻辑、类型参数、完整代码示例；模型并不知道内容已经丢失。

**修复方向：**明确 provider 的 body 格式。browser provider 返回的纯文本应只做纯文本正规化，不再剥标签／解实体；确有 HTML provider 时在其适配边界转文本。保留现有 HTML 单测，同时新增本探针这类“DOM 已解码文本 → 最终材料”的端到端回归，避免单独清理函数测试掩盖类型边界错误。

### WM-B2 · P2：启用 browser 搜索的配置使表情 import 和 rebuild 命令必然提前失败

**定位：**`scripts/stickers.ts:23–25`；`src/deployment/web-runtime.ts:7`；`src/web/service.ts:14`。

**触发条件：**按 README 执行表情素材 `import` 或 `rebuild`，使用 `webSearch.enabled=true, provider=browser` 的配置。当前文档明确采用该配置，故不是少见错配。文档入口为 `README.md:144–145,177`，以及 EXPRESSION_STICKERS 的重建说明。

CLI 在判断 rebuild 分支之前，无条件 `assembleWeb(storage,settings,systemClock)`，但没有传 browser provider。`assembleWeb` 不创建 browser，服务构造器因此选择不可用的 `UnconfiguredWebProvider` 并立即抛错。

**实际证据：**两个真实 CLI 子进程都退出 1，stderr 均为 `web search enabled but provider not configured`，尚未到达导入／重建动作。重建本来只需要旧描述与 Embedding，却被无关的网页依赖阻断；import 同样无法按文档执行。

**修复方向：**先区分 CLI 用途，再装配所需能力：rebuild 不创建 WebSearchService；import 明确支持独立浏览器 provider 生命周期，或明确选择该离线维护命令的无搜索模型模式。不能简单让运行中故事的搜索静默失效。验证应保留 enabled browser 的真实 CLI 分支，而不仅测试 `StickerLibrary` 类。

### WM-B3 · P3：嵌套 article／main 的正文会被重复拼接

**定位：**`src/web/browser/extract.ts:62`。

**触发条件：**有效正文容器本身包含同种候选容器，例如主体 article 下嵌评论 article。`querySelectorAll` 返回祖先和后代；祖先的 `text` 已包含后代，随后 `contents.join` 再追加后代。

**实际证据：**只有一处 `内层正文唯一标记` 的合成页面被提取成两处。探针 `nestedArticle` 给出原 HTML、最终全文及 `innerTextOccurrences=2`。

**影响：**嵌套内容重复进入 full_body，增加模型输入、缓存和落盘成本，也可能令重复内容在推理中被过度强调。没有查验实际网站触发频率，因此定为 P3，不声称所有页面都会重复。

**修复方向：**选取不重叠的有效正文子树后再拼接，例如先确认有正文证据的顶层候选；不要按文本相同去重，否则会误删真实重复段落。

## 高收益改进

### WM-O1 · 优先：把网页控制信息与正文快照分开，减少 JSON 重读及重复存储

**定位：**`src/web/service.ts:22,24,30,45–51,60`；`src/web/store.ts:25–30,39–46,51–54`；`src/model/client.ts:29,37–49,68`。

当前 `quota()` 只是读两个计数却调用完整 `snapshot()`；每次 snapshot 读取 session（含 checkpoint 正文）、全部 operations（含 response 正文）和全部 materials。`commitStep` 判断是否已读时又解析全部材料。模型工具续接还把完整 toolResults 存进 checkpoint。这个数据组织与任务正文是否有必要提供给模型无关，可在保持全部材料、阶段额度和恢复语义的条件下降低成本。

**实测：**内存 SQLite、每页 100,000 ASCII 字符、假模型依次 read N 页再输出；统计包含标记正文的 `JSON.parse` 输入字符，排除无正文解析。除成本统计外仍走真实 ModelClient／store／service，并构造实际 completion envelope。

| 页面数 | 唯一正文字符 | snapshot 次数 | 带正文 JSON.parse 次数 | 累计被解析字符 | 相对唯一正文 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100,000 | 10 | 7 | 703,904 | 7.0 倍 |
| 5 | 500,000 | 42 | 263 | 35,694,804 | 71.4 倍 |
| 10 | 1,000,000 | 82 | 988 | 151,781,900 | 151.8 倍 |
| 20 | 2,000,000 | 162 | 3,788 | 625,122,808 | 312.6 倍 |

20 页样本最终运行约 1.44 秒（第一次运行约 1.15 秒）；这是本机带插桩的离线累计耗时，不是线上延迟承诺、峰值内存值或单次连续阻塞时长。真正模型总输入字符仍应按每次续调用累计；探针得到约 21.10M，和本地约 625.12M 的反复解析不是同一口径。

同一样本完成后调用既有 compactOwnerCheckpoint，`web_operations` 仍有 2,015,290 字符，`web_materials` 有 2,007,881 字符：operation.response 留着正文副本。运行时 checkpoint 又多保留约 2M；不是资料池传给模型时的去重已经解决了存储重复。

**建议及收益：**增加 counters／metrics／单操作轻量查询；已取得材料用 URL/ID 元数据判断；operation 与 checkpoint 的 toolResult 只持久化 materialIds 与结果元数据，从 `web_materials` 装配模型输入及重放响应。可以去掉这两层正文副本，材料主导场景下已完成会话相关 JSON 体积接近减半，并明显降低本地同步解析成本。需保留 B 缓存口径、阶段首次成功计数、已确认操作重放和崩溃恢复，不能靠删正文或改变 20/40 获得改善。

### WM-O2 · 次优先：合并图片资产的验证和编码读取

**定位：**`src/input-media/assets.ts:38,54–58`；`src/input-media/service.ts:48–57`；`src/model/client.ts:81`。

常见的“字节已预取、尚无观察”路径会先在 ensureAsset 中整文件读取一次，再调用 resolveImageAsset 读取并 base64 编码作为检查但丢弃结果，随后 ChatCompletionsTransport 再次读取编码才交给模型。这里是重复工作，不是要求移除 pending 图的完整性检查。

**实测：**1,000,008 字节的 ready 合成资产，完整 `prepareForTurn → ModelClient → ChatCompletionsTransport` 路径：模型请求 1 次，resolveImageAsset 2 次，合计构造 2,666,732 个 data URL 字符，其中 1,333,366 字符立即被丢弃。ensureAsset 中额外一次整图 readFile 由代码路径确认，探针没有对文件系统调用计数，故不把它写成实测次数。

**建议及收益：**将“资产存在／可读验证”与“创建模型 payload”拆开，或者在单次观察调用期间共享已读字节并严格限定生命周期；同 hash 已有观察的路径尤其不必构造丢弃的 data URL。保持 ref 冻结、同版本观察及清理保护，不把原图放进普通模型上下文或持久 checkpoint。典型新图至少省掉一次完整 base64 编码和相应字符串分配；具体时延收益未测。

### WM-O3 · 次优先：环境任务 superseded 后回收其临时网页 owner

**定位：**`src/environment/scheduler.ts:16`；`src/environment/preparation.ts:25–34,75,115,130`；`src/web/service.ts:9,64–65`。

正常环境提交会 releaseOwner 并 compactOwnerCheckpoint，但跨日 supersede 只把 batch／step 终结；reconcile 的取消完成与 applyReady 的过期早退也没有同样收尾。公共 cache 仅能显式 delete，未见自动过期；旧 checkpoint 也保持完整。

**实测：**旧环境 owner 取得 1 页并保存 checkpoint，调用真实 ensureEnvironmentBatch 跨日后，step=superseded，但 `cache.size` 从 1 仍为 1，checkpointRetained=true。材料保留本身应继续用于审计，不是要清空统计或历史。

**建议及收益：**为已终结 owner 统一做一次资源收尾，在旧异步操作结算后释放进程缓存并压缩再也不会恢复的 checkpoint。普通 pending／失败／停止任务仍需保留恢复材料，不能一起清掉。避免多次跨日失败或取消导致实例存活期堆积完整公开页缓存及永久无用 checkpoint；频率取决于失败／跨日次数，未把该样本外推为固定每日泄漏量。此项来源于主审核提示，分项仅补足实际生命周期证据。

## 核对通过及不夸大的边界

- 20/40 分开计数、同阶段已确认 operation 重放、跨阶段 B 缓存、只有成功完成模型接口调用后 markProvided、personal_life 专用本人查阅来源均有实现及现有针对性测试对应。相同 query 的新搜索会继续未读候选；无新增候选计一次失败，不能误报成无端消耗失败额度。
- pending／ready／unrecognized 图片终态、关闭新图开关后仍恢复既有 pending、最终可见资源池按消息绑定观察，以及新代际阶段身份均已追踪；未确认新的内容串入或冻稿重看问题。
- 表达动作权限由 outputMode 决定；输出渲染、字素延迟、确认后更新时间和已确认项恢复跳过有明确链路。此次未确认新的确定性发送错误；真实模型是否保留所有语义及 QQ 实际确认质量未作在线验证。
- 重复 read 同页的无新增进展、图片／模型网络超时等扩展防护议题没有列入缺陷；本审核不以可能的模型不配合或假设异常作证据，也不提出新的字数／token 截断策略。
