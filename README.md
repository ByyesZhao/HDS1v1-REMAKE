# HDSI 重制版 V0.5

2026-10-14 [最新代码与文档核对](docs/v0.5/records/document-current-sync-20261014/README.md)：当前产品基线19cdf58、包版本0.5.2。普通生活活动不再阻挡深度记忆整理，前台／共同活动保护和15分钟等待保留；研究进度类型与诊断已明确。最近产品验收227文件1546项通过、2项既有跳过，文档核对与历史批次证据分别记录。

2026-10-13 [existingLongId引用权限修复与0.5.2交付](docs/v0.5/records/existing-long-reference-20261013/README.md)：基础记忆可复用已提供短期的真实关联长期，create与awaken权限分离；确认lookup恢复重建实际发送名单，最终提交拒绝discarded目标。工程验收、正式部署与Git状态以本批记录为准；服务由用户手动重启。

2026-10-13[记忆整合重试与起床边界修复](docs/v0.5/records/memory-retry-waking-20261013/README.md)已实现并完成离线验收：整合／audit 600秒、首次＋最多2次自动重试、耗尽全局暂停，包含错误／checkpoint取证及起床原睡眠输入。223文件1491项通过、0失败、2项既有跳过（总1493项）；typecheck／build／demo通过，插件合同2文件10项通过，双场景smoke各四阶段提交通过；独立复核关闭两项P2。正式部署与Git状态见交付记录；服务启动及人工resume未执行。

单角色、一对一QQ生活模拟。当前架构入口为[总架构](docs/v0.5/architecture/REMAKE_V0.5.md)，子系统、源码对应与审核材料见[文档索引](docs/v0.5/README.md)。旧架构、已完成方案和旧日志已集中到[历史归档](docs/archive/README.md)，当前规则无需拼接多轮旧rebuttal。

2026-10-13[最新文档复核](docs/v0.5/records/document-code-recheck-20261013/README.md)以本地／远端一致的`705cccd`为基线，对照12份现行说明和源码，澄清默认重试次数等边界；本轮只修文档，实际验证见记录。

V0.5整理当前实现：普通最近4个完整对话段、活动完整授权原文和结束后记忆召回；7／90／3／30记忆周期及100／1000／500容量；每日06:00世界／校园／课题组／周增量链；普通最新输入15秒静默合批及首次发送前跟进新输入、共同60秒或全文`【推进】`，约10轮软收尾、20轮硬上限；冻结发送与按阶段恢复。

V0.5是架构文档版本；当前插件与运行包版本为0.5.3，Git版本标签为v0.5.3。数据库各子系统版本保持原协议，环境异步协议2新库默认启用；旧库须显式升级。正式库已按后续授权备份升级环境规划至2，原数据保留；2026-10-10又按用户要求启用新图识别及Bing搜索，见[配置记录](docs/v0.5/records/feature-enablement-20261010/README.md)。

记忆整合业务ID／资源引用修复见[0.5.3交付记录](docs/v0.5/records/memory-owner-reference-20261014/README.md)。同版本后续的[接口响应诊断](docs/v0.5/records/model-response-diagnostics-20261015/README.md)与[正文必填合同修复](docs/v0.5/records/memory-content-contract-20261014/README.md)在main交付，原v0.5.3发布标签保留。

## 1. 当前状态

此前为[综合审核整改交付](docs/v0.5/records/comprehensive-remediation-20261011/DELIVERY.md)：5项代码问题及流程／性能改进已完成，217文件1370项全量、工程门与独立复核通过。Q2保持原检索参数，Q3仅交付离线工具。正式部署和最终服务状态以交付页记录为准。

前批交付为[当前审核改进T1～T9](docs/archive/records/current-audit-improvements-20261009/DELIVERY.md)。此前REVIEW26的107／620、ASTRA T1～T13的121／681和R1的122／693保留各批历史含义。ASTRA随后已独立重跑137文件776项并[确认关闭](docs/archive/reviews/post-t1-t9-20261009/REVIEW.md)。环境异步E1～E5及交付后R1／R2、只读启动检查修复均已完成，最终148文件826项及离线验收通过，该批见[修复与正式升级交付](docs/v0.5/records/environment-post-delivery-fixes-20261009/DELIVERY.md)；初批过程见[本批记录](docs/v0.5/records/environment-async-20261009/README.md)。旧证据仍按原批次解释。

此前加入三条固定回复规则及程序选择的图片／表情分支，纯附件可落库、收尾可已读不回，该批150文件840项见[回复规则交付](docs/v0.5/records/reply-guidance-20261009/DELIVERY.md)。后续图片输入／本地搜索及复核修复已交付，该批验收为175文件920项，见[交付](docs/v0.5/records/image-search-post-review-fixes-20261010/DELIVERY.md)。各批最新状态以[版本索引](docs/v0.5/README.md)为准，配置启用不作为新增在线验收。

普通回复跟进新消息T1～T5已完成，该批184文件990项及离线检查通过，独立复核7文件44项和三组边界探针通过，见[交付](docs/v0.5/records/chat-reply-freshness-20261010/DELIVERY.md)。发送尝试前收到追加输入会等待并重新生成；首次尝试后保留冻结尾段，未知结果沿用重试。源码合并不等同正在运行的服务已更新；正式部署状态见交付记录。

新增[安全停止交付](docs/v0.5/records/graceful-stop-20261010/DELIVERY.md)：stop-hdsi.cmd等待当前故事整轮和世界／学校、记忆、取图在途阶段保存；187文件1004项与类型／构建／演示／插件验收通过，独立审查补修已关闭。正式部署状态见交付，服务由用户启动。后续[停止失败传播R1](docs/v0.5/records/graceful-stop-r1-20261010/README.md)补齐浏览器关闭失败返回错误且不退出的合同。

67项旧图库的图片、说明、标签和1024维向量已在新项目复用；运行不依赖旧HDSI目录。角色背景和用途映射已批准启用，故事阶段完整背景保留，未迁移作者事实或覆盖已有细节。

网页核心与本地浏览器provider已实现，此前配置启用记录确认Bing搜索和新图识别已打开；记忆向量索引已实现，真实语义阈值未标定，前次配置核对下使用当前词法阈值和直接键。离线Q1/Q2评估保留原参数（keep_current），不表示检索质量已达标，详见[检索评估](docs/v0.5/records/comprehensive-remediation-20261011/RETRIEVAL_EVALUATION.md)。真实QQ持续收发、新图在线描述、现实新闻搜索及数月稳定运行尚未验收。服务继续由用户手动启动／重启。

[图片输入交付](docs/v0.5/records/image-input-20261009/DELIVERY.md)与[本地搜索交付](docs/v0.5/records/local-browser-search-20261009/DELIVERY.md)保留原基线。后续[配置启用](docs/v0.5/records/feature-enablement-20261010/README.md)保持现有模型／强度，启动检查通过；等待用户手动启动，未由配置操作启动QQ服务。

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

demo是内存库和固定模型的合成故事；smoke使用真实Koishi Context及临时库，模型HTTP以离线返回替代，不连接QQ。更新代码前先用stop-hdsi.cmd停HDSI，再build，最后由用户重新启动Koishi。

## 3. 手动启动

根目录双击：

- `start-hdsi.cmd`：启动`D:\HDSI-remake\runtime`中的Koishi与故事插件。
- `stop-hdsi.cmd`：请求安全停止HDSI，等待当前工作保存。
- `start-snowluma.cmd`：启动独立`D:\SNOWLUMA`的SnowLuma。

各自有控制台。HDSI建议双击`stop-hdsi.cmd`安全停止：先禁止新输入与新任务，等待当前故事整轮、世界／学校及记忆后台当前阶段和取图工作完成保存，再退出；未来预约、静默等待和未开始的后续链留待重启。Ctrl+C有退出等待钩子，但Windows控制台直接关闭不保证等待。SnowLuma仍按其控制台方式停止。传入`--check`只核对本地依赖／配置／图库，不启动服务、登录账号或调用模型。

```powershell
.\start-hdsi.cmd --check
.\start-snowluma.cmd --check
```

Koishi控制台为http://127.0.0.1:5141。机器人1000000000、目标用户1000000001；匹配此目标私聊的文本及图片／表情类型标记进入故事，纯图片／表情同样接受。visualInput开启后，在角色可读时向独立incoming_image发送原图，其他阶段只读固定观察；语音等其他非文本附件仍不作为模型聊天输入。

SnowLuma登录该机器人，当前使用其本地正向OneBot WebSocket服务`ws://127.0.0.1:3001/`，由HDSI主动连接。Koishi控制台仍是5141端口。修改接入配置后正常退出并重启HDSI；SnowLuma无需因此重启。可向机器人发送`hdsi.status`确认接入，管理命令不经过15秒聊天合批或模型生成。现有运行入口由`runtime/koishi.yml`配置，插件以本地项目引用；不启动旧项目或注册后台任务。首次连接排查见[记录](docs/v0.5/records/onebot-connection-20261010/README.md)。

## 4. 本地配置与模型

`config.local.json`读取同目录`梁思璃设定.txt`，批准的`background-views.local.json`提供用途／表达风格。用途映射和风格可以修改，下次启动读取，未批准候选不能直接切换。

`key.txt`识别DeepSeek与Qwen认证行，仅载入进程认证环境；已有环境变量优先。不把密钥放提示词、文档或故事库。私有配置、设定和密钥均按现有忽略规则留在本地。开发样例为`examples/story.sample.json`，勿向正式故事库写开发人物。

十二个故事／后台连接键：

`narrative`、`narrative_shared`、`personal_chat`、`personal_life`、`personal_shared`、`expression`、`memory`、`memory_consolidation`、`world`、`school_campus`、`school_group`、`school_week`。

另有`stickerDescriptionModel`及可选`incomingImageModel`；用户图观察未单独覆盖时复用素材描述连接。固定信息审核使用memory_audit提示／资料投影，实际模型任务名和复用连接均为memory_consolidation。当前全部Flash；记忆提取／深度整理／新图描述及用户图观察high，其余上述故事与环境任务low。每项可独立改`deepseek-v4-pro`，格式修补及工具续调用继承原连接。强度支持none／low／high／max，具体有效值与Schema默认差别见[对应清单](docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md)。

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

环境异步升级是独立的1→2迁移，不会由启动自动执行。初批开发只升级测试夹具；本项目正式库后来已在2026-10-09停服备份升级，见本节开头记录。以下命令用于其他仍为旧版本的库，不要求本项目重复apply：
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

### 已完成任务的恢复载荷回收

`memory:compact-payloads`用于回收已完成记忆任务和明确终态owner的网页checkpoint；不删除记忆正文、网页材料或未完成任务的恢复输入。先用显式数据库路径只读检查，再在HDSI已安全停止后选择apply：

```powershell
npm run memory:compact-payloads -- runtime/data/hdsi-remake.sqlite --dry-run
npm run memory:compact-payloads -- runtime/data/hdsi-remake.sqlite --apply --stopped --batch-size 50 --max-batches 20
```

默认每批50条、每次最多20批；`hasMore:true`表示仍有残余，可按相同参数续跑，已清行不会重复修改。每批事务提交，中断只回滚当前批。`--stopped`是操作者确认，不会替你检测或停止进程。无可回收项时不创建备份；有残余时首次写入前将数据库及实际存在的WAL／SHM一起保存到数据库旁`backups/memory-payloads/<uuid>/`。可传`--backup-dir <目录>`，工具仍在其下新建唯一uuid子目录，并返回`backupPath`。

当前代码清除网页checkpoint前会在同一事务将其归档到`model_run_records`，归档失败则回滚；该不可变历史不由本工具删除。因此回收的是业务恢复载荷，不保证数据库中旧输入／响应正文消失。历史用途与其他归档入口见[恢复说明](docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md)。

环境步骤正文需显式增加 `--include-environment`，默认统计为0不代表环境没有残余：

```powershell
npm run memory:compact-payloads -- runtime/data/hdsi-remake.sqlite --dry-run --include-environment
npm run memory:compact-payloads -- runtime/data/hdsi-remake.sqlite --apply --stopped --include-environment --batch-size 50 --max-batches 20
```

该选项只回收准备版本1且已committed／superseded的三份恢复正文，先写入身份、结果指纹和计数审计摘要，再清正文；旧版本0／缺省和pending／running／ready原样保留。所有类别共用每批上限，缺少环境表的旧库不会因此建表。新完成的版本1步骤由运行时收尾，普通启动不扫描压缩历史全文。

回退需停服并恢复同一备份组的DB/WAL/SHM及配套代码，不能将旧主DB和新WAL混用；恢复会舍弃备份后的业务。摘要不能重建原模型输入，旧二进制也不能假定读取已清正文。命令不执行VACUUM，逻辑载荷减少不保证磁盘文件立刻缩小；这项回收不转换网页正文引用格式。

### 网页正文引用格式转换

新代码兼容读取旧内嵌正文与v2材料引用，新写入统一为v2；完整正文仍在网页材料表，模型输入保持完整。历史转换为可选运维动作，不是启动时全库迁移：

```powershell
npm run web:migrate-payloads -- runtime/data/hdsi-remake.sqlite --dry-run
npm run web:migrate-payloads -- runtime/data/hdsi-remake.sqlite --apply --stopped --batch-size 50 --max-batches 20
```

数据库路径必须显式给出，不带apply时为只读。先安全停止HDSI，再声明 `--stopped`；工具不会代为停服。每批最多50个残余run，默认最多20批；`hasMore=true`时可续跑，完成需同时确认旧格式session／operation为0。写入前备份到数据库旁 `backups/web-payloads/<uuid>/`；`--backup-dir <目录>`也会创建唯一子目录，复制主库及实际存在的WAL／SHM。没有残余不创建备份；失败批整体回滚，先前成功批保留。此工具不删除网页材料或终结任务。

旧二进制不能读取v2。即使不做批量转换，新代码运行后也可能已写入v2，因此回退必须使用配套代码和同一完整停服备份，不能只回退Git；恢复备份会丢失备份后的业务。详见[网页恢复合同](docs/v0.5/subsystems/REMAKE_V0.5_WEB_SEARCH.md#7-中断与恢复)。

## 6. 图库维护

新增或重建先停止HDSI：

```powershell
npm run stickers -- import D:\我的素材 config.local.json runtime/data/hdsi-remake.sqlite
npm run stickers -- rebuild - config.local.json runtime/data/hdsi-remake.sqlite
```

新图描述后再编码；重建沿旧文字／标签，不重识图。更换模型、端点或维度需显式重建图库，素材ID和图片文件保持可用。细节见[素材文档](docs/v0.5/subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md)、[迁移记录](docs/archive/topics/stickers/STICKER_MIGRATION.md)。

`import`按配置提供网页搜索：启用browser时，CLI独立启动headless浏览器，默认启动等待60000ms，页面操作继续使用原配置预算；关闭搜索时不加载浏览器。`rebuild`只调用Embedding，不创建网页会话或视觉模型。CLI不启动故事或QQ；退出前等待自有页面排空、关闭浏览器上下文，再关闭数据库。启动、模型或清理失败均非零退出并保留错误原因；若描述／入库已经成功而最后清理失败，已保存素材不会自动撤销，重跑前先核对结果。离线合成回归不代表真实图片描述质量已验收。

启动预算覆盖整个上下文启动。若底层浏览器获取在超时后才返回，保留的收尾任务会关闭迟到资源，不再访问已关闭数据库；正常退出按canvas页面、浏览器、数据库顺序等待实际异步关闭完成。

`npm run check:models`会发固定测试提示及素材测试查询，是显式在线验证；普通启动检查不联网。其他`--online`验收也使用模型与认证，报告有明确数据范围，不能当成离线命令。

## 7. 管理和恢复

仅目标私聊的管理命令，不作为剧情输入：

- `hdsi.status`：查看暂停、当前阶段、下一调度及维护／检索／页面额度，含失败job、周期、执行／失败数和维护通知pending／attempted／sent／failed；不展示查询、正文或密钥。
- `hdsi.pause`：停止新轮，正常在途轮可继续完成，输入继续保存。
- `hdsi.resume`：显式解除暂停；如有维护暂停归属，只为记录的failed job／retryCycle开启新周期，保留同jobId／runId及原修补／工具预算，再先续办旧轮。启动不等于resume。

活动控制全文`【推进】`跳过等待，线下`【动作：…】`表示动作尝试。角色能看到也可不回复。

前台模型／发送／基础后处理失败暂停并尽力发安全error；重启不清持久暂停。尚未尝试的候选可重生成，有发送尝试则冻结续发，输出完成只续后处理。已确认项不重发，未确认窗口仍可能重复。接口超限保留报错，不自动删内容、缩窗口或增加关段命令。详见[报错与恢复](docs/v0.5/subsystems/REMAKE_V0.5_RECOVERY.md)。

## 8. 当前文档与复盘

[V0.5总架构](docs/v0.5/architecture/REMAKE_V0.5.md)＋其8份子系统＋[实现对应](docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md)是当前说明。最新代码、审核与部署进度统一见[版本索引](docs/v0.5/README.md)；查看资格该批见[交付](docs/v0.5/records/phone-access-20261010/DELIVERY.md)，回复规则该批见[交付](docs/v0.5/records/reply-guidance-20261009/DELIVERY.md)，正式升级见[交付后修复与正式升级](docs/v0.5/records/environment-post-delivery-fixes-20261009/DELIVERY.md)。原E阶段证据在[环境异步交付](docs/v0.5/records/environment-async-20261009/DELIVERY.md)和[复核关闭](docs/v0.5/records/environment-async-20261009/REVIEW_CLOSURE.md)；版本重写过程在[文档修订日志](docs/archive/records/V0.5_DOCUMENT_REWRITE_LOG_20261009.md)。

文档分类与新建原则见[文档总入口](docs/README.md)和[目录原则](docs/DIRECTORY_POLICY.md)。当前说明、最新交付和最终复核在docs/v0.5；过期说明、已完成合同、旧审核和过程日志在docs/archive。进行中的计划单独保留在当前plans，完成后按目录原则移入历史合同；最新交付见V0.5索引。

原runtime历史测试输出、旧运行日志及完整回退快照已收至[runtime/archive](runtime/archive/README.md)，其中的私有资料不默认送审。源码工具和在用部署文件保持原路径；旧记录内的原执行路径以[迁移清单](docs/v0.5/records/document-organization-20261009/move-manifest.json)查新位置。


## 用户图片与本地浏览器配置

2026-10-10用户授权后已配置visualInput.enabled=true；incomingImageModel未配，复用stickerDescriptionModel（Flash/high）。角色有权读取时才准备视觉观察；字节预取不代表已经看到。入站观察独立于发送图库，不改旧67项素材向量。

当前显式配置webSearch.enabled=true、provider="browser"、engine="bing"、navigationTimeoutMs=60000、maxConcurrentPages=1。runtime的Koishi plugins已加入puppeteer:hdsi-web（headless=true），使用本项目依赖并自动查找本机Chrome；未就绪时故事实例等待，不由HDSI启动另一个浏览器。没有搜索API计次费，仍消耗本机资源、网络和模型续调用。此前DuckDuckGo公开验收遇到验证码，不自动回退。

只读隔离check支持--config、--database、--koishi-config三个绝对路径；默认启动器原路径保留。prepare-feature-check.ts生成image／search合成库，verify检查哈希；不复制正式库。两项开关不要通过改版本号或删表启用，部署／回退仍按一致备份和手动启动规则。
