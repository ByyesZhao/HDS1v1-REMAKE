# V0.5：审核报告与证据入口

日期：2026-10-09。返回[当前文档索引](../../v0.5/README.md)。原始报告、失败日志和文档备份保留当时事实；再次送审应结合后续交付及关闭说明判断当前状态。

| 材料 | 基线及当前解释 |
| --- | --- |
| [当前代码／文档再审](current-audit-20261009/README.md)、[CODEX核验与方案范围](CODEX_RESPONSE_CURRENT_AUDIT_20261009.md) | 基于 `c9e4599` 及当前文档；确认B1／B2；本次T1～T9已完成，见[新交付](../records/current-audit-improvements-20261009/DELIVERY.md)及[复核关闭](../records/current-audit-improvements-20261009/REVIEW_CLOSURE.md)。E1～E5仍未实施 |
| [ASTRA初审](ASTRA_REVIEW_20261009.md)、[证据与复现](AUDIT_EVIDENCE_20261009.md) | 针对 `73774bf`；F1～F8、D1已由T1～T13处理。原缺陷复现断言不能直接当成当前绿色回归 |
| [CODEX核验回复](CODEX_RESPONSE_ASTRA_REVIEW_20261009.md) | 当时确认问题及修复范围，后续已实施；读回复中的“尚未实施”时需结合交付时间 |
| [实施后独立复核](ASTRA_POST_IMPLEMENTATION_REVIEW_20261009.md) | 针对 `eb5b29e`，主要修复成立，发现R1；原§1～5保留，后续关闭补充说明R1已修复 |
| [ASTRA交付](../records/ASTRA_FIX_DELIVERY_20261009.md)、[R1补验](../records/ASTRA_R1_CHECKPOINT_FIX_DELIVERY_20261009.md) | 此前修复结论与逐批验收；该批源码补丁 `b398699`，该批完整离线回归122文件693项 |

## 证据目录

| 目录 | 含义 |
| --- | --- |
| `../records/current-audit-improvements-20261009/` | 本次T1～T9交付、复核关闭、SQL工作量及各阶段／主目录日志 |
| `evidence/` | 初审基线的复现脚本／结果，保留修复前问题证据 |
| `postfix-evidence-20261009/` | 实施后独立测试及原始日志；原9项为8通过／1失败，记录R1缺口 |
| `r1-fix-evidence-20261009/` | R1补丁的红／绿专项、原独立9项转绿、完整回归及主目录复验日志 |
| `r1-fix-evidence-20261009/original-docs/` | R1修改前的README／计划／报告备份，不是当前说明或未完成待办 |

当前正式回归以项目 `tests/` 为入口。原独立9项可按[R1计划§5](../plans/ASTRA_R1_CHECKPOINT_FIX_PLAN_20261009.md#5-命令与通过标准)重跑；旧目录中的失败日志不会被重写成成功。其他原缺陷脚本若采用“证明旧错误发生”的断言，应在其记录的历史基线上使用，不能仅凭当前修复后断言失败宣布业务回归。

本次文档整理没有新增在线或正式库验收，检查范围见[再次送审记录](../records/V0.5_RESUBMISSION_DOCUMENT_CHECK_20261009.md)。
