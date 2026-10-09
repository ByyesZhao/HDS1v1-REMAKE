# 记忆容量与空闲整理 V0.4 实施细化

最新修正：REVIEW19 的只读容量退出预测待办已修，83文件473项测试、类型检查及构建通过。REVIEW17／18的469项、原任务1～8的435项保留为历史基线；本次过程见[REVIEW19修复记录](REVIEW19_DRY_RUN_FIX_LOG_20261008.md)。

日期：2026-10-08。状态：任务1～8及最终复核修正已实现，435项测试、类型检查、构建和隔离离线／有限在线验收通过；最终代码复核另见交付记录。实际实施基线`9e24b0d`。正式空库仅只读检查，未升级或清理，服务保持停止。

本文与[执行计划](MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md)共同作为本次实施依据。已合并[原方案](MEMORY_CAPACITY_IDLE_V0.4_PROPOSAL_20261008.md)、[CODEX回复](../../dsh-review/CODEX_REBUTTAL_MEMORY_CAPACITY_IDLE_V0.4_20261008.md)、[DSH修订审核](../../dsh-review/DSH_REVIEW15_MEMORY_CAPACITY_IDLE_V0.4_20261008.md)及[第十六轮计划审核](../../dsh-review/DSH_REVIEW16_MEMORY_CAPACITY_IDLE_PLAN_20261008.md)。原稿3000条、所有记忆退出后无限留库的口径由本文替代。

## 1. 范围与既有约束

- 基础记忆提取、具体事实更新仍每个实际故事轮完成；深度摘要、合并、稳定认识／事实审核在空闲15分钟后进行。
- 活跃短期100条，普通活跃长期1000条（包含尚未可见的预备项），普通长期归档500个canonical身份。归档最长90天；容量满和期限到是独立清理条件。
- 7天短期、90天普通长期、同一canonical每天最多一次有效唤醒、3个合格日期续期、30个日期进入常驻审核候选均保留。日期仍用Asia/Shanghai；时间计算使用注入Clock。
- 新输入、新确认输出、实际非环境故事完成或活动变化刷新15分钟计时。共同活动整个过程中不准备／应用深度整理；睡眠沿用后台例外，其他条件仍检查。
- 不新增字符、token、固定检索条数预算；不自动缩减上下文重试容量错误。相关性、来源、可见性及近期30条原文窗口保留。
- `memory`和`memory_consolidation`各自独立Flash/high，可后续改Pro；本次不改模型、Embedding或搜索供应商。
- 不新增向量数据库、通用语义裁判或并发故事。一个Host、一个定时器、一个后台网络准备槽。每个后台提交／清理单元后让出事件循环，重扫前台。
- 清理普通经历记忆及其派生副本；作者背景、details／detail_history、常驻必要证据、原始消息／公开剧情／experiences、学校计划不执行本期删除政策。容量不是整个SQLite文件大小上限。

睡眠例外、500条归档及归档90天已作为配置缺省值实现；本地配置未显式覆盖时采用缺省值。本期仅实现正常业务所需规则，不增加极端情况防御框架。

## 2. 文件职责及配置

| 文件 | 责任 |
| --- | --- |
| `src/memory/types.ts` | 容量／空闲／增量／清理类型、扩展维护合同 |
| 新`src/memory/capacity.ts` | 计数、完整排序、短期转层、长期归档和一次容量归一 |
| 新`src/memory/idle.ts` | 持久化锚点、活动判定、深度资格、有效截止 |
| 新`src/memory/cleanup.ts` | 引用闭包、跨表清理、job剪除、一次清理单元 |
| `store.ts`、`lifecycle.ts`、`retrieval.ts` | SQL筛选、原生命周期衔接、恢复／合并／索引 |
| `maintenance.ts` | 增量快照、合格任务公平排序、在途回写及逐单元应用 |
| `src/host/input.ts`、`runtime.ts`、`src/recovery.ts` | 接纳输入、确认输出、段B及Host让位入口 |
| `src/model/contracts.ts`、`prompts.ts` | 正式深度合同和角色／事实审核边界 |
| `src/deployment/memory-runtime.ts`、`src/index.ts`、`settings.ts` | 装配、新旧库门禁、配置兼容 |
| 新`scripts/migrate-memory-capacity.ts` | 只读检查／停止后的显式结构升级 |
| 新`src/memory/metadata.ts`、`src/deployment/memory-capacity-upgrade.ts` | 无正文统计、同源检查、备份及结构升级 |
| 新`scripts/validate-memory-capacity.ts`及离线／在线验收模块 | 新隔离库混合场景和有限模型合同验收 |

新配置位于`settings.memory`，不得复用`contextLimits.shortItemsLimit／longItemsLimit`：

```json
{
  "capacity": {
    "shortActiveLimit": 100,
    "longActiveLimit": 1000,
    "longArchiveLimit": 500,
    "archiveRetentionDays": 90
  },
  "idleMaintenanceMinutes": 15,
  "maintenanceDuringSleep": true
}
```

四个capacity值为正整数或null，缺省取上表，显式null只关闭对应条数／期限约束。15分钟为正数；睡眠例外为布尔值。旧配置缺少整个对象可以解码默认值，但旧库未迁移时不能因此直接清理。`batchItems=20`、后台并发1、`batchCharacters=null`沿用；实际后台请求超时120000ms及重试300000ms不因验收工具300秒而被误改。

## 3. 数据字段与接口

### 3.1 主身份、空闲状态及待办

`MemoryCandidate`新增可选字段，加载旧行时归一为null／空数组：

| 字段 | 类型与含义 |
| --- | --- |
| `capacityExitedAt` | `string|null`；本层因容量退出时刻，短期／长期分别存自己的值 |
| `capacityExitReason` | `'short_capacity'|'long_capacity'|null` |
| `archiveEnteredAt` | `string|null`；普通长期本次进入归档的真实起点，不是维护执行时间 |
| `evidenceMemoryIds` | `string[]`；learned引用的canonical经历身份，与原始sourceIds分开 |
| `evidenceVersions` | 可选`OwnerVersion[]`；learned各必要canonical证据已同步的版本，旧值缺失按空数组处理，仅存ID／版本不复制正文 |

归档判定和起点统一使用`src/memory/capacity.ts`导出的两个纯函数：`archiveStart(row:MemoryCandidate,now:string):string|null`及`isArchivedLong(row:MemoryCandidate,now:string):boolean`。它们只接受普通有效canonical长期作为归档池对象；short、learned、durable、merged／discarded不计入该池：

```text
archiveStart(row, now):
  kind不是long、status不是active或mergedInto非空 -> null
  archiveEnteredAt非空 -> archiveEnteredAt
  否则capacityExitedAt非空 -> capacityExitedAt
  否则expiresAt非空且expiresAt <= now -> expiresAt
  否则 -> null

isArchivedLong(row, now) := archiveStart(row, now) != null
```

自然到期不要求定时任务先写archiveEnteredAt：仅有expiresAt到期也立即算归档。首次落地归档字段时，将上述推导出的真实起点保存到archiveEnteredAt，不使用执行now。**一旦archiveEnteredAt已保存，本次归档窗口和90天清理截止只认该锚点**；之后expiresAt变化或再次到期都不能后移／重启窗口。expiresAt仍保留原长期grant的业务含义，不再作为另一套本次归档截止。任何合并／改写会改变已归档成员的期限字段时，先在同一事务固化修改前的archiveStart，不能因字段尚未落地而顺带延期。

真实重新激活在同一事务清空archiveEnteredAt、capacityExitedAt及reason；随后新的真实退出才开启新窗口。§7.2正式同事件合并继承既有活跃成员资格是身份合并，沿用该成员真实grant，不是凭维护now重新激活；全归档成员合并保留最早真实归档锚点。

current筛选、longArchive计数、清理候选与90天截止、状态统计和升级检查共用此定义。SQL使用等价的普通主身份过滤及同次序CASE表达式，集中在一个Store归档查询片段，不在各调用点重写判定；纯函数与SQL用相同夹具校验一致。不得仅以archiveEnteredAt非空计数，也不得按expiresAt另算一个不计500的历史池。

`Runtime`新增`memoryCapacityVersion:1|null`及`memoryIdle:MemoryIdleState|null`。版本1是本功能迁移标记，`memory_schema_version`和基础记忆结果`schemaVersion`仍为3，不按文档V0.4改成4。

```ts
interface MemoryCapacityConfig {
  shortActiveLimit: number|null; longActiveLimit: number|null;
  longArchiveLimit: number|null; archiveRetentionDays: number|null;
}
interface MemoryIdleState {
  lastInputAt: string|null; lastOutputAt: string|null;
  lastStoryCompletedAt: string|null; lastActivityChangedAt: string|null;
}
interface MemoryDirtyOwner extends OwnerVersion {
  queuedAt: string; reasons: Array<'event'|'awaken'|'detail'|'capacity'|'expiry'|'learned'>;
  status: 'pending'|'reserved'|'done';
  lastProcessedVersion: {revision:number;stateVersion:number}|null;
}
interface MemoryAuditReport {
  id: string; at: string; readSet: OwnerVersion[];
  kind: 'detail_conflict'|'learned_revision'|'learned_withdrawal';
  sourceIds: string[]; reason: string;
}
```

新增`memory_dirty_owners(id,data)`保存每owner最新版本、状态及处理水位，主键`ownerType:ownerId`；done行仅为轻量水位，不是可调用待办，owner物理清理时一并删除。`memory_audit_reports(id,data)`保存当前增量审核建议，按相同对象＋建议类别替换过时报告，避免无证据变化重复调用。不保存另一份完整记忆正文。新证据版本更新同一行并转pending；不能删除水位后再把同版当未审核。

`MaintenanceJob`补`kind:'consolidation'|'audit'`及`prunedOwnerKeys:string[]`，缺省分别为consolidation及[]。`selectedIds`是正式审核对象，`snapshot／readSet`还包含必要依赖；批次20只限制selected，不裁关联事实／身份，也不裁正文。

### 3.2 固定公共接口

```ts
// src/memory/capacity.ts；均使用调用方传入的now
class MemoryCapacity {
  readonly config: MemoryCapacityConfig;
  constructor(store: MemoryStore, config: MemoryCapacityConfig);
  counts(now: string): MemoryCapacityCounts;
  normalize(now: string, protectedLongIds?: string[], changeBudget?: number): CapacityResult;
  reactivate(id: string, at: string): void;
}
// src/memory/idle.ts；调用方负责输入／输出／段B事务
class MemoryIdle {
  constructor(storage: Storage, minutes: number, duringSleep: boolean);
  record(kind: 'input'|'output'|'story'|'activity', at: string): void;
  eligibility(now: string): IdleEligibility;
  nextDeadline(now: string): string|null;
}
// src/memory/cleanup.ts；同步单元，不包含网络await
class MemoryCleanup {
  constructor(store: MemoryStore, capacity: MemoryCapacity);
  applyOne(now: string): 'applied'|'blocked'|'none';
  nextDeadline(now: string): string|null;
}
```

`MemoryCapacityCounts`固定为`shortActive,longOccupied,longPreview,longVisible,longArchive,protectedLong,shortOverflow,longOverflow,archiveOverflow`均为number。`CapacityResult={changedOwners:OwnerVersion[],temporaryProtectedIds:string[],counts:MemoryCapacityCounts}`；保护ID只用于本次归一，不能保存成永久豁免。`IdleEligibility={allowed:boolean,readyAt:string|null,reason:'ready'|'waiting'|'shared_activity'|'activity'|'unfinished'|'batch'|'paused'}`。Host仍负责“是否存在可执行前台”的最高优先判断。

`assembleMemory`扩展返回`capacity,idle,cleanup`；`Dependencies`增加对应可选依赖供既有开发fixture兼容，正式装配必须同时启用三者。已有`MemoryMaintenance.startOne／applyOneReady／nextDeadline`签名保留，其内部按任务类型使用idle资格。

装配次序为store→capacity→`new MemoryLifecycle(store,capacity)`→idle／cleanup→maintenance；Lifecycle第二参数可选，兼容既有无容量fixture。awaken校验当轮来源／合法ID后才调用capacity.reactivate；不设置反向Lifecycle依赖。段B调用normalize时显式传入本轮真实恢复的canonical ID，函数内部另收集本次提前转层ID，保护只覆盖当前归一。新增可选内部changeBudget，缺省Infinity；旧库清理入口用1逐对象推进，段B仍完整归一当轮小差额，不改变容量规则。

## 4. 活跃计数、排序与转层

### 4.1 两个工作集

短期只数尚未自然到期、未容量退出、未merged／discarded的实际short行。不同短期关联相同long仍分别占短期容量；只有正式短期合并才能减数。

普通长期按非durable的canonical主身份计数，排除merged／discarded及§3.1的isArchivedLong，包含尚未达到retainedFrom的预备项：`longOccupied=longPreview+longVisible`。正常归一后占用不超过1000，可见是其子集，不另设配额。`longArchive`计数、500容量候选和90天清理对象都用同一个isArchivedLong集合；自然到期与容量退出统一计入，别名不重复计数。

自然过期查询立即失效。保护集合包括仍服务活跃短期的canonical长期、常驻必要证据，以及本次提前转层／真实恢复的长期；保护项本来就在池内，不能另扣100条。先处理短期归一，再处理长期；典型情况下100条活跃短期至多保护100个不同关联长期。无合格候选时记录超量和原因，不拒绝新记忆。

### 4.2 两种完整排序

| 比较顺序 | 活跃容量退出（先退出） | 归档超量清理（先删除） |
| --- | --- | --- |
| 前置 | 排除受保护身份 | 排除实际仍被引用的必要身份 |
| 1 | importance：normal在high前 | 累计有效唤醒日期数升序 |
| 2 | 累计有效唤醒日期数升序 | lastMeaningfulAt升序 |
| 3 | decayRatio降序 | importance：normal在high前 |
| 4 | lastMeaningfulAt升序 | happenedAt升序 |
| 5～末 | happenedAt、createdAt、ID升序 | createdAt、ID升序 |

短期唤醒数来自关联canonical长期，长期来自自身canonical。没有独立短期唤醒计数；不得使用会清零的windowAwakenings。`lastMeaningfulAt=max(lastEventUpdateAt,最近有效唤醒firstEffectiveAt)`，无唤醒使用真实事件更新时刻；`decayRatio=clamp((now-lastMeaningfulAt)/(7或90天),0,1)`。后台读、重写、索引及归档时刻都不算“刚发生／刚想起”。

两张排序表的importance位置不同是有意的：活跃优先保重要新事，有限归档优先删除低唤醒旧事。不能共享一个排序器然后只换容量值。

### 4.3 提前转层与真实恢复

short容量退出时同事务标记、确认关联长期摘要存在、令普通未生效预备摘要立即生效。day 3退出、原day 7截止：`retainedFrom=day 3`，初始grant锚点day 3，`expiresAt=day 3+90天`；保留短期原截止。**这是前移操作**，不能套用真实新进展导致预备截止后移的旧分支。已生效长期、真实有效续期和durable不重置。

容量退出不算唤醒；已有基础eventSummary／feelingSummary足以先接上，不等待LLM改善。short详情暂留至原7天截止，随后按§5清理。关闭容量不重新暴露已退出详情；新增真实进展可按合法来源建立／继续事件，但不得恢复旧详情为刚发生。

长期容量退出写capacityExitedAt／reason及archiveEnteredAt，不伪造expiresAt，不复用discarded／merged。current排除isArchivedLong；archive仍按既有权限提供存活的当前项及归档项，未生效预备项不能靠archive越过retainedFrom。常驻、details和学校客观上下文权限保留。

只有有合法当轮重谈来源的awaken才能恢复普通长期；清除本次归档标记、沿原canonical及每日去重处理，新增reactivate grant从真实重谈算90天，已有更晚有效期限不缩短。查询命中不恢复；同一重谈不能成为两份续期证据。即使该日已有有效唤醒，合法容量恢复也只能产生恢复窗口，不能重复增加日期数。恢复长期不恢复旧short详情，保护至当前归一结束，必要时归档另一合格候选。

容量／恢复改变stateVersion；正文不变不重建向量。每轮段B先保存基础结果、登记增量、按短期→长期归一，再提交故事完成；事务没有网络。大量旧库归一使用Host逐单元待办，避免一轮处理全库。

## 5. 有限归档、真实清理及引用闭包

### 5.1 清理条件是OR，不是AND

归档已满90天的合格记录可删除，哪怕只有一条；归档超过500时，未满90天也可按归档排序删除。90天是**最长**归档时间，不保证每条至少有90天找回期。否则超过500仍不能清理，违背有限容量。

归档对象统一用§3.1的isArchivedLong；清理期限统一为`archiveStart(row,now)+archiveRetentionDays天`。自然到期且字段尚未落地时用实际expiresAt推导；已落地则只取archiveEnteredAt。容量退出后又自然到期不会改窗口，离线、重启、摘要合并／改写、维护执行均不后移。真实重新激活结束本次归档窗口，下次真实退出重新计算。超过归档期限先清理，再处理超量；未晋升常驻的高唤醒／high记录没有无限归档豁免。

### 5.2 先处理引用，再删身份

| 引用 | 本次明确处理 |
| --- | --- |
| 活跃short.linkedLongId指向待删long | **保护long，不强行结束short**；如有正式合并，先同事务将short重指到真实新主身份 |
| 已退出／到期short仍指向long | 原7天内保护long；到期且摘要就绪时先清short及派生副本，再删long；摘要缺失时仍保护存活canonical long，并走下述修复闭环 |
| learned.canonicalMemoryId／evidenceMemoryIds | 有效常驻证据保护；不因归档压力删除有效learned。历史sourceIds中可确认的记忆ID在迁移时归一为证据引用 |
| mergedInto、其他短期／证据引用合并次身份 | 合并事务重指主身份，旧次身份移除正文／向量；仅仍被未完成工作引用的旧ID留轻量重定向 |
| 未完成故事／post_job | 本期保守地暂缓物理清理；该故事完成后即重扫，不等待一次新的15分钟深度窗口 |
| pending／computing／ready后台快照 | 不构成永久保护；按§5.4剪除快照、作废相关单元，其他单元继续 |

归一后的正常状态不应出现“活跃short长期指向可删除long”；对旧库已存在的这种状态仍按上述闭包处理。DSH提出的“先把活跃短期也退出”不是默认策略，不能为清理一个弱long破坏本来合法的短期7天窗口。

合并重指后增加相关owner.stateVersion，使旧快照过时。清理short前必须确认非空简要long或其真实canonical主身份已经保存。基础create/update的eventSummary／feelingSummary至少一项非空白，另一项允许为空，无长度预算；双空白走既有格式修补。存量缺摘要的到期short显示missing_summary，保护其存活canonical long；仅有存活详情和合法历史来源时登记增量摘要修复，不造身份／来源、不重扫原始日志。short的可选summaryRepairBasis记录登记后的(short.revision,short.stateVersion,long.revision,long.stateVersion)；同版本只登记一次，登记仅提升stateVersion，不改变正文revision、事件时间、截止或grant，已处理水位也能合法重新登记。没有可用详情／来源／long时保留阻挡，不排空任务。

修复准备和应用沿用空闲15分钟、活动、前台及重试门禁；选中可修复的空摘要事件必须refine或合法同事件合并生成非空简要摘要，不能retain／discard绕过。成功后原清理入口先删到期short及派生副本，再按原archiveStart判断long；删除保护不后移归档起点，也不改变活跃容量归一资格。正常已有基础摘要的short到期清理不等LLM。常驻必要证据只保留必要身份／摘要，不要求保留所有原short全文。

### 5.3 删除面与事务边界

`MemoryCleanup.applyOne`最多清理一个已闭合事件身份及必要退出子记录，同一Storage事务完成以下适用项目。不能靠通用`storage.remove('memories',id)`代替专用表删除。

| 数据面 | 删除／压缩内容 |
| --- | --- |
| memories | 待清理short／普通long正文；merged／discarded的已无必要退出正文也清理 |
| memory_awakenings | 按canonicalMemoryId删除该身份日期；不得误删已迁移到存活主身份的日期 |
| memory_retention_grants | 按记录canonicalMemoryId删除；不按旧grant ID前缀猜归属 |
| learned_background | 活跃必要投影保护主身份；仅无必要的退出副本可清理，其他有效常驻不删 |
| memory_index | 该owner所有revision／配置签名向量；只换可见性时不删除有效向量 |
| memory_index_jobs | 清理text／result及待办；在途返回不能重建已删job或vector |
| memory_maintenance_jobs | 剪除snapshot项、相关结果正文，保留其他单元和必要轻量状态 |
| dirty／audit记录 | 删除已无owner的待办与已无有效依据的当前建议，不保存正文副本 |
| post_jobs | 故事done后清空result中的详细记忆提取正文；未完成恢复所需数据不动 |
| 已完成模型网页checkpoint | 清空input／privateLookupResult／repair等恢复正文；网页来源、额度和材料不随普通记忆删除 |

退出short的原始消息／experiences仍是业务来源，不能通过自动重扫原始日志无限重建已删记忆。永久清理后明确回忆返回未找到；用户重新叙述或新真实经历可按当轮合法来源形成新记忆。

post_jobs和网页checkpoint也会保存记忆正文，这是核对源码后补充的删除面。`WebSearchService.releaseOwner`当前仅清进程缓存，不证明持久化checkpoint已压缩。新增`compactOwnerCheckpoint(ownerType,ownerId)`明确清空已完成调用的恢复正文，保留网页计数／来源；未完成前台不调用此方法。环境步骤成功后也处理其已完成模型checkpoint，不修改晨间排程。

后台单次prepare结束（成功、失败或超时）可以清掉该次已结束模型checkpoint：pending重试从当前持久化快照重建输入，网页session计数沿用，不开新额度。尚在途的模型内存／checkpoint允许暂存至该次请求结束，清理待办标明这个短暂副本；不能成为永久档案。停止／超时的signal继续阻止迟到保存。

### 5.4 在途回写必须读新job

已有合同要求`ids ⊆ readOwners`，并把readOwners转为readSet，所以DSH“合同允许写ID不在readSet”的推论不成立；但物理删除仍需明确生存检查，且不能依靠非空断言应用。

应用单元前检查`ids／readSet／canonicalId`在当前有效快照中的身份存在、当前owner存活、版本一致、必要关联完整。任一缺失按stale处理，不抛成无限重试，不回建owner；与其无关的单元继续。旧纯索引结果owner不存在同样stale，不重建向量。

清理时把被删ownerKey写入当前job.prunedOwnerKeys，并从持久化snapshot剪掉正文：

- pending：重建仍存活selected及依赖；没有selected则done并压缩。
- computing：本次本地请求保留旧快照至返回，但数据库快照已剪除。
- ready：相关单元标stale、移除其content等正文，保留其他有效单元；全部终结时压缩job。
- done：不保留snapshot、完整result及索引text／向量结果；只留任务统计，重复恢复不执行。

**prepare成功／失败回调读取当前数据库job，再合并结果**，不能用`{...work.job,...}`把闭包里的旧snapshot覆盖回来。job已移除／终结则忽略迟到结果；尚有其他单元则过滤prunedOwnerKeys和当前owner生存／版本，存回有效结果及stale标记。重试不能重新排已删对象，web额度／来源沿用同一逻辑任务。

轻量重定向只服务仍在运行的旧ID引用，正式引用应先重写canonical；消费者结束后清理重定向。不把所有合并旧ID、done job或审核报告另做无限正文档案。

### 5.5 清理调度

确定性的计数、转层、归档期限及少量物理清理不调用LLM，不等15分钟；深度模型审核才受15分钟门禁。Host先恢复旧轮／处理前台，随后`cleanup.applyOne`，每次成功让出并重扫，再考虑深度ready或新后台准备。

short原7天截止、归档90天截止、容量归一待办纳入已有Host计时器；没有新消息也能执行。未知保护结束时不反复使用过去截止返回now；等待正式状态／故事完成后唤醒。人工暂停不清理，stop不再提交；首次旧库大批超量逐单元处理。暂时超量显示差额及阻挡原因，保护解除后继续。

## 6. 空闲15分钟与活动门禁

### 6.1 锚点的明确写入点

`idleAnchor=max(memoryIdle四个非空时刻)`，`readyAt=idleAnchor+15分钟`。record只取更晚时刻，不因重放退回／前移；无实际输入／故事的新库用初始化Clock建立锚点，无待办不调用模型。

| 事件 | 写入入口 | 刷新 |
| --- | --- | --- |
| 新普通／共同消息、【推进】 | 实际类名`InputBuffer.acceptInput`，接纳事务 | lastInputAt；生产入口以platform/selfId/userId/channelId/messageId的JSON元组建立稳定ID，缺平台messageId才用独立UUID；同ID重复投递不重复接纳或刷新 |
| 实际输出成功确认 | `sendFrozen`的confirmed提交事务 | lastOutputAt；失败、sending、草稿不算 |
| 实际非环境故事完成 | `finishPostprocessing`段B，与done／completedAt一起 | lastStoryCompletedAt；静默生活故事也算 |
| 共同活动真正开始／结束 | 公开开始确认及段B正式状态转换 | lastActivityChangedAt；最终轮完成／输出取最晚 |
| 普通scene.activity真正开始／结束／切换 | 段B比较此前character与正式nextState | lastActivityChangedAt |
| 学校提醒被角色正式获知、新事件进入经历 | 对应正式故事段B | 由story锚点覆盖 |
| 环境步骤完成、通知客观发布、索引／维护完成 | 各自步骤／job | **不刷新** |

普通活动以`startsAt`识别连续活动，同一startsAt的描述润色、phoneAccess／expectedEndAt更新不是结束；null→活动、活动→null、实际起点不同的切换构成变化。主叙事共用提示明确“继续同一活动保留原startsAt，真正新活动使用真实新起点”。未来startsAt尚未到不挡；实际活动仍存在则即使expectedEndAt已过也不猜结束。不额外为维护启动生活推进。

### 6.2 深度资格

以下任一条件关闭深度prepare和ready应用：暂停、未完成故事、openBatch、未满最新15分钟、sharedClock正式active、已开始且未确认结束的普通活动。睡眠例外只解除睡眠本身的活动阻挡，不解除共同活动、输入或其他明确活动；是否睡眠用现有isSleeping，不按“在寝室／躺着”猜。

共同活动整个过程中即使双方没有输出、下个60秒节点尚未到也不能深度整理。结束后从最后实际输出／实际结束／最终故事完成最晚值重新等15分钟，不能抵扣开始前已等部分。

等待期间新输入立即刷新；随后更晚输出／正式完成再次刷新。不取消在途深度请求，但ready待新资格。重试到期、04:30补漏、重启／恢复不能越过门禁；纯重启不额外刷新，恢复旧故事按真实新completedAt刷新。维护完成不刷新自身锚点，空闲15分钟不是每15分钟一次调用周期。

## 7. 增量深度整理与正式合同

### 7.1 增量队列与水位

实际段B仅登记本轮触及的short／long／detail／learned版本。容量退出、真实唤醒、到期和证据变化同样登记。每owner只保留最新待办，已reserved版本不重复分配；当前版本变化则等旧单元stale／完成后选新快照。

04:30只补到期／漏办，固定cutoff，不每日审核全部1000；离线后处理当前已到期及未处理版本，不补造每天审核。后台自己的摘要改善／已审水位不再次入增量造成自循环。成功unit用`completeDirty(readVersion,resultingVersion)`登记处理后的版本水位，队列仍等于readVersion时才转done；更晚已登记版本继续pending。冲突仍存活且有新版本者重新入队，已删对象不入队。同版done再次补漏不重排。

选中事件依赖包含其canonical长期、相关short／learned、稳定认识必要跨事件证据和事实来源；20个selected之外可以补依赖。短期详情清理与深度准备在同一Host选择点串行：摘要已存在可先清理过期short，随后只从当前存活long／原合法来源建立摘要任务；不要求先依靠LLM成功才删除过期详情。

### 7.2 合同变化

继续使用独立`memory_consolidation`模型角色；任务类型`kind`和输入明确区分事件整理／固定信息审核。现有refine只改long简要摘要，不改short详细正文。新增动作：

| 动作 | 必需输入／输出 | 程序应用 |
| --- | --- | --- |
| `merge_short` | ≥2个不同存活short身份及其必要long／learned／反向short依赖；canonicalShortId为createdAt最早的输入short，相同时取ID升序最小者；content、eventSummary、feelingSummary、非空合法sourceIds | 合并同事件详细记录；linked long若不同先正式合并并重指；单一long不假装满足旧merge≥2long合同 |
| `review_detail` | targetId为被审detail ID、readOwners、sourceIds、decision=`retain`或`report_conflict`、reason | retain登记水位；冲突保存当前建议，不自动改details或历史 |
| `review_learned` | targetId为被审learned ID及证据readOwners、sourceIds、decision=`retain`／`suggest_revision`／`suggest_withdrawal`、reason | 保存审核水位／建议；本期不自行改作者背景或撤销常驻结论 |

所有动作明确readOwners，程序生成包含写入对象和隐式重指对象的readSet。继续保证ids在readOwners内且不重复、每selected被一个unit覆盖、不重叠写入、来源来自快照合法证据。事件整理仍隔离各单元完整依赖；只报告建议的audit允许不同目标共享只读证据，目标仍不得重复，每单元仍校验全部readSet版本。允许空结果仅在没有需要审核的selected时；有selected时用retain表达合法“无变化”。

audit仅消费selected审核目标的dirty水位，作为比较证据读取的short／long仍保留其独立事件待办。detail快照补同键／别名事实及共享合法sourceIds的存活证据，再沿既有事件依赖补全，不一次发送全库。learned除主canonical外，任何evidenceMemoryIds关联事件的版本变化也登记新版本及一次审核；同一证据版本重复同步不重新入队，不改原结论。

`merge_short`必须显式加入contracts中“content非空且sourceIds至少1个”的变更动作集合，成为`refine／merge／merge_short／promote`，不能只在提示词或表格中要求。sourceIds须来自提供的历史快照合法来源白名单；本阶段不要求另有当前用户新消息，也不能把维护job ID伪造为来源。空数组或未知来源按合同失败进入既有格式修补，不能通过正式应用；合并结果另保留成员来源并集。canonicalShortId的时间相等按解析后的createdAt时刻判断，ID按稳定字符串升序最小者，调换输入数组顺序不改变主身份。

merge_short要求模型明确同一事件而非共享关键词，不允许不同事凑条数。保留sourceIds并集、完整事件范围及阶段感受；short保留截止取真实latestEventUpdateAt+7天，容量退出状态不靠合并清除，合并不算唤醒。详细content仅写short；关联long正文由合并后的eventSummary／feelingSummary构造，不能复制short详细正文。关联长期合并迁移日期／grants、去重并保留更晚真实有效期限，不凭处理now续期；如果成员仍有活跃层资格，主身份继承真实现有资格并解除本次归档标记，沿用真实已有grant，不算新增唤醒；全归档成员合并固化各原始archiveStart，主身份保留最早锚点，不能靠合并后台归档记录自动恢复或延期。

稳定认识证据独立字段evidenceMemoryIds包含至少两个不同canonical事件；原30次门槛不能通过多short指同long、后台复读或共同代写推导用户稳定性格来凑。promote主long必须是未归档的活跃普通身份且满足累计30有效日期；归档主项必须先以合法当轮来源显式awaken恢复，再进入正常审核，累计日期不清零，不能靠维护改写或检索恢复。该限制不自动撤销已有durable，也不禁止仍合法的次事件证据。consolidationTask(snapshot,selectedIds,kind,evaluationAt)使用job.cutoff作为冻结评估时刻；正式模型输入给promotionEligibleIds，应用按同一冻结主项在当前时刻再次检查。准备期间自然到期判stale、重排当前合法工作，其他单元继续，不把冻结promote投入五分钟重复应用。promotionCandidates(at)与定时审核候选采用同一谓词。retain／discard规则继续，其中discard零唤醒要求与容量清理分开，不能用discard表达有唤醒旧记忆的最终到期删除。

具体事实有新来源仍每轮立即更新；空闲审核初版只报告矛盾／重复key，不回滚正式事实，不发新消息／任务联系用户。审核报告只保存必要结论、ID和来源，不复制整个候选正文。替换报告按固定decision的完整报告ID精确删除；_／%是字面键字符，不使用LIKE模式。

## 8. 公平调度与截止

Host每次选择顺序：旧未完成故事→现有可执行前台（含环境步骤）→一个确定性清理单元→一个合格ready单元→一个合格pending准备。清理及ready成功都setImmediate后回到选择点。已有环境请求仍可能占前台槽，本期不改环境并发；在途后台与环境可并行，但新后台准备／应用不得抢前台。

索引不等15分钟；深度两类job都检查最新idle资格。同为合格时按现有createdAt→jobId FIFO，合格ready优先提交再准备，不无条件索引优先。未满足深度门禁的ready不能挡合格索引；index和深度只有一个网络准备槽。

截止只返回能改变资格的未来时间／当前实际可处理工作：idle未满返回readyAt；retry未到取retryAt与idle门槛共同约束；活动未结束不给过去idle截止，等实际状态／合法前台截止；在途请求等回调，不为它安排0ms轮询。清理／索引不继承深度15分钟门禁，但仍受Host暂停／旧轮／openBatch及前台优先规则。

## 9. 升级、装配与观测

新库按当前Clock初始化idle和版本1；旧库必须先用升级前版本恢复／完成旧非环境故事，停止服务后显式迁移，不能指望已被新装配门禁拒绝的版本替旧库续轮。结构升级兼容JSON字段，保留schema3；learnt历史可确认事件引用归一到evidenceMemoryIds，已知short ID沿linkedLongId解析到canonical long，保留原始sourceIds，不能猜陌生ID是事件。新promote同源解析短期证据，合同readSet包含该canonical长期版本，应用与合同使用同一个真实事件身份。

脚本默认`--dry-run`：用内置SQLite只读连接，不经会写DDL的Storage／MemoryStore构造器，输出数量、拟转层／清理ID及原因、保护／缺失引用、待办差额；不打印正文／密钥。`--apply --stopped`写结构／标记和持久化待办，初次大批归一仍由Host逐单元推进；迁移前备份、记录检查结果，重复apply不重置日期／grants／idle或已经生效配置。

退出活跃池与物理删除分别使用对应运行阶段的保护集合：`longCapacityExits`使用`protectedCanonicalIds(rows, at, false)`；归档`protected`、`archiveCapacityDeletes`和到龄归档清理使用`true`。受阻或仍保留的短期详情可阻止关联长期正文被删除，但不额外赋予其活跃层资格。各列表是检查时刻现有快照的分阶段候选，未模拟后续短期退出、预览激活、临时保护、新输入与逐单元清理；不能称为“至少这些会退出／删除”的下界或整个调度过程的最终清单。

脚本`--config <json>`默认指向项目config.local.json；只解码memory容量及空闲部分，不用会读取key.txt／backgroundFile的loadSettings。报告列出配置来源及有效容量；检查与apply使用同一配置，不能用默认500估算另一套已显式修改的容量。

旧库idle初始化取现存真实输入／confirmed输出／非环境done故事时刻最大值；缺乏任何证据时取迁移Clock。现存实际活动按状态继续阻挡，不用预计结束代替。旧pending／ready维护job规范化kind及轻量剪除字段；computing按现有恢复规则转pending。done任务正文压缩，不把旧深度结果在新门禁前应用。

正式装配旧标记缺失时报明确命令，不偷偷清库；配置解析本身不写库。保持用户手动cmd启动服务的安排。升级工具不读取密钥或背景；有限在线验收在既有授权范围内读取本地模型配置和背景，不读取正式聊天。

status展示四个长期统计、short活跃、容量目标／差额、保护数、最老清理阻挡、idleReadyAt／阻挡原因、增量pending／ready及实际后台请求／重试数；不加载或记录私聊／记忆正文。归档缺失按未找到，不保证500或90天之外可恢复。常驻／原始业务数据增长仍可另行评估，不宣称本期完成磁盘封顶。

## 10. 验收与实施阅读顺序

验收矩阵见执行计划各任务。关键断言是：第101条详情有摘要接续、第1001条含preview归一、归档501或90天分别触发真实清理、悬空引用与迟到回调不复活正文、真实新输入使ready重新等待15分钟、索引不被不合格deep ready堵住、晨间链优先且不刷新空闲锚点。

真实模型只使用此前允许的角色背景及隔离测试剧情，不连接QQ或发送正式聊天。验收工具单请求300秒；不把工具等待值改成正式后台超时。只做有限合并／审核场景并记录模型合法retain、冲突建议和实际调用量，不根据一批输出声称100／1000／500已适合数月使用。

实际实施先读本文，再按[执行计划](MEMORY_CAPACITY_IDLE_V0.4_EXECUTION_PLAN_20261008.md)任务1～8顺序执行。相关既有能力查[记忆V0.3细化](../memory-v0.3/MEMORY_V0.3_IMPLEMENTATION_20261007.md)、[共同活动细化](../shared-activity/SHARED_ACTIVITY_V0.3_IMPLEMENTATION_20261007.md)、[世界学校细化](../world-school/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_20261008.md)，不重做已完成计划。审核往返仅作历史依据；本期冲突以本文明确替代项为准，未替代项仍按现有实现。

### 第十六轮合并记录

第十六轮§2.1／§2.3的归档集合与锚点口径合并到§3.1／§4.1／§5.1；§2.2的ID决胜及来源硬校验合并到§7.2，并在执行计划任务2／3／5／7补充验收。其§3观察沿用现有OR清理、删除面和让位规则，不增加新的产品选择。审核阶段只更新文档；后续任务1～8实施及实际验收见[过程日志](MEMORY_CAPACITY_IDLE_V0.4_IMPLEMENTATION_LOG_20261008.md)和[交付记录](MEMORY_CAPACITY_IDLE_V0.4_DELIVERY_20261008.md)。

### REVIEW17／18 交付修复

已合并获批重复身份、双空白摘要闭环、归档晋升主项及字面审计身份修法：见§5.2、§6.1、§7.2及执行计划补充。首轮实现435测试为历史记录；本次修复及整体复核修正后83文件469测试、类型检查、构建、隔离混合验收通过。最终复核／集成见[修复记录](REVIEW17_MEMORY_FIX_LOG_20261008.md)。未改模型／搜索配置，无正式库写入，无在线调用或QQ连接。
