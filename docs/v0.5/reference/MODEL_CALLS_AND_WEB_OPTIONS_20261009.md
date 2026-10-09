# 当前模型调用与网页搜索服务参考

更新：2026-10-10。新增图片输入和本地搜索已实现，正式配置及13个既有连接保持原值；下述正式配置白名单核对发生于2026-10-09。返回[版本索引](../README.md)。本表以代码基线`7eef283`及当日本地正式配置解析结果为准；[白名单配置证据](../records/document-model-audit-20261009/evidence/effective-models.json)不包含密钥、背景或配置全文。本次没有发起模型或搜索供应商认证调用。

## 1. 正式运行中的DeepSeek用途

13个既有独立连接保持使用`deepseek-flash`，主机为`api.deepseek.com`，输出模式均为`json_object`。下表列出14个逻辑用途；固定信息审核没有独立连接。

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

新增incoming_image逻辑用途：src/input-media/observe.ts，仅在visualInput启用且角色有权读取新图时调用；可选incomingImageModel，未配复用stickerDescriptionModel（当前Flash/high）。已知face／成功观察缓存免视觉请求。13个既有连接保持原值，独立覆盖可后续改Pro。

这不是每轮必须执行的14次调用。环境和维护准备使用原连接，不额外增加另一套模型。固定信息审核若要单独设置模型／强度，需要后续增加连接配置；当前改变`memory_consolidation`会同时影响整理和审核。

源码中`src/directors/world.ts`的旧环境辅助入口与`runSchool`兼容入口仍存在，当前正式每日链使用`generateEnvironmentStep`；旧辅助入口不构成第14个独立配置连接。

## 2. 如何修改与续调用

当前12个`models.<连接键>`及单独`stickerDescriptionModel`都可分别修改`model`、`reasoningEffort`。本地配置Schema接受`deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`；可将选定连接改成`deepseek-v4-pro`。强度接受`none`、`low`、`high`、`max`。上述是项目当前支持的标识，不是新增供应商可用性承诺。

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

收到用户图片／表情不调用图库描述合同；visualInput启用且角色可读时调用独立incoming_image四字段观察。默认正式开关仍关闭；本轮未执行真实图片／模型上传。新增scripts/validate-incoming-media.ts默认离线，显式online需公开／合成fixture；scripts/validate-local-web.ts不调用模型，仅验证浏览器。离线启动检查、demo及插件smoke不作为真实DeepSeek调用；迁移时核验连接配置也不等于已请求模型。

## 4. 网页搜索接入建议

当前`webSearch.enabled=false`，各阶段20次成功取得正文／40次失败规则已实现。DeepSeek原生搜索不可用不影响本项目的可替换方案：模型生成`webSearch`／`webRead` JSON请求，HDSI执行供应商操作，再把结果交给原模型继续生成。现有接口要求`search(query)`返回候选URL／标题，`read(url)`返回正文；已实现browser provider；若仅打开enabled而provider仍为unconfigured，正式入口会提前报错。

本地browser适配器已接入，webSearch支持provider及engine／navigationTimeoutMs／maxConcurrentPages。默认关闭；打开browser需本项目Puppeteer服务和可用Chrome／Edge；不要求搜索API密钥。Bing真实候选／正文及资源排空已通过独立公开验收，DuckDuckGo返回验证码，不自动回退。所有现有模型／强度未修改。

配置与证据见[搜索交付](../records/local-browser-search-20261009/DELIVERY.md)。下表中的付费服务仅保留作为未接入的后备对比，后续采用时需重新核对服务规则。

| 方案 | 适配现有结构的理由 | 需要注意的差异 |
| --- | --- | --- |
| **当前优先：本地Puppeteer浏览器** | 可迁移旧页面端口，搜索与正文都在本机执行，无搜索API计次费 | 仍依赖外部搜索网站与本机网络，需处理改版／不可读结果；已接入；正式开关仍关闭 |
| 付费候选：Tavily Search＋Extract | 同一家服务覆盖候选搜索和URL正文读取，适配较直接 | 搜索摘要不当已读正文；Extract使用无query的正文模式 |
| 博查Web Search＋正文读取器 | 可作为中文资料检索的对比候选；官方接口提供标题、URL、摘要和日期 | 仍需独立读取正文，例如接Jina Reader；需要比较实际资料质量和可达性 |
| Brave Web Search＋Jina Reader | 独立搜索索引与网页读取分开，便于分别更换 | 两个服务需要分别接入；不用有token预算的LLM Context替代完整读取 |

Tavily当前每月提供1000免费credits，无需信用卡；Basic搜索一次为1 credit，Basic提取每5个成功URL为1 credit，失败提取不计费。供应商计费与HDSI“20／40”是两套口径，额度按阶段读取行为累计，包括该阶段首次缓存取正文。[官方额度与计费](https://docs.tavily.com/documentation/api-credits)

若选择Tavily，建议候选搜索使用basic，关闭自动参数、答案生成与搜索正文附带；独立Extract读取使用markdown，省略`query`及其分块参数，避免把按查询挑选的有限片段误当完整正文。正文沿HDSI现有清理、缓存、引用和失败规则处理，不另设字符或token截断。不是每次查询都必须读取20页，20是阶段上限。[Search接口](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Extract接口](https://docs.tavily.com/documentation/api-reference/endpoint/extract)

博查官方Web Search示例返回URL、snippet与summary，仍须另取正文；本次没有核实其完整价格表，不给出费用估算。[博查官方接口](https://open.bochaai.com/)

Brave当前Search为每1000请求5美元，并提供每月5美元免费额度；Jina Reader可提取网页正文，其服务计费／速率规则需另看。此方案适合更重视独立索引和组件可替换性的情况。[Brave官方产品与价格](https://brave.com/search/api/)、[Brave接口类型](https://api-dashboard.search.brave.com/documentation)、[Jina Reader](https://jina.ai/reader/)

推荐依据是现有接口适配成本；尚未对中文实时新闻、学校网站、目标网络连通性或实际费用做本项目对比验收。具体接入时再用公开查询检查正文完整性、失败／不足返回、每阶段计数、缓存复用和checkpoint恢复。
