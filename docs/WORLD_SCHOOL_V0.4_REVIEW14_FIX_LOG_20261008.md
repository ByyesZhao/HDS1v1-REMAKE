# 世界与学校 V0.4 第十四轮修复记录

日期：2026-10-08。起点1466701；分支codex/world-school-review14-fixes。执行依据为用户已接受的交付回应§6及世界学校实施细化／执行计划。本文件记录这次局部修复，不重做原任务1～8。

采用执行计划、隔离工作树、TDD与根因调试技能；逐组本人实施，结束只做一次独立终审。服务不启动，不新调在线模型，正式配置及数据库不改写；原336项基线和全部修复日志保留。

## Task 1 冻结结果、摘要替代及批次时区

先新增业务失败回归，再修冻结结果跨开始／ready恢复、旧摘要失效与时区无进展重选。冻结候选合同仍依原输入校验；应用保护实际已开始历史，程序负责校正实例引用与通知身份，不交给模型判断时钟。

验证命令：npm test -- tests/world-school-review14-calendar.test.ts tests/world-school-review14-environment.test.ts；预期新增缺陷断言RED，然后专项GREEN及typecheck。完成后保存分组提交。

## Task 2 晨间入口及取消时间投影

先测跨日00:05只终结旧批、06:00才跑新日常链，bootstrap／显式upgrade例外保持；取消保存程序时刻，过去原始快照保留，取消后区间／onsite退出。不强制角色结束当前行为或提前获知。

验证命令同Task 1加tests/world-school-perspective.test.ts；预期新规则RED后GREEN，原跨日测试仅按已接受06:00口径调整。完成后提交。

## Task 3 覆盖、提醒及装配错误

周覆盖采取程序生成确定性元数据：每个weekStart保存全部本轮sourceVersions与checkedAt，模型仍可给conflictNotes，不能让记录掩盖必需实例／通知。提醒默认按timing，显式策略优先；装配错误进入现有暂停路径。补正向提醒、通知门禁、running恢复、上游公开／内部版本、独立必需通知及配置不写文件断言。同步规范与行为到测试名索引。

验证命令：npm test、npm run typecheck、npm run build、npm run demo、node runtime/plugin-smoke.cjs、git diff --check；预期全绿，保留新完整日志，之后一次终审。

## 接口预检与裁定

- Task 1→2：SchoolInstance新增可选cancelledAt，程序写入有效区间截止；原startsAt／endsAt／sourceSnapshot及角色已知快照保留，历史缺项兼容，不升数据库版本。该元数据只用于取消投影，不是模型产出的新事实。
- Task 1→3：冻结/ready应用都经过同一归一化；实例引用、通知ID必须一起转换，reminder已经过时则不补发。周覆盖元数据始终从被冻结输入生成，不从实时隐含新上游读入。
- Ruling：同基础课次被冻结时尚未开始、实际提交已开始，更新保存为独立后继实例（沿用基础key＋after＋旧ID），旧历史行不覆盖。它保存客观安排版本，不自动生成经历／知识；ready恢复再检查一次。成本：多保留一条版本实例，避免历史覆盖与无穷重试。
- Ruling：确定性周覆盖由程序补齐，weekChanges仍允许空及可选冲突说明，已有声明版本错误仍拒绝。成本：与“模型填覆盖记录”措辞同步，但不新增模型调用／必填空数组修补。
- Ruling：使用当前用户授权直接完成必要、可逆本地集成到主目录main，最终重建lib；不推送、启动服务或改正式库。隔离产物在归档前复制回新项目。

## 进度与证据

初始化：npm ci按锁文件安装，未新增依赖。基线输出保存于本次独立执行目录；后续RED／GREEN、提交、终审与交付在此追加。

Task 1：基线61文件336项通过。新增6项业务回归全部先RED；修后专项6项GREEN、typecheck退出0，全量63文件342项通过。归一化在resolve与实际apply都执行：跨开始的更新形成后继客观版本，历史不覆盖，通知实例引用／提醒身份一起转换，过期提醒不补发；取消候选跨开始时不再覆盖历史行。新摘要同事务失效旧未读，重复应用不把read重置scheduled；时区身份及本批自身日期统一退出旧步。原始baseline/task1-red/task1-green/task1-suite日志保留。

Task 2：新增4项，其中3项规则先RED，bootstrap／upgrade例外已有行为直接GREEN；cancelledAt为程序写入可选元数据，原起止／sourceSnapshot不改，跨区间客观投影截短，取消后的onsite拒绝，旧SchoolKnowledge保留。又补一条同轮早期获知的断言，先RED抓到截短结束时间提前暴露；修后onsite保存原安排并去除后来的cancelledAt。全量64文件346项通过，typecheck退出0。原跨日测试更新为午夜终结、06:00建新批；旧日结果审计仍保留。没有写正式库／更新正式角色状态。
任务3：7个业务断言先RED（周元数据缺失／重复周、按kind误判三种提醒、装配错误未暂停、旧恢复重写截止），另5项已有行为GREEN。修后49项专项通过；追加pending重试跨开始、后继提醒身份、周五前已有下周三项正向业务验证。全量65文件361项通过，typecheck／build退出0，demo及真实Koishi Context的离线plugin-smoke通过。默认按timing；显式策略优先；校园及周提示词、实施细化／执行计划／原日志同步。运行日志保留task3-red／green／extra／suite／demo；正式服务和在线模型未调用。


## 一次独立终审及本次裁定

独立只读终审范围1466701..5048b72；无Critical、无另列Minor，发现两项Important。其一：上一批已committed后切换时区会沿用旧晨间截止，同日切回已superseded身份还会留下过期截止；其二：冻结后迟到结果能补发一串未入库历史提醒。两项均按实际影响接受，一次修复，不再派第二审。

新增时区三个变体和请求／ready／pending迟到提醒三个变体，全部先RED；此前已入库提醒的延迟发布正向用例先GREEN。修后专项15项通过、typecheck退出0；原输出final-red／final-green保留。时区依据最近插入批次记录，并校正终态身份的下一入口，原已终结步骤／额度不重开。实际应用检查尚未入库提醒publishAt，保留当前issue／change、未来提醒和已入库合法通知。

终审提出而未深入评判的事项，逐项裁定如下（不是遗漏的新待执行任务）：

- Final: Ruling: 缺行／坏库及额外null保护不扩展，沿用本次非极端防御范围；代价是坏库仍走已有错误处置，不新增自愈。
- Final: Ruling: 全表扫描优化／数月储量不重构，本轮只修已复现行为；代价是长期吞吐仍需运行证据评估。
- Final: Ruling: SchoolWeek独立版本历史表／广泛实例归档不新增，保留原版本快照与通知审计；代价是周覆盖只保留当前记录。
- Final: Ruling: 任意乱序重放旧已提交变更不承诺，生产仍按串行事务及同轮恢复；代价是手工乱序应用不受本次验收保证。
- Final: Ruling: 不追改存量提醒策略，存量可能是显式选择，新缺省才按timing；代价是旧已保存策略继续生效。
- Final: Ruling: 迟到归一化后的模型措辞／现场叙述合理性本次只锁结构和来源，不做新在线语义验收；代价是自由文本仍需后续真实剧情观察。
- Final: Ruling: 本轮不连接QQ、不让正式库运行步骤、不声称数月运行验收；代价是正式首次环境链和长期运行尚无本次新证据。

没有延期Minor。全部任务和終审裁定的原始ledger、失败与通过日志、审查diff最终复制到项目runtime/environment-upgrade-backups/development-audit-world-school-review14中；隔离工作树按Codex管理方式归档，供恢复而非直接删除独有记录。
终审修复后最终验证：65文件368项通过（25.47s），typecheck／build退出0，demo／真实Koishi Context离线plugin-smoke通过。相对336项基线新增32项。正式配置／数据库SHA256与集成前一致；只读检查版本1，四步仍pending、attempt=0、起止null，未误记为执行完成。
