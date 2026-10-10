# 查看消息资格与专注场景交付

日期：2026-10-10。状态：代码已集成并构建，正式库已停服备份修正，等待用户手动启动；真实QQ效果尚未验收。产品范围基线a66a89c→7929b85；[实施合同](../../plans/phone-access-20261010/README.md)、[ASTRA计划审核](../../reviews/phone-access-20261010/PLAN_REVIEW.md)、[过程记录](IMPLEMENTATION_LOG.md)。

## 实施结果

- 普通专注活动默认允许查看，由个人导演决定now/later/none；没有新增专注状态枚举或强制回复。
- 普通／共同主叙事的phoneAccess=false必须指定结束时间，严格晚于startsAt；错误沿用最多两次格式修补，仍失败按原规则报错暂停。
- 读取资格、消息检查、睡眠、共同活动及恢复沿用既有实现。已确认分段不重发；发送结果未知的分段仍重试。
- 本批一次性[现场脚本](repair-state.cjs)仅匹配已知活动开始时间及描述指纹，停服后同事务更新查看资格、复用普通未读检查；不提前标记已读，不改自主时间／生活经历。CLI先备份数据库及WAL／SHM；未知现场、合法状态和未完成轮不应用。

## 实际验证

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| 既有基线 | 5文件23项通过 | [baseline](logs/baseline.log) |
| 合同失败回归 | 8失败／3通过，旧代码接受false+null和零长度区间 | [task1-red](logs/task1-red.log) |
| 合同修复 | 11项通过 | [task1-green](logs/task1-green.log) |
| 协议2及既有相关流程 | 8文件51项通过，含磁盘关闭重开与未知发送恢复 | [task2-green](logs/task2-green.log) |
| 部署失败回归／通过 | 6项失败→6项通过，含原子回滚和未读过滤 | [red](logs/task3-red.log)、[green](logs/task3-green-final.log) |
| 全量（隔离／主项目） | 各179文件954项通过，121.54秒／127.84秒 | [隔离](logs/full-test.log)、[主项目](logs/main-full-test.log) |
| 类型／构建 | 隔离及主项目均通过 | [主项目类型](logs/main-typecheck.log)、[主项目构建](logs/main-build.log) |
| 演示／双场景插件验收 | 隔离及主项目均通过，仅合成服务 | [主项目演示](logs/main-demo.log)、[主项目双场景](logs/main-plugin-smoke.log) |
| 启动门禁 | 新构建及正式库只读检查通过，无联网，不启动服务 | [主项目启动器检查](logs/main-startup-check.log) |

主项目首次沙箱复验在导入阶段找不到临时SSR缓存（174文件失败、5文件27项通过），[原错误](logs/main-full-test-sandbox.log)保留；在与隔离验收相同的非沙箱环境复跑954项通过，没有修改测试断言。过程中的测试接点错误／类型检查失败保留原始日志；不是产品失败回归证据，不用它们替代task1-red／task3-red。部署工具红日志表示工具未实现的行为断言，不是已有产品被证实的六个缺陷。独立复核1项Important已修复，CLI与部署13项、全量954项通过，见[复核记录](INDEPENDENT_REVIEW.md)及[关闭证据](REVIEW_CLOSURE.md)。

## 正式部署与后续启动

15:27只读预检仍匹配旧文献场景，3条普通输入未读；HDSI仍监听5141，故没有执行正式写入。[预检报告](evidence/formal-precheck.json)只保存时间、计数和指纹，不含原消息、角色设定或密钥。

本批已执行的命令形式如下；实际备份目录和结果在下方记录。再次部署需重新确认停服、当前状态并使用新的备份时间标识：

```powershell
node docs/v0.5/records/phone-access-20261010/repair-state.cjs --database D:/HDSI-remake/runtime/data/hdsi-remake.sqlite --stopped --apply --backup D:/HDSI-remake/runtime/archive/batches/phone-access-20261010-BACKUP_TIMESTAMP --report D:/HDSI-remake/docs/v0.5/records/phone-access-20261010/evidence/formal-apply.json
```

只有eligible现场会备份并修正，场景已变则跳过，不强制解除真实不可查看状态。命令不启动服务、不发送QQ消息或调用模型。

用户确认停服后，核实5141无监听、Koishi实例退出；15:40再次只读确认仍匹配且没有未完成轮。[停服证据](evidence/stop-verification.json)、[停服预检](evidence/formal-stopped-precheck.json)。15:43完成主项目构建及[正式修正](evidence/formal-apply.json)，备份为`runtime/archive/batches/phone-access-20261010-154324/`，包含旧lib及数据库侧文件。

[只读差异验证](evidence/formal-delta-verification.json)确认：character仅phoneAccess改为true；其他state不变；39张其他表内容指纹一致；只新建／更新1个普通未读检查任务；3条输入仍未读，67个表情包保持。可用本批[验证脚本](verify-formal-deploy.cjs)在服务再次启动前复跑，启动后新业务变化不再符合停服差异基线。

现在由用户双击根目录`start-hdsi.cmd`启动HDSI；SnowLuma可继续运行。启动后按正常流程补叙事并处理积压，个人导演仍可沉默。真实QQ是否回应、图片和在线模型质量不以工程测试冒充验收。

本次没有修改模型参数、图像／搜索开关、记忆规则或计时参数。此前只读诊断和线上运行证据保留原基线；工程验收不证明真实模型永不误判场景。
