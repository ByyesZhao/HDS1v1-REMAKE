# 第七轮审核修正：执行计划与实施记录

依据：DSH-review/CODEX_REBUTTAL_MEMORY_V0.3_DELIVERY_20261007.md，以及用户本轮决定：搜索结果不足就反馈“结果不足”，不自动补配置来源，允许角色结合场景向用户询问。

目标：按已接受规则修正记忆可见性、字段和时间范围、维护应用退避、搜索错误及不足反馈；不增加人为字符预算，不改阶段独立20／40或有限格式修补，不启动服务／联网。

执行方式：使用 executing-plans 与 test-driven-development，在当前目录依次实施，每任务先RED后GREEN，最终完整回归及一次独立复核。目录无Git，当前src/tests/docs/README基线备份于runtime/review7-backup-20261007，不创建虚构提交。

## 任务与接口

### 任务1：检索可见性与可选预算

- [x] tests/review7-memory.test.ts：archive在第1天不提供预备长期，七天边界开始提供，到期仍可追问；high立即生效；结构化lookup沿同门禁。
- [x] src/memory/store.ts：archive只绕过到期，不绕过retainedFrom。
- [x] src/memory/retrieval.ts：可选预算保护id或sourceIds命中；always合计限制不修改计数基数。默认仍null。
- [x] 运行新回归先见预期失败，再确认通过。

### 任务2：记录字段、事件范围及索引

- [x] tests/review7-memory.test.ts：新建／更新不保存DTO控制字段，旧控制字段不回传；合并保留时间范围和最新更新时刻；常驻提升立即归零窗口计数；纯非索引文本变化不重复索引。
- [x] src/memory/types.ts、store.ts、lifecycle.ts、retrieval.ts：happenedAt为已知范围起点，新增可选happenedUntil为已知范围终点，旧记录缺终点按起点读取；lastEventUpdateAt仍表示处理进展时间，不冒充事件终点。create/update可提交有来源依据的时间。
- [x] 索引revision只按既有索引模板文本变化递增；保留不同stable_understanding结论，不按canonicalMemoryId删除。
- [x] 运行新回归及生命周期／最终复核测试。

### 任务3：应用失败回滚与调度退避

- [x] tests/review7-maintenance.test.ts：人工注入单元写入中途异常，正文／标记一起回滚；ready保留且五分钟后重试；其他就绪任务与聊天继续；不产生0ms定时循环；索引应用亦适用。
- [x] src/memory/maintenance.ts：整个事务外捕获，记录retryAt／lastError；ready可继续保持ready，统一各入口对retryAt的判定，不误标stale、不重调已经准备的模型。
- [x] 运行新回归及既有host／维护测试。

### 任务4：搜索结果不足与错误边界

- [x] tests/review7-web.test.ts：配置来源不注入候选；零结果／部分结果明确返回不足反馈；模型可据反馈决定询问用户；非法URL逐项记失败、合法项继续；恢复不重计；非数组结果记search_error；HTTP(S)配置校验。
- [x] src/web/service.ts、types.ts、deployment/web-runtime.ts：取消initialSources自动读取；结果附message／requestedPages／obtainedPages，不足反馈为“结果不足”，不暂停故事或伪造资料。
- [x] src/model/client.ts：工具结果送回同阶段，提示允许承认未知、按对话需要向用户询问，仍经原个人导演／表达合同输出；合法工具不耗修补，成功接受工具后清理旧repair提示但不重置repairCount。
- [x] 运行新回归及既有web测试。

### 任务5：同步规范、验证与交付

- [x] 更新两份记忆／两份搜索权威文档、交付说明及两份实施记录，补真实事务边界、合法工具、无未读候选、配置来源不兜底和本次证据。
- [x] npm test、npm run typecheck、npm run build、离线Koishi smoke及两个启动文件--check。
- [x] 一次独立复核；有实质发现时先补失败回归再修正，最终保存证据，不进行真实联调。

## 判断与进度

Pre-flight：任务1和2共用MemoryCandidate与存储投影；任务2新增可选时间字段兼容旧行；任务3沿用现有job.retryAt不新增任务状态；任务4附加工具响应字段可恢复旧结果，阶段身份／20/40不变；任务5以最终实现回填规范。

Ruling：本轮修正属于已经批准的rebuttal范围，搜索不足行为以用户最新指令覆盖原建议的配置来源兜底。旧审核快照不追改；权威文档与本记录保存当前实施结果。

Ruling：不运行依赖Git的技能脚本，不删除现有备份或实施记录；以本文件作为持久进度，最后保留给用户复盘。

当前：任务1～5均已完成；保留代码、备份和记录，服务未启动。


Task 1: complete — 新回归先3失败／1正常分支通过，修正后存储／检索合计17项通过。

Task 2: complete — 六项实际缺陷回归先失败；时间合同夹具参数修正后确认缺字段失败。新增常驻投影时间／来源补验先失败后修正。最终记忆／生命周期／原最终复核合计27项通过。

Task 3: complete — 三项失败回归确认整笔抛错及1001次即时wake；修正后维护／host共17项通过。Ruling：另一任务成功应用产生正常索引待办，允许它立即调度，测试先完成该索引再断言失败任务五分钟截止，不能把正常工作误判为空转。

Task 4: complete — 七项新回归先全部失败，修正后相关网页专项32项通过；再补失败40边界与已确认非法URL中断恢复。本轮三文件23项通过。

Ruling：happenedUntil为已知范围终点，不代表事件已结束；旧记录缺字段按happenedAt理解，无需重写正式库或改变schema3。常驻经历同步时间及新来源只改stateVersion，索引文本不变时不重建向量。


Task 5: complete — 21:27完整npm test：42文件200项通过；npm run typecheck、npm run build均退出0；npm run smoke --prefix runtime真实Koishi Context离线加载通过；start-hdsi.cmd --check与start-snowluma.cmd --check均退出0。README、四份权威文档、相关根目录接口／记忆／恢复说明、交付说明、文档审核索引及两份原实施记录已同步。

## 独立最终复核

采用executing-plans／requesting-code-review要求的一次新上下文只读复核，按备份差异、调用链、四份规范和23项新增测试源码交叉检查。Critical 0、Important 0、Minor 0，不需追加修正回合。复核者没有另跑测试，通过数量以本次主执行者的实际输出为准。

复核重点确认：archive生效门禁；DTO落库／旧投影清理；事件范围和常驻投影／索引；整个应用事务回滚后退避且前台继续；搜索配置来源不注入、不足消息持久化及同模型续调用；非法URL独立计数、40边界和恢复去重；清旧repair提示不重置次数。

复核边界：未判定人工构造未生效却durable的数据、退避保存本身同时失败的双重存储故障；模型语义错误不通过新增自动审核扩大范围；真实搜索provider、Qwen语义阈值及QQ联调仍按既有接入待办处理。未读取私有角色材料，未启动服务或联网。

Ruling：finishing-a-development-branch检查不适用Git合并／PR选项，因为当前目录不是Git仓库；按用户授权把成果留在D:/HDSI-remake，不删除备份／记录，不发起无关集成确认。
