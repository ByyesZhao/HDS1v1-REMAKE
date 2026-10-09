# 环境异步 E1～E5 交付

日期：2026-10-09。基线：272437f；实现提交：87b14f0、8eaa396、6a50a17、da47ea5、2a6b981；复核修复与文档关闭：fec1afa。状态：已交付并本地快进合入main，独立复核两项问题已修复；正式库未升级。

## 行为

环境网络等待移入独立单槽；角色聊天／共同活动前台可继续，环境只持久ready，前台串行边界复核依据再提交。记忆准备另有单槽，三槽可并存，业务事务仍同步串行。四步world→campus→group→week仍需前一步提交。

学校合同和resolver共享数据只读接口；检索候选、普通原文、向量数组与签名持久冻结，共用现有排名／权限／预算内核。只核对实际lookup返回对象与来源存在，以及本阶段世界／计划／科研／周安排／知情／预约／通知业务依据。正常通知发布／已读生命周期不单独失效。同日依据变化延后重冻generation，跨日／时区终结批次；每个执行lease拒绝晚回写。

唯一网页checkpoint保存原lookup请求／pending；成功结果和usedBasis同事务落库。中断沿同请求恢复，新generation重新投影原查询，不增加查询次数；step owner和generation阶段键不变，20／40计数、已确认材料与操作保持。停止abort两槽，等前台与全部准备收尾才关闭Storage。

## 验证

- 修复后完整146文件／804项通过，类型检查、构建、演示、双场景真实Koishi离线插件装配通过；新增28项。
- [原始全量日志](logs/full-final.log)、[类型](logs/typecheck.log)、[构建](logs/build.log)、[演示](logs/demo-final.log)、[插件](logs/plugin-smoke-final.log)。
- 主目录fec1afa复跑同样通过：146文件804项（86.29秒），[全量](logs/main-full.log)、[类型](logs/main-types.log)、[构建](logs/main-build.log)、[演示](logs/main-demo.log)、[插件](logs/main-smoke.log)。主目录28份当前导航／台账／已关闭合同检查无缺失链接，见[检查结果](evidence/document-link-check.json)。
- [修复后工作量JSON](evidence/workload-final.json)：H=0/90/180旧环境批次，每档5样本，固定1000当前记忆；15/15聊天在环境响应前正式提交，status没有环境大正文读取。冻结约11.81～16.62ms、提交约9.73～12.81ms（查看原始数字；合成样本不表示供应商性能）。
- 新增回归：环境升级／降级、学校冻结／向量、挂起HTTP聊天、busy/openBatch/pause、四阶段非空、ready文件重开、科研／知情／预约失效、通知生命周期、跨开场normalize、网络／格式retry、stop/late结果、午夜／时区、lookuppending／重投影、网页操作接续／额度、应用回滚、记忆并行槽。
- 首次全量暴露两项：元数据新标量未同步旧字段断言，兼容包装重复读取步骤正文；已修正，原失败证据保留。初始774/776因新worktree未构建lib导致两项工具失败，后续先构建。

独立复核两项来源修复的红绿回归与裁决见[关闭说明](REVIEW_CLOSURE.md)。前期[工作量](evidence/workload.json)保持原结果，不与修复后样本混算。

## 部署与回退

新库environmentPlanningVersion=2。现有1须显式停服备份升级；旧ready/running/有输入pending标preparationVersion0继续原串行合同，未开始pending标1。modelContractVersion仍独立。

本次**未迁移正式库**，未读取私有配置／密钥／人物文本，也未联网或连接QQ。部署升级命令见[项目README](../../../../README.md)。降级工具只在没有新模式非终态步骤时允许退到1，仍须stopped和完整备份；禁止手工改标记。无法满足可恢复完整旧备份，会丢失其后进度。开发升级／降级检查见environment-async-upgrade测试及[4场景CLI证据](evidence/upgrade-cli.json)。

## 复跑

```powershell
npm run typecheck
npm run build
npm test
npm run demo
node runtime/plugin-smoke.cjs
npx tsx scripts/check-environment-async.ts --output .tmp/environment-async-workload.json
```

搜索provider仍未选，semantic标定仍关闭；真实QQ延迟、供应商模型质量和长期运行不是本批验证范围。快照本地同步复制与学校业务依据扫描有实际成本，没有宣称全系统恒定时间。
