# 当前模型调用与网页搜索配置参考

核对日期：2026-10-10。产品修复基线`47eb14d`，随后文档提交`31f331c`。返回[版本索引](../README.md)。模型以[此前白名单](../records/document-final-audit-20261010/evidence/effective-models.json)为准；之后按用户授权[启用图片／搜索](../records/feature-enablement-20261010/README.md)，只改变开关和浏览器装配，不改模型。本次只读启动检查加载本地认证但不输出凭据／背景，不启动服务或发起模型／搜索请求。

## 1. 本地部署配置的DeepSeek用途

13个已配置连接均使用`deepseek-flash`，主机为`api.deepseek.com`，输出模式均为`json_object`。下表列出15个逻辑用途：固定信息审核复用整理连接，用户图观察当前复用素材描述连接。14个模型任务名不等于14套已配置连接，也不意味着插件当前正在运行。

| 逻辑用途 | 配置连接 | 思考强度 | 主要调用位置／条件 |
| --- | --- | --- | --- |
| 普通主叙事 | `models.narrative` | low | `src/directors/narrative.ts`；普通故事轮补生活 |
| 共同活动主叙事 | `models.narrative_shared` | low | 同上；共同活动节点 |
| 聊天／预约／已读复议个人导演 | `models.personal_chat` | low | `src/directors/personal.ts`；相应前台角色判断 |
| 自主生活个人导演 | `models.personal_life` | low | 同上；自主生活轮 |
| 共同活动个人导演 | `models.personal_shared` | low | 同上；共同活动角色判断 |
| 表达润色与分段 | `models.expression` | low | `src/output/expression.ts`；有实际表达意图时 |
| 世界导演 | `models.world` | low | `src/directors/school.ts`的每日环境生成链；每日首阶段 |
| 校园学校导演 | `models.school_campus` | low | 同上；学期／校园持续安排 |
| 课题组学校导演 | `models.school_group` | low | 同上；模拟科研与组内安排 |
| 周计划学校通知正文 | `models.school_week` | low | 同上；只有必需通知才调用，单有冲突不调用 |
| 每轮基础记忆提取与细节变更 | `models.memory` | high | `src/memory/organize.ts`；有合法本轮来源才调用 |
| 空闲深度整理、合并与常驻评估 | `models.memory_consolidation` | high | `src/memory/maintenance.ts`；空闲资格成立且有任务 |
| 固定信息审核 | `models.memory_consolidation` | high | 同上；独立`memory_audit`提示／资料视图，复用整理连接 |
| 新表情素材看图描述 | `stickerDescriptionModel` | high | `src/output/sticker-description.ts`；显式导入新素材时 |
| 用户图片／表情观察 | `incomingImageModel`；未配复用`stickerDescriptionModel` | high（当前复用值） | `src/input-media/observe.ts`；角色有权读取且需新观察，或接续已冻结pending |

`incoming_image`使用四字段观察合同，与发送图库描述合同分开。当前`visualInput.enabled=true`且没有`incomingImageModel`覆盖；在角色有权读取时准备新图观察。若以后关闭，已冻结pending仍接续原模型任务，已确认历史观察不丢失。已知原生face与成功观察缓存免视觉请求。

这不是每轮必须执行的15次调用。环境和维护准备使用原连接，不额外增加另一套模型。固定信息审核若要单独设置模型／强度，需要后续增加连接配置；当前改变`memory_consolidation`会同时影响整理和审核。未设置独立`incomingImageModel`时，改变`stickerDescriptionModel`也同时影响用户图观察。

源码中`src/directors/world.ts`的旧环境辅助入口与`runSchool`兼容入口仍存在，当前正式每日链使用`generateEnvironmentStep`；旧辅助入口不构成第14个独立配置连接。

## 2. 如何修改与续调用

当前12个`models.<连接键>`、`stickerDescriptionModel`及可选`incomingImageModel`都可分别修改`model`、`reasoningEffort`。本地配置Schema接受`deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`；可将选定连接改成`deepseek-v4-pro`。强度接受`none`、`low`、`high`、`max`。上述是项目当前支持的标识，不是新增供应商可用性承诺。

`src/settings.ts`选择连接，`src/model/client.ts`将其`model`和`reasoning_effort`发到`/chat/completions`。当前10个连接显式low、3个high。未配置强度时，学校连接默认low，其余连接默认high，不能把当前表格当成所有连接的Schema默认值。

格式修补、细节补查后的继续生成、网页搜索／阅读后的继续生成以及对应请求重试，沿用原任务连接与思考强度，不切换其他模型。各阶段搜索计数也不会因此重置。

记忆`memoryEmbedding`与图库`embedding`当前均为`qwen3.7-text-embedding`、1024维，独立配置、独立用途；不调用DeepSeek，也没有DeepSeek思考强度。当前记忆`semantic=null`，纯语义查询标定尚未启用，不能据向量建索引就宣称正式检索已启用全部语义路径。

## 3. 显式工具与在线验收入口

这些不是插件自动每轮执行的额外任务，需人为运行；模型仍来自上述连接。本次未执行这些在线入口。

| 入口 | DeepSeek使用方式 |
| --- | --- |
| `scripts/check-models.cjs`／`npm run check:models` | 固定连通性测试使用expression，即Flash／low；还包含独立Qwen测试 |
| `scripts/validate-shared-story.ts` | 隔离共同活动验收，按叙事、个人、表达、记忆等实际阶段连接 |
| `scripts/validate-world-school.ts` | 非offline模式按世界／学校连接；offline模式使用替身 |
| `scripts/validate-prompt-context.ts`在线模式及`src/deployment/prompt-context-acceptance.ts`、`prompt-quality-acceptance.ts` | 按验收任务连接 |
| `scripts/memory-capacity-online-acceptance.ts` | 整理／审核使用memory_consolidation，即Flash／high |
| `scripts/stickers.ts`导入 | 新图描述使用sticker_description，即Flash／high；重建向量仅用Qwen |

收到用户图片／表情不调用图库描述合同；角色可读且开启新识别，或恢复既有pending时使用独立`incoming_image`。`scripts/validate-incoming-media.ts`默认离线，显式online使用公开／合成fixture，单请求等待300秒；`scripts/validate-local-web.ts`不调用模型，仅验证浏览器。离线启动检查、demo及插件smoke不作为真实DeepSeek调用；迁移时核验连接配置也不等于已请求模型。

## 4. 已实现的网页搜索配置

模型生成`webSearch`／`webRead` JSON请求，由HDSI执行本地浏览器查询和正文读取，再交给原模型继续生成。不依赖DeepSeek原生搜索，不需要搜索API密钥；付费搜索API尚未接入，不列为现有配置选项。

| 配置 | 当前正式有效值 | 已实现含义 |
| --- | --- | --- |
| `webSearch.enabled` | true（显式配置） | 是否向模型开放网页工具 |
| `webSearch.provider` | browser | 可选unconfigured／browser；启用但未配置provider会提前报错 |
| `webSearch.browser.engine` | bing（显式配置） | 可选bing／duckduckgo，不自动换引擎 |
| `webSearch.browser.navigationTimeoutMs` | 60000（显式配置） | 页面操作期限，包含排队、建页、导航和正文就绪等待 |
| `webSearch.browser.maxConcurrentPages` | 1（显式配置） | 本实例共享页槽上限，真实关闭／迟到建页排空后才释放 |
| `webSearch.maxSuccessReads`／`maxFailures` | 20／40 | 同一逻辑阶段累计，含修补／续调用／恢复；不是收费或HTTP次数 |

当前Koishi已配置Puppeteer，静态查找确认本机Chrome存在；服务就绪后才创建故事实例，仍需用户启动／重启使配置生效。当前提取器为`dom-v2/readability-0.6.0`，按原DOM可见性和清理后独立正文判断，不把隐藏内容或登录引导当已读正文。页面正文没有人为字符／token截断。独立浏览器验收脚本的启动等待默认60000ms，与页面操作期限分别计算。

已有公开工程验收中Bing成功返回候选并读取中文／英文目标正文，DuckDuckGo当时遇到验证码；这不证明当前任意网站可读，也不代表正式服务已启用或真实模型工具续调用质量已验证。详见[搜索原交付](../records/local-browser-search-20261009/DELIVERY.md)、[最新修复交付](../records/image-search-post-review-fixes-20261010/DELIVERY.md)与[搜索规则](../subsystems/REMAKE_V0.5_WEB_SEARCH.md)。
