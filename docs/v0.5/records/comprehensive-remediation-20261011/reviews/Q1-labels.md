# Q1 独立标注复核

状态：**PASS**（2026-10-11；下列争议已由作者修订，独立复核通过，可按文末 hash 冻结）

数据：`tests/fixtures/memory-retrieval-v2.json`，`synthetic-memory-retrieval-v2-20261011`。

## 审核边界

本审核只读自然问句、人工期望、种子 owner、消息与 turn、历史记录、权限、scope、时间和来源闭包；参考 Q1-brief 与现有记忆规则及 MemoryStore 的候选资格规则。未运行任何检索、评分、阈值选择、模型、正式数据库、联网或 holdout 错误报告，也未查看调参报告。修订理由完全来自语料语义与数据合同。

## 实际覆盖

逐条阅读全部 60 个 family 的 owner 正文及全部 360 个 query 文本和期望，超过最低抽查要求。各 family 的六类均包括 direct、conversational、paraphrase、multi_topic、temporal、negative。

- development / fact：fact-01、fact-02、fact-03、fact-04、fact-05、fact-06、fact-07、fact-08、fact-09、fact-10、fact-11、fact-12、fact-13、fact-14、fact-15、fact-16。
- development / experience：experience-01、experience-02、experience-03、experience-04、experience-05、experience-06、experience-07、experience-08、experience-09、experience-10、experience-11、experience-12、experience-13、experience-14、experience-15、experience-16。
- calibration / fact：fact-17、fact-18、fact-19、fact-20、fact-21、fact-22、fact-23、fact-24。
- calibration / experience：experience-17、experience-18、experience-19、experience-20、experience-21、experience-22、experience-23、experience-24。
- holdout / fact：fact-25、fact-26、fact-27、fact-28、fact-29、fact-30。
- holdout / experience：experience-25、experience-26、experience-27、experience-28、experience-29、experience-30。

holdout 共 12 个 family / 72 条 query，全部阅读；development 为 32 / 192，calibration 为 16 / 96，两类平衡。

## 发现与已完成修订

定位使用唯一 family/query ID 与字段，避免文件格式化后行号失效。

| 编号 | 定位 | 语义理由及处理 |
| --- | --- | --- |
| L1 | fact-01 至 fact-30 的 direct、conversational、multi_topic、temporal；owners[3] | 同名学姐也使用被问到的姓名，仅问裸姓名不能唯一排除该人。已在全部事实正例中明确排除同名学姐，逐条重读通过。 |
| L2 | 全部 60 个 negative query | 原版事实负例完全同句，经历负例也完全同句，跨三个 split 重复同一缺失主题。已改成各 family 独有的同人缺失属性或新事件，逐条核对四个种子都无法回答，空期望通过。最终 360 条问句文本全部唯一。 |
| L3 | fact-25:paraphrase | “记录日常的本子”同时可能指手账和 owners[2] 的笔记本；已明确问手账并排除课堂笔记本，通过。 |
| L4 | fact-30:paraphrase | “从哪座站出发”超出“返乡车站”提供的信息；已改成返乡乘车相关车站，不再假定出发/到达方向，通过。 |
| L5 | fact-01:paraphrase | “换成”暗示换机经历，种子仅登记当前型号；已改为“现在用”，通过。 |
| L6 | experience-06、experience-07 事件时间；全部 experience 来源/登记/保留时间 | “看夜空”“夜跑”与上午时间不一致，且原来源早于正文所述事件结束。06/07 已改 20:00–21:00；其余保持 10:00–11:00。全部经历消息/完成 turn 设为结束后十分钟，createdAt/lastEventUpdateAt/retainedFrom 同步，expiresAt 恰为其后 90 天。八月干扰事件保持八月发生、九月登记。静态逐条核对通过。 |

事实 temporal 的历史为“此前未登记”到当前登记值，理由明确不推断更早实际值；所有问句现已明确问“登记记录”的变化。这支持登记变化，不虚构实际偏好或生日等属性发生变化；30 条历史逐条检查通过。

## 静态合同与闭包结果

最终静态检查为 60 families、360 queries、240 唯一 typed owner keys、240 消息来源。每条 query 显式列出四个本 family owner；正例期望一个，负例期望为空。期望都存在于候选，未发现重复 query ID、问句文本或跨 family owner key / owner 正文重复。split 分布恰为 development 两类各 16、calibration 两类各 8、holdout 两类各 6；每 family 六类各一条。

所有 owner.sourceIds 都在本 family messages 中且正文一致；消息 seenTurnId、turn.inputMessageIds、batchId/batchIds 相互闭合；30 条 detailHistory 的 key/newValue 对应当前 detail，来源与 turn 存在。mergedInto、linkedLongId 均为空，evidenceMemoryIds 为空，没有漏列的规范 owner 或长期证据 owner。消息是这些 owner 的来源，不是被遗漏的独立相关 owner。

事实 owner 为 active detail，历史权限仅在 temporal 开启；经历 owner 为 active long，普通问句时仍在保留窗口内，temporal 时间推进至保留期结束后并明确允许 archive。scope 与 allowArchive、includeDetailHistory 与 allowDetailHistory 一致，visibleSourceIds 为空，不虚构可见来源授权。过期经历的 owner 仍可由授权回忆访问，符合现有资格规则。

经历三个干扰项分别改变人物、月份/地点、活动；正例均明确指向目标事件。事实三个干扰项分别改变近似姓名、属性、同名身份；L1/L3 修复后全部正例有一个相关 owner 与三个真实干扰项。没有将共享人物或地点本身当作足以回答所问属性/事件的依据。

所有同事件问法及干扰 owner 留在同 family/split；全体正文的人工阅读未发现跨 split 同事件改写。问句包含直接、口语、同义、插入其他话题、登记变化/过期回忆和无答案主题，语义与各类别一致。仍是有重复句式的合成数据，PASS 不代表覆盖全部真实用户语言分布。

权限补充：少数经历 conversational 的“那次”按现有请求规则带 archive 权限；experience-14 的“旧城”、experience-20 的“旧衣”会按现有规则带 detailHistory 权限。这些字段与当前产品规则一致，本复核没有改写或扩大授权；这些 family 没有事实历史 owner，因此不会漏标来源闭包。

## 冻结记录

接受的 dataset SHA256：`8abac8950e18ab379effe7231b04d5debebd654f6a758892a898c52caeae1366`。

hash 来自最终 JSON 的原始字节；最终结构、唯一性、来源/turn/历史闭包、时间链检查无错误。任何后续数据改动都使本 hash 失效，须重新复核受影响标注再冻结。本审核没有直接编辑数据集。

本报告不授权运行 holdout；复核通过后由 root 冻结该 hash 并决定后续 development/calibration 基线。
