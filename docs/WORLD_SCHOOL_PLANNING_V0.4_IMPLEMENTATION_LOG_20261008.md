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

RED：新增7项失败，原268项通过。GREEN：全部277项通过（52文件），typecheck退出0。新增JSON表与两类Store复用同一Storage；旧runtime字段只在读取时缺省null，未写回。兼容加载在Schema前执行，复制独立对象，显式错误不回退。工具demo／已有共同验收因必需依赖提前装配Store，其行为未改。任务1完成；调度尚未启用。
