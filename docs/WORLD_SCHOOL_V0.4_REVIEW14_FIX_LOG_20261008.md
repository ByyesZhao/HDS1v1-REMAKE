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
