# 历史文档与证据归档

整理日期：2026-10-09。[当前文档](../v0.5/README.md) · [目录原则](../DIRECTORY_POLICY.md)。

此处保存被替代的说明、已完成开发合同、旧审核／rebuttal、早期交付、失败／通过过程和旧打包件。它们只表示对应基线的事实；“待实施”“尚未修复”、测试数字及日志路径保持产生时范围，不能替代当前说明。

| 分类 | 内容与入口 |
| --- | --- |
| [legacy-design/v0.2/](legacy-design/v0.2/) | 原项目根目录V0.2总架构及子系统，已由V0.5替代 |
| [topics/](topics/) | 按功能开发批次归类的旧方案、细化、计划和过程 |
| [plans/](plans/) | V0.5已完成ASTRA T1～T13、R1、T1～T9合同；环境异步E1～E5已完成并归档 |
| [reviews/](reviews/) | ASTRA初审、实施后旧复核、R1及T阶段修复前再审，连同原始复现和日志 |
| [records/](records/) | ASTRA/R1旧交付、V0.5重写／检查、REVIEW24／26记录及T阶段红绿日志 |
| [dsh-review/](dsh-review/) | 原DSH-review目录的报告、rebuttal及封存送审副本，整体保留关系 |
| [document-history/](document-history/) | 已废止的索引入口和旧索引快照 |
| [logs/project-root/](logs/project-root/) | 从根目录收起的共同活动／REVIEW10测试日志 |
| [packages/](packages/) | 旧DSH送审zip，不是当前发布／审核包 |

## 按主题追溯

| 主题 | 旧开发材料 |
| --- | --- |
| 记忆生命周期 | [memory-v0.3/](topics/memory-v0.3/) |
| 容量和空闲整理 | [memory-capacity-idle/](topics/memory-capacity-idle/) |
| 提示、普通／活动窗口 | [prompt-context/](topics/prompt-context/)、[REVIEW24修复](records/REVIEW24_DIALOGUE_FIX_LOG_20261009.md) |
| 共同活动和公开收尾 | [shared-activity/](topics/shared-activity/) |
| 世界与学校 | [world-school/](topics/world-school/) |
| 网页搜索 | [web-search/](topics/web-search/) |
| 表情素材迁移 | [stickers/](topics/stickers/) |
| 初次开发及本地Git | [initial-implementation/](topics/initial-implementation/) |
| V0.5记忆create修正 | [REVIEW26记录](records/REVIEW26_MEMORY_CREATE_FIX_LOG_20261009.md) |
| T1～T9原始过程日志 | [归档日志](records/current-audit-improvements-20261009/logs/)；该批交付现在归档于[当前records](records/current-audit-improvements-20261009/DELIVERY.md) |

只调整可识别的Markdown导航，没有改变原始日志、JSON、zip和执行探针的内容。报告内的原执行路径／旧命令未被批量替换成新的执行记录；查移动后的文件请用[逐项迁移清单](../v0.5/records/document-organization-20261009/move-manifest.json)。旧报告若有原本就不成立的相对链接、临时绝对路径或快照链接，属于历史材料，不作为当前送审导航。

审核探针应按报告指定源码基线和假数据运行；当前正式回归入口仍是项目tests。完整回退快照、测试库和含角色生成内容的本地输出另在[runtime/archive/](../../runtime/archive/README.md)，不混入公开文档归档。

环境异步E1～E5[已关闭合同](plans/environment-async-20261009/README.md)、[早期红绿日志](logs/environment-async-20261009/)已归档；最新交付／审核留在当前V0.5。[移动清单](../v0.5/records/environment-async-20261009/evidence/document-moves.json)。
