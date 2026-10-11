# 个人导演任务合同修复交付

日期：2026-10-11。版本：`0.5.1`。状态：**已实施并部署，HDSI已安全停止；待用户手动重启，未恢复失败轮**。基线：`9a14ea4`；产品实现提交为`5a41a9f`、`64dbc0f`，恢复测试为`18d79d1`，补充测试为`1af4f13`、`3ac4fb5`。按[设计合同V2](../../plans/personal-task-contract-20261011/PLAN_V2.md)和[细化步骤](../../plans/personal-task-contract-20261011/EXECUTION_PLAN.md)实施，原方案及ASTRA审核保留原基线含义。

## 实际改动

- `src/model/contracts.ts`：个人taskChanges只创建appointment，update/cancel只接受本次合同构建时克隆的pending预约ID；Schema和parse共用同一快照，action／任务详情strict。无预约时只开放create，life仍可省略任务数组；预约NOW、部分更新和其他控制语义保持。
- `src/model/prompts.ts`：明确程序独占check_messages／scene_step，chat/shared用reply=later复议，life未来意图用nextPlan；主叙事经历和学校获知链路保留。
- 新增三份personal-task-contract合同、业务流、磁盘恢复测试；调整tasks、review-fixes的旧检查权限以及shared-v3-contracts的错误路径断言。通用types、app调度、recovery状态机和task-projection未修改。
- 无依赖、版本或数据库协议变更，无数据迁移；配置与正式库未作为离线验收输入。

## 回归与恢复矩阵

| 保存状态／输入 | 已验收结果 |
| --- | --- |
| chat/life/shared，空预约／终态任务／调用方修改输入 | 程序任务拒绝，预约集合不漂移，严格字段生效；life可省略taskChanges，chat/shared必填 |
| json_object／json_schema、lookup／web续接、修补 | 请求仍用同一预约合同；工具分支保留，工具调用不消耗格式修补次数 |
| 学校通知实际观察后变为不可读 | personal_life取得经历和新活动；真实未读仍未标见，程序检查只绑定新消息，历史seen不变 |
| 可读后reply=later，再次到期复议 | 同一deferred ID改期，reconsider来源正确，不重读历史 |
| 未冻结，repairCount=2，推进10分钟重开库 | 同ID更新at，合法响应通过；再次非法只请求一次个人响应后暂停，预算仍2 |
| 混合学校轮life→chat | personal阶段runId复用、taskName由生产代码更新；旧修补材料／预算保持，新合同和visible来源更新 |
| 旧冻结候选全pending，无首次尝试 | 旧稿不发，恢复时刻重算，新模型任务过新合同，旧check转换不直接提交 |
| retry无confirmed／confirmed加尾retry／sending | 旧at和候选保留，叙事／个人／表达不重算；本地confirmed不重发，未知项按原规则重试 |
| 零输出已封口，post未完成／post.result已保存 | 沉默不推翻，只续未完成后处理；保存结果复用，重复恢复不重复提交 |
| pending网页操作未执行／已done未写回checkpoint | 前者接续原操作，后者无新provider调用；lookupUsed与结果保留 |
| 网页20成功／40失败额度 | 磁盘重开后仍禁用工具，计数不重置 |
| paused=true，Host.start／Host.resume | 启动不调用模型；resume后才续办，合法完成，非法仍暂停并经onError报告 |

这里是合成sender／provider的离线行为；不证明QQ未知发送窗口绝对一次、真实模型永不越权或正式轮已经恢复。

## 执行证据与纠偏

| 检查 | 实际结果 |
| --- | --- |
| E0基线 | 6文件50项通过 |
| T1合同红灯→绿灯 | 新合同18项在旧权限上失败；改后7文件73项通过，类型检查通过 |
| T2提示红灯→绿灯 | 4提示断言失败、7既有策略／业务断言通过；改提示后8文件70项通过 |
| T3恢复验收 | 新17项磁盘测试通过；临时回放旧合同4失败／13通过，其中字段齐全的check在旧合同被放行；还原后7文件69项通过 |
| T4首次全量 | 220文件，1405通过／7失败／2跳过；6项缺隔离lib，1项仍匹配旧scene_step错误文字 |
| 补齐隔离构建与旧断言 | build通过；保留scene三种操作拒绝，使用模型详情字段并检查taskChanges错误路径，8项通过 |
| T4首次绿色全量 | 220文件，1412通过／0失败／2跳过（总1414）；此轮早于复核补强，后续最终全量再次通过 |
| T4最终全量与工程门 | 复核补强后220文件／1412通过／0失败／2跳过，205.31秒；typecheck、build、demo退出0；插件定向2文件10项及显式隔离lib smoke两场景各四阶段退出0 |
| 独立只读复核 | 无Critical／Important产品问题；指出角色切换测试自行调用openStage会修正taskName，见[复核与证据修正](reviews/FINAL.md) |
| 复核后的测试证据补强 | 改成state／checkpoint只读；临时移除生产taskName更新，2个角色切换测试失败；还原后17项通过。生产代码没有为探针改变 |

因新工作树没有忽略的lib，实际验收增加了构建前置，未用正式lib取得通过。额外shared测试仅调整错误路径和夹具，不削弱程序任务拒绝。独立复核指出的问题属于既定T3证据要求，因此在最终验收前补齐。终态数量及各工程门以[evidence/verification.json](evidence/verification.json)为准；原失败和临时变异日志单独保留，不覆盖此前审核。

## 部署与现场边界

用户随后明确授权整合并推送Git、安全停止正在运行的HDSI，手动重启修改后的服务。离线验收完成前不执行这些操作；停服后才备份正式数据与旧lib、放入已验收构建并做只读启动检查。不会由本批执行启动或hdsi.resume，失败暂停应跨重启保留。

实际部署／停止已完成，见[现场记录](DEPLOYMENT.md)：停服后备份、246个构建文件比对一致、只读启动检查通过，暂停与失败阶段预算仍保留。原14:04失败轮是历史调查快照，恢复时活动／个人角色／at可能改变，不承诺人物仍在小憩或立即醒来。没有新在线模型／搜索、真实QQ质量验收或自动恢复。
