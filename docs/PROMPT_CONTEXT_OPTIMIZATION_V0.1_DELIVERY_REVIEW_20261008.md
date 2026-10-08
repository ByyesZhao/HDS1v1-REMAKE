# 提示词与上下文优化 V0.1 交付验收记录

任务1～12已落实。权威约束仍是[实施细化](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_20261008.md)和[执行计划](PROMPT_CONTEXT_OPTIMIZATION_V0.1_EXECUTION_PLAN_20261008.md)；逐任务过程见[实施日志](PROMPT_CONTEXT_OPTIMIZATION_V0.1_IMPLEMENTATION_LOG_20261008.md)。本文件记录实际证据与限制，供DSH复核。

## 1. 资料身份与字段迁移

| 旧输入 | 本次模型输入 | 保留的语义 |
| --- | --- | --- |
| recent/visibleMessages/reconsiderMessages各自携带正文 | resources.messages一份，roles.recentIds/visibleIds/reconsiderIds | 历史、首次可见与已看复议仍分开；普通主叙事不获本轮未读输入 |
| 最新30条原文 | 默认4个完整对话段，15分钟双方真实消息空闲结束 | 当前计入4段；共同活动／未结束回复保持；40条单段不截断 |
| history/details/retrieved及lookup顶层记忆 | resources.owners＋detailRefs/shortRefs/longRefs/learnedRefs | 同身份版本一次；不同revision/stateVersion得到不同ref；具体事实时间及稳定认识依据保留 |
| 向量、容量退出、整理版本等存储字段 | 常规模型视图白名单不传；Host快照仍完整 | 不减弱维护readSet、来源和冲突校验 |
| 网页累计正文、工具结果及补查重复材料 | resources.materials＋各处materialIds | 正文仍完整；失败／不足、计数和外部资料资格仍保留；修补原响应不强行去重 |
| shared scene轮数、时钟、outline及sharedMeta重复 | sharedMeta唯一轮号／阶段权威，outline一份 | lastPublicNode与本轮publicNarration仍不同，null不拿旧正文顶替 |
| 无来源记忆提取／无兼容语义路径的query embedding | 程序在请求前跳过 | 共同经历或本人网页来源仍正常提取；不把复议、检索命中当新来源 |
| school_week实例／通知声明／版本机械输出 | v1模型只给noticeTexts和weekNotes | 程序展开、固定课次与声明；无必需通知免调用也保存冲突／覆盖；旧v0恢复保留 |

同次请求只按身份去重，不按语义相似删事实。默认不加输入字符／token预算；真实接口容量错误保持原负载、原失败轮并暂停，不自动删减。

## 2. 真实隔离验收

使用用户已有授权：本地角色背景、初始稳定细节和合成剧情／记忆。使用本地配置认证，密钥只在认证头。无正式聊天、图片、QQ、真实搜索服务或embedding调用。正式库未进入在线验收；完整报告留在本地忽略目录runtime/data，本文不复制私有背景或完整输入。

| 本地报告 | 实际结果 |
| --- | --- |
| prompt-context-online-20261008.json | normal/shared/life/empty均完成；HTTP 4/5/2/2，共13，其中共同1次格式修补；embedding 0 |
| prompt-context-quality-20261008.json | 首批表达／课程通知／冲突样例，共5次HTTP；发现确定联系承诺被改成询问，随后补强保真提示 |
| prompt-context-expression-recheck-20261008.json | 2次HTTP；否定、明天10点联系承诺、变动手机事实与动作均保留 |
| shared-acceptance-fccb74c7-13fe-4e4c-a623-05b8fb14c149/interactive.json | 6轮真实模型故事，25次HTTP，1次修补；首轮公开开场，第6轮用户要求结束后公开收尾；无输入轮允许代写，有输入轮用户代写清单为空 |
| shared-acceptance-9c41311c-8416-4ed4-b506-0b1fb36feff2/wrap.json | 从已完成16轮的冻结种子接续17、18轮，8次HTTP，1次修补；第18轮合理暂停并收尾，goal/endingCondition沿用，不靠删线索冒充全部完成 |
| shared-acceptance-6ffbcfef-344e-45e0-bd07-b53795d830ff/final.json | 从19轮种子运行第20轮，6次HTTP、2次修补；公开最后关卡过程与结算，openThreads空，个人导演end，记忆正常提取 |
| prompt-context-quality-final-20261008.json | 6次HTTP；明确接住用户仍在店外的纠正，保留已公开历史；结果不足允许询问 |
| prompt-context-quality-complete-20261008.json | 7次HTTP、1次修补；4条课程通知语义／绑定一致；角色自行选择优先组会并准备请假，不把计划写成获准；结果不足主动询问方向；发现表达新增“刚拿到手还在熟悉” |
| prompt-context-expression-final-20261008.json | 再补不新增取得时间／使用状态／经历规则后，2次HTTP；两种模式保留否定、确定联系时间、当前手机和线下动作，未再新增该细节 |

这些落盘成功报告合计74次HTTP（含修补）。另外一轮新增质量夹具因少传sharedMeta在共享合同检查阶段中止，前置请求没有落完整成功报告；74不是本次全部计费请求数。类型检查还曾检出夹具advanceReason错误，已修复。不得把缺失报告算成零请求或从字符数推算费用。

首批正常输入字符观测（不含system/schema）：普通叙事10512、个人10710、表达7331、记忆5541；各阶段池内消息分别43/44/44/5，身份无重复。普通叙事未包含本轮未读current，个人包含current及43条历史（4完整段，其中一段40条）；记忆只给当前合法来源，不把全原文窗当新来源。只比较实际字段／身份，不宣称固定token下降比例。

学校合成样例课程为10月8日周四14:00–15:00与10月9日周五09:00–10:00，均教一301；提醒分别13:00和08:00。正文正确区分通知发布时间与课次开始时间，两条提醒的instanceId/occurrenceKey对应各自课次。issue／week_digest正文同样列出两次课，没有把提醒时刻当上课时间。

## 3. 语义观察及限度

交互第4轮最初略过用户“仍在店外”的纠正，不能称原多轮故事已证明澄清通过。补齐resources用途说明及本轮纠正优先后，独立共享个人导演样例明确承认看岔并按店外继续。此复验是定点语义样例，不是把整条6轮故事重新生成。

表达两次发现的承诺弱化／新增手机使用细节已通过提示补强并复验。语义质量仍是模型行为，不增加字符串规则冒充完整含义校验；本次样例通过不保证所有未来表达零偏差。wrap/19→20使用冻结种子专测后段，不伪装为连续从第1轮跑到20轮的全程验收。

结果不足样例使用合成不足状态，不调用未确定的搜索供应商；它验证个人导演可以询问。搜索失败／不足的真实工具协议、额度和后续调用由既有自动回归覆盖。context_limit用模拟Response验证，未刻意向真实接口提交超大负载。

## 4. 最终独立代码复核与修复

独立审核对象为f891c48..本交付分支及任务12未提交差异，读取两份权威文档，不读取私有配置正文，不调用API，不沿用以前reviewer。单轮结论With fixes：Critical 0，Important 2，Minor 1。

1. Important：正常迟读使输入段已关闭，合法binding={episodeId:null,holdReply:false}在失败恢复时被当损坏。新增late_read_closed_episode_with_null_binding_can_resume_after_model_failure先失败，再区分缺失／非法hold／应保持当前关联，合法空绑定可resume，不重开旧段。
2. Important：lookup真实RetrievedContext顶层shortTerm/longTerm/learned未被投影，完整存储owner和重复正文绕过池。新增实际形状回归先失败，再统一projectOwner和版本ref；detailHistory、两种网页材料字段也保留引用。
3. Minor：历史安全警告未记录运行日志。新增失败回归后，start/resume经统一checkDialogue将安全ID／原因送onWarning，Koishi logger.warn落日志，不含消息正文；不阻挡正常启动。

修复后主代理指定回归、类型检查、构建及完整测试通过。未新增防御编程体系，也未再开启第二轮独立审核。

## 5. 部署、提交与审阅

正式库迁移前消息／活动／在途均0；停服确认后备份并升级dialogueContextVersion=1。备份位于runtime/prompt-context-backups/dialogue-20261008150036587-87c15b07-a6d2-415a-a967-b41592359cd3。旧消息、来源和记忆不删除。config.local.json使用4段／15分钟及已批准background-views.local.json；风格及各用途映射可修改，下次启动读取，原作者文件和现有details保留。

基线83文件473项；本次最终98文件536项，typecheck/build通过。dc68d4d已本地fast-forward合入main；主目录typecheck/build及98文件536项再次通过，离线demo通过。Start-HDSI.cmd --check与Start-SnowLuma.cmd --check均返回0，服务进程核对为0；正式库只读检查version=1且canApply=true。无远程push或PR。任务1～11提交依次f352dc9、bf0eb2d、f4f463a、3a338fc、604623b、59735b4、a9f570c、67d4fc9、6e98876、d2df815、e7f6894；任务12提交dc68d4d；本地合入记录见Git。

执行账本的全部裁定：中文“任务”标题不匹配技能bash提取器，采用Python／PowerShell等价提取、逐任务简报和日志，并人工逐项核对源计划；没有降低需求或略过测试。逐任务账本存本地runtime/data/prompt-context-process-20261008/worktree-process（54文件哈希核对一致），主目录最终全套输出在上级main-suite.log，本文与实施日志为可提交的复盘入口。DSH审阅建议看两份权威文档＋实施日志＋本文＋BACKGROUND_VIEW_MAPPING_20261008.md；历史方案／rebuttal按需追溯。
