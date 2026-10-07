# HDSI 重制版 V0.2

独立 Koishi 插件，基线记录于六份 `REMAKE_V0.2*.md`，记忆及搜索按docs/四份细化／计划实施。单角色、单用户、单进程；SQLite保存一份故事，串行前台回合与一个后台准备槽。新 Koishi 安装于 `D:\HDSI-remake\runtime`，旧工程保留。

## 当前状态

已实现输入合批、主叙事/个人/表达/记忆任务、冻结发送与恢复、睡眠、预约、待看/延后回复、共同场景、中文记忆检索、主动联系、表情素材和世界/学校更新。各模型任务独立选择 DeepSeek Flash/Pro；qwen Embedding 另行配置。

正式背景使用根目录 `梁思璃设定.txt`，私有运行配置为 `config.local.json`，密钥从同目录 `key.txt` 读取。已复用 67 张表情包及其描述、标签、1024 维向量，所有图片与所需参考资料均已复制到新项目；运行不依赖旧 `D:\HDSI`。DeepSeek JSON 与 qwen 向量接口已完成少量实测，真实 QQ 和完整故事路径仍待联调。当前服务保持停止，OneBot 和故事插件已配置为下次手动启动时启用。

详情见 [实施记录](docs/IMPLEMENTATION_LOG.md)、[图库迁移说明](docs/STICKER_MIGRATION.md) 和 [文档核对与 DSH 审核清单](docs/DOCUMENT_AUDIT.md)。六份架构/子系统/实施文档已按当前代码更新，实施文件名保留，正文改为落地记录。

DSH 二轮确认后的修订见 [修订与验证记录](docs/DSH_REVIEW_FIXES_20261007.md)：记忆整理使用独立预算；新建记忆／细节变更至少引用一个本轮来源；个人导演新建或更新检查任务的最终时间晚于本轮；空别名更新沿用旧别名。此前V0.2基线为18文件78项，当前版本验证见记忆实施记录。

记忆V0.3任务1～7已实施，规则及实测见[记忆实施记录](docs/MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md)。直接依据仍为记忆细化／执行计划、搜索设计／执行计划四份。搜索任务1～6离线核心已实施；具体搜索provider稍后选择，不能把离线接口当已联网。

## 开发与验证

需要 Node >= 22.13（本机验证为 24.21.0），npm。

```powershell
cd D:\HDSI-remake
npm ci
npm test
npm run typecheck
npm run build
npm run demo
npm ci --prefix runtime
npm run check --prefix runtime
npm run smoke --prefix runtime
```

`demo` 完全离线，使用内存数据库、固定模型返回和模拟 QQ。`smoke` 使用真实 Koishi Context 加载编译插件，模型 HTTP 被离线固定返回替代，使用临时数据库；不连接 QQ。

## 新 Koishi

在项目根目录双击 `start-hdsi.cmd` 启动新 Koishi，双击 `start-snowluma.cmd` 启动 `D:\SNOWLUMA` 的 SnowLuma；各自显示控制台窗口。用窗口中的 Ctrl+C 停止，结束后按任意键关闭窗口。脚本不会启动旧项目或注册后台任务。命令行传入 `--check` 可只检查启动依赖，不启动服务。

```powershell
cd D:\HDSI-remake\runtime
npm start
```

控制台：[http://127.0.0.1:5141](http://127.0.0.1:5141)。`runtime/koishi.yml` 是新配置；插件通过 `file:..` 引用当前项目，每次改代码后先运行根目录 `npm run build`，再重启 Koishi。新的故事库默认 `runtime/data/hdsi-remake.sqlite`，不读取旧数据库。

已预填机器人 QQ `1000000000`、用户 QQ `1000000001`，新 OneBot 和故事插件已启用。SnowLuma 首次运行时需登录机器人账号，并将该账号的 OneBot 反向 WebSocket 连接设置为 `ws://127.0.0.1:5141/onebot-remake`。本次没有启动 SnowLuma、登录 QQ 或实际发消息，账号连接由用户手动运行时完成。旧 HDSI 监测任务已暂停。

独立 SnowLuma 为 `D:\SNOWLUMA`（1.14.22）；HDSI 启动脚本使用系统 Node，新 Koishi 与图库全部位于当前项目。旧流程参考归档在 `references/legacy-stickers`。

## 正式配置

`config.local.json` 已按正式设定生成，`backgroundFile` 指向同目录 `梁思璃设定.txt`，每次启动重新读取；不用手工把整个背景粘进 JSON。配置中包含设定里的表达指导、世界/学校规则和 16 项初始稳定细节，没有编造聊天前史、具体课表或手机型号。年龄和年级明确以 2026 年秋为基准。

`key.txt` 沿用用户提供的格式，程序识别 `deepseek KEY:` 和 `qwen... KEY:` 两行，把完整值载入当前进程的 `DEEPSEEK_API_KEY` 与 `QWEN_API_KEY`；已有环境变量优先。密钥仅用于 HTTP 认证，不复制到运行 JSON、提示词、SQLite 或文档。双击启动会自动读取，不需要提前设置 PowerShell 环境变量。`key.txt`、正式设定和私有配置均已加入忽略列表。

开发样例仍为 `examples/story.sample.json`；验证样例时使用独立开发数据库或 `smoke`，避免写入正式故事。

如需临时覆盖本地文件，也可以在启动 Koishi 的同一个 PowerShell 中设置环境变量：

```powershell
$env:DEEPSEEK_API_KEY = '<在本机填写>'
# 启用素材时另配：
$env:QWEN_API_KEY = '<在本机填写>'
npm start
```

模型配置示例：

```json
"narrative": {
  "model": "deepseek-flash",
  "reasoningEffort": "low",
  "baseUrl": "https://api.deepseek.com",
  "apiKeyEnv": "DEEPSEEK_API_KEY",
  "outputMode": "json_object"
}
```

`models`中十项故事／后台任务分别配置：`narrative`、`narrative_shared`、`personal_chat`、`personal_life`、`personal_shared`、`expression`、`memory`、`memory_consolidation`、`world`、`school`。普通和共同场景可选择不同模型。`stickerDescriptionModel` 单独选择素材描述模型，对应运行任务名 `sticker_description`。可用名称：`deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`。默认用 JSON Object 模式，并由本地 Schema 校验控制字段，原调用后最多修补两次；也提供 `json_schema`/`prompt` 接口选项，须由实际端点验证后选用。

当前正式配置和样例中的十一个DeepSeek任务均使用 `deepseek-flash`。普通/共同场景主叙事、聊天/预约个人导演、自主生活/共同场景个人导演、表达润色与分段、世界导演、学校导演使用 `reasoningEffort: "low"`；记忆整理、记忆压缩和新表情包看图描述使用 `"high"`。后续可单独将任一任务的 `model` 改为 `deepseek-v4-pro`，该任务的思考强度独立保留。

`reasoningEffort` 支持 `none`、`low`、`high`、`max`，缺省为 `high`（兼容原接口默认行为）。请求将其传为官方 `reasoning_effort` 参数：`none` 关闭思考，其余开启对应强度。格式修补和本地细节查询后的续调用继承原任务的模型及思考强度；Embedding 配置不使用该参数。参数含义见 [DeepSeek Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

程序将配置的模型名称直接传入 [Chat Completions 接口](https://api-docs.deepseek.com/api/create-chat-completion/)，不自行切换模型。具体既有属性未预取到时，同一次任务运行最多允许一次本地 `lookupDetails` 查询及续调用；格式修补重新返回完整 JSON，程序不保证散文逐字不变。事实连续性、动作格式和意图含义主要由提示词约束，程序校验结构、时间与来源 ID，不使用额外事实审核模型。

网页搜索为进程内共享模块，`webSearch.enabled` 默认 false，真实 provider 尚待选择。全部十一类任务都有各自持久化会话，独立20次成功正文／40次失败，任一到限停新操作；缓存B按阶段首次取得计数。`webSources`保留兼容配置，不自动注入候选或兜底；不足时反馈“结果不足”，模型可保留未知，对话角色可以询问用户。正文不按12000字符截断。世界／学校仅引用最终已实际提供的正文 URL；只有生活个人导演的实际阅读才产生可用于查阅类短期的来源。

## 表情素材

当前已配置 `qwen3.7-text-embedding`、用户提供的北京地域 OpenAI 兼容端点和显式 `dimensions: 1024`；图库已就绪。旧记录的模型、端点、请求维度、输入长度与配置指纹已核对，当前端点复算一条原描述的余弦相似度为 `0.999999`，没有重新识图或重算整库。记忆使用独立memoryEmbedding与混合检索，真实语义阈值待标定，先使用已校准词法。

新增图片或显式重建前先停止 HDSI。以下命令在根目录运行：

```powershell
cd D:\HDSI-remake
npm run stickers -- import D:\我的素材 config.local.json runtime/data/hdsi-remake.sqlite
npm run stickers -- rebuild - config.local.json runtime/data/hdsi-remake.sqlite
```

新图导入支持本地 PNG/JPEG/GIF/WebP，由描述模型生成文字再编码入库；动态图片的描述效果需逐项查看。旧 67 张图直接复用已识别文字。路径保存为绝对路径，素材文件需要保留。更换 Embedding 模型、端点或维度后显式运行 `rebuild`，旧图重建沿用 `embeddingInput`（描述与标签），保留素材 ID。每条非线下角色文字独立抽样，命中选择最高余弦相似度素材，不设匹配阈值。线下开始/结束轮的文字均不抽样。

`npm run check:models` 是显式在线验证命令，会发送固定测试提示、表情描述和测试查询，验证结果保存到 `runtime/data/sticker-retrieval-check.json`；普通启动前检查只读本地配置和图库，不调用模型。当前 10 条检索中，疲惫、得意、拥抱、睡觉、害羞、委屈和困惑等匹配符合描述；“好呀，赞同”匹配到疑惑图，“早上好”匹配到抱抱图，存在语境偏差。记录保留供后续审查，没有因此改变既定的最高相似度、无阈值规则。

## 管理与恢复

三条命令仅绑定目标私聊，不进入故事记忆：

- `hdsi.status`：暂停状态、当前阶段、下一调度时间、维护／检索及网页会话计数；不展示查询、正文或认证内容。
- `hdsi.pause`：停止启动新轮，已有正常回合完成后暂停；输入继续保存。
- `hdsi.resume`：解除暂停，先续办未完成阶段，再处理队列。

模型/QQ/后处理异常保存 `paused=true`，并尽力发送系统 `error`；错误在 SQLite `runtime.lastError` 和 Koishi 日志中查看。暂停跨重启保留，需要 `hdsi.resume`；意外退出且未暂停时，启动先续办旧轮。尚未尝试发送且输出未完成的整稿可重新生成，已有尝试则保留冻结稿，跳过确认项、重发未知项。素材冻结的是 ID，恢复前保留图片文件与 ID 映射。输出完成只做后处理，故事效果与完成标记在同库事务提交；环境及无叙事的睡眠控制回合不调用记忆模型。

SQLite 使用内置 `node:sqlite`，WAL + `synchronous=FULL`；事务、普通关闭/重开和参数已验证，未开展硬件断电测试。架构与控制范围遵循实施文档，不增加多机、熔断、供应商切换或完整生产监控。

## 记忆V0.3运维

正式库已备份并迁移schema3；服务保持停止。historyBudget及所有可选记忆人工预算默认null，原文窗口30；默认7/90/3/30生命周期见记忆文档。memoryEmbedding与embedding独立配置，memory_consolidation为独立Flash/high。

离线检查：npm run memory:check；背景候选：npm run memory:background；升级旧库先停服务，再npm run memory:migrate -- --stopped。背景候选在runtime/data/，尚未切换生产背景。未实际标定Qwen语义阈值时semantic-only关闭；不自动裁内容重发真实容量错误。


第七轮审核修正后：42文件200测试通过，typecheck/build/Koishi离线smoke及两个cmd --check通过；变更及待接入项见[实施交付与审核入口](docs/IMPLEMENTATION_HANDOFF_20261007.md)和[本轮修正记录](docs/REVIEW7_FIX_IMPLEMENTATION_20261007.md)。离线网页规模检查：npm run web:check。


