# REVIEW17 记忆修复实施记录

基线：bc05801。依据：已获用户批准的 `DSH-review/CODEX_REBUTTAL_MEMORY_CAPACITY_IDLE_DELIVERY_20261008.md` §5，以及 REVIEW18 补充确认。无需新的产品裁定。

## 执行顺序

1. 重复身份：短期合并须至少两个不同存活 short；生产 QQ 入口以带作用域的平台消息 ID 去重，缺 ID 时每次生成独立身份。
2. 空摘要闭环：基础合同拒绝双空白摘要；保护受阻 short 的存活 canonical long；同版本登记一次增量修复，空闲15分钟门禁不变；摘要修复后先清 short，再按原归档锚点清 long。
3. 归档晋升：仅活跃普通 long 可作晋升主项；冻结合同与当前应用时刻各检查一次；期间到期判 stale，不反复应用同一冻结结果；真实重谈恢复后才可晋升。
4. 审计报告：按字面身份替换，键含 `_` 或 `%` 不影响别的目标。
5. 同步实施细化／执行计划，完整测试、类型检查、构建、隔离混合验收；一次独立整体复核，修正实质问题后集成本地主目录。

每项先记录失败回归，再修改实现。可顺手在没有超量时跳过容量排序；不扩展迁移框架、不改模型或检索规则。正式库不写入，不启动服务，不连接模型或 QQ。

## 验证记录

测试使用合成数据；入口测试实际调用插件apply注册的middleware，Host暂停，两个外部服务均未启动。依赖复用本地node_modules，未新增包。

| 项目 | 修复前失败 | 修复后验证 |
| --- | --- | --- |
| 重复身份 | 4项失败，生产普通／推进均重复入库 | 原合同、合并共18项通过；追加共同活动／缺平台ID验证，入口文件6项通过 |
| 空摘要 | 6项失败、2项合法摘要通过；旧long先被删 | 8项闭环通过；只读引用策略额外1项失败后与升级测试15项通过 |
| 晋升／审计 | 5项失败、1项真实恢复通过 | 与原合同／合并／生命周期共30项通过 |
| 无超量排序 | 满1000条无变更仍读唤醒历史3996次 | 不超量不排序，同一测试无历史查询 |

初轮全套：83文件、454测试通过。补共同活动2例、只读引用1例后最终全套83文件457项通过（36.60秒），完整输出保存于复核证据目录。`npm run typecheck`、`npm run build`通过。

隔离混合验收：`npm run validate:memory-capacity -- --db runtime/memory-capacity-acceptance-20261008/review17-fixed/isolated.sqlite`。3故事轮、共同活动结束、空闲门禁、11清理单元、前台先于第二清理、引用解除后归档清理均通过；重开容量仍100/1000/500，无派生正文泄漏。产物最终复制回主目录同路径。

实现说明：summaryRepairBasis只记录登记后的版本元组；登记提升short.stateVersion，沿用expiry增量原因，不改事件日期或正文revision。模型合同对可修复缺摘要事件禁止retain/discard；没有历史来源则持续missing_summary阻挡。当前应用与冻结合同对promote选取同一主ID；跨自然到期的结果失效后重排当前合法工作，不延迟重复应用旧结果。audit按3种固定decision完整ID删除，已有参数化LIKE不能替代字面匹配。

正式库未写入；未在线验收、未连接QQ、未启动服务。最终复核如下；集成结果另记。

## 一次独立整体复核与作者修正

审查范围bc05801..6109956。一名新上下文只读审查者完成；无Critical，1项Important、1项Minor。未派二次复审。

Important：SQL元数据只识别4种ASCII空白，与JS String.trim不同。全角空格等空摘要会失去引用保护，空详情会让nextDeadline=now却无可执行修复。作者新增12项回归，全部先失败；SQL trim改为完整ECMAScript空白集合的绑定参数，与正文判定一致。摘要与升级27项通过，完整83文件469项通过（37秒），typecheck、build和新隔离混合验收再次通过。新的报告为runtime/memory-capacity-acceptance-20261008/review17-fixed-final/isolated.sqlite.report.json。离线格式修补验证两次合成响应，双空白首次失败、第二次合法结果接纳，不联网。

Minor延期：只读inspectMemoryCapacity把删除保护集合也用于活跃容量退出预测，因此到期short关联空long时，dry-run预测的退出对象可能与normalize不同。实际运行的归一和删除规则正确，本次未扩大修正范围；后续可将退出预测用includeRetainedShorts=false、物理删除用true，并补同条件回归。

Ruling：不新增旧合同冻结ready结果的全面重新校验／迁移框架——本次不是旧库导入，正式库只读确认未初始化角色、owner数0，无未完成故事；本轮改变已有晋升应用门禁和修复登记版本，其他冻结恢复沿既有机制。代价：未来导入含旧冻结结果的库，仍须单独执行升级检查并处理不兼容结果。

正式库SHA256：BC65898A1BACDD87798554AA3C14CE2EE683E052C76F2358F90D23A8BEDF3BBD。只读服务进程核对HDSI／SnowLuma匹配数0。
## 主目录集成与证据

本地分支codex/memory-review17-fixes快进到主目录main，代码终点2cac79d（实现1a2a282、文档6109956、整体复核修正2cac79d）。主目录再次83文件469测试通过（36.55秒），typecheck、build、实际lib插件导入检查均通过。首次受限测试环境报spawn EPERM，随后以获准的本地测试权限重新完整运行通过；两份日志均保留，未修改依赖。

集成前后正式库SHA256相同；角色未初始化、memories/details/learned为0、无未完成轮，未执行正式升级或清理。没有在线调用／QQ连接，HDSI／SnowLuma保持停止，已有两个cmd未改。

最终隔离库及报告位于runtime/memory-capacity-acceptance-20261008/review17-fixed-final/，完整测试、类型、构建和账本在其verification目录；首轮修复验收和旧缺陷复现各保留原目录。用户已有DSH审核文件原样保留。一次独立复核及唯一作者修正已闭环，无未处理Critical／Important；上述只读预测Minor明确延期。隔离工作区完成证据转存后通过Codex原生工具归档，源码提交保留在本地Git。