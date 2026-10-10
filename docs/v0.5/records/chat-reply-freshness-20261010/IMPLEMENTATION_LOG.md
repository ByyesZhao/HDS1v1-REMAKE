# 普通回复跟进新消息实施记录

基线：3fb4e1c。执行依据：reviews/chat-reply-freshness-20261010/EXECUTION_PLAN.md 与 REVIEW.md，保留 ASTRA 原始证据。正式服务保持运行；工程验证使用隔离数据，无模型联网、QQ发送或正式库修改。

采用 executing-plans、TDD 与隔离工作树。Windows 与 T1～T5 中文标题不适配技能 Bash 辅助脚本，改用本文件记录逐任务 brief、提交与红绿证据。

## 预检与任务依赖

- T1：输入版本、普通完整未读选择、开放批门禁；普通选择凭据供 T2 使用。
- T2：持久 waiting、候选门禁、冻结与首次 sending 原子边界；供 T3 续办。
- T3：同 ID 换代、必要事件接管、等待定时；消费 T1 的统一 eligibility。
- T4：generation 阶段身份与个人来源，附件终态保留；不能清 incoming_image。
- T5：真实磁盘重开、最终提交一次、旧合同兼容、全量检查与文档同步。

范围明确：15秒为开始生成门槛；首次发送尝试后保留尾段；事件轮按固定请求完成。新 JSON 字段可选，无库升级。每任务确认退出码后提交；最终独立复核一次。

## T1 brief

新普通消息与 revision 同事务；重复／控制／共享输入不增。旧 ready 不越过新 open，静默满后取所有普通未读，stash 无 pending 索引也可恢复。事件不捎带开放批中的普通消息。选择和 deadline 共用规则；无权限不产生过期空跑。

T1 RED：4/4 在旧实现失败；GREEN：4文件19项通过，退出码0（logs/T1-*）。沿用 Storage.unreadMessages 定向查询，无全历史正文扫描。旧起床测试调整为开放批期间事件不捎带普通输入。

## T2 brief

只处理有选择凭据的普通轮。阶段返回后检查，过时控制中断不暂停。冻结及首次 sending 事务内检查，零输出封口；第一段开始尝试后保留全部尾段。等待清候选并释放聊天 hold，图片冻结保留。

T2 RED：6项失败；GREEN：5文件30项通过，退出码0。首次 sending 门禁置于 sender try/catch 外，不会把换代误记成 retry。旧手工／持久轮没有凭据仍用原合同。

## T3 brief

持久 waiting 用专用宿主分支，单 unfinished 不改变。同 ID 改绑普通／到期事件，真正改绑 generation+1。事件接管输入／batch／check 为空，原未读留给后续。定时同选择规则，等待不能启动环境或维护；状态显示实际等待期限。

T3 RED：4项失败；首次实现定向回归发现 collectReady 抽取 prepare 后漏读 state，修正后 GREEN：4文件22项通过，typecheck通过（日志保留首次失败）。

## T4 brief

业务 stageKey=reply:generation:stage:taskName；同代际恢复身份／额度不变，换代独立额度。仅清旧业务 checkpoint，附件阶段和 ready/unrecognized/pending 冻结保留。最终本人查阅来源只取有效 personalRunId。真实 ModelClient 请求证明旧 lookup／repair／材料不自动注入。

T4 RED：2项失败；GREEN：6文件27项通过，退出码0（T4-green-complete）。中间测试修正 SQL 未指定排序和 lookupDetails 测试请求格式；原失败日志保留。新增真实 ModelClient 验证查阅／修补／公开缓存计数及实际图片 DTO；不用 mock 参数冒充权限证明。

## T5 brief

真实 SQLite 文件重开，覆盖 waiting、全 pending、sending、confirmed/retry、silent post、旧轮与事件接管恢复。检查有效提交一次、原消息批次不变；全量检查、演示、双场景 smoke、隔离启动检查后同步当前文档。
