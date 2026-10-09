# 当前审核改进实施过程

日期2026-10-09。源码基线c9e4599（含b398699），隔离工作区codex/current-audit-improvements；保留主目录已有文档和审核材料。执行T1～T9，E1～E5独立后续不纳入本次交付。仅离线夹具，不读正式库／私有配置，不启动服务。

## 预检与裁决

共享接口一致：T3检索通道→T4/T8；T4查询专用Date.parse UDF→T6，不写进持久索引；T5环境元数据→后续E；T2准确dirty释放→T7修剪。按T1到T9串行集成。Bash任务簿脚本与拆分T标题不匹配，采用同格式本地ledger与本记录保存brief、BASE及RED/GREEN证据，不省略测试门禁。

## T1：事件时间

已读日期解析矩阵与引用／许可规则，先添加真实解析、生命周期、检索及投影回归。

基线首次缺lib导致smoke/benchmark两个加载失败；构建后完整122文件693项通过（70.19s）。T1测试初次夹具mergeLong拼错已改为真实merge，纠正后9失败/1通过，均为事件日期断言。
T1完成：修正缺日期／单日期默认；已通过真实canonical合并、learned引用、预备许可、旧post、检索与三阶段投影。5文件40项通过，typecheck退出0。原日期污染历史不批量修正。

## T2：字符选批与未启动任务刷新
新增完整正文选批器；主选集保持FIFO、首条超目标仍完整入选，依赖闭包不受软目标裁切。等待任务只在startedAt显式null时刷新；旧字段缺失和已启动任务保持冻结。RED补齐后9失败/3通过；GREEN7文件54项通过，typecheck退出0。绿色测试前修正夹具：长期发送字段是eventSummary，undefined参数不能被默认null覆盖。默认batchCharacters=null未变。


## T3：通道门禁
先校正活动夹具的description/startsAt/phoneAccess，随后RED真实断言：recent关闭未实现、缺lookupForMemory API、免个人分支仍准备资料。GREEN8文件40项通过，typecheck退出0（测试触发名改为合法check_messages）。默认普通阶段结果保持，记忆补查只对发送的owner投影计一次可选预算。


## T4：普通窗口SQL
RED6项均因缺接口／UDF失败；GREEN9文件52项通过。新增1000/10000/50000段样本，每次窗口全文164消息+4段，写入0；3规模测试通过，typecheck0。JS原选择器对照覆盖未读、活动、missing/null、时间offset/小数、非BMP段ID、稳定outbox排序、回滚和非法日期兼容。SQL历史标量聚合仍随H增长。


## T5/T6：环境与学校定向查询
T5 RED2项因缺元数据入口失败，GREEN6文件33项；T6 RED3项因全集读取和缺定向入口失败，GREEN10文件57项。共享规模探针15样本通过：环境历史0/90/180天；学校0/1000/5000历史、A=0/3。空候选1条学校查询，固定3候选5条查询/8份JSON；发布后不回查学校表。计数暴露deadline二次读取runtime，已合并为一次。未引入异步环境、跨轮缓存，原ready／时区／公开版本资格保持。

