# MEMORY V0.3 第四轮审查回应（Codex）

日期：2026-10-07。回应：[DSH REVIEW4](DSH_REVIEW4_MEMORY_V0.3_PLAN_20261007.md)。核对对象：[实施细化](../docs/MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[执行计划](../docs/MEMORY_V0.3_EXECUTION_PLAN_20261007.md)及当前源码。DSH-review 中三份方案文档与 docs 中对应文件逐字节一致，本轮差异不是审核版本过旧。

结论：**多数意见可以采纳为实施前澄清；有必要作一次简短回应，但不需要推翻架构或增加新一轮大设计。** 需纠正的主要判断是“MemoryCandidate 缺版本”和“固定 cutoff 漏掉到期记忆”；另需缩小“必须新增模型分支”“IndexResult 必须携带应用标记”等要求。每单元让出事件循环、前台优先、预备摘要及七项任务继续保留。

本次只新增本回应，不修改程序、配置、正式数据库或两份方案正文。文中的补充规则是建议并入下一次文档修订的具体文本，不能视为已经实现。

## 1. 四条主要意见

### 1.1 唤醒唯一键：采纳合并算法澄清，不认定约束本身冲突

细化 §5.1 已列出字段 canonicalMemoryId、localDate，唯一键所说的“记忆 ID + localDate”应明确为 **(canonicalMemoryId, localDate)**。DSH 建议 A 的键实际与现有设计一致；需要补的是合并方法，而非换一套唯一约束。

如果直接 UPDATE 副本行的主身份，或裸 INSERT 相同日期，确实可能冲突。但使用 UPSERT 即可保留数据库唯一性，不必采用 B 的查询时去重或 C 的取消约束：

1. 同一事务读取主／副唤醒记录，按日期聚合；同日选最早有效时刻，保留与该时刻对应的首次 turnId，sourceIds 去重并集。
2. 按主身份 UPSERT 每个日期，而不是裸 INSERT。
3. 删除副身份下已经归并的唤醒行；副记忆本体及 mergedInto、正文来源继续保留。
4. 同事务重算日期计数、处理合法 grants、保存合并关系和应用标记。

来源并集和时间比较由业务层计算，使用实际时间先后，不依赖带不同偏移的日期字符串字典序。

本轮用 node:sqlite 内存库做了最小约束示例：A 的20、22日与 B 的21、22日通过 UPSERT 后再删副行，事务成功，主记录剩3个日期，22日取较早时刻。**该示例只证明唯一键下的操作顺序可行，没有验证完整来源、grants 或生命周期。**

建议补入细化：

> 唤醒唯一键为 (canonicalMemoryId, localDate)。合并使用同事务内按日期聚合并 UPSERT 主行，再删除已归并的副唤醒行；不直接修改冲突主键，不放宽唯一约束。首次有效时刻及首次轮次保持对应，来源取并集。

### 1.2 cutoff：不采纳“漏掉”的判断，保留每日固定范围

细化 §7.3 已明确“新到期内容进入下一维护周期”，计划任务5也要求测试这一行为。04:30之后到期的短期：

- 详细版按 shortExpiresAt 退出，不等待维护。
- 预备长期按 retainedFrom 生效，可继续通过词法／已有向量检索。
- 下一每日周期再压缩／合并，不会丢掉记录，也不因暂未压缩而不能回忆。

所以这里是**压缩时效的选择**，不是期限判断或检索遗漏。方案草案也采用每日维护；当前没有“每条到期后立即完成压缩”的要求。保留固定 cutoff 能界定本周期积压，避免不断纳入新项导致周期迟迟无法完成。

“按容量切批”和“固定周期 cutoff”可以同时存在：前者限定一次计算多少条，后者限定本周期处理哪些条。当前20条／12000字符已经是容量切批。

不建议把消费进度只记成到期时间 watermark：同一时刻可以有多条，版本变化／失败重试还可能让处理乱序。是否已处理应由 owner 版本、job和单元标记判断，不能用一个时间游标替代这些记录。

建议保留并补清：

> 每日到期后在可调度扫描中建立或恢复一个维护周期，cutoff 一经保存不再扩张；各批按容量处理该范围内未处理版本。cutoff 之后到期的记录进入下一周期，其预备长期正常生效。停机恢复优先继续已有周期；无已有周期时用恢复扫描时刻建立一次补办范围，不逐日补造维护周期。范围完成后 nextMaintenanceAt 设为当时之后最近的04:30。

这条处理的是压缩／常驻判断周期；新正文的派生索引任务仍按独立待办处理，不必等下一天。retryAt 未到的待办也不应让宿主忙等或挤占前台。

### 1.3 新进展与唤醒：采纳明确分开

DSH 的实际建议合理，但两项规则没有逻辑冲突。已有表格已规定新进展推进短期、长期不因改写重开期限；确实还可以把“不是自动唤醒”写得更直接。

建议补入细化及任务2测试：

> hasNewEventProgress 只控制短期详细窗口及尚未生效预备窗口。有效唤醒由单独的 awaken 操作及合法当前来源判定，不从 update 自动生成。两项可在同一轮同时成立，但唤醒仍按主记忆、上海日期去重。

同一天多次真实进展可以延长详细窗口，仍最多贡献一个有效唤醒日期。已经归档的长期也不因一次正文更新就隐式重新激活。

### 1.4 长期期限起点：采纳，但保留迁移／续期例外的完整定义

普通与重要事件的初始窗口不同是有意设计，细化 §3 已分别给出。建议统一命名以方便实现引用：

> 新建长期的 initial grant 锚点为其首次对检索生效的时刻：normal 为 shortExpiresAt，high 为本轮 at；expiresAt=该锚点+90天。createdAt 不充当保留锚点。尚未生效的预备窗口可随真实进展调整，已经生效的不因改写改变初始锚点。

不能把“始终从首次生效算”推广到所有状态：renew 使用第三个有效唤醒时刻，reactivate 使用本次有效唤醒时刻，旧长期 migration 使用升级时刻的一次观察期。它们都是已定义的不同 grant，后续有效期限按合法 grant 计算，不按后台提交时刻重算。

## 2. 八处小问题逐项结论

| DSH条目 | 结论 | 处理建议 |
| --- | --- | --- |
| 2.1 MemoryCandidate 缺 revision/stateVersion | **不成立** | 执行计划类型表已经写“MemoryCandidate = OwnerVersion + …”；OwnerVersion 明确含两个字段。可把组合关系改为显式 extends，但无需补新字段。维护快照还需要读相关事实，不应认定 selectCandidates 是唯一准备入口。 |
| 2.2 job缺stale、重准备违反单槽 | **澄清可采纳，矛盾不成立** | computing才占网络槽；ready、pending及staleUnitKeys不占槽。冲突单元在新job中准备，旧job的该单元标stale终结；其他有效单元照常应用。不需要额外批次级stale状态，默认先消化ready，再准备下一批。 |
| 2.3 IndexResult缺应用消费标记 | **不采纳放进结果DTO的要求** | IndexResult是计算结果；持久化IndexJob.done和索引写入必须同事务，恢复跳过done已足以幂等。若需要排查，可在job加completedAt／completionReason=applied或stale，不让远程计算结果携带未来应用身份，也没有必须对应的故事轮ID。 |
| 2.4 明确dispose顺序 | **采纳生命周期要求，调整责任划分** | 建议host.stop统一停止宿主并收尾协调器，dispose继续await host.stop后storage.close；见下节。无需在dispose和host.stop中重复拥有停止责任。 |
| 2.5 Abort不代表供应商取消 | **采纳** | 停止后返回的结果丢弃，不写ready；不声称没有产生远程调用／费用。该语义适用于本地停止，不把普通查询超时伪装成供应商已停止。 |
| 2.6 周期建立和分批扫描分开 | **采纳拆分，保留cutoff含义** | 建立／恢复周期、选范围内未处理项、完成后推进时间分别定义。原建议又要求扫描cutoff之外，会抵消固定cutoff；按本回应§1.2即可，不新增watermark体系。 |
| 2.7 800字符是总额还是单条 | **采纳** | 是本次上下文全部alwaysInclude稳定认识的合计可见字符上限800，不是每条800；超额按相关性选取。重要经历仍按需检索。正文中的80应是笔误，没有80字符规则。 |
| 2.8 记录查询降级率 | **采纳最小观测** | 进程内记录查询数、缓存命中、实际远程请求数、超时／失败及词法降级数，在hdsi.status给出自启动累计概况；分母区分实际远程请求和缓存查询。不存查询正文，不新增每轮统计表／监控框架，标定报告另记真实耗时。 |

### 关于停止顺序的具体建议

[当前入口](../src/index.ts)第100行是 `await host.stop(); storage.close()`；[当前宿主](../src/host/runtime.ts)的 stop 等待 active。未来后台不在active中，因此必须增加协调器收尾。这是实质性集成要求。

更明确的归属是：

1. host.stop立即设stopped、清timer，阻止输入调度／新故事／新维护。
2. 立即调用maintenance.stop，发出Abort，不先等待前台active结束才发出。
3. 等待前台active和后台收尾都完成；后台取消后的结果不落ready，不触发新wake。
4. host.stop返回后，dispose关闭SQLite。

这样保留一个生命周期所有者，也避免把 `host.stop → maintenance.stop` 机械解释成“前台等很久，后台才能开始取消”。如果实现选入口分别调用，也必须先同时发起停止，再等待两者，满足同样语义。

已有ready结果不因stop删除；尚在computing的任务未产出ready，重启按原规则退pending。正常pause仍允许在途结果保存ready，两种操作要区分。

## 3. 源码衔接提醒

### 3.1 真实输入夹具：采纳，但不全局替换saveInput

[tests/helpers.ts](../tests/helpers.ts)的saveInput确实只写messages，不经过InputBuffer，也不建立pending批次。它适合直接指定inputMessageIds的generateTurn测试，并非本身错误。

宿主／静默窗口／消息重试的V0.3用例应直接调用host.acceptInput或InputBuffer，再推进时钟闭合真实批次；不能仅用saveInput声称证明“不遮挡正常聊天”。任务6已有真实让位验收，建议再显式写出该夹具限制。

### 3.2 async调用清单：补测试覆盖

任务4已列出app里的叙事／个人两处和organize一处await，无需重新发现调用点。可以补入tests/turn.test.ts的间接集成覆盖：它实际断言模型输入可见性和调用顺序，async上下文修改不能破坏这些断言，并非该测试直接调用ContextBuilder。

生产入口src/index.ts的默认lookup也已经纳入任务7装配替换；实施时继续用rg核对全部build/buildForMemory/lookupDetails调用，再运行受影响用例与完整套件。

### 3.3 memory_consolidation路由：采纳一起改配置，不必新特判

[src/settings.ts](../src/settings.ts)的connectionFor只有sticker_description特判，其余按 `settings.models[task]` 查找。把memory_consolidation加入modelRoles及models配置后，这个通用路径自然能够处理它，不要求新增专属if分支。

需要一起验证角色枚举、Zod配置、启动前校验、默认值、样例／实际配置、路由测试和文档任务总数。这一项作为普通模型角色保持独立Flash/high配置，总任务数从10更新为11。

### 3.4 nextMaintenanceAt：采纳提前固定字段，不混入故事请求

细化已经使用nextMaintenanceAt这个名字，但执行计划共享类型没有明确归属，建议在任务1增加 `Runtime.nextMaintenanceAt: string|null`，迁移／初始化时设置最近的维护截止，周期的cutoff和处理进度仍由持久化维护状态／jobs承担。

Scheduler.nextDeadline与宿主定时需要合并**可运行**维护截止；Scheduler.collectReady仍只产生环境／故事TurnRequest，不把维护也当作故事轮。否则会破坏“不占故事槽”的边界。后台在途、openBatch、paused和retryAt未到时按既有规则避免past截止空转。

## 4. 建议并入文档的最小改动

后续可在原文中一次补齐，无需改七项任务顺序：

1. 细化§5：唯一键写全、UPSERT操作顺序；短期进展／唤醒独立；初始grant与renew／reactivate／migration的锚点区分。
2. 细化§7～8：每日固定cutoff明确保留；冲突单元转新job；单槽按computing限制；host.stop统一收尾及取消结果丢弃。
3. 细化§5.3、§6：800是本次总额，添加进程内最小召回降级统计。
4. 计划任务1固定Runtime.nextMaintenanceAt；任务2加更新不自动唤醒／同日UPSERT用例；任务5加stale转新job、索引done同事务用例；任务6明确真实输入夹具、停止同时等待前后台；任务7检查通用模型路由与统计展示。

其中多数是把已决定的行为写得更直白；保留每天维护和现有DTO职责，可以避免把正常业务扩成新的调度／统计体系。DSH“可以开工”的总体判断成立，以上属于可随实施前文档修订闭合的有限问题。

## 5. 本轮验证边界

- 已完整阅读REVIEW4，核对方案原文、审核副本及相关源码，三份文档副本一致。
- 仅运行一个node:sqlite内存示例，证明同日重叠UPSERT合并不需要放宽唯一约束；未创建项目数据库文件。
- 未运行项目测试／构建／服务或供应商请求；现有78项历史结论没有被当成本轮或V0.3通过证据。
- 仅新增本回应，程序和两份细化／执行文档尚未修订。
