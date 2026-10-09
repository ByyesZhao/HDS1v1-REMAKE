# 给 SOL 的执行与验收指南

日期：2026-10-09。状态：**修订方案已成稿，产品功能未实施**。本包基于 `4fe090c0e2acfe2b137854db7a55de86afcc9036`，落实 [PLAN_REVIEW](../../reviews/image-input-local-search-20261009/PLAN_REVIEW.md)。返回[入口](README.md)。

## 1. 直接交接的工作指令

按本目录的修订 DESIGN、IMAGE_INPUT_PLAN、LOCAL_SEARCH_PLAN 实施。先交付 I1～I6，再做 S1～S5；每项先写行为失败回归、确认跑红、实现、跑绿、提交，并把实际文件／命令／结果记入对应批次记录。

已有设计决策以[修订 DESIGN](DESIGN.md)为准；原 review 的失败探针用于固定回归，不能当现成实现复用。无需重新讨论“图片到底采用哪条架构”。有代码基线差异时先核对差异，再局部适配；不重新设计整个调度或模型系统。

本次用户请求是出执行文档，**本轮没有启动产品实施**。SOL 接到实施指令后，依实际授权执行代码／依赖／隔离验收；真实视觉模型验收和正式部署各自记录范围。不要把过往批次的正式库升级授权当成本批自动启用新功能的指令。

## 2. 开始前与提交边界

1. 读本指南 → DESIGN → IMAGE_INPUT_PLAN／LOCAL_SEARCH_PLAN → 原 review。核对 git status、HEAD、当前源码；保留已有用户修改。
2. 当前修订可能尚未提交。若创建 worktree，先确保完整修订包进入实施分支：提交这批文档或复制并核对 [修订自查](evidence/revision-self-review.json) 所列文件；不能在只有 `4fe090c` 原稿的新 worktree 中照旧执行。
3. 使用已有适合的隔离工作区；需要新分支时用 `codex/` 前缀。开发库、媒体目录和 Koishi Context 必须是合成／临时实例。
4. 测试允许 mock 模型和浏览器端口，但同时保留真实 ModelClient 序列化、真实 SQLite 重开、真实 Koishi Context 注入测试；不能把最容易出错的接缝全部 mock 掉。
5. 只暂存本任务具体文件；每个 I／S 子步骤的建议提交名见相应计划。任务规模可细分，合同、编号及验收归属不漂移。
6. 每批最终构建及验收之后若有功能修改，重跑受影响验证及必要全量门禁；只改交付文案无需重复跑全量产品测试。记录声明与真实命令一一对应。

不改变：12 个 models.* 连接、1 个 stickerDescriptionModel 连接、各自强度／输出模式、现有向量连接、15 秒／共同 60 秒节奏、4 段原文窗口默认值、20／40、环境准备／串行提交和前台串行。新增 incoming_image 是新用途，可复用旧连接，不把“用途数”误写成“独立连接数”。

## 3. 执行依赖和可检查产物

| 顺序 | 完成条件 | 给下一步的产物 |
| --- | --- | --- |
| I1 | 当前消息解析及附件／段／时钟同事务；旧输入回归通过 | 稳定附件、contentParts、三表及索引 |
| I2 | 实际字节资产、QQ face、合格缓存，旧图库不改 | assetRef resolver 和内容查询 |
| I3 | 独立四字段观察，真实 image_url，旧模型配置兼容 | observeIncomingImage 及可选连接 |
| I4a | 普通／共享读取资格，逐图 pending／terminal，冻结不丢 | prepareForTurn 与历史关联 |
| I4b | 最终 envelope 的 recent／活动／lookup 观察，去重保位置 | withTurnVisualContext 包装器 |
| I5a | 磁盘恢复、来源、文件保护、停机排空 | 可恢复媒体生命周期 |
| I5b | check 真实使用显式 config／database 路径，所有分支只读 | 可复用隔离启动检查 |
| I6 | 图片批全量离线验收及交付记录 | 可独立合入的图片能力，默认关闭 |
| S1 | 预约到实际关闭的单槽，迟到资源和 dispose | 可用于隔离浏览的 port／slots |
| S2a | 引擎候选＋主体的同一提取代码，完整 provider 接口 | S5a 可运行的真实路径 |
| S5a | 至少一个公开引擎真实候选＋候选正文成功，页面排空 | 浏览器可行性证据；失败先处理原因 |
| S2b | 空态／动态／正文／访问墙反例全部固定 | 版本化提取器 |
| S3 | 原工具 20／40、缓存／恢复／来源规则不变 | browser provider 与工具闭环 |
| S4 | required 服务就绪和单实例关闭／重装配 | 可启动的插件装配、静态预检 |
| S5b | 搜索批完整离线＋公开浏览验收，清楚标明未测层 | 可独立合入的搜索能力，按部署范围启用 |

两批都保留独立交付记录。I6 不等 S5b 才算图片开发完成；S5a 暂时失败也不回滚已交付的图片功能。

新增选择已经裁定，SOL 不必自行二选一：

- 持久化加 image_assets，避免多个附件重复管理同一文件；旧 image_observations 内容不可变。
- 历史装载使用权限投影后的 ModelRunner 包装，lookup 支持已投影 StageModelInput；不用在 Transport 里扫库。
- 旧混合图库描述首轮重新观察，不自动拆分／重嵌入 67 项描述。
- BrowserPageSlots 直接拥有 open/read/close；managed provider 必有 stopAccepting 和可等待 dispose。
- 正文用 article／main，语义容器缺失再用 Readability；没有全页 body 成功回退。
- 首批只有 Bing／DDG HTML，先实际浏览再完整集成，不带 RSS 或自动跨引擎。

## 4. 可重复的隔离验收

### 4.1 补齐一次性夹具生成器

在 I6 增加 `scripts/prepare-feature-check.ts`，测试 `tests/feature-check-fixture.test.ts`；搜索批复用，不再复制另一个工具。I6 先实现 image／verify，S4 增加 search 模式。最终 CLI：

```text
npx tsx scripts/prepare-feature-check.ts --mode image|search --output <absolute-directory>
npx tsx scripts/prepare-feature-check.ts --verify <absolute-directory>
```

必须先写测试，确认生成／verify 失败后实现，并运行 `npx vitest run tests/feature-check-fixture.test.ts` 转绿。脚本基于 examples/story.sample.json 构造完整合成配置：替换人物背景／示例文本，清掉 backgroundFile、backgroundViewsFile、calibrationFile 等外部引用，模型及嵌入凭据环境变量使用夹具专属名字。不得读取 config.local.json、正式 key.txt 或正式数据库。

产物固定为 story.json、story.sqlite、koishi.yml、no-network.cjs、paths.json、before-check.json。用 Storage 和 MemoryStore 的现有初始化／migrate／migrateCapacity 接口创建当前版本的临时空库；不用复制正式库。使用固定合成时间与必要初态，确保 shared／dialogue／memory／environment 版本检查实际运行；若 check 增加某个版本检查，夹具同步真实初始化，不绕过检查。

image 模式开启 visualInput、关闭 webSearch；search 模式同时开启 visualInput 与 browser provider。search 模式在 S4 才要求通过检查。两种模式 stickersEnabled=false，图库开启路径另由 I5b 单测覆盖。koishi.yml 在 search 模式仅声明隔离检查所需启用 Puppeteer，不能引用正式配置。no-network.cjs 在**当前子进程**设置合成凭据并令 global.fetch 抛“offline fixture forbids network”；它不启动任何插件。

before-check 保存 story.json／story.sqlite 的摘要和 SQLite schema 摘要；--verify 比较它们，确认 check 没写数据库或配置，失败返回非 0。生成器拒绝覆盖已有非空输出目录，不默默清理任何未知目录。

### 4.2 每批门禁命令

从实现工作区根目录依次执行；每条成功才执行下一条，真实日志分别保存到对应 records 目录。下面命令中的生成器及 check 参数是**I5b／I6 待实现产物**，不是声称当前仓库已经可运行。

```powershell
npm run build
npm run typecheck
npm test
npm run demo

$featureCheckRoot = Join-Path $env:TEMP ("hdsi-feature-check-" + [guid]::NewGuid().ToString("N"))
npx tsx scripts/prepare-feature-check.ts --mode image --output "$featureCheckRoot"
node --require "$featureCheckRoot/no-network.cjs" runtime/check.cjs --config "$featureCheckRoot/story.json" --database "$featureCheckRoot/story.sqlite" --koishi-config "$featureCheckRoot/koishi.yml"
npx tsx scripts/prepare-feature-check.ts --verify "$featureCheckRoot"

npm run smoke --prefix runtime
```

搜索批将生成器的 `--mode image` 改为 `--mode search`，其余顺序相同。上述 node 命令运行的就是 `npm run check --prefix runtime -- --config ... --database ... --koishi-config ...` 对应入口，额外预加载禁止联网的夹具，避免把真实凭据或网络用于离线检查。

PowerShell 不会自动因上条外部命令失败停止；执行者必须检查每个退出码，记录第一次失败并修复，不能只看最后一条 exit 0。先 build 是因为已有测试及插件脚本消费 lib；后 build 不能替代先前使用旧 lib 的测试结果。

图库开启、未启用视觉、搜索关闭无依赖、显式路径不存在、旧只读库无新表等分支由对应测试覆盖。双场景 smoke 的原验收保持，新增图片／浏览器夹具不能删除原场景以换取通过。

### 4.3 在线层的判定

| 层 | 验收内容 | 通过不能证明什么 |
| --- | --- | --- |
| 离线 | 真实序列化／SQLite／Koishi 接缝，模型和浏览内容 mock | 不能证明真实图片质量或引擎可达 |
| S5a／S5b 公开浏览 | 隔离浏览器、固定公开查询、候选正文及资源排空 | 不证明真实模型工具续调用质量、所有网站稳定性 |
| 视觉在线 | 公开／合成图片与实际所选连接，描述／OCR／不确定性 | 不证明私人聊天图片或 GIF 全帧理解 |
| 模型搜索续调用在线 | 实际模型选择工具、材料返回后继续生成 | 不等于正式 QQ 长期运行 |
| 正式部署 | 备份、配置、版本检查、实际授权的启用操作 | 不自动补齐未跑在线质量项目 |

图片在线单请求保护 300 秒；搜索单页面操作默认 60,000ms，排队包含在内。报告分别给调用方结束时间和页面排空时间。长 close／factory 不结算的实例不能通过 drain 验收，更不能声称已可安全重装配。

## 5. Review 逐项关闭映射

“设计已落实”只是下面映射成立；“产品问题已关闭”需要 SOL 的代码和新测试证据。原 review 行号继续指向 `4fe090c` 原稿，不能用当前文档行号否定旧报告。

| 项目 | 设计与实施位置 | 产品关闭必须看到的证据 |
| --- | --- | --- |
| R1 历史观察 | DESIGN §2、4；I1／I4b／I5a | 两轮且首轮无记忆；磁盘重开；ordinary narrative／personal／expression／活动／lookup 有正确观察；窗口排除；视觉额外调用 0 |
| R2 服务就绪 | DESIGN §6.2；S4 | 真实 Context 两种注册顺序；缺配置／启动失败；服务移除重来；Host 与 Storage 不重叠 |
| R3 真正页槽 | DESIGN §6.1；S1／S4 | 延迟 close、迟到 factory、取消与 waiter、dispose；实际活页 ≤ 1，未决资源不被抹掉 |
| R4 DOM 依据 | DESIGN §5.2～5.3；S2／S3／S5 | 导航壳、查询含 no results、main、验证码文章、动态、长正文、direct read 搜索页、no_candidates 记 1 |
| R5 旧图库 | DESIGN §3.1；I2／I3 | 混合描述不进观察／OCR／用户心理；首次合法观察；原图库和 embedding 不变 |
| 顺序与重复位置 | DESIGN §2.3、4.3；I1／I4b | 逆序 ID／同毫秒／12 图／A→B→A 的最终 envelope |
| pause 语义 | DESIGN §1、4.1；I4a | 在途 narrative 时 pause，当前轮后续看图继续，下一轮不启动 |
| 未知冻结／恢复资产 | DESIGN §3.3；I4a／I5a | A unknown 后 B 失败，重开 A 不重判；pending 用原 assetRef 续旧网页额度 |
| 真正隔离 check | DESIGN §7；I5b／I6／S4 | 三个显式路径，所有分支不读默认正式文件；只读字节／schema 验证 |
| 提早可行性／RSS 范围 | DESIGN §5、7；S5a | 先有真实候选＋正文才完成集成；仅 HTML，独立保存失败和成功证据 |

关闭记录为每项填实际 commit、测试名、日志／报告路径及剩余限制；不得仅填“按计划实现”。新问题以可复现用例和影响范围记录，不用模糊“可能有风险”扩大工作。

## 6. 文档同步和最终交付

图片批记录目录：`docs/v0.5/records/image-input-20261009/`；搜索批：`docs/v0.5/records/local-browser-search-20261009/`。这是任务标识，记录实际完成日期；不要覆盖本计划的原 HTTP、旧自查或原 review 探针。

每批最少交付：

- DELIVERY.md：实际提交／合入位置、完成任务、测试真实统计、离线／在线／正式状态。
- IMPLEMENTATION_LOG.md：关键实现裁决、失败到修复、命令及对应日志；无需逐行聊天流水。
- REVIEW_CLOSURE.md：本指南 §5 的适用条目及代码／测试证据，未完成项目明确保留。
- evidence/ 和 logs/：公开／合成输入的必要报告及验证输出；私有密钥、人物背景全文、正式聊天不进入送审文档。

当前规则在功能实际交付后更新：
[上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md)、
[表达与图库](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)、
[记忆](../../subsystems/REMAKE_V0.5_MEMORY.md)、
[恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md)、
[网页工具](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md)、
[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md)、
[模型用途](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md)。
本次只修订待实施包，不提前把这些当前规则改成新功能已存在。

执行者的最终回复应给出：图片／搜索各自是否完成、实际 HEAD、验证数字和日志入口、线上未验收项、正式文件是否变更／服务是否运行。全量旧测试通过不代替新功能关闭矩阵。

## 7. 部署与回退细节

开发完成后先交付可审配置差异。图片配置只增加 visualInput.enabled=true；没有独立需求时不复制新 incomingImageModel，直接沿原 stickerDescriptionModel。搜索配置增加 provider=browser 及 browser 参数，并在 runtime Koishi plugins 中启用 Puppeteer。示例默认仍关闭。

正式部署若已在用户交给 SOL 的执行范围内，则按项目 README 完成显式停服、完整一致备份（数据库及 SQLite 伴随文件／图库／配置／当前构建）、部署当前依赖和构建、只读启动检查；保持用户手动启动服务。未包含正式部署时，把确切配置差异与命令交付，不擅改正式文件。

本批加表不重写旧消息／图库；不要为它重跑已完成的环境异步迁移或清空旧数据。若检查发现未满足已有版本要求，使用对应既有迁移流程，不通过改版本号绕过。

回退优先关闭新功能并回退本批构建／配置；若恢复旧二进制无法正确处理已保存的新回合状态，则使用本批部署前的完整一致备份。执行回退前明确停服和选择对应备份，不能删新表／图片目录来“恢复旧行为”。回退不用于抹除原失败证据。
