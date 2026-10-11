# Web 与媒体整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 B2、B3、B5，并在不改变网页额度、材料可见性与中断恢复的前提下落实 WM-O1、WM-O2、WM-O3。

**Architecture:** 先修 provider 文本边界、图库 CLI 依赖装配及 DOM 子树选择，再把网页控制数据查询与正文装配分开。网页操作与模型检查点采用版本化正文引用，正文仍完整保存在阶段材料表；图片使用单次观察范围内的资产租约，环境 owner 在旧工作结算后异步收尾。

**Tech Stack:** 现有 TypeScript、Node `>=22.13.0`、node:sqlite、Vitest、linkedom、Koishi、koishi-plugin-puppeteer、@mozilla/readability `0.6.0`；不新增第三方依赖。

**Spec:** [综合审核](../../reviews/comprehensive-audit-20261011/README.md)、[Web/媒体审核](../../reviews/comprehensive-audit-20261011/WEB_MEDIA_AUDIT.md)、[网页合同](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md)、[表达与素材合同](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)。环境终态正文压缩由同批 [RUNTIME_PLAN.md](RUNTIME_PLAN.md) 所有，W7 仅接其终态接口。

## Global Constraints

- 本文是待执行计划；本次只写方案，不执行产品实现、正式启停、库迁移、在线模型／搜索或 QQ 操作。
- 编写前实际核对 HEAD=`ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c`，与审核基线一致；工作区已有审计文档和索引改动，不能覆盖。执行前重查 `git rev-parse HEAD`、`git status --short` 及本计划涉及源码差异；不能把旧探针“复现通过”当作修复通过。
- `maxSuccessReads=20`、`maxFailures=40` 独立累计；任一到限关闭新工具。格式修补、恢复和同一环境 step 的 generation 更新不重置原阶段资格。
- B 缓存按 `ownerType:ownerId` 隔离；跨阶段首次取得同页各加一次成功，同阶段已确认步骤重放不重复计数。不增加跨 owner 缓存，不删除历史计数／来源／材料。
- 完整正文不截字、不截 token、不摘要；12000 字以上、Unicode、代码示例和真实重复段落都保留。
- `markProvided` 只在 transport 成功返回且取消检查通过后调用；网络失败不登记来源。返回格式错误但接口已成功时仍登记实际提供，再走原格式修补；只有 `turn/personal_life` 创建 `self_web_read_sources`。
- 未冻结恢复沿原 run/operation/checkpoint；冻结发送不重新搜索或改稿。pending lookup、repair、环境 generation 和 pending 图片版本均沿既有合同。
- 不读取私有配置、密钥、正式 SQLite 来制作夹具；测试只用合成图片、合成网页、临时配置与隔离库。性能数字必须来自未来运行结果，不把审核样本耗时写成改后承诺。
- 执行提交每个任务只暂存该任务明确文件；不执行 `git add .`。正式部署与数据写入不包含在本文的离线实现验收中。

## Review Focus

1. 已由 DOM 解码的 `&lt;`、`<nav>`、比较式与泛型必须作为文字保留；W1 覆盖浏览器到最终材料链路。
2. CLI 浏览器启动 reject／一直不就绪／关闭失败不能留下页面或 SQLite 句柄，也不能启动故事／QQ；W2 用真实 CLI 子进程与替换服务测试。
3. 已完成 operation 但 checkpoint 仍指向 pending 的崩溃窗口，以及旧 checkpoint 中的 repair/private lookup，升级后必须接续而不再次消耗页面；W5 覆盖落库重开。
4. 同 hash 并发观察、模型失败、关闭新图开关后的 pending 恢复，不能因共享字节租约早释或残留 data URL 而失真；W6 覆盖。
5. 跨日后旧 provider 迟到、取消 catch/finally 迟到，不得在 owner 回收后重新填缓存／写回 checkpoint；W7 用可控 Promise 覆盖，前台不等网络排空。

## 文件职责与执行顺序

| 任务 | 负责文件／新增边界 | 独立交付与依赖 |
| --- | --- | --- |
| W1 / B2 | `src/web/provider.ts`、`content.ts`、`browser/extract.ts`、provider 返回值及相应夹具 | 先修；不依赖 W4/W5 |
| W2 / B3 | `scripts/stickers.ts`；新 `src/deployment/sticker-web-runtime.ts` | 保留 import 搜索资格；rebuild 不装配网页；与 W1/W3 可独立 |
| W3 / B5 | `src/web/browser/extract.ts` | W1 后串行编辑同文件 |
| W4 / WM-O1a | `src/web/store.ts`、`types.ts`、`service.ts`、`src/model/client.ts`；checkpoint 使用方 | 保持旧 JSON，单独可发布；与R1共享organize.ts，R1先执行 |
| W5 / WM-O1b | 新 `src/web/persistence.ts`、`payload-migration.ts`；store/model 接线；新停服工具 | 依赖 W4；兼容读、v2 写、迁移和回退作为同一发布门 |
| W6 / WM-O2 | `src/input-media/assets.ts`、`service.ts`；现有 transport resolver 保持签名 | W5 后跑联测；实现可独立 |
| W7 / WM-O3 | `src/web/service.ts`、`src/environment/preparation.ts`、`runtime.ts` | 单向依赖 R4a 的终态 helper；R4a 本身不依赖 W7；W5 后做兼容联测 |

W1～W3 先通过再开展性能任务。W4/W5 不与其他 agent 同时修改 `store.ts`／`client.ts`；W7 的 `preparation.ts`／`runtime.ts` 接线交给单一执行者合并运行时任务。每项绿色提交后才进入依赖它的任务。

## W1：明确 provider 的纯文本边界，修复二次 HTML 清理

**Files:** 修改 `src/web/provider.ts`、`src/web/content.ts`、`src/web/browser/extract.ts`、`src/web/service.ts`、`tests/web-content.test.ts`、`tests/browser-web-integration.test.ts`；更新返回 `{title,body}` 的 provider 测试夹具与 `scripts/validate-local-web.ts` 的类型引用（用 `rg -n 'WebSearchProvider|signature:|normalizeMaterial' src scripts tests` 枚举，逐个确认）。

**Interfaces:** 新 `WebProviderPage={title:string;body:string;bodyFormat:'text'}`；`WebSearchProvider.read(url,signal?):Promise<WebProviderPage>`。`normalizeMaterial` 只接收并正规化纯文本（压空白、URL、codepoint 计数），不剥标签、不解实体。旧 HTML 清理规则移到显式 `htmlToWebText(html:string):string`；HTML fixture 在适配边界先调用它，生产 browser 直接返回 `bodyFormat:'text'`。没有默认 `html`、自动猜测、可选 format 或运行时故事降级。`extractReadablePage` 的返回类型是 `WebProviderPage`；BROWSER_EXTRACTOR_VERSION 由 `dom-v2/readability-0.6.0` 升为 `dom-v3/readability-0.6.0`（W3沿用本批v3），让 provider signature 不跨提取语义混用缓存。

- [x] **写回归。** `browser_plain_text_survives_service_normalization` 经 linkedom → `extractDomEvidence` → managed provider → `WebSearchService`；HTML实体承载 `关系：a < b && c > d。`、`List<String>`、字面 `<nav>示例</nav>`、可见 `&lt;`。断言最终 body 含上述逐字内容、真正 nav 不在正文，counters=`{successReads:1,failures:0}`，模型 completion envelope 中材料相同。
- [x] **写边界测试。** `html_adapter_cleans_markup_once` 把原 web-content HTML 测试改为显式先适配；保留长尾 `😀尾部标记`、`body.length>12000`、codepoint 数、`empty body` 断言。`plain_text_does_not_decode_entities_again` 断言输入字面 `&lt;` 仍是 `&lt;`。
- [x] **跑红。** `npx vitest run tests/web-content.test.ts tests/browser-web-integration.test.ts`；基线应在纯文字保真断言失败，而不是 fixture 装配失败。
- [x] **实现边界。** 按上述签名分离纯文本与显式 HTML adapter；一次性更新 provider 实现与 fake，不对既存 `web_materials` 重新清理，也不声称能恢复已损坏正文。
- [x] **跑绿。** 同命令，加 `npx vitest run tests/browser-search-provider.test.ts tests/web-session.test.ts tests/web-provider.test.ts`、`npm run typecheck`；所有用例通过，provider 返回类型无隐式兼容洞。
- [x] **提交。** `fix: preserve extracted web plain text`；只列出本任务实际变动文件暂存。同步网页文档提取器版本与纯文本边界，保留历史审核原文。

## W2：图库 CLI 按用途装配，import 保留 browser 搜索

**设计依据:** 网页合同 §2 明确“素材描述”可搜索，因此这里选择独立 browser import；不能把 `enabled=true` 改成 false 或不传 web 来绕过。独立 CLI 只创建自己的 Koishi `Context`、HTTP 插件、Puppeteer 服务和 owned pages；不载入 `runtime/koishi.yml`、HDSI 插件、SerialHost、QQ adapter 或 stop endpoint，不调用故事服务的启停生命周期。rebuild 沿用旧描述，仅 Embedding。

**Files:** 修改 `scripts/stickers.ts`、`README.md`、`docs/v0.5/subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md`、`REMAKE_V0.5_WEB_SEARCH.md`；新增 `src/deployment/sticker-web-runtime.ts`、`tests/stickers-cli.test.ts`、`tests/sticker-web-runtime.test.ts`；复用 `tests/local-web-validation-startup.test.ts` 的真实 Context＋替换 Service 方法。

**Interfaces:** `createStickerWebRuntime(storage:Storage,settings:StorySettings,clock:Clock,options?:{startupTimeoutMs?:number}):Promise<{web:WebSearchService;dispose():Promise<void>}>`。默认启动预算60000ms，页面预算继续使用 `settings.webSearch.browser`（不互相重置）。false 分支直接 `assembleWeb`，不 require browser；true/unconfigured 保留明确失败；true/browser 等 ready 后创建 `createManagedBrowserProvider(createKoishiBrowserPort(...),settings.webSearch.browser)`。HTTP 通过 `createRequire` 锚定仓库 `runtime/package.json` 读取已有 `@koishijs/plugin-http`，Koishi／Puppeteer用项目包；路径相对模块位置而非调用者 cwd。不安装第二套浏览器／新依赖、不改现有正式配置。

- [x] **写真实 CLI 回归。** `rebuild_with_enabled_browser_never_creates_web_or_vision`：子进程、临时配置设置true/browser，预置一条合成sticker，fake Embedding；断言 exit=0，ID/path/description不变、向量更新，browser factory=0、vision=0、web sessions=0。
- [x] **写 import 测试。** `import_with_enabled_browser_completes_tool_roundtrip`：合成PNG，fake视觉模型先请求 `webRead` 再返回description，替换Puppeteer服务只提供合成DOM；断言真实CLI exit=0，1条sticker、1次Embedding、1次实际页面读取、视觉请求2次，第二请求带正文；阶段独立20/40，ownerType=`asset`；外网请求0。
- [x] **写生命周期测试。** `import_browser_start_reject_preserves_original_error`、`import_browser_start_timeout_closes_context`、`import_failure_drains_pages_before_closing_storage`、`disabled_import_never_loads_browser`。分别断言原错误+exit1、测试启动预算100ms后settle、managed.dispose完成在storage.close之前且无关库后写入、关闭模式browser require/factory均0；重复dispose仅关闭一次。fake记录adapter/Host构造次数均0。迟到建页与close失败由现有slots测例验证，CLI不得先关库再让cleanup写。
- [x] **跑红。** `npx vitest run tests/stickers-cli.test.ts tests/sticker-web-runtime.test.ts`；基线rebuild/import在“provider not configured”失败。
- [x] **实现分支。** 在脚本中先判断rebuild；import才创建独立runtime。创建失败由factory逆序关闭已取得资源；主finally完成asset owner释放、checkpoint压缩、managed.dispose、Context.stop（含Puppeteer附带canvas scope既有处理）后关Storage。保留原失败原因，cleanup失败附加诊断并非零退出；成功不吞清理失败。
- [x] **跑绿和更新命令说明。** 同命令＋`npx vitest run tests/stickers.test.ts tests/web-deployment.test.ts tests/local-web-validation-startup.test.ts`。README保留现有参数顺序，说明import可按配置搜索、独立headless browser、启动预算、失败非零，rebuild只需Embedding；继续要求导入／重建前停止故事，不能以本次测试证明在线视觉效果。
- [x] **提交。** `fix: assemble sticker CLI dependencies by command`。不运行指向默认正式库的无参数CLI来验收。

## W3：提取互不重叠的正文子树

**Files:** 修改 `src/web/browser/extract.ts`、`tests/browser-page-extraction.test.ts`、`tests/browser-visible-dom.test.ts`。

**Interfaces:** 保持 `extractDomEvidence`、`extractReadablePage`；算法仍先 article 再 main/[role=main] 再 Readability。每档在 cleaned clone 上筛 `hasBodyEvidence`，仅保留没有“同档且通过证据筛选”的祖先的候选，按DOM顺序拼接。选择顶层有效候选，不能按文字相同去重，也不把main强行覆盖article优先级。

- [x] **写回归。** `nested_articles_emit_descendant_text_once`、`nested_main_role_main_emit_descendant_text_once`：内层唯一标记各只出现1次。`sibling_articles_keep_identical_paragraphs`：两个兄弟article各一段相同文字，最终出现2次。`non_body_candidate_does_not_hide_valid_descendant`：无效／清理后的候选不妨碍有效子树；隐藏／登录区域内文字仍0次。
- [x] **跑红。** `npx vitest run tests/browser-page-extraction.test.ts tests/browser-visible-dom.test.ts`，前两项在occurrence=2处失败。
- [x] **实现候选过滤。** 在原extract循环中按包含关系过滤；只改子树选择，不加长度阈值，不改source标签；BROWSER_EXTRACTOR_VERSION保持W1的v3。
- [x] **跑绿。** 同命令＋`npx vitest run tests/browser-web-integration.test.ts tests/browser-koishi-port.test.ts`；长正文尾、动态就绪、登录墙均保持。
- [x] **提交。** `fix: avoid overlapping browser body containers`。

## W4：用轻量查询读取控制信息，暂不改变 JSON 格式

**Files:** 修改 `src/web/types.ts`、`store.ts`、`service.ts`、`src/model/client.ts`、`src/environment/preparation.ts`、`src/environment/runtime.ts`、`src/memory/organize.ts`；新增 `tests/web-light-state.test.ts`，扩展 `tests/web-store.test.ts`、`tests/web-model-tools.test.ts`、`tests/web-memory-sources.test.ts`。`organize.ts`与R1共享，先完成R1再修改这里的网页读者。

**Interfaces（W4产出，W5沿用）:**

```ts
type WebSessionState = {
  ref: ModelRunRef; counters: WebSearchCounters;
  metrics: WebSessionMetrics; nextOperationOrdinal: number;
};
type WebMaterialMetadata = Omit<WebMaterial,'body'> & {
  firstOperationId: string; provided: boolean;
};
// WebSearchStore:
state(runId: string): WebSessionState;
checkpoint(runId: string): WebModelCheckpoint | null;
materialMetadata(runId: string, url?: string): WebMaterialMetadata[];
materials(runId: string, ids?: readonly string[]): WebMaterial[];
// WebSearchSession增加 state(), checkpoint(), operation(operationId), materials(ids?)。
// W4的operation沿用WebOperationRecord；W5替换为不含body的WebOperationState。
```

`state` SQL只投影ref/counters/metrics/ordinal；`checkpoint`只投影checkpoint；`materialMetadata`只投影元数据，不能选整条data再JSON.parse。`materials`一次查询指定run全部材料或IDs，返回持久插入顺序；ids=[]返回[]，不能解释为全部。`snapshot()`仍是显式完整诊断接口，W4不删除它。增加非唯一表达式索引 `web_materials_run_url` on `(json_extract(data,'$.runId'),json_extract(data,'$.material.url'))`，只在正常可写Store构造安装；只读检查不安装。

- [x] **写读放大回归。** `control_reads_parse_zero_body_characters` 使用已落盘20×100000字符材料和大checkpoint；对JSON.parse输入中专用正文标记统计，不统计测试自身解析；调用state、materialMetadata、providedUrls、quota判断、markProvided。断言计数正确、正文JSON.parse字符=0、`snapshot`调用=0。`mark_provided_updates_only_flags_and_source_metadata`断言材料body/hash/readAt与firstOperationId不变，重复调用只1条本人来源；未知ID事务不部分登记。
- [x] **写原子性回归。** `commit_step_uses_url_metadata_and_rolls_back_atomically`：注入op保存失败，材料/计数/confirmedSteps全部回滚；确认同一步两次、同URL新read op都只计1次成功。`completed_operation_replay_uses_current_counters`：后续已读更多页面，再重放旧op，正文/停止原因仍旧结果，counters是当前累计值，provider=0。`organize_loads_source_materials_once_per_run`构造同run两个实际本人来源和未提供材料，断言snapshot=0、materials查询1次、输出sourceId/material绑定及原顺序不变、无未提供材料串入。
- [x] **跑红。** `npx vitest run tests/web-light-state.test.ts tests/web-store.test.ts tests/web-model-tools.test.ts tests/web-memory-sources.test.ts`；基线无轻量接口／仍解析正文。
- [x] **实现SQL控制通道。** quota、target、URL查重和providedUrls改用投影。beginOperation只原子增加ordinal；incrementMetric只更新相应JSON字段；commitStep原子更新计数/操作/材料；markProvided用SQL json_set标志而不重写正文；所有session更新不经 `SELECT data`把大checkpoint带回JS。SQL JSON函数在SQLite内部解析仍计作存储工作，不宣称其耗时为零。
- [x] **实现调用方改用窄接口。** ModelClient启动只读一次checkpoint；perform直接取单op，每轮state+materials，不扫描operations；环境startOne/invalidate及旧runtime的repair读取改用checkpoint。organize的privateLookup读取改用checkpoint，selfWebReadSources先按runId聚合materialIds，再每run调用一次materials(ids)，最终按原source顺序绑定。`rg -n '\.snapshot\(' src/web src/model src/environment src/memory/organize.ts`检查热路径只剩显式诊断定义，不能留下“为读一个字段先inflate全部”的包装。
- [x] **跑绿。** 同定向命令＋`npx vitest run tests/web-session.test.ts tests/web-recovery.test.ts tests/environment-async-tools.test.ts tests/environment-async-provenance.test.ts tests/web-status.test.ts`、`npm run typecheck`。20/40、cacheHits/provider calls、lookup/repair/provided资格不变。
- [x] **提交。** `perf: project web control state without body snapshots`。这一提交保留旧JSON格式，允许单独发布；W5成本目标不能算作W4成果。

## W5：正文引用 v2、旧任务恢复与显式迁移

### W5.1 持久化与内存接口

**Files:** 新 `src/web/persistence.ts`；修改 `src/web/types.ts`、`store.ts`、`service.ts`、`src/model/client.ts`、`src/model/resource-pool.ts` 及所有checkpoint类型使用方；新增 `tests/web-persistence-v2.test.ts`、扩展 `tests/web-recovery.test.ts`、`tests/web-model-tools.test.ts`、`tests/resource-pool-index.test.ts`。

**Interfaces:** `WebToolResultRef=Omit<WebSearchResponse,'materials'> & {materialIds:string[]}`；`WebOperationState=Omit<WebOperationRecord,'response'> & {formatVersion:2;response:WebToolResultRef|null}`。新的 `WebModelCheckpoint` 有 `formatVersion:2`，其 `toolResults:WebToolResultRef[]`，其他字段保持原类型、可选性和含义。`LegacyWebModelCheckpoint`／`LegacyWebOperationRecord`完整保留旧读取类型；无formatVersion视为v1，不能把已有repair/input/lookup删掉。`store.operationState(runId,id)`及`session.operation(id)`只返回引用；`store.operation`与`snapshot`作为兼容诊断可显式hydrate，不得在控制热路径调用。

`persistence.ts`负责纯转换：`toResultRef(response:WebSearchResponse):WebToolResultRef`、`decodeCheckpoint(value:LegacyWebModelCheckpoint|WebModelCheckpoint):WebModelCheckpoint`、`decodeOperation(value:LegacyWebOperationRecord|WebOperationState):WebOperationState`、`hydrateResult(ref:WebToolResultRef,materials:ReadonlyMap<string,WebMaterial>):WebSearchResponse`。`saveCheckpoint`接收新类型；旧格式仅由测试文件内的raw SQL夹具写入，不新增生产用saveLegacyCheckpoint入口，也不让新写悄悄写v1。

`store.beginOperation(runId,request,guard?):WebOperationState`、`saveOperation(record:WebOperationState):void`以及session.beginOperation同步更新返回类型。`finishOperation(runId,id,response:WebSearchResponse):void`接完整工具响应并仅保存ref；`store.operation(runId,id):WebOperationRecord`、`snapshot().operations`维持显式hydrate后的诊断形状。返回给工具调用者的 `WebSearchResponse`仍有完整materials，不改变供应商/模型的现有公开合同。

**新旧 JSON（示例中的短body仅示意，不是正文截断策略）:**

```json
{
  "legacyOperation": {
    "operationId": "r:op:0", "runId": "r", "request": {"kind":"read","url":"https://example.test/a"},
    "candidateUrls": ["https://example.test/a"], "nextCandidateIndex": 1, "status": "done",
    "materialIds": ["m"], "failures": [], "confirmedSteps": [0],
    "response": {"materials":[{"id":"m","url":"https://example.test/a","title":"A","body":"全文","readAt":"2026-10-11T00:00:00Z","bodyCharacters":2,"selectionMode":"full_body","sourceKind":"external_reference"}],"counters":{"successReads":1,"failures":0},"stopReason":"satisfied","failures":[],"requestedPages":1,"obtainedPages":1}
  },
  "operationV2": {
    "formatVersion": 2, "operationId": "r:op:0", "runId": "r", "request": {"kind":"read","url":"https://example.test/a"},
    "candidateUrls": ["https://example.test/a"], "nextCandidateIndex": 1, "status": "done",
    "materialIds": ["m"], "failures": [], "confirmedSteps": [0],
    "response": {"materialIds":["m"],"counters":{"successReads":1,"failures":0},"stopReason":"satisfied","failures":[],"requestedPages":1,"obtainedPages":1}
  },
  "checkpointV2": {
    "formatVersion": 2, "input": {"business":"保留原业务输入"}, "repairCount": 1,
    "lookupUsed": true, "lookupRequest": "原查询", "lookupPending": false,
    "privateLookupResult": {"fact":"原冻结结果"},
    "repair": {"original":{"bad":1},"errors":"原格式错误"},
    "pendingOperationId": null,
    "toolResults": [{"materialIds":["m"],"counters":{"successReads":1,"failures":0},"stopReason":"satisfied","failures":[],"requestedPages":1,"obtainedPages":1}]
  }
}
```

旧checkpoint没有formatVersion，toolResults每项是上述legacy response。session外层仍含ref/counters/metrics/nextOperationOrdinal/checkpoint；不另改runId或ordinal。`web_materials`保持 `{runId,material,firstOperationId,provided}`，主键仍`${runId}:${material.id}`，它是该阶段网页正文唯一结构化持久位置；B缓存跨阶段仍允许各阶段独立材料行，不新建全局共享正文表。operation与checkpoint中不存网页body副本。业务input、lookup、repair.original如果本身含业务引用或模型文字，不做字符串替换／删减，不能把“任意同文字只存一次”当承诺。

- [ ] **写v1/v2互操作测试。** `legacy_checkpoint_preserves_pending_lookup_repair_and_results`、`v2_operation_and_checkpoint_store_refs_only`、`mixed_v1_v2_stage_reopens_without_provider_replay`。直接插入基线JSON夹具（不是先经新save接口造“旧数据”）；重开文件库，断言所有状态字段相同、op/step ID不变、已有正文0次新provider读取，原始web_operations与checkpoint.toolResults无materials/body字段，web_materials正文逐字相同。
- [ ] **写崩溃窗口测试。** `done_operation_pending_checkpoint_replays_once_after_reopen`：op已done而cp.pending仍指向它，恢复只追加一次toolResult、pending清空、计数不变；`partial_operation_reopens_at_first_unconfirmed_candidate`沿原2成功/1失败夹具，只读余下候选；`pending_lookup_is_reexecuted_but_confirmed_lookup_is_not`断言未确认补查1次、已确认0次；`repair_budget_survives_v1_upgrade`保留repairCount=1/原error/lookupUsed。
- [ ] **写权限与模型等价测试。** `v2_completion_envelope_matches_legacy_material_pool`对相同输入比较完整envelope；materialIds顺序、结果不足/message、requested/obtained、当时toolResults counters保持旧值；旧done操作直接重放的外层counters继续使用当前值。`failed_transport_never_marks_refs_provided`及成功但格式错误路径保持W4合同；冻结发送恢复0次模型/搜索。
- [ ] **跑红。** `npx vitest run tests/web-persistence-v2.test.ts tests/web-recovery.test.ts tests/web-model-tools.test.ts`，新format和引用断言失败；不把未知版本类型报错作为唯一回归。
- [ ] **实现编解码与轻量模型状态。** 新写只v2，读取v1可转换但只在checkpoint/operation显式读取时，state等轻量接口不触发转换/hydrate/落库。ModelClient单次run启动载入该阶段materials一次到局部Map；每次工具响应把新材料合入；checkpoint只保留refs，transport前用同一个Map装配完整webResults/webMaterials，无重复SQL载入旧正文。run结束或异常Map自然释放，不跨run缓存私有lookup；同一run内格式修补和lookup复用该Map。
- [ ] **实现新旧使用方接线。** 环境repair重置只改新checkpoint对应字段；generation invalidation继续保留网页操作及toolResults，清原private lookup并设lookupPending的逻辑不变。hydrate缺失ID以具体run/ID错误停止恢复，不重新搜网页补“同一”事实；合法基线通过下节迁移预检保证不产生该情况。已有诊断snapshot输出新cp类型，更新明确深等旧cp的测试预期。
- [ ] **跑绿。** 上述测试＋`npx vitest run tests/web-store.test.ts tests/web-session.test.ts tests/web-memory-sources.test.ts tests/environment-async-tools.test.ts tests/environment-async-provenance.test.ts tests/incoming-image-model.test.ts tests/memory-payload-compaction.test.ts`、`npm run typecheck`。再用`rg -n 'toolResults|saveCheckpoint|snapshot\(' src scripts tests`完成所有读写者清点。
- [ ] **提交。** `perf: persist web tool bodies by material reference`；该提交可离线审阅，但生产发布必须与W5.2的备份回退说明一起交付。

### W5.2 存量格式迁移、回收与回退

**Files:** 新 `src/web/payload-migration.ts`、`src/deployment/web-payload-migration.ts`、`scripts/migrate-web-payloads.ts`、`tests/web-payload-migration.test.ts`、`tests/web-payload-migration-cli.test.ts`；修改根 `package.json` 增加 `web:migrate-payloads`，修改README和网页／恢复文档。不要混入运行时计划对 `memory:compact-payloads` 的环境摘要改动。

**Interfaces:** `inspectWebPayloads(db:PayloadConnection):{legacySessions:number;legacyOperations:number;invalidReferences:Array<{runId:string;materialId:string}>}`；`migrateWebPayloadBatch(db:PayloadConnection,limit=50):{sessionsVisited:number;operationsUpdated:number;checkpointsUpdated:number;hasMore:boolean}`，limit限定每批最多50个存在v1残留的run，不按正文数变小计数。deployment包装 `migrateWebPayloads(path,options:{stopped:boolean;batchSize?:number;maxBatches?:number;backupDirectory?:string})`，默认maxBatches=20，返回before/after/batches/hasMore/backupPath/updated及formatVersion=2。

选择残留条件是operation缺formatVersion或非空checkpoint缺formatVersion（空checkpoint不算）。每个run在事务内验证其op/cp的materialIds存在于同run材料表，先比较旧embedded material与表内相应material全部字段，再写v2；不匹配就回滚并报runId，不猜正文、不改counters。复制工具结果时保持精确metadata和顺序。每批事务由deployment包装；批中任何失败回滚本批，早前批可复跑，第二次完成后updated=0/hasMore=false。无schema version强制跃迁，不启动时全库扫描，也不在只读inspect安装索引。

- [ ] **写迁移回归。** `migration_preserves_all_owner_states_and_material_bytes`含turn/maintenance/asset/environment及pending/running/done混合；对材料、来源、counter、op位置、lookup/repair做迁移前后深比较。`migration_interruption_resumes_by_residual_format`注入第二批中途异常，第一批保留、第二批全回滚，重跑不重复计数。`migration_dry_run_has_zero_writes`用只读连接/触发器检查0写。`migration_ref_mismatch_rolls_back_whole_batch`验证明确错误，不改变原记录。
- [ ] **跑红。** `npx vitest run tests/web-payload-migration.test.ts tests/web-payload-migration-cli.test.ts`。
- [ ] **实现显式停服工具。** 只接受显式db路径；默认dry-run，`--apply`必须`--stopped`；沿已有部署工具在首次写前备份db/-wal/-shm到唯一目录并返回backupPath，不覆盖原备份。正整数校验、`--batch-size 50 --max-batches 20 --backup-dir <path>`、非法组合exit1；不自动停服、不访问模型／browser。只有输出hasMore=false且复检legacy counts=0才表示迁移完成。
- [ ] **验证命令。** 对新建合成库运行 `npm run web:migrate-payloads -- .tmp/web-remediation/legacy.sqlite --dry-run`，然后 `npm run web:migrate-payloads -- .tmp/web-remediation/legacy.sqlite --apply --stopped --batch-size 2 --max-batches 1 --backup-dir .tmp/web-remediation/backups`，持续复跑到hasMore=false；测试证明源备份可重开且包含原v1、正文/计数不变、二次完整apply更新0条。只跑本任务生成的fixture路径。
- [ ] **记录回收边界。** v1→v2仅去operation/checkpoint网页副本，不清web_materials。终态checkpoint的整体清除仍走现有 `memory:compact-payloads`；pending/running/ready待提交与failed/stopped可恢复任务不清。asset没有可靠终态行，禁止按ownerType或时间推断旧import已结束；当前W2成功／失败finally可收尾自己的owner，历史asset checkpoint只能保留或另行用户明确选定，不在此自动删除。
- [ ] **记录部署／回退。** 先停故事并备份，部署能读v1/v2的新代码，按显式路径迁移，离线恢复夹具验证后才由外层部署流程启用；即使未执行全库迁移，新代码运行新写也会出现v2。旧二进制不认识v2，回退必须恢复配套停服备份与旧代码，不能只git checkout旧代码继续写升级库；恢复备份会舍弃备份后的新业务，交接必须说明，不做自动逆向重构。
- [ ] **跑绿并提交。** 两个新测试文件＋W5.1恢复文件通过；`npm run typecheck`；提交 `feat: migrate legacy web payload references offline`。

### W5.3 成本与整体合同验收

**Files:** 新 `tests/web-payload-cost.test.ts`、`scripts/measure-web-payloads.ts`；输出未来交付目录（不覆盖审核evidence）的 `web-payload-cost.json`。

- [ ] **写可确定的成本断言。** 固定1/5/10/20页，每页100000 ASCII字符＋专用唯一标记，假模型依次read再final。`fresh_tool_loop_parses_each_saved_body_at_most_once`断言热路径snapshot=0、控制方法正文parse=0、整个新会话正文JSON.parse输入字符不超过唯一正文的2倍＋每页4096字符元数据余量；该阈值是待验证预算，不是声称已测得。20页原2M正文场景，operation.response和checkpoint.toolResults中body字段数=0，web_materials共20份完整正文。同run恢复只从材料表读一遍；provider不会重读已确认页。
- [ ] **跑红后完成必要修正。** `npx vitest run tests/web-payload-cost.test.ts`；只修仍重复物化的路径，不通过减少tool调用、截短输入或少给模型资料达标。记录JSON.parse/body reads/stringify字符、operation/session/material各表UTF-8 bytes、模型envelope累计字符和耗时；JS字符与SQLite UTF-8 bytes分列。
- [ ] **对比语义和成本。** 同fixture跑基线代码副本与新代码，materials hash、counters、provider calls、模型调用数、完整envelope逐请求等价（新增持久化版本字段不进入模型）；仅持久化与本地重复解析变化。将观测值写报告，耗时无硬毫秒门限，不能用单次抖动宣称倍数。
- [ ] **提交。** `test: bound web payload work without changing model context`；W5三节全绿后才能报告WM-O1已完成。

## W6：观察范围共享图片读取与惰性编码

**Files:** 修改 `src/input-media/assets.ts`、`src/input-media/service.ts`；扩展 `tests/incoming-media-assets.test.ts`、`tests/incoming-media-turn.test.ts`、`tests/incoming-image-model.test.ts`，新增 `tests/incoming-media-asset-lease.test.ts`。`src/deployment/plugin-runtime.ts` 现有 `ref=>mediaAssets.resolveImageAsset(ref)` 回调签名不改。

**Interfaces:** `IncomingAssets.acquireImageAsset(ref:string):Promise<{release():void}>` 增加引用计数租约；private map按ref共享一个正在读／已读的Buffer与可选dataUrl，最后一个release清除两者，release幂等。`resolveImageAsset(ref:string):Promise<string>` 若已有租约就复用Buffer并首次惰性编码；无租约时自己acquire、编码并finally release，保留独立调用兼容。租约期间纳入现有uses，`retire`不得删除。`ensureAsset`已ready分支只确认资产记录并返回ref，不再为可用性单独readFile；实际完整可读检查由acquire的一次readFile完成。

`IncomingMediaService`冻结pending后、查同hash观察缓存前acquire；取得租约立即进入try/finally，try首行检查signal，包住cache分支、共享observations promise、observe/model修补与工具续调用，finally释放，确认观察落库前再次检查signal。冻结ready/unrecognized和confirmed历史仍原早退，不碰原图。pending即使关闭新图开关或已有同hash观察仍acquire验证冻结ref，缺失文件仍报错且不能写ready／改查新的sourceUrl。data URL不进数据库、checkpoint、普通文字context或跨观察全局长期缓存。

- [x] **写定量回归。** `ready_asset_one_read_one_encoding_per_observation`用1,000,008字节合成PNG，真实prepareForTurn→ModelClient→ChatCompletionsTransport配假fetch；断言完整readFile=1、base64编码=1、模型请求=1、data URL=`'data:image/png;base64,'+bytes.toString('base64')`，释放后active leases=0。用模块mock计I/O与编码，不把测试期望自身toString计入。
- [x] **写续调用／缓存测试。** `image_tool_repair_roundtrip_reuses_payload_lease`多次transport仍只1读1编码；`cached_observation_validates_pending_ref_without_encoding`断言1读0编码0模型；`missing_pending_asset_never_becomes_ready_from_cache`断言报错、pending保持；`frozen_ready_needs_no_image_file`删除可清理文件后读取既有观察仍0读。
- [x] **写并发释放测试。** `concurrent_same_hash_leases_share_bytes_and_protect_retire`用两个attachment同hash、可控read/观察promise；1次读取，任一未释放retire=false，最后释放且业务保护解除才可retire。`observation_failure_and_stop_release_payload`对模型reject/取消/格式限额分别断言释放，后续恢复可重新读取且不复用已释放URL；graceful stop等待在途观察完成，关库后写入0。
- [x] **跑红。** `npx vitest run tests/incoming-media-asset-lease.test.ts tests/incoming-media-assets.test.ts tests/incoming-media-turn.test.ts tests/incoming-image-model.test.ts`，基线重复resolve/编码或无租约断言失败。
- [x] **实现租约。** 用现有jobs/saves/deleting/uses机制衔接；先占uses再异步read防删除竞态，read失败回滚引用且map移除，等待删除结束后重新检查ready。每个持有者自己finally释放，不能把共享promise首个调用者的finally作为所有人释放点；无新增byte长度／token限制，不改变识别版本。
- [x] **跑绿并提交。** 同命令＋`npx vitest run tests/incoming-media-cleanup.test.ts tests/incoming-media-onebot-review.test.ts`和`npm run typecheck`；提交 `perf: share image bytes within observation leases`。报告实际读/编码次数，不声称验证真实视觉效果。

## W7：环境终态 owner 在旧工作结算后统一收尾

**依赖与分工:** R4a先独立提供并接线 `compactTerminalEnvironmentStep(step:EnvironmentStep,at:string):EnvironmentStep|null` 及 `EnvironmentPreparation.private compactTerminalPayload(stepId:string,now:string):void`；只压缩其允许的v1终态，v0保持原准备载荷。R4a不调用尚未实现的finalizeOwner；W7随后替换其终态调用点，把正文压缩和网页清理协调到同一路径，技术依赖严格为R4a→W7。本批按主入口采用R4a→R4b→W7的执行顺序。pending/重试/stop/generation invalidation不是terminal，不调用finalize。

**Files:** 修改 `src/web/service.ts`、`src/web/store.ts`、`src/environment/preparation.ts`、`src/environment/runtime.ts`；新增 `tests/web-owner-finalization.test.ts`、`tests/environment-web-finalization.test.ts`，扩展 `tests/environment-async-host.test.ts`、`tests/environment-async-recovery.test.ts`、`tests/environment-async-boundaries.test.ts`。既有历史checkpoint回收已在 `src/memory/payload-compaction.ts` 覆盖committed/superseded，不另写第二个compactor。

**Interfaces:**

```ts
// WebSearchService
finalizeOwner(ownerType: ModelRunRef['ownerType'], ownerId: string): Promise<void>;
// WebSearchStore：SQL只投影ref.runId，不加载session/checkpoint
ownerRunIds(ownerType: ModelRunRef['ownerType'], ownerId: string): string[];
// EnvironmentPreparation：私有，tracked cleanup队列
finalizeTerminalOwner(stepId: string): Promise<void>;
scheduleTerminalFinalization(stepId: string): void;
```

service按 `store.ownerRunIds` 收集已入队locks，等待allSettled后 `releaseOwner` 再 `compactOwnerCheckpoint`；同owner并发调用共用一次finalization promise，完成即删临时map。不是永久关闭owner的全局墓碑，也不把失败锁当作拒绝清理原因；真正checkpoint压缩写失败要通过调用者errors渠道保留。调用前业务层必须已确认owner终态且不再产生新写：web locks仅覆盖网页operation，不能代替等待整个旧environment execution。

`finalizeTerminalOwner`重读step，只接收committed/superseded且同step不再active；同步调用运行时的compactTerminalPayload，再await web.finalizeOwner。`scheduleTerminalFinalization`记录Promise到Set，catch进入已有errors队列，finally移除并onReady；不能无人观察reject。reconcile/applyReady前台只schedule，不await该Promise；wait/stop以及 `runEnvironmentStep` 内临时preparation的退出显式排空Set，不能在cleanup未结束时关闭Storage。

- [ ] **写service级测试。** `finalize_owner_waits_for_queued_operation_then_releases_cache`暂停provider read，先finalize后resolve；结算前checkpoint保留，完成后cache owner不存在、checkpoint=null，materials/operations/counters/来源全保留；重复finalize不增加UPDATE（已NULL不写）。另一owner缓存仍可命中，保证隔离。
- [ ] **写跨日迟到测试。** `superseded_execution_cannot_repopulate_owner_after_finalization`：旧step取得一页后第二操作挂起，跨日reconcile使superseded；active未settle前准备载荷和checkpoint保留；迟到provider返回受signal/guard拒绝，旧execute/catch/finally结算后清cache和checkpoint，计数不加迟到页，新batch状态未被旧任务覆盖。
- [ ] **写所有入口测试。** `expired_ready_step_schedules_cleanup_before_stale_return`覆盖applyReady的过期早退；`reconcile_cleans_non_active_superseded_owners`覆盖没有active执行的旧ready/pending owner；`committed_owner_uses_same_finalizer`覆盖正常提交；`scheduler_supersede_is_observed_by_preparation`覆盖调度已先将batch标terminal的顺序，不能只依赖firstActiveBatch还能查到旧批次。
- [ ] **写非终态和前台时序测试。** `stop_retry_and_generation_invalidation_preserve_recovery`断言pending/retry/stopped/current generation继续保留；`foreground_pump_does_not_wait_for_terminal_web_drain`挂起旧provider、输入新前台消息，前台selection/模型调用可继续；`host_stop_waits_for_finalizers_before_storage_close`断言终态cleanup写在close前，无unhandled rejection。
- [ ] **跑红。** `npx vitest run tests/web-owner-finalization.test.ts tests/environment-web-finalization.test.ts tests/environment-async-host.test.ts tests/environment-async-recovery.test.ts tests/environment-async-boundaries.test.ts`；当前跨日owner cache/checkpoint留存的断言失败。
- [ ] **实现终态发现与结算。** 复用R4a的 `observedStepIds`（startOne、reconcile/applyReady见过的active批次step IDs），不新建第二份集合；每次reconcile检查这些ID的终态，这覆盖scheduler先supersede，不扫描全历史。R4a原“压缩后删除ID”改为成功finalize后才删除，失败仍保留待显式恢复，集合不能变成历史墓碑。旧execution.finally先清active再schedule，它本身不await包含自身的cleanup集合，避免自等；正常applyReady成功和两种stale早退都schedule相应terminal IDs。running旧任务必须等其promise结算才压缩，不能abort时立即清正文。旧v0串行runtime在明确terminal返回处await web.finalizeOwner，但不调用v1正文压缩。
- [ ] **实现wait/stop与存量边界。** `wait()`等待已在途execution后再循环drain cleanup Set，包含finally新入队工作；`stop()`同理，pending abort本身不触发finalize。临时preparation在applyReady后await wait。冷启动进程无旧cache，历史terminal checkpoint由显式停服compactor处理；不在启动追加全历史正文扫描，不自动清未完成checkpoint。
- [ ] **跑绿并提交。** 同命令＋`npx vitest run tests/environment-payload-compaction.test.ts tests/web-recovery.test.ts tests/environment-async-tools.test.ts tests/memory-payload-compaction.test.ts`，`npm run typecheck`；提交 `fix: finalize terminal environment web owners after settlement`。

## 本分计划交付门

- [ ] W1～W7各任务均有修复前失败、修复后通过和实际提交；checkbox只能由执行证据更新，本次不预勾。
- [ ] 在工作区创建独立TEMP/TMP目录后运行本计划定向测试和 `npm run typecheck`，集成阶段再按主计划跑一次全量、隔离outDir构建及demo。浏览器仅合成页面、CLI仅fake供应商；受权限限制的skip/失败单列，不能改成产品全绿。
- [ ] `git diff --check`通过；交付记录逐项映射B2/B3/B5/WM-O1/WM-O2/WM-O3到测试与变更，明确旧损坏网页未自动恢复、迁移新旧代码回退配对、真实网页／视觉质量未在线验收。
- [ ] 文档同步网页v2引用、恢复／迁移命令和图库CLI能力；历史审核证据保持原样，交付测量写新目录。未执行正式迁移／服务启停时明确写“未执行”。
