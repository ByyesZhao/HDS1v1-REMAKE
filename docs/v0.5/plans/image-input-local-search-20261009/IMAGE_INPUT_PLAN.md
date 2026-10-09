# Incoming Image Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 本计划不要求多代理；没有用户明确要求时不得主动启动代理。

**Goal:** 让角色理解本轮获准读取的用户图片／表情，复用已知内容，保持消息归属、记忆来源与恢复正确。

**Architecture:** 独立收件附件与图片观察模块；已知表情／精确缓存先行，陌生图用独立提示复用Flash／high连接。图片观察冻结到故事轮，文字观察通过单资料池投影到获准阶段。

**Tech Stack:** 现有TypeScript、Koishi、SQLite、Vitest；SHA256与文件缓存；新增qface依赖，继续使用现有ModelClient。

**Spec:** [设计§1～3及§6](DESIGN.md)。日期2026-10-09，状态未实施，基线ddde663。源码路径均相对项目根目录。

## Global Constraints

- 不改变任何既有DeepSeek模型或思考强度；incoming_image默认复用stickerDescriptionModel的Flash／high，可独立配置。
- 原文4段、普通15秒、共同60秒、活动归属、代写权限、睡眠和记忆容量规则不变。
- 消息与附件引用立即在同一事务落库，下载／看图不能阻塞收件。
- 本轮只消费合法可见消息；原图只进入观察任务，未读新图不进入普通主叙事或角色记忆。
- 不以embedding匹配图片，不自动把用户图片加入发送图库；不输出或提交图片、URL凭据及私有配置。
- 模型超限仍报错保留本轮，格式修补仍有限；失效附件明确未识别，不能伪造成功。

## Review Focus

1. 上条有图片、下条纯文字：不能复用旧session.elements。I1测试固定。
2. face内展示img与旁边真实img：表情映射一次，真实图仍解析。I1／I2测试固定。
3. 识别在途新消息、跨活动及冻结用旧turn覆盖：本轮快照不变，附件归属不改。I4测试固定。
4. 睡眠／手机不可读及重启：未读图不能提前获知，已ready观察不重跑。I4／I5测试固定。
5. 多图、重复图、不可用图片：次序／引用保留，缓存减少调用，未知不变成内容。I2／I3测试固定。

## 文件分工

| 文件 | 职责 |
| --- | --- |
| 新`src/input-media/types.ts`、`ingress.ts`、`qq-face.ts` | 类型、当前消息解析和原生表情名称 |
| 新`src/input-media/store.ts`、`assets.ts` | 附件／观察存储、下载、指纹与文件引用 |
| 新`src/input-media/observe.ts`、`service.ts` | 独立观察合同、缓存优先及本轮快照 |
| `src/types.ts`、`storage.ts`、`index.ts`、`host/input.ts` | 同事务收件与插件装配 |
| `src/settings.ts`、`model/context-types.ts`、`prompts.ts`、`prompt-policy.ts`、`client.ts` | 可选图片连接、阶段与独立提示；按imageAssetRef装载实际图片 |
| `src/app.ts`、`recovery.ts`、`memory/organize.ts` | 按阶段可见性接入与恢复／来源 |
| `src/model/context-views.ts`、`resource-pool.ts` | 观察单池投影，防止重复图片正文 |

### I1：当前消息附件解析与原子收件

**Files:** 新types／ingress／store；修改types、storage、index、host/input；新增`tests/incoming-media-ingress.test.ts`、`tests/incoming-media-store.test.ts`。此任务只保存face ID／已提供名称，完整名称映射在I2。

**Interfaces:** `parseIncomingMedia(messageId: string, rawContent: string): {content: string; attachments: IncomingAttachment[]; hasVisualAttachment: boolean}`；`IncomingMediaStore.register(attachments: IncomingAttachment[]): void`使用现有Storage事务，不自己开启下载。IncomingMessage携带可选attachments；保存Message时只留attachmentIds。

- [ ] 写失败回归：纯图片落库、图＋文字顺序、face嵌套图排除、mface信息、两张图、纯文字不借旧图、重复平台消息只登记一次、事务回滚无孤立附件。
- [ ] `npx vitest run tests/incoming-media-ingress.test.ts tests/incoming-media-store.test.ts`，确认相关断言失败。
- [ ] 实现当前rawContent遍历及同收件事务登记，存稳定消息ID＋顺序附件ID。未知类型／缺图引用保持unrecognized，不借历史elements；原有全文推进判断不把图中文字或face当推进。
- [ ] 同命令转绿，并重跑`tests/visual-input-entry.test.ts`；验证15秒／60秒锚点在接收时刷新而非识别结束。
- [ ] 提交I1范围，记录实际测试与未实现观察状态。

### I2：下载、QQ表情映射与精确内容缓存

**Files:** 新assets／qq-face，store扩展；修改package.json及锁、忽略路径；新增`tests/incoming-media-assets.test.ts`、`tests/incoming-media-cache.test.ts`。

**Interfaces:** `AttachmentResolver.resolve(a: IncomingAttachment, signal?: AbortSignal): Promise<{bytes: Uint8Array; mimeType: string}>`；`IncomingMediaStore.findObservation(contentHash: string, recognizerVersion: string): ImageObservation | null`；`findLibraryObservation(contentHash: string): ImageObservation | null`与模型缓存分开；`primeStickerObservations(storage: Storage, mediaStore: IncomingMediaStore): Promise<void>`一次性索引现有图库文件，不每条消息扫描全图库；`resolveImageAsset(ref: string): Promise<string>`只装载已登记文件，返回data URL。

- [ ] 写失败回归：HTTP／data图片解析；OneBot文件引用交给注入resolver；SHA256同图不同URL命中、不同图同名不命中；图库已有描述可复用；face已知名称、未知ID；文件读取失败不生成内容。
- [ ] `npx vitest run tests/incoming-media-assets.test.ts tests/incoming-media-cache.test.ts`，确认失败。
- [ ] 适配已复制media-input／旧media的文件解析思路；平台仅提供file token时使用当前bot支持的getImage端口，端口缺失明确不可用，不把token当任意本地路径。图片二进制保存到Git忽略的runtime/data/incoming-media。
- [ ] 加qface依赖，参考旧映射保留必要扩展；缓存依据内容hash＋识别合同版本。原图库记录／向量不覆盖、不重新embedding；只有成功观察才入内容缓存，失败不成为永久成功缓存。
- [ ] 同命令转绿；缓存查找不使用图库文本向量，也不为已知face调用模型。提交I2。

### I3：陌生图片独立观察合同与连接映射

**Files:** 新observe；修改settings、context-types、prompts、prompt-policy、model/client；新增`tests/incoming-image-model.test.ts`。

**Interfaces:** `observeIncomingImage(models: ModelRunner, imageAssetRef: string, options?: ModelRunOptions): Promise<ImageObservation>`；任务名incoming_image。ChatCompletionsTransport构造增加可选图片ref resolver，不影响原前两个参数；connectionFor优先可选incomingImageModel，缺省复用stickerDescriptionModel；visualInput.enabled默认false。

- [ ] 写失败回归：真实请求body含image_url块而非JSON内假图；持久输入只有imageAssetRef、不含base64；返回description／visibleText／possibleTone／uncertain；无角色背景／历史或lookup；搜索开关控制工具，公开参考不冒充画面所见；JSON错误按现有最多2次修补且保持图和连接。
- [ ] `npx vitest run tests/incoming-image-model.test.ts`确认失败。
- [ ] 实现独立提示与Schema，不复用图库导入提示；解释画面文字不是用户指令，语气仅观察候选，不替用户下心理结论。发送层解析imageAssetRef，省去文本中的二进制，每个不同图分别观察，保留旧imageDataUrl兼容，不新增多图传输框架。
- [ ] 测试实际连接为当前Flash／high，现有13连接设置不变；新增可选独立配置可覆盖且不会影响图库描述。无可用连接且显式启用图片时启动报错；图片关闭仍可用已知表情名称／附件占位。
- [ ] 同命令转绿，确认401／格式修补耗尽／上下文超限保留原错误分类，不静默换模型。提交I3。

### I4：故事可见性、观察冻结与单池上下文

**Files:** 新service；修改app、recovery、context-types、context-views、resource-pool、index；新增`tests/incoming-media-turn.test.ts`、`tests/incoming-media-context.test.ts`。

**Interfaces:** `IncomingMediaService.prepareForTurn(turnId: string, messageIds: string[], signal?: AbortSignal): Promise<PreparedAttachment[]>`；TurnRecord.visualContext为已准备观察快照；pool.visualObservations按observationRef去重，ModelMessage.visualObservationRefs只引用获准消息附件。

- [ ] 写失败回归：普通主叙事无未读新图；普通主叙事判断能看后，个人导演才拿图描述；共同主叙事拿本场图，另一活动未读图排除；同图两消息在pool只出现一次正文；纯图到来令程序禁止代写用户新动作。
- [ ] `npx vitest run tests/incoming-media-turn.test.ts tests/incoming-media-context.test.ts`确认失败。
- [ ] 接入既有visible／reconsider及activityContext选择；受控下载失效保存unrecognized，模型错误抛给现有错误处理。下载可在收件后异步启动，仅合法故事读取调用观察；输入路径不await识别。未命中图使用turn owner和稳定phase incoming_image:<attachmentId>，继承既有搜索计数／checkpoint；修补与续调用不重置额度，不在checkpoint保存base64。
- [ ] 持久化已ready快照；freezeTurn合并最新持久turn，discardUnattempted保留快照。把观察按权限投影到个人／共同主叙事／表达／记忆，不暴露sourceUrl、原图base64给这些阶段。
- [ ] 测试看图等待期间新消息进入下一轮、共同时钟正确、暂停不触发新角色观察、睡眠不调用视觉、ready重开不重看、冻结与发送恢复不丢visualContext。同命令转绿，提交I4。

### I5：记忆来源、缓存文件清理与恢复验收

**Files:** 修改memory/organize、input-media/service／store、host/runtime、runtime/check.cjs；新增`tests/incoming-media-memory.test.ts`、`tests/incoming-media-recovery.test.ts`。

**Interfaces:** `IncomingMediaService.cleanupOne(now: string): Promise<'applied'|'none'>`；只清无在途／待看／延后／当前原文引用的原图文件，观察文字不因此删除；在现有空闲让位边界一次处理一个文件。`IncomingMediaService.stop(): Promise<void>`停止新下载、取消／等待仍在途的保存工作，Host.stop完成后调用，Storage.close前必须完成。

- [ ] 写失败回归：图产生记忆必须引用原消息ID；未读图不能作为记忆；相同图本轮新发送不被当旧无来源；shared与普通窗口观察保持权限；unrecognized不编造画面记忆。
- [ ] `npx vitest run tests/incoming-media-memory.test.ts tests/incoming-media-recovery.test.ts`确认失败。
- [ ] 基础整理带入本轮授权观察；sourceIds仍用messages，不生成伪用户台词。测试文件重开后ready结果不再调用模型，下载未完成可重载来源，源URL失效保留未知；已发送输出不重发。
- [ ] 实现逐单元无引用文件清理：仍受空闲／前台资格，路径必须解析并确认在指定incoming-media目录内，再用本机原生文件API删除；被未完成轮引用文件不删。观察缓存不是短／长记忆，清理不改记忆生命周期。
- [ ] 只读启动检查不创建表、下载图片或请求模型；旧无附件数据库可读；下载在途关闭时须先stop排空、再关闭Storage，取消的下载保持可恢复而非成功缓存。新增关闭回归断言无关库后写入，同命令转绿。提交I5。

### I6：插件接线、文档和分层验收

**Files:** index、examples/story.sample.json、runtime/plugin-smoke-fixtures.cjs／plugin-smoke.cjs、README、V0.5相关文档；新增`scripts/validate-incoming-media.ts`及`tests/incoming-media-smoke.test.ts`。

**Interfaces:** 验收脚本默认离线；`--online --config <path> --fixture <public-or-synthetic-image> --report <path>`才调用真实图片连接，不连QQ、不读正式消息。默认单模型请求300秒，仅验收保护。

- [ ] 写离线插件失败回归：图片模式启用且连接可用时图片描述进入角色输入；关闭时无视觉请求，纯图仍落库；新接口不依赖Puppeteer或旧项目路径。
- [ ] `npx vitest run tests/incoming-media-smoke.test.ts`确认失败；完成正式装配与离线fixture。
- [ ] 在隔离库执行`npm run typecheck`、`npm test`、`npm run build`、`npm run demo`、`npm run check --prefix runtime`、`npm run smoke --prefix runtime`，各项通过才声明离线交付；检查正式库／配置未被测试改动。
- [ ] 若获准实际在线验收，用公开／合成表情、狗照片、带字截图、多图次序和GIF验证；保存耗时／质量与限制。没有在线结果则明确未验收，不使用私人聊天图替代。
- [ ] 同步表达／上下文／记忆／恢复／实现对应与模型用途表；记录新增incoming_image逻辑用途及连接复用。正式启用另停服备份，仅加图片开关；模型／强度不变，保持用户手动启动。提交交付，计划关闭后按目录原则归档。
