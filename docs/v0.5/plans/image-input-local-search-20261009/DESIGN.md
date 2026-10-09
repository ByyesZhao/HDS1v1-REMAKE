# 图片输入与本地搜索设计（审核修订版）

日期：2026-10-09。状态：**设计已细化，功能未实施**。源码基线 `4fe090c`（产品代码沿用 `b9d5514`）。本文件替代同路径原待审稿；原稿由该提交及 [review 基线](../../reviews/image-input-local-search-20261009/evidence/baseline.json)追溯。返回[入口](README.md)。

## 1. 范围与裁决

保留“独立图片观察 → 文字资料池”和“本地浏览器 → 现有 WebSearchProvider”两条路线，先图片、后搜索，分别交付。图片识别与用户意图判断分开：观察任务识别画面，个人导演结合消息语境决定反应。

- 当前图片入口只有占位和 hasVisualAttachment；发送层已有单图 image_url 能力。新图片任务复用现有 Flash／high 连接，不改任何已有模型、强度、输出模式或嵌入连接。
- 当前网页工具的阶段身份、20 成功正文／40 失败、B 口径缓存、checkpoint 和本人查阅规则继续使用；新增底层 provider，不重写工具框架。
- 图片开关默认 false；搜索开关默认 false。已知原生表情名称可在图片关闭时使用；关闭时不下载陌生图片、不调用视觉模型。
- 本批不做图片相似度检索、图片自动入发送图库、多图一次模型调用、GIF 抽帧、搜索 RSS、跨引擎自动回退或 SearXNG 部署。
- 不增加正文／观察字符裁剪，不把 HTTP200、搜索摘要、旧图库用途描述当已识别事实。
- 原始消息 15 秒／共同活动 60 秒收件节奏、四段原文窗口、睡眠与暂停合同不变；暂停只挡新故事轮，已开始的前台轮继续完成。

[原审核](../../reviews/image-input-local-search-20261009/PLAN_REVIEW.md)的 R1～R5 均纳入以下合同。[执行指南](EXECUTION_GUIDE.md)给出依赖、验证顺序与交接要求；它与两份实施计划共同使用。

## 2. 图片：数据及接收合同

### 2.1 统一类型

定义在新增 `src/input-media/types.ts`。以下是跨任务合同，辅助实现类型可局部增加，但不得出现另一套字段含义。

```ts
type IncomingAttachment = {
  id: string; messageId: string; order: number;
  kind: 'image' | 'market_sticker' | 'native_face';
  sourceUrl?: string; platformFile?: string;
  platformAssetId?: string; faceId?: string; semanticLabel?: string;
};
type MessageContentPart =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'attachment'; attachmentId: string; start: number; end: number };
type ImageObservation = {
  description: string;
  visibleText: string[];
  possibleTone: string | null;
  uncertain: boolean;
};
type PreparedAttachment = {
  messageId: string; attachmentId: string; order: number;
  status: 'ready' | 'unrecognized';
  origin: 'platform' | 'library' | 'cache' | 'vision' | 'unavailable';
  observationRef: string | null;
  recognizerVersion: string | null;
  observation: ImageObservation | null;
};
type FrozenAttachment =
  | {
      messageId: string; attachmentId: string; order: number;
      status: 'pending'; imageAssetRef: string | null; phaseKey: string;
      recognizerVersion: string;
    }
  | Omit<PreparedAttachment, 'observation'>;
type TurnVisualContext = { version: 1; entries: FrozenAttachment[] };
```

`ready` 必有 observationRef、recognizerVersion 和可读取的观察；`unrecognized` 的三项均为 null，origin 为 unavailable。实现用判别联合或 schema 固定这个不变量。pending 是工作状态，不能出现在模型图片资料中。

`IncomingMessage` 增加可选 attachments、contentParts；持久 `Message` 保存 attachmentIds、contentParts，不保存完整附件地址或二进制。`TurnRecord.visualContext?: TurnVisualContext`。旧行缺省为空，不根据旧占位反推画面。

### 2.2 表与文件

沿 Storage 的 JSON 表模式增加三张小表，不新建通用任务平台：

| 表 | 必要字段和用途 |
| --- | --- |
| message_attachments | IncomingAttachment，加 downloadStatus（pending／ready／unavailable）、assetRef、confirmedObservationRef、confirmedRecognizerVersion；关联“这条消息已确认的观察” |
| image_assets | id 即 assetRef、contentHash、mimeType、relativePath、state（ready／deleting／deleted）；管理一份按内容去重的原图文件 |
| image_observations | id 即 observationRef、contentHash（平台表情可空）、recognizerVersion、origin、observation、confirmedAt；不可变观察正文 |

建立 messageId、assetRef、contentHash＋recognizerVersion 查询索引；同 hash＋版本的成功观察取同一条。观察升级创建新版本，不原地改旧 observationRef。附件已确认关联不因内容缓存升级自动替换。

默认资产目录由**实际 databasePath 的父目录**推导为 `incoming-media/`，正常部署即 `runtime/data/incoming-media/`；测试显式传临时目录。`:memory:` 必须由装配端传资产目录，不猜正式路径。文件名为内容 SHA256，扩展名由已识别 MIME 决定。assetRef 是登记 ID，不是任意文件路径。

原图经临时文件完整写入、原子重命名后，才把资产与附件状态存为 ready；崩溃留下的临时文件不会被当成功资产。收件记录中如平台给出 data URL，短暂原始来源只存在该附件的下载元数据中，成功落盘后清除；轮快照、模型 checkpoint 和常规上下文均不含 base64。清理只删除原图文件，保留附件与观察文字。

读写 Storage 初始化采用新增表／索引的加法方式，旧消息与图库不重写，不变更已存在的环境／记忆／对话版本。只读打开不得建表；读取尚无新表的旧库返回“无媒体记录”。正式部署仍按项目 README 停服备份后进行。

### 2.3 接收与图文次序

`parseIncomingContent(messageId: string, rawContent: string)` 返回 `{content: string; contentParts: MessageContentPart[]; attachments: IncomingAttachment[]; hasVisualAttachment: boolean}`。

只遍历当前 session.content 的 Koishi h 树；不读可能保留旧元素的 session.elements。原生 face 的内嵌 img 是展示子节点，只产生一个 face 附件；mface 保留平台素材标识及可解析来源。无法解析地址也保留附件占位。

附件 ID 用 `JSON.stringify([messageId, order])` 生成，order 是本条消息中从 0 开始的数字次序。content 保持可读文本及原有占位语义，contentParts 用最终 content 的 UTF-16 下标 [start,end) 保留图文交错位置：text 指向原文字，attachment 指向对应占位，不复制一份消息全文。下标在最终空白规范化后计算，能直接用 JS slice 还原；不把附件改写成用户新话语。统一次序：**调用者提供的已授权消息顺序 → 消息内 numeric order**；不按 ID 字符串排序。A→B→A 的三个出现位置都保留，只有观察正文去重。

InputBuffer 在原收件事务中先判重复／推进，再登记附件、消息与普通段／活动归属、刷新时钟。显式从 IncomingMessage 剥离 attachments，不能通过对象展开把临时 URL 写进 Message。纯文本全文“【推进】”沿原规则；带图片或表情的消息不是推进命令，OCR 从不进入控制判定。

事务完成后可以启动预下载；该调用不 await 网络或模型。观察仅在合法故事读取阶段发生。重复平台消息不得重复登记或重启已完成下载。

## 3. 图片：文件、缓存与观察

### 3.1 文件及免调用路径

```ts
interface AttachmentResolver {
  resolve(a: IncomingAttachment, signal?: AbortSignal):
    Promise<{ bytes: Uint8Array; mimeType: string }>;
}
// IncomingMediaStore
register(attachments: readonly IncomingAttachment[]): void;
findObservation(hash: string, version: string): PreparedAttachment['observation'] | null;
findLibraryObservation(hash: string): ImageObservation | null;
// 资产服务
ensureAsset(attachmentId: string, signal?: AbortSignal): Promise<string>;
resolveImageAsset(ref: string): Promise<string>; // 返回 data URL
```

register 在 InputBuffer 的现有事务中调用，不自行开事务或发起 I/O。findObservation 的正文用于查询；服务保存关联前还须取得同一记录的 ref／版本，不可为缓存命中另造一份正文。实现可另设返回完整记录的内部查询。

- HTTP(S)／data 来源由 resolver 解析。OneBot 只给 file token 时，交给当前 bot 的类型化 getImage 桥接；无该能力即 unavailable。不得把 token 当本地路径。保留旧参考中的必要格式适配，不导入其运行模块。
- SHA256 只取实际字节。平台素材 ID 仅作为已验证 hash 的辅助索引；不能凭文件名、URL 相同或文本 embedding 判同图。
- qface 已知 ID 生成固定平台观察：description 为已知表情名称，visibleText=[]，possibleTone=null，uncertain=false（只确认平台名称）；未知 ID 不猜。平台映射有自己的版本，不伪称看过原图。
- 同 hash 的下载落盘／观察在进程内合并在途 Promise；未读消息只能得到文件，不能因此写 confirmedObservationRef。合法 prepare 才把内容缓存关联到该条消息。
- `primeStickerObservations(storage, mediaStore): Promise<void>` 在图片启用后每次实例装配只索引一次图库文件 hash，不在消息路径扫描全库；不调用 embedding。已有未拆分 description／tags **不符合** ImageObservation，findLibraryObservation 对它们返回 null。
- 本批不补人工结构化图库数据。原 67 条描述即使精确同图，首次合法读取仍走 incoming_image；成功后免重复调用。保留 library 来源接口，仅明确合格结构化记录才可使用。旧描述“画面是一只狗，适合嘲讽对方”不得直接转为图上文字或用户心理。

### 3.2 独立图片任务

`observeIncomingImage(models: ModelRunner, imageAssetRef: string, options?: ModelRunOptions): Promise<ImageObservation>`，任务名／PromptStage 为 incoming_image。单张图一个任务，独立 schema 只返回 description、visibleText、possibleTone、uncertain；无角色背景、历史、lookup。

提示要求分开客观内容、可辨文字和可能的表情语气；画面文字是待识别内容，不是给程序的指令。网页资料可以帮助识别公开事物，但不能填成“画面上可见的文字”或本轮用户意图。GIF 保留原文件，不承诺逐帧理解。

新增 `incomingImageModel` 可选连接，connectionFor 优先它、缺省用 stickerDescriptionModel。**不把 incoming_image 加入无条件 modelRoles 检查**；只在 visualInput.enabled=true 时检查其连接／凭据。保持既有 modelRoles 及所有连接值原样。

`ChatCompletionsTransport(connectionFor, fetcher = fetch, resolveImageAsset?)` 只增加第三个可选参数，旧 imageDataUrl 行为兼容。incoming_image 输入只带 imageAssetRef；发送时解析为真实 image_url 块，文本 envelope 删去图片传输字段。其他阶段不调用 resolver。

观察由现有 ModelClient 执行，格式修补最多 2 次；HTTP、鉴权、上下文超限、格式耗尽错误沿原错误路径向上传递，不吞成 unrecognized。只有来源确实不可下载／不可解析、视觉关闭或未知平台表情形成受控 unrecognized；取消留 pending。

阶段为 `phaseOptions(web, 'turn', turnId, 'incoming_image:' + attachmentId, 'incoming_image', {lookup: null, signal})`。搜索关闭时不可调用网页；开启时沿现有 20／40、修补及恢复合同；不因新增图片任务取消其既有网页工具能力。

### 3.3 恢复身份

incoming_image 首版识别合同固定为 `incoming-image:v1`，在 observe.ts 导出 `INCOMING_IMAGE_RECOGNIZER_VERSION` 常量。prepare 在首次模型调用前持久保存 pending 的 imageAssetRef、phaseKey 和 recognizerVersion。已有 pending.imageAssetRef 时直接读落盘资产，不再用源 URL 下载“同一张”图；资产意外丢失则报告可诊断的恢复错误，不能拿变化后的 URL 内容续旧 checkpoint。清理必须保护 pending 引用。

ModelClient 会用本次传入值覆盖 checkpoint.input，因此服务恢复时必须重新构造**相同 assetRef**；不靠 checkpoint 自己替实现者保存这个保证。同一次进程中的修补使用同一连接配置；重开时沿当前明确配置解析，不静默换模型。任务及识别合同版本持久化，配置人为改变应在交付／运维记录中体现。

历史版本无法按原合同继续时明确报版本不支持，不以新合同冒充旧 phase；本批保留 v1。观察成功时在短事务中一起保存 immutable observation、当前附件确认关联、turn 的 ready 条目；不跨网络持有事务。缓存命中也先按权限完成本条消息确认，再形成 ready。

ready 与 unrecognized 都是**本轮终态**，冻结、未尝试输出重生成、发送恢复和后处理都不重判。pending／aborted 才可继续。unrecognized 不进入全局内容成功缓存；后续新消息再次发送同图可重新尝试。图片观察请求在崩溃前后允许外部重复，但已持久结果不能重复调用。

## 4. 图片：资格、历史上下文与记忆

### 4.1 服务接口

```ts
interface IncomingMediaService {
  prefetchForMessages(messageIds: readonly string[]): void;
  prepareForTurn(turnId: string, messageIds: readonly string[],
                 signal?: AbortSignal): Promise<PreparedAttachment[]>;
  readConfirmedForMessages(messageIds: readonly string[]): PreparedAttachment[];
  readFrozenForTurn(turnId: string): PreparedAttachment[];
  cleanupOne(now: string): Promise<'applied' | 'none'>;
  stop(): Promise<void>;
}
```

prepare 只处理传入消息，不扫全部未读；优先本轮终态，再该附件已有确认关联，再按合法读取使用缓存／平台映射／模型。每完成一个附件即保存。readFrozenForTurn 只读取本轮 terminal 条目及其不可变观察，pending 不返回。readConfirmed 是**纯读**：只按传入消息的附件确认关联读取，不下载、不调用模型、不查全局同图缓存为其补权限，也不改变 seenTurnId。

| 阶段 | 本轮可新观察 | 允许纯读的历史观察 |
| --- | --- | --- |
| 普通 narrative | 无；必须先决定能否读本轮消息 | 现有投影允许的已读 recent／reconsider／lookup 消息 |
| narrative_shared | 当前轮已绑定的合法活动输入 | 本场活动历史及该阶段本来允许的历史 |
| personal_chat／life／shared | narrative 后最终 visible、合法 reconsider；共享按本场选择 | 最终 recent、活动历史和 lookup 消息 |
| expression | 不新发起观察，使用前阶段准备结果 | 该阶段允许的 recent／活动历史 |
| memory | 不新发起观察，使用已确认结果 | 该阶段原有历史及 lookup，来源资格不扩大 |
| world／school_*／memory_consolidation／memory_audit／sticker_description | 无 | 不注入用户图片观察 |
| incoming_image | 只读取本次唯一原图 | 无角色历史 |

睡眠跳过路径不 prepare。共享调用前先按已有 activityContext 选消息；普通轮先 narrative，再按现有 visible／reconsider 选择调用 prepare，之后个人与表达才使用观察。模型等待期间的新消息不追加到已绑定本轮。

### 4.2 明确接线方法

新增 `src/input-media/context.ts`，使用轻量 ModelRunner 包装，不往 Transport 内偷偷查询数据库：

```ts
hydrateVisualContext(
  input: StageModelInput,
  confirmed: readonly PreparedAttachment[],
  frozen: readonly PreparedAttachment[]
): StageModelInput;

withTurnVisualContext(
  models: ModelRunner, media: IncomingMediaService | undefined, turnId: string
): ModelRunner;
```

包装器在 director／expression 已构建 StageModelInput **之后**工作，仅对白名单故事阶段装载 input.resources.messages 的 ID，调用 readConfirmedForMessages 与 readFrozenForTurn，再以本轮冻结条目覆盖同 attachmentId（包括 unrecognized）。其余阶段透传。冻结记录所指正文由媒体 store 读取；缺记录是完整性错误，不捏造描述。

narrative、personal、expression 在 app 中使用此轮包装 runner；memory/organize 同样包装。保留 d.models 本体供图片观察、环境及维护使用，避免包装器递归。

lookup：包装器包住原 options.lookup，先让原回调完成检索与来源检查，再 stageInput(stage, rawResult)，最后 hydrate，返回 **StageModelInput**。buildCompletionEnvelope 新增对该类型 lookup 的分支，与原 raw lookup 共用资料池合并及 contextRefs 去重逻辑；旧 raw lookup 兼容。memory/organize 的 includeLookupIds 同时识别 raw.retrieved 与持久化 StageModelInput.resources.owners，以免恢复后丢失可改写记忆 ID。checkpoint 只持久化纯数据，不保存包装器函数。

这个选择避免逐个历史数组随手补字段，也避免 buildExpressionView 的手动白名单丢弃新字段。测试必须检查真实序列化 envelope，而不只检查 service 返回值。

### 4.3 单池与出现位置

ModelResourcePool 增加 `visualObservations: Array<{ref: string; recognizerVersion: string; observation: ImageObservation}>`，正文按 ref 去重。ModelMessage 增加可选 contentParts 和 `visualAttachments`；后者每项仅含 attachmentId、order、status、observationRef，不含 sourceUrl、assetRef、hash 或二进制。

每个图片 occurrence 都留一项；A→B→A 为三个绑定、两个正文。ResourcePool.message 首次已建消息后再从 lookup 合并同 ID 时，应合并缺失的附件绑定，按 attachmentId 去重；同附件冲突不得用后到数据改写本轮终态。老 checkpoint 池没有 visualObservations 时按 [] 处理，不强迫旧夹具手工补字段。

只有最终池中的获准消息能引用图片正文；没有消息引用的观察不注入。正文依然在观察表／资源池，与短长期记忆分开。历史图片未被模型复述或写成记忆也能在窗口内继续读取；退出窗口后不因缓存存在被自动注入。lookup 若按现有规则合法返回该历史消息，可随它装载，不能因有图片而拓宽检索范围。

memory 的 currentSourceIds 沿现有 experiences／本轮 visible／outgoing／合格 self_web_read 生成，不加 attachmentId 或 observationRef。本轮新发送相同图片仍引用新消息 ID；历史上下文不升级为本轮来源。

### 4.4 文件清理与关闭

cleanupOne 每次最多处理一个候选文件，沿现有空闲让位位置调用；不能每次收件递归扫描目录或全量消息。按附件／资产索引及现有窗口、未读／延后、unfinished turn 快照判断保护；任何同 hash 引用受保护都保留原图。已确认观察文字不受文件清理影响。

候选选出后如发生 await，在真正删除前重查当前资格与引用。资产服务统一协调 acquire／delete：标为 deleting 后的新 acquire 等其完成并重新取资产，不能交出正在删除的旧路径。unlink 与 DB 状态更新可恢复；文件已不存在视为幂等删除。未完成图片 phase、在途写入／读文件始终受保护。

正常停机：停止接收新的 HDSI 工作 → await Host.stop（前台完成，环境／维护取消收尾）→ await media.stop → await managedBrowser.dispose → Storage.close。stop 拒绝新预下载，取消并等待本服务已有下载／写入，无关库后写入；暂停不是 stop。

## 5. 搜索：端口、提取与额度

### 5.1 配置与端口

`webSearch` 在原字段上增加 provider（默认 unconfigured，另一值 browser）及 browser：
`{engine:'bing'|'duckduckgo', navigationTimeoutMs:60000, maxConcurrentPages:1}`。引擎默认 bing，超时／并发可配置正数；navigationTimeoutMs 的含义明确为**整次页面操作总时限**，不是只算 goto。保留原字段名，避免无收益改配置名。

定义在 `src/web/browser/types.ts`：

```ts
type BrowserProviderConfig = {
  engine: 'bing' | 'duckduckgo';
  navigationTimeoutMs: number; maxConcurrentPages: number;
};
type BrowserReadRequest =
  | { kind: 'search'; url: string; engine: 'bing' | 'duckduckgo' }
  | { kind: 'article'; url: string };
type BrowserPageResult = {
  finalUrl: string; title: string;
  access: 'ok' | 'login_wall' | 'captcha' | 'http_error';
  search: { state: 'results' | 'empty' | 'unready';
            links: Array<{url: string; title: string}>;
            evidence: string | null } | null;
  main: { text: string; source: 'article' | 'main' | 'readability' } | null;
};
interface BrowserPagePort {
  read(request: BrowserReadRequest, options: {
    signal: AbortSignal; deadlineAt: number
  }): Promise<BrowserPageResult>;
  close(): Promise<void>;
}
interface BrowserPort { openPage(): Promise<BrowserPagePort> }
interface ManagedBrowserProvider {
  provider: WebSearchProvider;
  stopAccepting(reason?: Error): void;
  dispose(): Promise<void>;
}
```

deadlineAt 与槽管理器使用同一单调时钟；队列、create、navigation、extract／wait 共用 60,000ms 默认预算。记录各段耗时和 timeout 所在段，不把排队超时当空搜索。关闭资源可能超出请求时限，见 §6。

`BrowserPageSlots.read(request, signal?): Promise<BrowserPageResult>` 拥有 openPage、读取、close 的完整流程；不再使用允许调用方随意忘记 close 的旧 `run(work)` 形状。`createManagedBrowserProvider(port: BrowserPort, config: BrowserProviderConfig): ManagedBrowserProvider` 在 provider.ts 定义，一个 HDSI 实例所有阶段共用同一槽管理器。

### 5.2 页面证据与就绪

Koishi port 只打开 HTTP(S) 公开网页，沿已选旧参考的公开地址约束，不做登录或验证码绕过。一次 read 只导航一次；不隐藏重试、翻页或跨引擎回退。

DOMContentLoaded 后观察 DOM，就绪条件是：明确访问阻挡，或搜索的结果／专属空态，或正文主体。通过 DOM 变化等待至 deadline；不得用一次 DOMContentLoaded 快照就认定动态页为空，也不得给等待另起 60 秒。

搜索提取分引擎：

- Bing 的结果项从 `#b_results .b_algo h2 a` 起步；DDG HTML 从 `.result__a` 起步，正式以 S5a 保存的实际 DOM 夹具校准。
- 空态必须是该引擎**结果容器内可见的专属空态元素**及匹配的引擎提示，不是查询框、title 或 body 全文出现“无结果／no results”。选择器和样本一起版本化。
- 有合法外链返回 results；有专属空态返回 empty；仅导航、未加载、结构不认识为 unready，等待至截止后抛不可读／超时。
- 相对地址按 finalUrl 解析；已知 Bing 跳转参数按明确公开编码解码到 HTTP(S) 目标，失败项跳过。过滤引擎导航、广告控制项和重复地址；不为解码偷偷额外导航。无空态但结果全被过滤不能伪称引擎确认“无结果”。

正文按顺序：可见 article → 可见 main／role=main → Mozilla Readability 对当前文档克隆提取。语义容器优先取其中实际主体；排除 nav、header、footer、aside、表单、隐藏节点。候选需含非导航文本内容块，不能仅因存在空 main 就判成功。无语义容器的文章走明确的 Readability 回退；Readability 返回 null 就无正文，**永不回退整个 document.body.innerText**。

Readability 使用项目本地安装的 `@mozilla/readability` 浏览器脚本，在克隆文档上运行并取完整 textContent，不从 CDN 注入，不另装服务器端 DOM 框架。其默认算法阈值是主体判断而非输出裁剪；本批不另设字符上限，不以 isProbablyReaderable 预检拒绝短而有效的 article／main。该库允许浏览器脚本加载及克隆文档解析，见 [官方说明](https://github.com/mozilla/readability)。

direct webRead 打开已知搜索引擎结果页时也标 search，拒绝把摘要送入 main。正文谈论“登录”“验证码”并不等于访问墙；access 判断用可见阻挡 DOM／表单及主体缺失证据，不能使用全文关键词即封杀。

`extractSearchCandidates(page, engine)` 只接受 access=ok 且 results／empty；empty 返回 []。`extractReadablePage(page)` 只接受 access=ok、非搜索页且 main 有正文；保留完整正文。原始整页文字如用于诊断，不进入 WebMaterial。

### 5.3 核心工具合同不变

WebSearchProvider 仍是 search(query, signal?) → links，read(url, signal?) → {title,body}，signature 包含引擎和提取器版本（Readability 锁定版本也计入）。页面端口的证据字段不要求改模型工具 schema。

核心 WebSearchService 继续负责候选逐页读取、正文缓存、20／40、operation step 幂等和 checkpoint：

- 搜索页不计成功；一次有效目标正文才计成功。
- search_error、read_error、empty_body、no_candidates 保持既有失败语义；真正空候选本来就累计 1 次失败。
- 同阶段重复正文不重复计；公共缓存跨阶段按现有 B 口径，各阶段首次取用计 1。
- 外部 AbortSignal 取消不提交迟到材料；适配器自身 timeout 且上层未取消按原失败路径记账。
- 个人生活“本人查阅”资格保持；世界／学校公共参考不会自动成为角色已知事实。

首批只做 Bing／DDG HTML，旧 RSS 所需 feed 解析器不在本批范围。

## 6. 搜索：页槽与 Koishi 生命周期

### 6.1 槽是实际页面资源名额

排队 FIFO；仅排队取消不占槽。从开始调用 openPage 起占一个 reservation，直到建出的页面 close **实际完成**才释放。正常结束也要等 close 后才允许下个 openPage；不是只记录 close 被调用。

请求取消／超时可先结束调用方 Promise，但资源跟踪 Promise 保留：

1. factory 未返回：不释放 reservation；迟到页面禁止导航，立即 close 并等待。
2. 页面已返回：通知 read 取消并关闭；旧 read 结果不得继续产生材料；关闭确认前不复用名额。
3. close／factory 不结算或 close 抛错且不能证明页面已关闭：进入 draining／unhealthy，拒绝继续分配，保留未决资源记录。不能“超时即清零”并无限建替代页。

dispose 幂等，先 stopAccepting、取消本实例的排队／活动请求，再等待所有在途创建与关闭结算。dispose resolve 仅表示本实例已无未决资源；浏览器已断开／页面已销毁的可验证证据可作为结算，无法确认时保持阻塞并报告原因。不得为让停机好看而谎报排空；新 HDSI 实例也不能越过该阻挡。不得调用共享 ctx.puppeteer.stop 或关闭其他插件页面。

### 6.2 服务就绪与实例串行替换

用 `src/deployment/plugin-runtime.ts` 承接从 index 抽出的“单实例创建与关闭”，`src/deployment/browser-runtime.ts` 管理服务就绪与串行替换；这两个模块只分离生命周期，不重构故事逻辑。

- webSearch.enabled=false：直接走无 browser 实例，绝不要求 Puppeteer。
- enabled=true＋provider=unconfigured：明确配置错误，未建库前失败。
- enabled=true＋browser：外层做配置和依赖预检；内部 `ctx.inject(['puppeteer'], inner => ...)` 等服务。使用 inner 管注册的副作用，不在 apply 中一次同步检测 ctx.puppeteer 后报“缺失”。
- required 服务出现后，捕获这一代 page 工厂；创建／关闭都经过外层单一 Promise 链和 generation。旧实例 close 完成并再确认 generation 仍有效，才打开新 Storage／启动新 Host。
- 服务移除立刻使旧 provider.stopAccepting，停用本实例收件入口，然后按 §4.4 收尾；不得继续从旧工厂新建页。重新出现只排队请求替换，不与旧 Host 重叠。
- 普通 HDSI 关闭先等正在执行的前台轮，随后 dispose provider；“浏览器服务已经失去”则先禁止旧 factory，再等 Host 收尾。两种情形不要混为同一调用顺序。

诊断按证据分层：runtime/check 检查模块是否安装以及所指定 Koishi 配置是否启用 Puppeteer；缺少／禁用明确报错。运行时服务未就绪显示 waiting，不误判未安装；服务启动自身错误保留 Koishi 原始异常及 waiting 状态，未到 running 就不称启动成功。HDSI 不新增随意的服务启动倒计时。使用程序化 Context、没有配置文件的测试直接通过生命周期状态／原始错误证明 waiting 与 failed，不能假装静态检查能够证明浏览器启动成功。

运行时状态至少能区分 waiting／starting／running／stopping／failed；真实 Context 测试覆盖两种注册顺序、服务启动拒绝、移除再注册及最终整体 dispose。不存在“两个 Storage 都先打开，等 start 时再去排他”的窗口。

## 7. 验证、发布与证据

全部执行细节、命令和 review 对照见[执行指南](EXECUTION_GUIDE.md)、[图片 I1～I6](IMAGE_INPUT_PLAN.md)、[搜索 S1～S5](LOCAL_SEARCH_PLAN.md)。核心验收顺序固定为 build → typecheck → test → demo → 指定隔离路径的 runtime check → 离线 smoke；每批单独完成。

runtime/check 必须接受 configPath、databasePath，搜索配置检查还接受 koishiConfigPath。所有分支（旧版本检查、图库、媒体、模型）统一使用显式路径；默认正式启动器路径保持不变。check 只读，不打开浏览器、下载图片、建表或请求模型。测试缺失路径不得静默回退正式文件。

搜索在 S1 与 S2 最小 DOM 提取完成后先做 S5a 公开可行性验收，再进入工具／插件完整集成。真实浏览器要实际返回一个固定查询的候选并读取其中一篇正文，原直连 HTTP 探针不能代替。失败保留证据、搜索默认 false，不自动换付费服务。

图片在线质量、搜索真实浏览器、离线工具闭环、正式运行是不同验收层；未执行的层写清未执行。本次修订只准备文档，未实施上述任何接口、安装依赖或运行新功能。

外部能力依据：[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)、[Koishi 服务依赖](https://koishi.chat/zh-CN/guide/plugin/service)、[Puppeteer API](https://puppeteer.koishi.chat/api.html)。浏览器／依赖版本以执行时锁文件及公开验收记录为准，不复制旧 node_modules。
