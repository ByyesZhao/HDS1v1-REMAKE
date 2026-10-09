# Incoming Image Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 按 SOL 单执行者交接，不主动启动代理。

**Goal:** 用户图片／表情在合法读取时得到固定观察，当前轮和后续获准历史上下文均可理解它。

**Architecture:** 收件原子登记，异步资产保存，独立 incoming_image 观察，消息关联＋回合冻结双层持久化，最后在已有权限投影之后装入单一资料池。发送图库、记忆和图片观察分别管理。

**Tech Stack:** 当前 TypeScript／Node SQLite／Koishi／Vitest／ModelClient；新增 qface，沿现有 Flash／high 图片连接。

**Spec:** [修订设计 §1～4、7](DESIGN.md)、[执行指南](EXECUTION_GUIDE.md)。日期 2026-10-09；代码基线 `4fe090c`；**待实施**。路径相对仓库根目录。本计划独立于 S1～S5。

## Global Constraints

- 保持现有模型、reasoningEffort、输出模式、嵌入连接；incomingImageModel 可选，未配复用 stickerDescriptionModel；visualInput.enabled 默认 false。
- 收件立即按原 15 秒／共同 60 秒时钟入库；不等待网络或视觉，不扩大普通／共享／睡眠的读取资格。
- ready 和 unrecognized 为本轮终态；pending 可恢复。已开始前台轮不因 pause 中途停图。
- 不裁剪观察或原文；仅 incoming_image 传原图；checkpoint 不存 base64。
- 内容按真实字节 SHA256 缓存；旧图库混合用途描述不直接转换；原 67 项图库及向量保持原值。
- 新表仅加法初始化；只读旧库不建表；正式配置、数据库和服务操作按交接的实际授权范围处理。

## Review Focus

1. 首轮看图但没有记忆，下一轮仍应随窗口／lookup 读到观察：I4 历史装载测试。
2. 同毫秒／逆序 ID／12 图／A→B→A 不得因去重而改次序：I1、I4 的消息与 envelope 测试。
3. A 已 unrecognized、B 报错后重开，以及 pending 原 URL 失效：I4、I5 的磁盘恢复测试。
4. 普通 narrative 在等模型时 pause，仍能完成当前轮后续图片，且未读同图不能提前见：I4 流程测试。
5. 精确匹配旧图库不等于客观观察，文件清理不能破坏在途恢复：I2、I5 的反例测试。

## 文件分工

| 新文件 | 职责 |
| --- | --- |
| src/input-media/types.ts、ingress.ts | 数据合同、当前消息解析与图文位置 |
| src/input-media/store.ts | 三表记录、索引、确认关联、冻结状态的纯读写 |
| src/input-media/assets.ts、qq-face.ts | 受控来源解析、落盘、资产引用、表情 ID 映射 |
| src/input-media/observe.ts | 独立任务 schema、提示和 ModelClient 调用 |
| src/input-media/service.ts | 合法 prepare、预下载、冻结、清理与 stop |
| src/input-media/context.ts | 权限投影后的只读 hydration 与本轮 runner 包装 |
| scripts/validate-incoming-media.ts | 默认离线，显式 online 时的公开／合成图片验收 |

重点既有接点：src/types.ts、storage.ts、host/input.ts、host/runtime.ts、app.ts、recovery.ts、memory/organize.ts、model/context-types.ts、context-views.ts、resource-pool.ts、client.ts、prompts.ts、prompt-policy.ts、settings.ts、index.ts。无需把其他大文件顺手重构。

## I1 原子收件、稳定附件与图文位置

**Files:** 新建 types.ts、ingress.ts、store.ts；修改 src/types.ts、storage.ts、host/input.ts、index.ts。新测 tests/incoming-media-ingress.test.ts、incoming-media-store.test.ts；扩展 tests/visual-input-entry.test.ts。

**Interfaces:** DESIGN §2 的类型；`parseIncomingContent(messageId, rawContent)`；`IncomingMediaStore.register(attachments: readonly IncomingAttachment[]): void`。后续任务直接使用这些记录，不再次解析 session。

- [ ] **写失败测试。** 覆盖纯图、文图文、face 内嵌 img、mface、缺图来源、纯文字不借 session.elements、emoji／中文及首尾空白处理后的片段下标、纯文本推进与图中“推进”、重复平台消息、事务异常。关键断言：

```ts
expect(parsed.contentParts.map(p => p.kind)).toEqual(['text','attachment','text']);
expect(parsed.content.slice(textPart.start, textPart.end)).toBe(expectedText);
expect(parsed.contentParts.some(p => 'text' in p)).toBe(false);
expect(faceParsed.attachments).toHaveLength(1);
expect(twelve.attachments.map(a => a.order)).toEqual(Array.from({length:12},(_,i)=>i));
expect(afterRollback.messages).toHaveLength(0);
expect(afterRollback.attachments).toHaveLength(0);
expect(afterDuplicate.attachmentIds).toEqual(first.attachmentIds);
```

- [ ] **跑红。** `npx vitest run tests/incoming-media-ingress.test.ts tests/incoming-media-store.test.ts tests/visual-input-entry.test.ts`；应因缺少合同／新行为失败，记录真实失败，不接受纯语法或测试装配错误。
- [ ] **实现解析及表。** stable ID=`JSON.stringify([messageId, order])`；新增三张表和对应索引；旧只读库无表按空。Message 只保留 attachmentIds／contentParts，不把 attachments 对象展开到消息行。
- [ ] **接入收件事务。** 重复／推进检查先行；register、Message 保存、段／活动归属、时钟刷新同事务；网络不进入事务。用挂起 resolver 的测试证明普通 readyAt 接收时＋15,000ms、共享 lastInputAt 接收时并按既有 60 秒调度刷新。
- [ ] **跑绿并提交。** 同命令全通过；显式暂存 I1 文件，提交 `feat: persist ordered incoming media references`。此时图片仍只是可恢复引用，不宣称已看懂。

## I2 资产保存、平台表情与精确缓存

**Files:** 新 assets.ts、qq-face.ts；扩展 store.ts；修改根 package.json／package-lock.json、.gitignore。新测 tests/incoming-media-assets.test.ts、incoming-media-cache.test.ts。

**Interfaces:** DESIGN §3.1 的 AttachmentResolver、ensureAsset、resolveImageAsset、findObservation、findLibraryObservation、primeStickerObservations。资产根目录由装配者显式传入；准备给 I3 的 resolver 只接受已登记 assetRef。

- [ ] **写失败测试。** HTTP／data 来源、getImage token、缺少 getImage、相同字节不同 URL、相同名不同字节、并发同图、文件写到一半、已知／未知 face，以及旧图库混合描述：

```ts
expect(first.assetRef).toBe(sameBytesOtherUrl.assetRef);
expect(otherBytes.assetRef).not.toBe(first.assetRef);
expect(store.findLibraryObservation(dogWithUsageTextHash)).toBeNull();
expect(stickersAfter).toEqual(stickersBefore);
expect(fakeEmbeddingCalls).toBe(0);
expect(assetAfterFailedWrite?.state).not.toBe('ready');
```

- [ ] **跑红。** `npx vitest run tests/incoming-media-assets.test.ts tests/incoming-media-cache.test.ts`。
- [ ] **实现资产路径。** 下载→实际 MIME／字节→SHA256→临时文件→原子重命名→保存 ready。HTTP／data 和平台桥接分开；token 不当路径。resolveImageAsset 只读登记资产并输出 data URL；可识别旧 phase 所引文件丢失错误，不静默换图。通过在途 Promise 合并相同资产工作。
- [ ] **实现表情和缓存。** 安装并锁定 qface；保留必要扩展映射及许可证来源记录。已知 face 固定观察版本。primeStickerObservations 每实例只执行一次，无 embedding、无全库每消息扫描；本批旧混合描述全部不满足免调用资格。内容缓存仅收成功观察，确认到消息留给 I4 的合法 prepare。
- [ ] **跑绿并提交。** 同命令通过；补断言 pending 写盘时输入仍可登记、失败不留下可供 resolver 使用的半文件。提交 `feat: cache incoming image assets by content`。

## I3 incoming_image 模型合同与发送层

**Files:** 新 observe.ts；修改 src/settings.ts、model/context-types.ts、prompts.ts、prompt-policy.ts、client.ts，必要的模型合同定义。新测 tests/incoming-image-model.test.ts；扩展 tests/model-settings.test.ts。

**Interfaces:** `observeIncomingImage(models, imageAssetRef, options?): Promise<ImageObservation>`；任务 incoming_image，导出 `INCOMING_IMAGE_RECOGNIZER_VERSION = 'incoming-image:v1'`；ChatCompletionsTransport 第三个可选 resolver 参数。I4 提供 phaseOptions，本任务不自建 owner 或工具计数。

- [ ] **写失败测试。** 抓取实际 fetch 请求，而非只断言 JSON 中有字符串。模型成功四字段、修补两次、旧 imageDataUrl 兼容、可选连接 fallback／override、关闭模式无新凭据要求：

```ts
expect(body.messages[1].content[1].type).toBe('image_url');
expect(textEnvelope).not.toContain('data:image/');
expect(checkpoint.input.context.imageAssetRef).toBe(assetRef);
expect(request.tools.lookup).toBe(false);
expect(request.tools.web).toBe(webEnabled);
expect(existingConnectionsAfter).toEqual(existingConnectionsBefore);
```

- [ ] **跑红。** `npx vitest run tests/incoming-image-model.test.ts tests/model-settings.test.ts`。
- [ ] **实现观察任务。** 使用独立 schema 和客观提示，不复用 sticker_description；分清 OCR 与用途猜测。无人物背景、历史或 lookup；公开资料不冒充图上文字。原 GIF 直接传入，不暗称逐帧处理。
- [ ] **实现发送／配置。** 图片 ref 仅在 incoming_image 发送时解析，文本 envelope 去传输字段；第三参数不破坏前两个参数或旧图片导入。visualInput.enabled 默认 false；只在启用时检查 incomingImageModel ?? stickerDescriptionModel，不扩张无条件 modelRoles。
- [ ] **跑绿并提交。** 同命令通过；验证第三次格式错误抛原 ModelFormatError、401／上下文超限保留原分类、修补图不变、无静默模型切换。提交 `feat: add isolated incoming image observation task`。

## I4 故事读取、固定观察与历史上下文

此任务分两次可检查的小步；I4a 完成后才接 I4b。R1 的交付条件是最终 envelope 可见，service 单测通过不能替代。

### I4a 合法 prepare 与回合终态

**Files:** 新 service.ts；修改 app.ts、recovery.ts、host/runtime.ts、index.ts；扩展 store.ts。新测 tests/incoming-media-turn.test.ts。

**Interfaces:** IncomingMediaService 的 prepareForTurn、prefetchForMessages、readConfirmedForMessages、readFrozenForTurn；TurnVisualContext。app 的 Dependencies 增加可选 incomingMedia，纯文字既有夹具仍可不提供。

- [ ] **写失败测试。** 普通 narrative 不见新未读图，决定可读后才 prepare；共享只看绑定场次；睡眠不准备；视觉关闭仅已知 face 可 ready；同批两消息同图一次模型调用但两个消息确认；prepare 输入 ID 保持原次序。
- [ ] **跑红。** `npx vitest run tests/incoming-media-turn.test.ts`。
- [ ] **实现流程。** 收件提交后 prefetch 不 await；关闭模式不预下载。普通 narrative 之后按 visible／reconsider 准备，共享 narrative 之前按既有 activityContext 准备。每图先固化 pending／assetRef／phaseKey／recognizerVersion，再调用 I3，成功短事务存观察、消息确认、本轮 ready。
- [ ] **实现终态与恢复。** 本轮 terminal 优先，不把 unavailable／取消／模型失败混为一类。模型错误抛出；受控来源不可用存 unrecognized；取消留 pending。freezeTurn 从最新持久 turn 合并，discardUnattempted 保留 visualContext。暂停沿原 Host 行为，不加半轮暂停状态机。
- [ ] **跑绿并提交。** 加挂起 narrative→pause→释放→首图和第二图均可调用→不启动后续轮的测试；新到消息保持下一轮。断言 freeze／discard 不覆盖 visualContext。提交 `feat: freeze authorized image observations per turn`。

### I4b 权限投影后 hydration，含历史和 lookup

**Files:** 新 context.ts；修改 app.ts、memory/organize.ts、model/context-types.ts、resource-pool.ts；按需要调整 context-views.ts 的兼容处理。新测 tests/incoming-media-context.test.ts；扩展 tests/resource-pool-index.test.ts、expression-context-view.test.ts。

**Interfaces:** DESIGN §4.2 的 hydrateVisualContext、withTurnVisualContext；readFrozenForTurn 返回 terminal 及不可变观察正文。lookup 返回 StageModelInput，由 envelope 新分支合并；兼容旧 raw lookup。

- [ ] **写失败测试。** A 轮只看图、不记忆、不复述；B 轮纯文字追问，ordinary narrative／personal／expression 都含 A 图。退出四段原文窗口排除；合法 lookup 可带回该消息观察，未合法返回消息不能只凭 hash 带图。共享活动历史和普通窗口分别测试。
- [ ] **跑红。** `npx vitest run tests/incoming-media-context.test.ts tests/resource-pool-index.test.ts tests/expression-context-view.test.ts`。
- [ ] **实现后投影装载。** 包装 runner 接收 director 已构建的 StageModelInput，只对 DESIGN 白名单阶段按 resources.messages ID 纯读；本轮 terminal 覆盖绑定。世界／学校等透传且不注图。lookup 包装先执行原回调，再 stageInput＋hydrate；不在 Transport 内加数据库读取。
- [ ] **实现资源池与恢复兼容。** body 按 ref 去重，ModelMessage 按附件保存多次出现及 contentParts。merge 同消息时补缺失绑定，不能 first-wins 丢掉 lookup 图片。旧 pool 无 visualObservations 按 []。memory 的 includeLookupIds 同时识别旧 raw 和已持久 StageModelInput，保持其原校验行为。
- [ ] **跑绿并提交。** 除上述路径，序列化 envelope 断言：

```ts
expect(abaMessage.visualAttachments.map(a => a.observationRef)).toEqual([refA,refB,refA]);
expect(envelope.resources.visualObservations).toHaveLength(2);
expect(JSON.stringify(envelope)).not.toContain(sourceUrl);
expect(visionCallsDuringHistoryRead).toBe(0);
expect(memoryInput.roles.currentSourceIds).not.toContain(historicalMessageId);
expect(unreadSameHashInNarrative).toBe(false);
```

测试逆序消息 ID、同毫秒和 12 图的数值次序；提交 `feat: hydrate authorized historical image context`。

## I5 记忆、磁盘恢复、清理与真实隔离检查

### I5a 恢复及生命周期

**Files:** 修改 src/memory/organize.ts、input-media/service.ts／store.ts／assets.ts、host/runtime.ts、index.ts。新测 tests/incoming-media-memory.test.ts、incoming-media-recovery.test.ts、incoming-media-cleanup.test.ts。

**Interfaces:** `cleanupOne(now): Promise<'applied'|'none'>`、`stop(): Promise<void>`；复用 Host.stop 合同，不改前台并发。参见 DESIGN §3.3、4.4。

- [ ] **写失败测试。** 使用临时磁盘 SQLite，关闭所有连接后重开；不只在同一 JS 对象上重试。覆盖 ready 不重看、A unrecognized＋B 报错后 A URL 恢复仍不重判、pending 已确认网页材料且源 URL 失效仍以旧 assetRef／phase／计数继续、部分已发送不重发。
- [ ] **跑红。** `npx vitest run tests/incoming-media-memory.test.ts tests/incoming-media-recovery.test.ts tests/incoming-media-cleanup.test.ts`。
- [ ] **落实来源。** 记忆只能引用原合法 messageId；历史图只作上下文，本轮重复发送用本轮新 messageId。unrecognized 无虚构内容；不得因为图存在而让 memory 获得未读消息。已确认网页材料不因图片恢复重复计数。
- [ ] **落实清理／stop。** 每单元最多一个候选，引用检查用已有窗口与附件索引，不每次聊天全盘扫描。待看、延后、unfinished turn、活动窗口、在途保存／读取都保护；删除前 await 后重查资格。删除与 acquire 共用资产状态；停机 await Host→media.stop→Storage.close，下载结束不得关库后写入。
- [ ] **跑绿并提交。** 断言关库后写入 0；cleanup 等待期间新引用进入后文件保留；一条受保护同 hash 引用能保全文件；原图删除后历史观察仍能纯读。提交 `feat: recover and retire incoming media safely`。

### I5b runtime/check 显式路径

**Files:** 修改 runtime/check.cjs、tests/runtime-check-readonly.test.ts；新增 tests/runtime-check-paths.test.ts。未来 S4 在同接口追加浏览器配置检查。

**Interfaces:** CommonJS 导出 `checkRuntime({configPath, databasePath, koishiConfigPath?}, dependencies?)`；仅 `require.main === module` 时运行 CLI。`--config`、`--database`、`--koishi-config` 为绝对路径参数；未传时保持现有正式启动器默认路径。显式路径不存在应报该路径错误，不回退默认。

- [ ] **写失败测试并跑红。** `npx vitest run tests/runtime-check-readonly.test.ts tests/runtime-check-paths.test.ts`。合成 config 及 key.txt 全在临时目录；数据库版本检查、图库和新媒体分支均使用传入 databasePath；利用注入读文件／打开库记录断言从未触碰缺省正式路径。
- [ ] **实现可注入检查函数。** 真实配置解析、连接检查、数据库只读检查保留，禁止网络／建表。不得只替换第一次数据库变量而让图库分支继续硬编码正式库。
- [ ] **先 build，再跑绿并提交。** `npm run build` 后同测试命令通过；比较夹具库前后字节及表／索引，验证只读。提交 `refactor: make runtime checks use explicit data paths`。

## I6 插件装配、验收与文档交付

**Files:** 修改 src/index.ts、examples/story.sample.json、runtime/plugin-smoke-fixtures.cjs、plugin-smoke.cjs、package.json，以及当前功能说明；新增 scripts/validate-incoming-media.ts、scripts/prepare-feature-check.ts、tests/incoming-media-smoke.test.ts、tests/feature-check-fixture.test.ts。

**Interfaces:** `npx tsx scripts/validate-incoming-media.ts --report <path>` 默认离线；仅 `--online --config <absolute> --fixture <public-or-synthetic-image> --report <path>` 调真实图片连接。在线单请求 300 秒为脚本保护，不改运行时模型合同。

- [ ] **写失败测试并跑红。** `npx vitest run tests/incoming-media-smoke.test.ts`。通过真实插件装配＋mock transport 验证图片开关开／关、已知 face、文字旧路径、无 Puppeteer 依赖；离线脚本真实网络请求数为 0，报告不是凭空写 passed。
- [ ] **完成装配与脚本。** new ModelClient 的 resolver、store、service、预下载、Dependencies、生命周期全部连通；示例默认关闭，不改私有 config.local.json。报告区分下载、视觉识别、上下文、恢复结果与调用数。
- [ ] **实现隔离夹具生成器。** 按执行指南 §4.1 先写 tests/feature-check-fixture.test.ts 并跑红，实现 prepare-feature-check.ts 的 image／verify 入口、合成凭据和禁止联网预加载，再运行 `npx vitest run tests/feature-check-fixture.test.ts` 转绿；search 模式由 S4 在相同脚本扩展，不能复制正式库。
- [ ] **执行本批完整离线门禁。** 严格用 [执行指南 §4](EXECUTION_GUIDE.md) 的 build 在先顺序和显式隔离路径；不能跑无参数 runtime/check 作为“隔离验收”。
- [ ] **记录在线层。** 如本次执行授权包含真实视觉验收，用公开／合成表情、动物照、带字图、多图位置和 GIF；记录实际模型／强度、调用／修补数、耗时和误识别。不包含时标“在线质量未执行”，不假借离线测试称真实识别已验收。
- [ ] **同步规则并提交。** 更新当前上下文／记忆／表达／恢复／实现对应及模型用途表，保留“13 个既有连接不变，incoming_image 新用途可复用连接”的区分。形成独立图片 DELIVERY／IMPLEMENTATION_LOG／REVIEW_CLOSURE 和证据；提交 `feat: integrate incoming image understanding`。正式启用步骤见执行指南，不自动启动服务。
