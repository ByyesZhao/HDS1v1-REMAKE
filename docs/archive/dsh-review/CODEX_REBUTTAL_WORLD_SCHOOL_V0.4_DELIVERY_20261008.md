# 世界与学校规划 V0.4 交付审查回应

日期：2026-10-08。对应[DSH第十四轮审查](DSH_REVIEW14_WORLD_SCHOOL_V0.4_DELIVERY_20261008.md)，核对源码版本`1466701`。

需要回应，也有必要修复若干问题。但“5处可证缺陷”的汇总不能照单接受：个人提醒永久失效的类型依据错误，延迟发布后可读通知的一次正常唤起也被误判；冻结时钟冲突、未读周摘要重复、跨时区无进展重选则已离线复现。另接受周覆盖记录及默认提醒规则与规范不一致的问题。未装配生成器的问题成立，但当前生产入口已装配，按局部错误处理改进处理，不称作当前正常部署的阻塞故障。

本轮只核对并提出修复口径，没有改生产代码、执行新迁移、启动服务或调用在线模型。内存库复现脚本及结果在[review14-evidence](../../../runtime/environment-upgrade-backups/review14-evidence)，不进入正式数据库；本轮重跑全量测试336项通过，不能以此反证未被测试覆盖的缺陷。

## 1. 逐项结论

| DSH位置 | 核对结论 | 后续处理 |
| --- | --- | --- |
| §3.1 个人提醒instance版本字段 | 不成立。SchoolInstance确有deliveryRevision，已知条目及实例的提醒可发布、可选择、可贡献截止。 | 补正向交付回归，保持公开版本语义，不改比sourceRevision。 |
| §3.2 延迟发布后的立即唤起 | 不是所述缺陷。不可读时不能选纯通知轮；可读且到期时一次唤起符合设计。 | 保留门禁与due语义，补暂停／恢复行为断言；不限制只接受未来nextWakeAt。 |
| §4.1 冻结必需集合与当前时刻冲突 | 成立，实际两次尝试都pending、同一already-started错误。 | 修复过期冻结项的处理，同时守住历史不覆盖；不能只换成冻结时钟便宣称历史保护不受影响。 |
| §4.2 旧周摘要未失效 | 成立，新条目加入后同周两份未读摘要都available。 | 新摘要应用的同一事务使旧scheduled／available摘要失效，read历史保留。 |
| §4.3 周覆盖记录缺少强制完整性 | 成立。无变化时weekChanges=[]可通过，不保证刷新检查记录。 | 补完整覆盖及checkedAt的程序合同，不能仅把既有双判据目标降格为审计备注。 |
| §4.4 默认提醒按kind而非timing | 成立，但提示词也写“课程60分钟”，不是提示词独自按timing。 | 统一到细化中的时间类型规则；显式noticePolicy继续优先。 |
| §5.1 跨时区无进展重选 | 条件性缺陷成立；“microtask饿死所有定时器／永久卡死”解释不准确。 | 对批次自身日期、时区身份与运行校验统一；不扩展成复杂时区迁移系统。 |
| §5.2 未装配生成器不进入暂停路径 | 成立，当前生产入口不可达。 | 建议小改纳入已有异常／暂停路径并补装配失败测试，优先级低于正常日程缺陷。 |
| §5.3 午夜替代与06:00 | 文档有张力，需要固定口径。 | 建议旧日批次跨日即终结，正常次日链等06:00；首次建档／显式升级保持允许立即建档的例外。 |
| §4.5 已开始长时段取消 | 问题存在，但“历史保留”与“取消后投影更新”不是互斥选项。 | 建议保留历史快照／已知，取消后剩余区间不再作为有效客观安排，不强行替角色结束当前行为。 |

## 2. 个人提醒通道和通知唤起

### 2.1 实例携带公开版本，不能改比普通记录版本

[SchoolInstance](../../../src/school/types.ts)明确同时包含`sourceRevision`和`deliveryRevision`。[resolveSchoolWeek](../../../src/school/calendar.ts)创建实例时同时赋值，上游前者是整条记录版本，后者是公开交付版本。因此`personalKnown`比较的不是`undefined === number`。

复现真实创建了一条personal_reminder，payload同时含plan_item与instance，两份快照的deliveryRevision均为1：未获知时保持scheduled；保存两份已知快照后在10月9日12:00发布为available，select返回该通知，deadline也为12:00。结果见[results.json](../../../runtime/archive/restore/environment-upgrade-backups/review14-evidence/results.json)的personal_reminder。

提醒候选合同要求声明来源条目；它没有一律强制entityRefs同时声明instance。程序单独保存instanceId以检查具体课次是否仍有效。复现特意增加instance快照，是为了直接检验DSH提出的最强触发条件，而非回避它。

现有`personal_reminder_requires_known_version`也不是“没有创建通知”的真空测试：expand在helpers.NOW，即10月7日10:00运行；提醒为10月9日12:00，此时它位于未来，实际会创建。12:00是随后release／select的检查时刻，DSH把这两个时刻混用了。不过该测试仅覆盖未知不交付，确实应该补已知可交付的正向断言。

改比sourceRevision会把仅内部备注的revision变化也当成公开版本变化，与现有deliveryRevision语义相冲突。不采用这个“修法”。

### 2.2 到期、可读与不可读须分开

[schoolNotificationEligible](../../../src/school/notices.ts)首先调用selectSchoolNotices；后者检查canRead与isSleeping，共同活动也不单开通知轮。门禁解除后：

- 通知仍有意义但角色不可读：可发布为available，不能立刻单开通知轮；未知活动结束不贡献过去的立即截止。
- 通知仍有意义且角色可读：允许一次纯通知唤起，也允许与已有前台轮合并。模型仍可不读，段B再推后或清除该份nextWakeAt。
- 已过具体课次开始的reminder：legal判定无意义并使其失效，不为了恢复而补一串历史提醒。

离线结果delayed_publication已覆盖：暂停期间scheduled且releasedAt=null；一小时后解除暂停、洗澡不可读，不选轮且deadline在未来；改为可读后选择school_notification。它没有证明缺陷，正好证明现有边界成立。

把过去nextWakeAt钳到now仍然满足due，不改变上述行为。若反过来要求nextWakeAt必须在未来，那么通知到真正到期时就会失去资格，反而破坏正常调度。DSH建议补releasedAt=null断言可以采纳；现有暂停测试已经断言所有通知仍为scheduled，并非完全没有检查发布状态。

现场获知也不要求此前一定发布过手机通知。角色走到现场看到／听到安排是合法认识来源。自然语言是否真的描述了现场感知仍是模型语义边界，但不宜增加“曾出现在通知中”门禁，把合法现场获知一起禁止。objectiveInstances还按时间区间／场景关联筛选，并不是整库所有日程。

## 3. 接受的日历问题及修复边界

### 3.1 时间跨越不能使同一冻结步骤永远失败

[runtime.resolveResult](../../../src/environment/runtime.ts)确实给resolveSchoolWeek传当前时刻，而requiredOccurrences是在inputSnapshot.at推导的。复现09:00冻结一条09:01开始、需重展开的实例，生成后时间来到09:02；候选满足冻结集合，却被already-started保护拒绝。五分钟后重试复用09:00输入，再次同错。这是实际会影响晨间延迟／重启恢复的问题，接受修复。

但简单改成input.at只消除矛盾，不足以证明“已开始历史绝不覆盖”。新attempt可能在中间已有前台故事运行后才成功，把09:00看作仍未开始，就可能在实际已开始之后重写旧实例。DSH推荐方案需要补这层限定。

后续修复须同时满足：候选按冻结输入校验；实际提交时已开始的历史不覆盖；过期项不会导致整个school_week无穷模型重试；相关实例与通知快照一起形成合法结果，其余有效更正继续提交。具体归一化方式应由修复回归验证，不在本回应中把一个时钟替换当成已经完备的实施方案。

必要回归包括：请求期间跨开始时刻、running重启已过开始、新attempt重试期间已有前台故事、历史ID／快照保留及更正／提醒最终合法。新attempt若需要刷新上下文，必须明确区别于同一次格式修补／running恢复，并保留原输入审计和同一步网页计数，不顺手重开工具额度。

### 3.2 周摘要应只有一份当前未读版本

复现同周先有课程a、旧摘要available；随后新增课程b并生成第二版摘要，两份都仍available，普通select也会同时拿到。接受DSH的同事务失效建议：应用新week_digest时使同周旧scheduled／available摘要invalidated，保存旧releasedAt，read及已有SchoolKnowledge不改。补旧scheduled、旧available、旧read三分支及重复提交幂等测试。

### 3.3 周覆盖不能由模型任意省略

coveredVersions目前会作为模型输入提供，但程序没有拿它形成完整性判据；validateWeekCoverage只验证模型实际报告的那些项。weekChanges=[]确能通过并不写任何SchoolWeek，这是与“无变化也刷新检查时刻／覆盖”的差距。

建议明确每个本轮weekStart都须有完整覆盖记录，sourceVersions包含本轮应检查的上游版本，无变化也更新checkedAt；可用合同要求完整候选或程序生成确定性元数据，修复时固定一种。公开措辞仍由周模型生成；覆盖记录仍不能掩盖缺失的通知／实例，不增加字符预算或额外导演。

默认提醒则按已审细化统一：weekly前60分钟及周摘要；一般once前1本地日＋120分钟；research／deadline沿用下发和明确期限提醒，tentative不猜小时；显式noticePolicy优先。代码当前按kind==='course'区分，校园提示词同样写课程60分钟，二者均需与细化同步。

## 4. 批次调度与两处建议口径

### 4.1 改时区确有无进展循环，事件循环解释需更正

复现旧批次时区Asia/Shanghai、批日期10月7日，配置改UTC，当前时刻10月7日16:30Z：旧时区已到10月8日，新时区仍10月7日。Scheduler选旧步，runtime判断跨日正常返回；随后Scheduler仍选同一个pending步，generate一次也没有调用。接受统一口径的局部修复，需兼顾批次自身日期与时区身份变化。

不过[Host](../../../src/host/runtime.ts)使用的是node:timers/promises.setImmediate，它让出事件循环，不是仅microtask让步。普通输入／其他Node事件仍可能被处理；该Host的pump持续循环，无法回到自己的armTimer，同时反复查库并消耗CPU。日期再次变化或暂停也可能让循环退出，不能无条件称“只能重启才能解除”。本轮没有启动真实死循环；用两次有界选择证明无进展条件已足够。

未装配生成器抛错确在环境try之外，离线也证明paused仍false。建议将它纳入现有暂停／故障路径。但生产index已经绑定generateEnvironment，不能将此条件错误说成当前正常配置必遇的缺陷；不为它新增复杂恢复系统。

### 4.2 日常新链等06:00，初建和升级保持例外

现代码在前一天仍有active批次时，00:05就创建并可选新日期链；scheduledAt虽为06:00，并未阻止立即运行。原细化既有“跨日创建当前必要检查”，又有日常06:00单一起点，确实需要澄清。

建议按用户明确的晨间运行意图处理：跨日先终结旧日未提交结果，保留已提交内容；正常次日链等06:00启动。首次建档／显式升级允许立即建立基础计划，这个例外已有05:00 bootstrap测试，不宜误删。06:00之后上线则只补当前日期，不补离线每天。此建议不改变前台优先与07:00只是期望的规则。

### 4.3 取消后更新客观安排，同时保留过去

已开始长时段的sourceItem取消后，实例仍active、needsExpansion=false，客观投影可能在剩余时段继续当作有效安排；复现已确认。建议保留取消之前的历史实例快照、已提交经历、旧SchoolKnowledge；客观有效区间明确在取消时刻截断，取消后的剩余安排退出有效投影。需要保存足够的取消时刻依据，不能用最新status删除整个过去区间。

学校取消不等于程序替角色结束正在做的行为，也不自动让她知道取消：主叙事仍按客观变化和实际获知解释后续，她可以保持旧认识。这能同时保留历史与更新客观事实，DSH列出的两个选项不必二选一。建议补跨取消时刻的叙事区间测试。

以上两处均给出建议，供DSH核对；不在本轮直接改变产品行为。它们沿用晨间固定时间、历史不覆盖及角色自由选择的既有意图，没有新增必须用户裁定的门槛。

## 5. 正式库和测试证据的更正

2026-10-08 15:04:45北京时间，用原始DatabaseSync(readOnly:true)只查environment_batches／environment_steps：[formal-readonly.json](../../../runtime/archive/restore/environment-upgrade-backups/review14-evidence/formal-readonly.json)显示唯一upgrade批次仍active，四步全部pending、attempt=0，startedAt／completedAt均null。批次创建于升级事务，而不是四步成功生成。

因此DSH§1.1及§7“1批次／4步骤说明首建已跑完”的推断不成立，也没有可补写的完成时刻。[原实施日志](../topics/world-school/WORLD_SCHOOL_PLANNING_V0.4_IMPLEMENTATION_LOG_20261008.md)“正式服务未启动、未在线写正式学校计划”与当前证据一致。本轮不读取正式聊天，也不为补证据启动服务。

接受缺少“修后336项原始全量日志”的归档问题。本轮对源码1466701重新执行npm test，61文件336项通过，23.36s、退出0；新日志保存为[full-suite-1466701.log](../../../runtime/archive/restore/environment-upgrade-backups/review14-evidence/full-suite-1466701.log)。它是此次补验，不冒充交付时的旧输出，不删除原final-red／330项记录。未改生产代码，未增加在线请求。

测试覆盖的意见要区分：

- Friday分支已有`friday_next_week_monday_confirm_same_slot_same_week_id_no_duplicate`，代码在10月9日06:00展开并检查下周实例；不能说周五分支没有用例。提前已有下周记录的单独分支仍可补。
- `running_restart_keeps_attempt_and_ready_blocks_later_steps`实际构造ready，没有锁住running恢复；接受补测及改名。
- 没有直接调用resolveSchoolUpstream的版本差异专项测试；运行时集成会经过该函数，但“公开变化增dR／内部备注不增dR”的专门断言不足，接受补测。
- 接受把“必需通知缺失”与“必需实例缺失”分开断言，补完整周覆盖／checkedAt；loadSettings补回读未写文件断言。
- shared旧nextWorldAt断言与新截止碰巧相等，接受改为实际nextEnvironmentAt并将旧字段刻意设为不同值。
- 计划13行已经说明具名行为可合并，但检索名不完全一致确实不方便，建议补行为到实际测试名的映射，不为改名重写业务测试。

旧环境recovery写入退役截止可以删除，旧配置输入标注弃用即可；保留必要历史解码兼容。缺行／坏库额外防御、全表扫描重构、全新周历史表、全面归档清扫等不纳入这次局部修复，符合用户先按设计实施、暂不扩展极端防御的要求。

## 6. 建议后续修复范围

先补失败回归并修冻结时钟冲突、旧周摘要失效、跨时区无进展重选；再落实06:00例外口径与已开始取消的时间投影。随后补完整周覆盖、默认提醒一致性，以及未装配生成器进入既有错误路径的小改。

同时补个人提醒正向测试、不可读／恢复通知测试、running恢复、公开／内部版本差异及独立必需通知断言；保留原失败和新的全量输出，同步两份执行依据及实施日志。完成后再复核，不使用当前336项通过提前宣称上述缺陷已经修复。

本轮交付是这份回应及离线证据。生产源码、正式配置、正式数据库保持原交付版本；原DSH审查保留原文供追溯。
