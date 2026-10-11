# 夜间运行核对与导演联网软提示

日期：2026-10-11（Asia/Shanghai）。源码基线d94640e。先只读检查昨晚至今日的正式状态，随后按用户要求增加两条联网软提示；未改模型、强度、搜索引擎或配额。

## 1. 运行核对

检查窗口：2026-10-10 18:00起，抽查于2026-10-11约08:42～08:50完成。SQLite使用mode=ro/query_only及读取事务，只输出状态、时间、计数，不保存聊天正文、人物背景或认证。

- runtime.paused=false，lastError=null，无未完成故事轮或未读输入。该窗口6轮（自主2、聊天3、起床1）全部完成；全库12轮完成、29个输出均confirmed。
- 2026-10-11环境链06:00:00启动，world／school_campus／school_group／school_week均attempt=1、committed、lastError=null；最后06:00:24.963完成。
- 今日08:10:00起床轮于08:10:45.210完成，后续记忆索引于08:10:46.649结束；全库62个索引任务done，无保存的后台错误。
- HDSI父进程23:56:19启动，实际worker当前5141监听正常；SnowLuma3001监听及双方WebSocket连接为Established。
- SnowLuma夜间日志两条ECONNRESET在18:36:43／23:51:11，处于昨日停服更新时段附近；当前连接已恢复。今日日志仅用户提供的08:29:51序号警告，无ERROR/FATAL。

HDSI普通控制台没有在runtime目录持续落盘日志；成功任务会清理checkpoint，resume也可清错误。因此结论是“可查持久记录与当前状态无未恢复失败”，不保证每次请求没有临时格式修补或后来恢复的瞬时异常。未向QQ发送测试消息。

## 2. SnowLuma序号警告

本地SnowLuma1.14.22的index.mjs：warnMissingC2cSequence记录NT序号缺失并保留客户端序号；parseMsgPushInternal调用警告后仍return true，不由这条警告丢弃消息。缺少权威服务器序号会阻止依赖它的撤回／相关历史操作；它不是登录失败或WebSocket掉线。

本条kind=temp_message、from=2010741172，不是HDSI目标用户1000000001。实际Koishi配置白名单已只读确认；src/host/input.ts:isTargetSession及plugin-runtime middleware拒收非目标用户，不触发故事轮。本次不修改SnowLuma。

## 3. 联网使用及小调整

检查时全库web_operations为0，48个web_sessions的successReads/failures均0，说明虽启用搜索，世界／个人等阶段尚未实际调用搜索或读页；不能由“工具已开放”冒充联网新闻验收。

用户要求世界导演获取每日重要新闻的软提示，并允许个人导演查阅感兴趣的事。范围明确且已有工具链，直接调整：applicableResourceRules只在webAvailable=true时按stage附提示。世界建议查当日／最近24小时的重要公共新闻，核对来源和报道时间后决定是否更新；三类个人导演可根据生活、兴趣、交流需要主动查阅。维持自由选择、空结果及未知，不强制每次调用，不新增自动抓取、引擎或新闻任务。

查询仍只有本阶段可见资料；20成功／40失败、来源验证、缓存、修补／恢复合同和仅personal_life本人查阅可独立形成查阅类记忆均保持。可逆文案调整不新增仅镜像提示字符串的测试，运行已有提示／工具／来源／恢复回归及编译检查。

## 4. 验收与部署

隔离工作树验收通过：全量189文件／1034项、提示／工具／来源／恢复相关6文件／24项；typecheck、build、demo及双场景plugin-smoke通过。离线实际传输装配检查8种阶段／工具可用性组合，确认建议进入system消息且只按目标阶段和可用工具注入。证据见logs/。文档检查覆盖89份Markdown、760个本地链接、15个锚点及71个源码路径，均无缺失，见[evidence/document-check.json](evidence/document-check.json)。

独立只读复核未发现问题，允许合并：确认提示实际传输、工具额度耗尽时不继续注入、来源资格没有扩大。复核没有重复访问正式库，也没有判断真实模型搜索效果。

检查与调试不调用真实模型、浏览器搜索或QQ；软提示是否让真实模型主动搜索仍需后续正常运行观察，不因离线检查通过宣称已联网。2026-10-11执行runtime/stop.cjs已返回安全停止成功，待备份旧lib并构建部署；用户手动重启，SnowLuma保持运行。
