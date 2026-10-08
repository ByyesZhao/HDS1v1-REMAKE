# 世界与学校规划 V0.4 实施日志

日期：2026-10-08。起点：`690a5ed`，隔离分支 `codex/world-school-v4`。

执行依据为实施细化及执行计划，任务1～8顺序推进。HDSI／SnowLuma保持停止。密钥、正式配置、数据库及备份不入Git；在线验收仅使用已授权角色背景和隔离模拟剧情，不连接QQ。

## 接口预检与裁定

| 生产任务 | 消费任务 | 固定接口 |
| --- | --- | --- |
| 1 | 2～6 | EnvironmentStore／SchoolStore复用Storage事务；环境版本旧缺项为null |
| 2 | 3、7 | Generator返回原始结果，runtime一次分配ID、冻结及应用 |
| 3 | 4 | school_week唯一模型候选来源，calendar只推导必需集合 |
| 4 | 5 | 通知refs冻结版本；releasedAt不等于readAt |
| 5 | 6～8 | 实际观察与研究经历在故事段B原子提交 |

Ruling：技能task-start只匹配英文Task标题，本计划使用中文“任务”；保留原计划，手动提取任务brief并记录BASE，task-done仍使用原计划路径。理由：不为了工具改写已审设计；风险仅为记录工具兼容，无产品语义变化。

## 任务1：配置兼容及存储

进行中。依赖通过npm ci按锁文件安装，未新增依赖。

RED：新增7项失败，原268项通过。首次完整回归：276通过、1失败（旧模型数断言11，应为13）。任务专项15项通过，typecheck退出0；先前登记全绿是记录错误，已更正。新增JSON表与两类Store复用同一Storage；旧runtime字段只在读取时缺省null，未写回。兼容加载在Schema前执行，复制独立对象，显式错误不回退。工具demo／已有共同验收因必需依赖提前装配Store，其行为未改。任务1完成；调度尚未启用。

任务1最终全量：277／277通过，52文件，退出0。旧部署断言已按三个学校角色更新。提交c0b0bca及本次补记。

## 任务2：独立环境批次
BASE见账本。RED：新调度模块尚不存在，六个业务用例待实现；未用此模块缺失结果冒充业务断言已执行。

任务2 GREEN：53文件、285／285通过；typecheck退出0。消息在阻塞的fake世界请求中立即落库，完成后先故事／记忆，再校园阶段；ready前序不放下游。跨日返回仅保留冻结审计，不应用。原环境测试提前同步为新协议，旧共同升级夹具直接构造历史冻结候选，不重新调用已退出的旧school。新学校非空结果解析留在任务3／4，当前明确报未装配而非悄悄丢弃。

## 任务3：三个学校角色与网页阶段
BASE=8993511。RED：合同模块尚不存在；随后职责、版本、URL、空结果及会话用例通过。GREEN：54文件294项通过、typecheck退出0。各school_*任务使用独立模型键，环境owner及稳定step.id/generation；重试只重置失败修补，不清成功工具、lookup和计数，次日新步骤0／0。背景完整提供且无私聊列表；归属上游输入分开。create clientRef一次解析为程序ID，更新保持身份；非公开stageInfo不增加deliveryRevision。周非空解析将在任务4接入，当前显式报未装配。没有启用搜索provider。

## 任务4：周日历与通知发布
BASE=cc32892。GREEN：56文件307项通过（最终全量），typecheck退出0。周五包含下周、周一沿用身份；once/weekly/deadline用稳定元组和SHA256标识，同一课次改期保持ID。必需更正从已下发／曾发布／已知及deliveryRevision恢复，覆盖记录不能代替候选。releasedAt在失效后保留；read快照不改。未来未知草案预排最新issue；默认提醒本地前1日／120分钟，错过的旧提醒不成串补发。collectReady门禁后事务发布，唯一Host计时器包含publishAt；未知结束不可读不贡献立即截止，合法未来提醒仍有将来截止。
Ruling：requiredNoticeKeys额外携带entityIds，固定候选宣告范围；它是原有真实引用／周摘要声明要求的可校验表示，无新预算或模型职责。防止摘要带入未下发草案。周解析移动到school/calendar，学校事务应用在school/changes由runtime使用，同样复用Storage事务。

## 任务5：角色知识与故事事务
BASE=6ff59d7。RED：未知学校引用、拒看立即重复唤醒及未提交knowledge的业务断言失败。首次全量仅旧共同合同的默认数组相等断言失败，按兼容缺省[]更新；最终58文件316项通过，typecheck退出0。程序先验证观察index/冻结通知版本/发布与可读时刻，分配经历ID后给个人本轮投影，段B才保存。注入school_knowledge写入失败证明notice已读、经历、知识一起回滚；恢复及重复后处理不重记。拒看nextWakeAt设未来活动结束或null；正常故事仍可合并。纯通知不抽联系，实际获知才单独个人生活调用。研究进展有已知research及实际experienceId，意图/通知不自产成果，completed不关任务或等于导师认可。
Ruling：未知活动结束缺少中间转场时点时，过去不可读区间只允许在at实际读取，或在主叙事给定明确新phoneAccess活动startsAt之后读取；不能由轮末状态回填睡眠已读。提示词同步此口径。程序只审引用/时刻/来源，描述是否真的是研究过程仍需任务8语义验收。

## 任务6：升级、门禁与正式库
BASE=9093d39。旧格式fixture RED为模块缺失，随后check/apply/二次check通过。全量59文件321项通过；新增未生成旧轮后专项12项（环境＋共同迁移）通过，typecheck/build退出0。Storage、Host及共同升级诊断采用同一终态谓词。没有独立post_jobs worker，终结旧环境不会重新进入后处理。
正式库：D:/HDSI-remake/runtime/data/hdsi-remake.sqlite。进程核对未发现HDSI／SnowLuma相关node/python；普通权限查询被系统拒绝，提升权限只读核对通过。升级前version=null，旧school事件0、旧环境轮0、异常outbox0、未完成普通/共同0、paused=false。临时CLI通过后显式--apply --stopped；升级后version=1，paused保持false。未修改密钥／正式配置或启动服务。
备份：runtime/environment-upgrade-backups/environment-20261008054344875-43af0f85-7bde-4cb9-af7e-a8c57cdef8ba/，SQLite/WAL/SHM三文件。报告：runtime/environment-upgrade-backups/reports/world-school-v4-before.json及world-school-v4-after.json（主目录下，非Git）。正式库没有遗留轮，因此实际不宣称终结了旧轮；该行为由临时fixture证明。

## 任务7：离线集成与文档
BASE=b62b666。初次全空校园输出暴露新库未建立持续计划，增加初建active计划合同，允许零课程；真实ModelClient格式修补边界测试通过。新学校角色省略思考强度默认low的断言先RED（得到high），再修Schema默认；显式设置不改。GREEN：60文件327项通过，typecheck、build、demo、生产Koishi离线smoke均退出0。smoke经正式入口提交4个独立步骤、2个初始计划，未连接QQ。旧共同验收工具固定未来环境截止，保持原验收范围。
示例使用三个school_*模型键及06:00；README、架构、生活、接口、恢复文档同步实际投影与调度。正式config.local.json显式补入独立学校模型键及新时间设置，旧school和旧时间数组移除，学校设定授权建档；更新前副本为runtime/environment-upgrade-backups/config.local-before-world-school-v4.json。该配置不含认证字段；密钥文件、角色背景未改，私有文件不入Git。
Ruling：初次校园／课题组各须建立active持续计划，零课程仍合法；否则新库空响应可被当作建档完成，后续无可复用计划。成本：格式修补可能多一次调用，不强制每日制造事件。
