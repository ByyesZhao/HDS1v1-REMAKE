# HDSI 重制版 V0.5

单角色、一对一QQ生活模拟。当前架构入口为[总架构](docs/v0.5/architecture/REMAKE_V0.5.md)，子系统、源码对应与审核材料见[文档索引](docs/v0.5/README.md)。旧架构、已完成方案和旧日志已集中到[历史归档](docs/archive/README.md)，当前规则无需拼接多轮旧rebuttal。

V0.5整理当前实现：普通最近4个完整对话段、活动完整授权原文和结束后记忆召回；7／90／3／30记忆周期及100／1000／500容量；每日06:00世界／校园／课题组／周增量链；普通15秒合批、共同60秒或全文`【推进】`，约10轮软收尾、20轮硬上限；冻结发送与按阶段恢复。

这是架构文档版本。现有npm包元数据仍为0.2.0，数据库各子系统版本保持原协议，本批新增环境异步协议2，新库默认启用；旧库须显式升级。正式配置未改；正式库已按后续授权备份升级环境规划至2，原数据保留。

## 1. 当前状态

前批交付为[当前审核改进T1～T9](docs/archive/records/current-audit-improvements-20261009/DELIVERY.md)。此前REVIEW26的107／620、ASTRA T1～T13的121／681和R1的122／693保留各批历史含义。ASTRA随后已独立重跑137文件776项并[确认关闭](docs/archive/reviews/post-t1-t9-20261009/REVIEW.md)。环境异步E1～E5及交付后R1／R2、只读启动检查修复均已完成，最终148文件826项及离线验收通过，该批见[修复与正式升级交付](docs/v0.5/records/environment-post-delivery-fixes-20261009/DELIVERY.md)；初批过程见[本批记录](docs/v0.5/records/environment-async-20261009/README.md)。旧证据仍按原批次解释。

本批已加入三条固定回复规则及程序选择的图片／表情分支，纯附件可落库、收尾可已读不回。150文件840项、类型、构建及离线验收通过，见[最新回复规则交付](docs/v0.5/records/reply-guidance-20261009/DELIVERY.md)。附件类型检测不等于实时识图；没有新的正式库迁移或在线调用。

67项旧图库的图片、说明、标签和1024维向量已在新项目复用；运行不依赖旧HDSI目录。角色背景和用途映射已批准启用，故事阶段完整背景保留，未迁移作者事实或覆盖已有细节。

网页核心已实现但搜索供应商尚未接入，开关关闭；记忆向量索引已实现，真实语义阈值未标定，当前先用已标定词法和直接键。真实QQ持续收发、新图在线描述、现实新闻搜索及数月稳定运行尚未验收。服务继续由用户手动启动。

[图片输入理解／本地浏览器搜索计划](docs/v0.5/plans/image-input-local-search-20261009/README.md)已写，尚未实施；目标是补齐用户图观察并复用旧浏览能力，保持现有模型／强度，优先避免付费搜索API。

## 2. 开发与离线验证

项目要求Node >=22.13.0。根目录命令：

```powershell
cd D:\HDSI-remake
npm ci
npm run typecheck
npm run build
npm test
npm run demo
```

Koishi依赖和离线检查：

```powershell
npm ci --prefix runtime
npm run check --prefix runtime
npm run smoke --prefix runtime
```

demo是内存库和固定模型的合成故事；smoke使用真实Koishi Context及临时库，模型HTTP以离线返回替代，不连接QQ。更新代码后先build再重启Koishi。

## 3. 手动启动

根目录双击：

- `start-hdsi.cmd`：启动`D:\HDSI-remake\runtime`中的Koishi与故事插件。
- `start-snowluma.cmd`：启动独立`D:\SNOWLUMA`的SnowLuma。

各自有控制台，Ctrl+C停止。传入`--check`只核对本地依赖／配置／图库，不启动服务、登录账号或调用模型。

```powershell
.\start-hdsi.cmd --check
.\start-snowluma.cmd --check
```

Koishi控制台为http://127.0.0.1:5141。机器人1000000000、目标用户1000000001；匹配此目标私聊的文本及图片／表情类型标记进入故事，纯图片／表情同样接受。当前不发送附件URL或图片字节、不实时识图；语音等其他非文本附件仍不作为模型聊天输入。

SnowLuma登录该机器人，OneBot反向WebSocket对应`ws://127.0.0.1:5141/onebot-remake`。现有运行入口由`runtime/koishi.yml`配置，插件以本地项目引用；不启动旧项目或注册后台任务。

## 4. 本地配置与模型

`config.local.json`读取同目录`梁思璃设定.txt`，批准的`background-views.local.json`提供用途／表达风格。用途映射和风格可以修改，下次启动读取，未批准候选不能直接切换。

`key.txt`识别DeepSeek与Qwen认证行，仅载入进程认证环境；已有环境变量优先。不把密钥放提示词、文档或故事库。私有配置、设定和密钥均按现有忽略规则留在本地。开发样例为`examples/story.sample.json`，勿向正式故事库写开发人物。

十二个故事／后台连接键：

`narrative`、`narrative_shared`、`personal_chat`、`personal_life`、`personal_shared`、`expression`、`memory`、`memory_consolidation`、`world`、`school_campus`、`school_group`、`school_week`。

另有`stickerDescriptionModel`。固定信息审核使用memory_audit提示／资料投影，实际模型任务名和复用连接均为memory_consolidation。当前全部Flash；记忆提取／深度整理／新图描述high，其余上述故事与环境任务low。每项可独立改`deepseek-v4-pro`，格式修补及工具续调用继承原连接。强度支持none／low／high／max，具体有效值与Schema默认差别见[对应清单](docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md)。

示例（当前支持的本地解码格式）：

```json
"narrative": {
  "model": "deepseek-flash",
  "reasoningEffort": "low",
  "baseUrl": "https://api.deepseek.com",
  "apiKeyEnv": "DEEPSEEK_API_KEY",
  "outputMode": "json_object"
}
```

记忆`memoryEmbedding`与表情`embedding`独立，当前Qwen模型均为`qwen3.7-text-embedding`、1024维。记忆标定文件semantic为空时不做纯语义查询；表情按最高相似度选图且无阈值。人工字符／token预算及相关记忆条数上限默认null，不自动裁剪超限请求。

## 5. 数据版本与升级

正式库默认`runtime/data/hdsi-remake.sqlite`。新库默认记忆schema3、容量1、共同活动1、环境规划2、普通窗口2；已有正式库已在2026-10-09按用户授权停服备份升级环境规划1→2，67表情包及其他非协议数据保持；版本号不随文档统一改为0.5。

已有故事需要升级时先停止HDSI，检查报告并备份。不要为文档改名重新运行所有升级。各批检查命令：

```powershell
npm run shared:migrate -- --database runtime/data/hdsi-remake.sqlite --check
npm run migrate:environment -- --database runtime/data/hdsi-remake.sqlite --check
npm run memory:capacity -- runtime/data/hdsi-remake.sqlite --config config.local.json --dry-run
npm run dialogue:migrate -- --database runtime/data/hdsi-remake.sqlite --config config.local.json --check
```

环境异步升级是独立的1→2迁移，不会由启动自动执行。本次开发只升级测试夹具，正式库是否升级由部署时决定：
```powershell
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --check
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --apply --stopped --backup-dir runtime/archive/restore/environment-async-backups
```
版本null先使用旧migrate:environment到1，再执行上述工具。旧ready／running／已有冻结pending沿串行合同恢复；新任务后台准备。运行中的新准备不会阻挡聊天，ready等串行门禁再提交。

回退旧版前，须在新程序完成或按日批次规则终结新模式非终态步骤，然后停服：
```powershell
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --target-version 1 --check
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --target-version 1 --apply --stopped --backup-dir runtime/archive/restore/environment-async-downgrade-backups
```
检查拒绝时不能手工改版本；可恢复完整升级前备份，但会丢失备份后故事进度。

普通窗口需apply时使用同配置／参数：

```powershell
npm run dialogue:migrate -- --database runtime/data/hdsi-remake.sqlite --config config.local.json --apply --stopped --backup-dir runtime/data/backups
```

它先备份DB及已有WAL／SHM，保留旧混合段和旧轮恢复，不删除消息。同版本普通apply幂等，不自动重拼。

已经升级到普通窗口2后，若修改`dialogueIdleMinutes`，启动会显示库内参数、请求参数与阻挡原因。可先恢复原参数完成旧轮和进行中的活动，再停止服务；要应用新参数需明确重建：

```powershell
npm run dialogue:migrate -- --database runtime/data/hdsi-remake.sqlite --config config.local.json --rebuild-chat-index --check
npm run dialogue:migrate -- --database runtime/data/hdsi-remake.sqlite --config config.local.json --rebuild-chat-index --apply --stopped --backup-dir runtime/data/backups
```

check不写业务数据；apply备份并事务重建普通索引，保留原消息与记忆。缺元数据、损坏关联、未完成故事轮或进行中的活动会阻挡，不得仅修改`chat_index_metadata`代替重建。普通窗口段数变化不需要重建。其他升级的前置条件以各自报告为准。修复证据见[REVIEW24记录](docs/archive/records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md)。

最近普通升级备份及配套回退代码的原记录见[实施日志任务20](docs/archive/topics/prompt-context/PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。备份现收纳于runtime/archive/restore，按迁移清单查新路径。回退用配套代码和完整备份，不直接拿新库运行旧门禁。

## 6. 图库维护

新增或重建先停止HDSI：

```powershell
npm run stickers -- import D:\我的素材 config.local.json runtime/data/hdsi-remake.sqlite
npm run stickers -- rebuild - config.local.json runtime/data/hdsi-remake.sqlite
```

新图描述后再编码；重建沿旧文字／标签，不重识图。更换模型、端点或维度需显式重建图库，素材ID和图片文件保持可用。细节见[素材文档](docs/v0.5/subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)、[迁移记录](docs/archive/topics/stickers/STICKER_MIGRATION.md)。

`npm run check:models`会发固定测试提示及素材测试查询，是显式在线验证；普通启动检查不联网。其他`--online`验收也使用模型与认证，报告有明确数据范围，不能当成离线命令。

## 7. 管理和恢复

仅目标私聊的管理命令，不作为剧情输入：

- `hdsi.status`：查看暂停、当前阶段、下一调度及维护／检索／页面额度；不展示查询、正文或密钥。
- `hdsi.pause`：停止新轮，正常在途轮可继续完成，输入继续保存。
- `hdsi.resume`：解除暂停，先续办旧轮，再处理新事项。

活动控制全文`【推进】`跳过等待，线下`【动作：…】`表示动作尝试。角色能看到也可不回复。

前台模型／发送／基础后处理失败暂停并尽力发安全error；重启不清持久暂停。尚未尝试的候选可重生成，有发送尝试则冻结续发，输出完成只续后处理。已确认项不重发，未确认窗口仍可能重复。接口超限保留报错，不自动删内容、缩窗口或增加关段命令。详见[报错与恢复](docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md)。

## 8. 当前文档与复盘

[V0.5总架构](docs/v0.5/architecture/REMAKE_V0.5.md)＋其8份子系统＋[实现对应](docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md)是当前说明。最新证据见[回复规则交付](docs/v0.5/records/reply-guidance-20261009/DELIVERY.md)；正式升级证据见[交付后修复与正式升级](docs/v0.5/records/environment-post-delivery-fixes-20261009/DELIVERY.md)；原E阶段证据在[环境异步交付](docs/v0.5/records/environment-async-20261009/DELIVERY.md)和[复核关闭](docs/v0.5/records/environment-async-20261009/REVIEW_CLOSURE.md)；版本重写过程在[文档修订日志](docs/archive/records/V0.5_DOCUMENT_REWRITE_LOG_20261009.md)。

文档分类与新建原则见[文档总入口](docs/README.md)和[目录原则](docs/DIRECTORY_POLICY.md)。当前说明、最新交付和最终复核在docs/v0.5；过期说明、已完成合同、旧审核和过程日志在docs/archive。进行中的计划单独保留在当前plans，完成后按目录原则移入历史合同；最新交付见V0.5索引。

原runtime历史测试输出、旧运行日志及完整回退快照已收至[runtime/archive](runtime/archive/README.md)，其中的私有资料不默认送审。源码工具和在用部署文件保持原路径；旧记录内的原执行路径以[迁移清单](docs/v0.5/records/document-organization-20261009/move-manifest.json)查新位置。
