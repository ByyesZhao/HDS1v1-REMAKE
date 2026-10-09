# SDD ledger — plan: docs/v0.5/plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md

基线 eb5b29e；隔离分支 codex/astra-r1-checkpoint；用户已授权按计划实施。
范围仅维护 checkpoint 生命周期、正式 C1～C6 测试及补验文档；不读私有配置/背景/密钥或正式库，不启动服务或真实模型/QQ。
任务为单项R1：核实→C1 RED→最小finally修复→C2～C6→验收→独立复核→本地集成。

## 预检与基线
- Pre-flight: no shared task interfaces；单生产改动消费 MemoryStore.job 最新状态，调用已有 WebSearchService.compactOwnerCheckpoint。
- 准备结果保存ready在finally之前；catch失败保存pending，stop维持computing；prune可以在途保存done。ModelClient阶段checkpoint独立于业务snapshot。
- 完整基线121文件681项通过（65.85s，baseline-suite.log）；独立9项8通过/1失败（baseline-independent.log），缺口与review一致。
- 原始review、证据和主目录未提交README保留，未覆盖审查原测试。
- Ruling: Windows记账脚本不直接适配，持久Markdown及本次专用.superpowers/sdd/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009日志替代；任务范围和验证不可因此省略。
- Ruling: 计划§5“smoke普通/共同”是描述笔误，实际空周/必需通知；demo才覆盖普通/共同活动。按真实命令验证并校正文案，不更改工具功能。若误判则有漏验风险，实际已读两工具及验收合同。
- Ruling: 沿用本项目已批准的隔离实施、本地集成方式，不重复询问创建worktree/合入；不推送，保留用户原文与可恢复记录。风险通过ff-only与主目录复验控制。

Task R1: in progress — 待写正式C1并取得真实失败。


## C1～C6 实施

C1夹具首次startOne=false：MemoryStore.migrate将维护时间设到次日，需在创建到期短期后设置nextMaintenanceAt=now。该夹具错误与早先green失败不作R1证据；恢复旧finally后重新取得c1-valid-red（checkpoint=null），再恢复补丁取得c1-valid-green。没有降低业务断言或手动补写失败checkpoint。

生产改动仅MemoryMaintenance.prepare.finally：计时器/监听器仍清理；维护且有web时读回最新job，ready/done才compact。输入、readSet、dirty、repairLimit、timeout/retry配置、索引路径均未改。

| 合同 | 实际正式覆盖 |
| --- | --- |
| C1 | 传输中断后的完整cp、同repair/input/id/startedAt/cutoff/snapshot/readSet/runId；当前owner更新仍用旧输入，应用门禁判stale |
| C2 | fake timer超时pending/retryAt、stop computing，整个cp相同；晚到合法结果不改变job/cp |
| C3 | 临时文件库pending/computing关闭重开，新对象computing→pending；全cp和冻结依据/阶段身份相同；更新owner后原repair/input续用 |
| C4 | 修补成功ready落盘再cp=null；实际operations/material/counters保留；saveJob注入一次事务异常，owner/applied标记回滚；同ready结果重用，没有新增模型请求；web未提供也完成 |
| C5 | 实际prune唯一选中owner→done，随后成功/异常/stop均不复活并清cp；prune非选中依赖时computing保持，合法旧结果的唯一单元判stale→done并清cp |
| C6 | 两次非法后传输失败cp.count=2；后台再非法仅增1请求且count不重置，随后带原repair合法完成，总5请求 |

旧逻辑六项失败/六项通过（c1-c6-red），失败均为恢复进度丢失；终态六项原本通过，修复后继续覆盖清理边界。新逻辑12项通过（c1-c6-green）。相关七文件34项通过（related-green）；原独立2文件9项全通过（independent-green）。类型检查退出0（types.log）。完整回归/交付收口中。


Task R1 implementation: complete — eb5b29e..b398699；正式12项、相关7文件34项及原独立9项通过；全量122文件693项通过（68.83s）。final-types/build/demo/smoke/diff各退出0，smoke空周3生成/必需通知4生成、各1Embedding、repair0、四步committed。native起初detached HEAD，补丁提交后命名codex/astra-r1-checkpoint；没有移动主目录HEAD或用户文件。文档关闭依据与最终独立复核/集成仍收口中。


## 最终独立复核

单次fresh reviewer审查eb5b29e..b398699，Critical/Important/Minor均0，源码与12项正式测试可合入。reviewer读取有效C1 RED、12 GREEN、原独立9 GREEN、全量122/693和smoke日志，没有重复全套或改文件。

Final Ruling（Declined-to-judge逐项裁决）：
- onReady抛错ready退pending：按计划保留旧catch，最新状态pending因此保留cp。未扩展通知异常处理；若之后需要改通知语义再独立定合同。
- 底层SQLite读/压缩异常、ready落盘与压缩间退出：不新增任意损坏防御，顺序保证后者仅冗余cp；前者沿用现有故障处理，未宣称硬件故障验收。
- job不存在的无主session回收：按计划不清理/不重建；不存在恢复依据时不可误判成功，可能留下既有无主数据，但本轮不扩大清理策略。
- 旧版本已经删除cp：无法重构丢失数据，只保护尚存，若误称恢复会制造历史，明确不做迁移。
- prepare退出后的单独prune即时压缩：当前补丁只覆盖prepare finally，物理清理由compactCompletedPayloads处理，保留既有合并后压缩时机；不将旧机制冒称新的即时回收承诺。
- 真搜索/非空private lookup/真实模型QQ正式旧库/长期规模：本轮没有验收，维护lookup为null且搜索关闭；整个cp原样保留而非重建简化版本，不扩展工具执行。
- 最终文档与集成：由主代理补新结果再关闭，不靠review结论替代主目录验证。计划smoke口径已裁定为empty_week/required_notice，demo普通/共同。

Deferred minors: none。日志保留而不删除，以满足用户复盘授权；仅归档本次managed worktree，避免丢失需用证据。


Task R1: complete — 源码/正式回归提交b398699已本地ff-only合入main；主目录122文件693项通过（65.72s），原独立9项全通过，typecheck/build/demo/smoke/diff各0。补验文档、计划、review关闭依据、README与当前恢复说明同步。新证据日志保留reviews/r1-fix-evidence-20261009，旧postfix-evidence不动；服务/密钥/私有背景/正式库/真实模型QQ均未访问或运行。仅修改计划合同对应内容，额外同步V0.5恢复/实现映射及前次交付补验链接是为避免当前文档过时，不扩大生产范围。
