# 当前审核改进T1～T9交付

日期2026-10-09。源码基线c9e4599；代码提交5b5e068～7ae5bae，已快进合入主目录。T1～T9已完成；整分支独立复核发现的两项验收缺口和一项计时口径均已补齐，见[关闭记录](REVIEW_CLOSURE.md)。环境异步E1～E5为后续独立交付，未改变environmentPlanningVersion或环境HTTP串行准备。

## 结果

- B1：引用已有事件且省略日期，继承事件发生范围；单日期为本次时点，新事件无日期用本轮时间。保留并集，不用重谈时间扩大旧事件。实际解析、canonical合并、learned引用、旧post、检索及三阶段投影通过，不猜测修复旧污染记录。
- B2：idle增量和兼容扫描共享完整正文选批。150码点目标下120+120+120实际只主选首项；120+30+1选前两项；首项200仍完整入选。默认null不限；必要依赖可超过主选软目标。仅startedAt显式null的未开始任务刷新，按准确版本退回预留，原队位不被后到条目抢走。
- 记忆初始／补查不再构造普通recent，来源校验和权限继承保留；有限预算只对发送的owner投影计一次。个人资料准备在主叙事更新状态后由原runPerson门禁决定；不需要个人阶段时仍提交经历、合法研究进度和基础记忆。
- 普通V2窗口SQL选择完整四段，未读/活动隔离、Date.parse、JS字面ID、outbox稳定顺序与纯选择器一致；V1读取和恢复保持。查询函数不进入持久索引。
- 环境检查只读活动批次及步骤元数据；学校评价只读活跃通知与相关实体和最新真实知情。公开版本、记录版本、epoch、后插入平局及同次发布/失效保持。
- 逐条清理只修剪相关活动任务，新终态即时压缩；旧终态正文由显式离线有限回收处理。未完成恢复、统计、原始消息和来源不删。资料池使用请求内Set，首次身份/正文/顺序及不同版本保留。

## 验收与工作量

最终全量：137文件776项通过；typecheck、build、离线demo、双场景Koishi smoke退出0。均为脚本模型／合成内存或临时库，没有外部模型、真实QQ、正式库或私有配置访问。

| 入口 | 实际证据 |
| --- | --- |
| 全量 | logs/main-full-suite.log：137/776，87.86秒；之前隔离验证136/761另存full-suite-final.log |
| 类型／构建 | logs/main-types.log、main-build.log |
| 演示／插件 | logs/main-demo.log、main-smoke.log：empty_week／required_notice |
| 普通窗口／清理 | benchmark.json；脚本check-current-audit-workload.cjs，6样本 |
| 环境／学校 | scheduling-query-results.json；脚本check-scheduling-queries.cjs，32样本 |
| 文档 | document-link-check.json：22文档209本地链接，无缺失（不检查锚点） |
| 各任务RED/GREEN／兼容 | IMPLEMENTATION_LOG.md与logs/；原基线成本红测t7-cost-red-baseline.log |

固定4段各41条消息，在H=1000/10000/50000历史下，每次解码164条完整消息＋4段，rank候选4行，写入0；原生EXPLAIN确认排名不从messages主表取data列。SQL仍扫描合格历史索引标量；热样本中位数约5.0/41.2/278.2ms只是此次观测，不是保证或验收阈值。

环境0/90/180天历史下，deadline／metadata各2条环境查询：1批次JSON＋4条步骤标量，不返回步骤全文（deadline另读1份runtime）。已有身份ensure只有当前身份与active查询，加1份runtime，无写入／步骤全文；full select在metadata基础上只追加1份主键步骤正文。真实ready提交后的完成检查仅1条metadata、4行标量，全部committed才写batch；固定过期active只改3个未提交步骤，原committed与无关历史原样保持。学校H=0/1000/5000，A=0时只有1条活跃通知查询，A=3/I=2/J=1/K=2时5条查询、8份JSON；发布后三消费不再读取学校表。相关实体各追加1000/5000旧知识时仍每键返回1份，但SQL内部尾部排序／UDF成本会上升，不能声称恒定时间。

首次耗时计入各夹具的真实首次入口调用（含探针记录开销），随后五个hot样本；并非进程冷启动。改变数据的提交／supersede只计数一次，不伪造同状态热样本。

清理K10，原基线H1000/5000实际重复更新40000/200000次历史终态；新实现H0/1000/5000四类历史更新均0，owner删除10。旧载荷混合回收limit3合计不过3，多次续跑至0，重复更新0；真实触发器统计而非仅spy saveJob。

只读无新索引旧库能查询且文件未改；可写首次／重复安装索引保留每表id/data/rowid。离线回收备份可打开，当前批故障回滚、前批保留。R1失败、停止、重开、ready应用重试、剪除及累计修补回归保留通过。新15项参数矩阵实际使用有限回收器，覆盖环境5状态、维护4状态、turn两状态及index4状态，完整网页资料／操作／真实self-read来源和计数身份未变；非终态恢复正文原样保持。

## 兼容与运行

不改正式配置、背景、库或服务，不增加供应商／网络调用。npm包与业务协议版本保持。

旧残留检查和回收：
```powershell
npm run memory:compact-payloads -- <数据库路径> --dry-run
npm run memory:compact-payloads -- <数据库路径> --apply --stopped --batch-size 50 --max-batches 20
```
只有停服后才apply，有候选才备份DB及存在的WAL/SHM；默认目标库同目录backups/memory-payloads/UUID，也可--backup-dir。hasMore=true可重复续跑；不靠memoryCapacityVersion推断清空，后台逐owner不循环运行此工具。本次只在测试临时库验证它，未对正式库执行。

## 执行中裁决

- 按统一计划先交付T1～T9；独立E1～E5留后续。代价：环境HTTP仍占串行步骤，当前不承诺环境模型计算时完全不占前台。
- Windows任务簿脚本与拆分T标题不匹配，以等价ledger和本过程记录保留任务brief、BASE、RED/GREEN，测试门禁未省略。代价：不用原Bash汇总入口，证据从本目录复核。
- 普通SQL选择抽出chat-sql.ts、四表回收抽出payload-compaction.ts，Storage／MemoryStore公开入口与合同保持。代价：多两模块，减少混合职责。
- 新50k压力播种因新增索引维护超过Vitest默认5s，单项允许20s执行期限；确定性解码／写入断言不变，没有放宽模型或产品时限。代价：真实卡住最多多等15s才由测试终止。
- 旧容量验收显式调用有限回收后检查旧载荷；删除业务仍要求立即剪除活动快照，并保留前台让位断言。代价：历史终态正文需运维入口回收，本身不混入每次删除。

主目录首次受限执行在Vite配置加载／测试子进程启动阶段失败；相同离线命令获执行许可后137／776通过。未将环境失败当成业务回归。主目录原有未提交文档及审核材料保留，仅提交本批实现相关说明；未推送远程。

原ASTRA审核及失败证据保留历史含义；未启用搜索供应商、semantic=null、数月运行／真实QQ／新图视觉尚未验收的边界不变。
