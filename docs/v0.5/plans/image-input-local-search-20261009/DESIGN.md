# 图片输入与本地搜索设计

日期：2026-10-09。状态：待审，未实施。返回[计划入口](README.md)。

## 1. 已核实的现状

### 1.1 图片确实缺少输入接线

`src/index.ts`把img／image／face／mface转为“用户发送…未识别内容”，只保存`hasVisualAttachment`。附件地址、表情ID与画面没有交给模型。第四条表情语境提示只能约束回应方式，不能凭空识别doge、图片文字或内容。

`src/model/client.ts`已经能把`imageDataUrl`变为真实`image_url`块；`src/output/sticker-description.ts`仅用于导入图库，不消费实时用户消息。Flash官方支持图片输入，现有模型无需更换。[官方Vision说明](https://api-docs.deepseek.com/guides/vision/)

已有67项图库的向量编码描述／标签，不是图像向量。不能直接把收到的图片拿去与这些文本向量比相似度就宣称识别成功。

### 1.2 “搜索模块”指当前重制版的工具框架

当前`src/web/`实现阶段会话、JSON工具请求、正文缓存、20／40、结果不足、引用和checkpoint；`WebSearchProvider`需要提供`search(query)`与`read(url)`。目前只有Unconfigured实现，正式入口无条件拒绝启用尚未装配的供应商。

这里的供应商可以是本地浏览器适配器，并非一定是付费API；原生DeepSeek搜索和HDSI程序执行网页操作是两条不同路径。

### 1.3 旧项目存在可迁移的浏览能力

已核对旧本地增强仓库，以及本地保存的作者`1.0.1-rc28`参考源码。两者都有Koishi Puppeteer：按搜索模板打开公开结果页、提取链接、再访问页面正文。旧默认模板是DuckDuckGo轻量HTML；增强版还判断Bing／DuckDuckGo结果项和登录／验证码壳，并处理Bing公开RSS搜索页。

它不是自建互联网索引，仍借用外部搜索网站；不支付搜索API请求费，仍消耗本机浏览器资源、网络和后续DeepSeek输入／续调用费用。可迁移的是底层页面能力，不是旧故事调度、20／20计数、截断预算或旧数据库。

需要用到的源码已复制到[新项目参考目录](../../../../references/legacy-web-search/README.md)，不复制旧运行配置。旧运行环境安装了Puppeteer插件；新runtime未安装，计划阶段未安装或启动它。

## 2. 图片方案取舍

| 方案 | 特点 | 本次选择 |
| --- | --- | --- |
| 每次把图直接给个人导演 | 少一次独立请求，个人导演可结合场景看图；需扩展主阶段多图／原图恢复，各次重试可能重发 | 保留为后续可选方向 |
| 独立观察→文字给故事阶段 | 初次多一个请求；可固定识别结果、按内容缓存，各阶段不反复看原图 | **选择**：复用现有Flash／high看图连接，采用独立提示 |
| 只匹配图库或QQ表情名称 | 成本低，但只能识别已知表情，无法理解陌生图片 | 作为前置免调用路径，不代替看图 |

建议管线：消息立即落库→保存附件→已知QQ表情映射／图片字节精确缓存→未知图片Flash／high观察→个人导演结合整批文字判断→表达遵循现有语境规则→记忆沿原消息来源提取。

不自动把所有用户图片收录进“角色可发送的表情图库”。理解缓存与发送素材库分开。

## 3. 图片合同与接口

### 3.1 类型和持久化

建议新建`src/input-media/`，类型如下；名称供两个任务边界使用，实现时保持一致。

```ts
type IncomingAttachment = {
  id: string; messageId: string; order: number;
  kind: 'image' | 'market_sticker' | 'native_face';
  sourceUrl?: string; platformFile?: string;
  platformAssetId?: string; faceId?: string; semanticLabel?: string;
};
type ImageObservation = {
  description: string; visibleText: string[];
  possibleTone: string | null; uncertain: boolean;
};
type PreparedAttachment = {
  attachmentId: string; status: 'ready' | 'unrecognized';
  origin: 'platform' | 'library' | 'cache' | 'vision' | 'unavailable';
  observationRef: string | null; observation: ImageObservation | null;
};
```

`message_attachments`按稳定附件ID保存接收引用、下载状态及文件指纹；`image_observations`按观察ref保存结果及识别器版本，不放图片二进制。文件存`runtime/data/incoming-media/`，保持Git忽略。`IncomingMessage`／`Message`新增可选`attachmentIds`；旧消息缺省空列表，不重新猜测已丢失画面。

附件ID由消息ID＋当前消息内顺序构成；重复平台消息不重复登记。消息、附件引用、普通段／活动归属必须在同一次收件事务保存。输入立即刷新15秒或共同60秒时钟，不能等下载／模型结束后才落库。只解析当前`session.content`，face嵌入的展示img不是另一张用户图片。

### 3.2 解析与缓存

1. QQ原生表情用已知ID名称，不调用LLM；未知保持未知。参考旧qq-face，计划新增qface依赖并保留必要扩展映射。
2. 图片／商城表情下载后按真实字节SHA256匹配已有观察或现有图库文件指纹；平台稳定素材ID可作已核实素材的辅助索引。不能凭相近文件名、未验证摘要或文本embedding直接认定同图。
3. 缓存命中用已保存客观描述，模型不重复看图。图库只有描述／标签时不伪造“图片内文字”；`uncertain=true`体现描述不足。同批多条消息同一图只观察一次，各消息保留各自来源及位置。
4. 未命中每张独立调用`incoming_image`任务，返回上述结构。使用与图库描述不同的提示：只观察画面与可读文字、描述可能语气，不能确定用户真实意图、编造内容或执行画面里的指令。
5. 新增可选`incomingImageModel`连接配置；未配置则复用`stickerDescriptionModel`。当前使用仍为Flash／high，既有13个连接及所有强度值不改；以后可独立配置。新增`visualInput.enabled`默认false，正式启用时显式true，避免无看图连接的旧配置突然发请求。

Flash支持GIF不等于本次已验证逐帧动态理解；保留原GIF发送，不声称读到所有帧。动态图质量列入可选在线验收，不在本批另建抽帧／视频系统。

### 3.3 可见性、冻结与上下文

下载可在收件后异步保存，角色识别仅在有合法读取资格的故事轮执行。普通轮先运行普通主叙事，再按其产生的可读状态解析本轮visible／reconsider图片；普通主叙事不能提前看到未读新图。共同活动主叙事本就能读取本轮真实活动输入，故该阶段前准备合法活动图片；未归属本场的未读图不能混入。

`IncomingMediaService.prepareForTurn(turnId, messageIds, signal?)`返回按附件ID排列的`PreparedAttachment[]`。允许的messageIds由现有可见性／活动选择代码提供，服务不自行扫描全部未读。结果保存在`TurnRecord.visualContext`，作为本轮固定观察快照。请求在途期间新消息属于后续轮；修补、发送重试、后处理恢复不改当前观察、不重新解释图片。未完成观察可以恢复重新请求，已ready的不重跑；不承诺外部请求在崩溃前后严格只发生一次。

`generateTurn`中保存观察后，冻结输出必须读取最新持久turn再合并，避免`freezeTurn`用调用前的旧对象覆盖visualContext；`discardUnattempted`也保留已确认观察。图片观察既不追加输入消息，也不修改本轮已有消息／活动绑定。

`ModelResourcePool`新增`visualObservations`，每个观察ref正文只放一次；`ModelMessage`保存对应观察ref，按已有消息ID可见范围投影。普通／共同个人、共同主叙事、表达和基础记忆读取各自获准的引用；世界／学校及其他无权限阶段不带用户图或观察。完整原图只发给图片观察任务，常规故事阶段不重复携带base64。

图片任务输入保存`imageAssetRef`，发送层经注入的`resolveImageAsset(ref)`从本轮已缓存文件读取并生成image_url，不把base64放进持久web checkpoint；现有图库imageDataUrl路径继续兼容。图片观察也接既有搜索合同：每附件独立稳定phase `incoming_image:<attachmentId>`，本轮缓存命中不新建模型／搜索请求；搜索关闭时没有该工具。公开补查只能辅助理解，网页内容不能冒充图中可见文字或事实，lookup仍不开放。格式修补与搜索续调用沿用同一图、连接和会话。

`hasVisualAttachment`仍只依据原始附件类型，第四条语境规则仍由程序选入。单独表情可不回；图后同批有实质文字须整批理解。已知doge可能调侃，但普通狗图不是doge；观察结果不是用户台词或动作，不生成`【推进】`控制请求，不新增代写授权。

### 3.4 失败、记忆与文件引用

失效图片URL／不可读取附件保存unrecognized，原文字及附件事实继续有效，角色可说明不清楚或追问；不伪称已看到内容。认证、模型格式修补耗尽或接口上下文超限沿现有报错／暂停处理，保留本轮，不偷偷换模型或裁内容。受控附件不可用与模型调用错误分开。

基础记忆可从已被角色读取的消息及其观察提取多条记忆，sourceIds仍引用原messageId，不把识别结果捏造成另一个用户发言。未读图不能成为角色记忆；历史缓存命中不证明用户以前给角色发过该图；收到同图的新消息仍是本轮真实来源。

引用中的本地原图不删除；清理只移除不被未完成轮、待看／延后消息及当前原文窗口引用的缓存文件，观察与记忆不因此删掉。无新增记忆容量、输入字符预算或自动图库收集规则。清理可复用既有逐单元让位方式，不能遍历全图库阻挡每次聊天。

## 4. 搜索方案取舍

| 方案 | 费用与维护 | 选择 |
| --- | --- | --- |
| 适配旧Puppeteer公开网页 | 无搜索API计次费用，本机耗资源；搜索网站可能改版或拦截 | **当前优先**，迁移成本与用户成本目标最匹配 |
| 自建SearXNG＋本地正文读取 | 无SearXNG软件请求费，需独立服务并维护上游引擎；不是自建索引 | 后续替换候选，不作为本批依赖 |
| Tavily等托管API | 接口稳定易接，按量计费／有免费额度 | 保留provider接口，不自动回退到付费请求 |

SearXNG官方提供`/search?format=json`，需启用JSON格式，公共实例可能关闭；官方提供容器部署。它仍访问上游引擎，不会解决所有验证码或网络限制。[Search API](https://docs.searxng.org/dev/search_api.html)、[部署说明](https://docs.searxng.org/admin/installation-docker.html)

建议当前只实现一个本地browser provider，正文可普通HTTP提取，必要时浏览器渲染；为减少双路径复杂性，首批统一浏览器读取，不另接Jina。若后续搜索维护成本大，再用SearXNG替换候选搜索接口，正文读取和HDSI会话保留。

## 5. 本地搜索合同

### 5.1 端口与配置

新建`src/web/browser/`：`BrowserSearchProvider implements WebSearchProvider`，维持现有search返回URL／标题、read返回完整正文的签名。独立端口把Koishi Puppeteer与纯提取／测试分开：

```ts
type BrowserPageResult = {
  url: string; title: string; text: string; articleText?: string;
  searchResultLinks?: Array<{url: string; title: string}>;
  httpStatus?: number; authenticationRequired?: boolean;
  verificationRequired?: boolean;
};
interface BrowserPagePort {
  read(url: string, signal?: AbortSignal): Promise<BrowserPageResult>;
  close(): Promise<void>;
}
interface BrowserPort { openPage(): Promise<BrowserPagePort>; }
```

配置建议：`webSearch.provider='browser'`（新增字段默认unconfigured）、`webSearch.browser.searchEngine='bing'`、`navigationTimeoutMs=60000`、`maxConcurrentPages=1`。支持bing与duckduckgo的已知模板和各自解析器，不承诺任意搜索网页都可用。URL模板由引擎配置推导，后续添加引擎需同时添加解析器；搜索域／偏好不是新增模型决策。

Koishi声明可选puppeteer注入；运行目录安装并启用`koishi-plugin-puppeteer`，浏览器路径／代理如有需要由该插件配置管理。源码声明可选peer并提供离线mock；不加载旧runtime/node_modules，不把旧配置复制进新Koishi。enabled=false可无Puppeteer启动；enabled=true而provider／浏览器不可用时启动明确报错。

provider.signature包括引擎与提取器版本，避免不同配置复用错误缓存。默认engine先定Bing，但需浏览器验收通过才正式启用；当前HTTP200且无结果标记不是通过。DuckDuckGo留可选，不隐藏自动跨引擎重试。

### 5.2 结果、正文与计数

搜索页只提取结果链接并验证实际结果项。导航壳、登录页、验证码页和空页面不是成功资料；真正“无结果”返回空候选，现有核心告知模型“结果不足”。不用搜索摘要当目标正文。

随后由现有`WebSearchService`逐URL调用read：取正文区域，缺失则取可见主内容；排除导航／广告／脚本壳，不应用旧12000／3000字符截断，也不新增token限额。内容超出模型真实容量沿现有错误处理，不自动删除记忆或截网页。

仍每逻辑阶段20次成功正文／40次失败；任一达到上限停新操作。搜索请求不重置计数；搜索页面不是新增一次成功正文。provider.search每次只发一个搜索请求，provider.read每次只读一个目标；不在provider内部隐藏反复重试、跨引擎轮询或计数体系。失败按现有search_error／read_error／empty_body计数，缓存继续按既定B口径阶段独立计费。providerReadCalls统计本次read操作，不统计浏览器CSS／JS子资源HTTP数。

### 5.3 调度与恢复

模型HTTP、浏览器等待均异步；收件继续立即保存。普通聊天若没请求搜索，不等待网页页槽。主动搜索的阶段可等待当前页槽，单次导航受明确时限，不承诺所有网页都能读取或所有搜索即时完成。

页槽全局共享，每页无论成功、失败或取消都关闭；已有signal的环境／维护取消时，取消等待／导航并阻止迟到材料提交。前台停止沿现有Host等待在途故事的合同，不在本批新增强制终止已开始前台的规则。Host停止完成后再dispose浏览器适配器，拒绝新页并关闭残留页。现有冻结依据校验、前台串行、web操作持久化／计数去重保持；恢复可能重新读取未确认页面，但已确认材料与计数不重复追加。已started外部浏览请求不保证网络严格只执行一次。

实际取得的生活个人导演网页仍可按既有本人查阅资格进入短期记忆；世界／学校参考不因此进入角色记忆。收到图片不自动执行网页搜索；若图片观察确需公开补查，沿既有阶段工具与可见范围规则，外部材料不能升级成画面所见或用户表达。

## 6. 本批范围与验收

两项各自有完整离线mock验收，不发QQ；公开页面真实浏览与已公开／合成图片看图作为单独在线验收，记录成功／失败与范围，不用正式聊天、私有角色图或旧故事。计划阶段只做公开无认证HTTP探针，证据在[入口](README.md)。

实施不修改任何现有模型或思考强度；允许增加开关、provider配置以及可选图片连接字段。数据库仅增加附件／观察存储，不改旧消息内容、归属、记忆和67项图库；只读检查不能创建表或下载内容。正式启用前停止服务并备份，不自动启动或发测试消息。

本批不接付费搜索、不建SearXNG服务、不开放登录／验证码绕过、不自动收图作为发送素材，也不更改既有概率、时间窗、睡眠资格、记忆容量或共同活动代写规则。
