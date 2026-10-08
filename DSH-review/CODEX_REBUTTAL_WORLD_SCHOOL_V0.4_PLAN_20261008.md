# 世界与学校规划 V0.4 实施计划审查回应

日期：2026-10-08。对应：[DSH第十二轮审查](DSH_REVIEW12_WORLD_SCHOOL_V0.4_PLAN_20261008.md)。核验对象：[实施细化](../docs/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)、[执行计划](../docs/WORLD_SCHOOL_PLANNING_V0.4_EXECUTION_PLAN_20261008.md)及当前源码；本地基线 `6ae36ad`。

结论：总体采纳。需要一份简短回应，明确更正通知必需集合与发布调用点；更正条件须补上已读旧版，并把跨日旧会话与次日独立步骤的额度区分清楚。架构无需调整，不需要用户再选产品规则。**本轮只生成回应；下列内容是建议并入两份执行依据的澄清，尚未回填或实现。** 未运行程序测试、模型或服务，未访问正式库、私有配置和密钥。

## 1. 逐项裁定

| DSH条目 | 裁定 | 核验与处理 |
| --- | --- | --- |
| 2.1 更正通知必需集合 | 采纳显式定义和补测，修正判定条件 | 原文required集合已包含“变更上游及已有通知策略”，并非仅支持issue；但change／cancel的键与用例确实没写够明确。不能把必需更正限定为存在失效未读，已读旧版也要纳入相关判断。 |
| 2.2 发布调用点 | 采纳，固定在Scheduler选择入口 | 每次collectReady在输入closeReady及暂停／未完成门禁后，先短事务release，再选择／冻结通知；deadline进入既有唯一定时器。详见§3。 |
| 2.3 验收300秒范围 | 采纳措辞补充 | 已有细化§6及计划Global Constraints明确这是验收工具限制；补到任务8接口与交付自查，保持正式ModelClient／AppConfig不变。 |
| 3.1 下游资格 | 原文已有实质规则，补一句明确状态与选择点 | select仅取第一个未成功步骤，前序未成功不能形成下游输入；下一步必须等前序committed，并经让位重扫。retryAt是截止字段，不是新状态。 |
| 3.2 通知正文归属 | 采纳表内说明 | 已有“模型填公开措辞”，将同样约束移到SchoolNotice行：周任务写公开措辞，程序填真实引用／快照／身份，不另起文案模型。 |
| 3.3 未覆盖判据 | 采纳双判据，不仅看周检查版本 | SchoolWeek.sourceVersions用于上游覆盖检查；实际实例／通知身份及有效版本决定是否缺项，不能一条周覆盖记录掩盖漏掉的通知。 |
| 3.4 跨日网页会话 | 采纳保留旧会话计数，明确新日期步骤独立 | 旧步骤终结不清零／重开；次日新step.id是独立调用，有自己的20／40，不能继承旧计数并变成跨日总池。 |

## 2. 更正通知：明确必需键，同时覆盖已读旧版

### 2.1 为什么不能只看失效未读

例：某组会只发过一条issue，角色已读，没有安排第二次提醒；之后从15:00改为16:00。此时没有任何失效未读通知，但她仍知道旧时间。按DSH建议条件就不能生成必需change键，这会漏掉更正。

更正键应从**上游公开版本变化＋通知策略＋已保存的通知／已知／覆盖版本**推导，不能只从本轮invalidated集合推导。已读旧通知及旧SchoolKnowledge保留；是否实际看到新更正，仍由主叙事获知／段B提交决定，程序不能先替她更新知识。

### 2.2 建议固定的集合规则

- `requiredOccurrences`：当前需展开范围内应存在却缺失、标needsExpansion、或与最新上游公开日程不符的occurrenceKey。SchoolWeek.sourceVersions用于判断检查覆盖；实例身份、实际版本及日程仍须校验。只改内部备注不因此重发整套通知。
- `requiredNoticeKeys`：按上游策略应生成且仍有意义的issue／change／cancel／reminder／week_digest完整元组身份，排除同身份已有合法scheduled／available／read记录；invalidated记录及旧deliveryRevision不算覆盖新版本。
- 上游deliveryRevision变化且`announceOnChange=true`时，若没有相应当前版本的合法通知，必须包含change键；取消则为cancel键。不以失效未读存在为前提，也不因旧通知已经read而省略。这些义务延续到候选实际提交，周任务失败／次日重试不能仅凭“昨天已失效”丢掉它。
- 默认下发／更正开关为true，沿用原“下发可读、改期及时更正”。原策略允许显式关闭或调整；关闭announceOnChange是明确的上游选择，不是假装模型漏项合法。关闭普通reminders不等于关闭更正。未曾公开且明确不发布的安排也不能靠强造更正通知泄漏。
- `SchoolWeek.sourceVersions`标记已覆盖不替代实际候选校验：必需键尚缺时，模型返回空变更或只更新覆盖记录都不通过；已存在对应合法身份时，不重复生成。周摘要已经使角色知道旧条目时，同样纳入更正判断，不能只查单项issue记录。

原文“空变更会通过”应理解为**文档未把该情况写成可唯一执行的校验与测试**。目前功能尚未实现，不能断言实际校验已经允许漏掉更正；原文也明确所有required集合为空才允许无变更。本次把必需键写具体，而非修改空结果合法的一般规则。

任务4补 `reschedule_requires_correction_notice`、`read_only_old_version_requires_correction_notice`、`cancel_requires_cancellation_notice`、`correction_candidates_not_recreated_after_commit`；断言漏候选拒绝、已有本版合法候选不重复、已读旧知识不静默变化。另用明确关闭announceOnChange的策略验证不会凭未读失效无条件强造通知。

## 3. 发布调用点：Scheduler统一处理，Host沿用一个定时器

源码核验：[SerialHost](../src/host/runtime.ts)在pump第43行closeReady，第50行调用collectReady；[Scheduler](../src/host/scheduler.ts)在collectReady第12行又closeReady，随后检查paused／unfinishedTurn。DSH给出的宿主位置可以成立，但直接调用Scheduler的测试和其他调用者也应具有相同发布／选择语义。

建议固定为：

```text
Scheduler.collectReady(now)
  → closeReady(now)
  → paused / unfinishedTurn门禁
  → releaseSchoolNotices(storage, now)短事务
  → 读取本轮状态与可用通知
  → 选择合法前台并合并通知，或选择纯通知／环境／自主
  → 返回被冻结的schoolNoticeRefs
```

所有本次选择使用同一个now。Host保留原调用结构，不另加第二个通知发布入口；现有closeReady重复的整理不作为本次必须新增的工作。未完成前台先恢复，期间不修改其冻结通知集合；暂停时不靠发布循环越过门禁，resume后再检查到期通知。

`Scheduler.nextDeadline(now)`在原有门禁后合并`environmentDeadline`、`schoolNoticeDeadline`及前台截止；Host再与记忆维护截止取最早，由现有armTimer建立唯一计时器。新增通知／环境deadline接入只计算截止，不发布通知、不调用模型；既有共同节点维护不在本轮顺带改造。睡眠／共同／拒看等不可执行通知不得贡献过期now；真正待发布通知到期可以触发一次合法扫描。

发布本身不占模型生成、不调用runTurn、不重排自主、不消耗共同轮。学校通知模型反应仍在合法故事中执行；“短事务”不代表已开始的环境请求中新增并发发布线程。

任务4补 `due_notice_released_before_selection`、`notice_deadline_reaches_host_timer`：通知刚到期时当次collectReady即返回正确ref；deadline到达会唤起现有Host而不是依赖下次每日学校调用。任务5继续守住晚到通知留下一冻结轮、暂停／恢复与共同节点资格。

## 4. 验收超时、下游及跨日补充

### 4.1 300秒仅属于验收工具

在任务8接口直接写：`scripts/validate-world-school.ts`默认单请求等待／取消上限300000ms，可显式覆盖；只在工具包装的Transport／请求signal生效，不新增AppConfig字段，不改变正式ModelClient语义，不给正式HDSI统一加300秒超时。

已有[共同活动验收工具](../scripts/validate-shared-story.ts)第17行定义300000ms，并在第42行合并原signal及AbortSignal.timeout；[模型客户端](../src/model/client.ts)接收调用方signal，没有统一300秒默认。这是可复用的实现边界，不需要另设正式配置。

任务8工具离线检查与交付自查补充该范围；真实超时仍记录原失败，取消应作用于该工具请求，不能仅Promise.race结束等待而留下请求继续写隔离库。

### 4.2 下游只在下一选择点取得资格

任一前序步骤pending、running、ready或等待retryAt时，下游不可选，也不提前冻结输入；ready尚未提交。前序事务committed后，Host先让出事件循环、重新检查消息／普通openBatch／合法前台，再选择下一步骤并生成其输入。不能在一个generateEnvironmentStep里直接串调下一学校模型。

任务2已有world_before_three_school_steps及pending_dependency_no_hot_deadline；补明确断言前序ready仍阻止下游、committed后的新消息先处理。属于已有规则的验证细化，不增加新调度服务。

### 4.3 旧会话不重置，新日期步骤仍独立

跨日superseded保留旧step.id、runId、计数、操作和检查点，释放缓存占用；旧步骤不再恢复生成，不通过改stageKey或重建同身份session清零。正在执行的旧日请求结束后先按既定规则检查日期，再决定终结，未提交结果不应用。

次日批次有新step.id，其独立会话按原设计从0／0开始。独立20成功／40失败是模型步骤额度，不是进程／学期／多日共享额度；已经明确“新的日期步骤是新会话”，不应借本条改掉。

核验[WebSearchStore.openStage](../src/web/store.ts)：唯一身份为ownerType＋ownerId＋stageKey，同身份返回已存会话，新的ownerId才创建新计数。任务3补跨日终结旧计数不变、同身份不重开、新日期owner独立的断言；这是固定预期，不启用新provider。

## 5. 并入执行依据的最小改动

| 文档位置 | 改动 |
| --- | --- |
| 细化§3.2 | 通知行明确周任务措辞／程序快照；通知开关默认及提醒与更正的区别。 |
| 细化§4 | 点名只有committed前序放行；每步后让位重扫，下一步不在上一调用中串调。 |
| 细化§5 | 补required双判据、change／cancel与已读旧版、已有候选幂等及策略显式关闭范围。 |
| 细化§6 | 旧跨日终结不清零；新日期独立会话仍有独立20／40。 |
| 细化§7 | 固定collectReady中的发布位置及nextDeadline→Host单timer接线。 |
| 计划任务2／3／4／5 | 增补上述对应断言，保留原RED／GREEN与逐任务日志。 |
| 计划任务8／交付自查 | 300秒工具包装范围，正式客户端／AppConfig不改。 |

上述澄清不改变06:00、学校自由选择、通知发布不等于获知、无人工预算、旧库显式升级或服务由用户手动启动。可以并入两份文档后按原任务1～8实施；无需扩大架构，也无需用户再裁定技术字段。
