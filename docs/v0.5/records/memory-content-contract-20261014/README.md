# 记忆整合正文必填合同修复

2026-10-14，前置基线 `c4b48c4`，包版本继续为 0.5.3。原 `v0.5.3` 标签记录首次发布，本次后续修正在 main 交付，不移动原标签。

## 问题与修复

11:55:23 的模型响应在 refine 单元提供 eventSummary 和 feelingSummary，却未提供 content，触发 `content: required`。一次格式修补后于 11:55:39 成功完成，未造成暂停或数据损坏。

直接原因是输出不符合实际校验；程序诱因是原 JSON Schema 把 content 标为可选，提示只要求“非空正文”，实际校验及落库却要求该字段。补写两个摘要不能代替实际保存的 content。

`model/contracts.ts` 改为按 action 区分的 Zod 合同，由同一份合同生成模型 JSON Schema 并解析响应：

| 动作 | 结构必填要求 |
| --- | --- |
| refine | 非空白 content：精炼后的长期简要正文；至少一个 sourceIds |
| merge | 非空白 content：同事件合并后的长期简要；canonicalId；至少一个 sourceIds |
| merge_short | 非空白 content：详细合并正文；非空白 eventSummary、字符串 feelingSummary；至少一个 sourceIds |
| promote | 非空白 content：常驻经验或稳定认识正文；learnedKind；至少一个 sourceIds |
| retain／discard | 不强制 content，不要求非空来源数组 |
| review_detail／review_learned | targetId、相应合法 decision；非 retain 的依据、reason 与来源约束仍由既有审核校验执行 |

所有单元仍要求 unitKey、非空 readOwners 和 ids，以及 sourceIds 数组。未知引用、来源合法性、写集合、重叠、摘要修复、合并／晋升资格、覆盖和提交版本校验保持原规则。保留原可选字段兼容已有输出；不由程序猜测或补写正文，不改变存储格式、重试预算或已保存结果的恢复路径。

`model/prompts.ts` 明确 refine.content 必填，eventSummary／feelingSummary 不能代替它，并说明四种正文动作中 content 的不同含义。

## 验证范围

新测试将真实模型 JSON Schema 转回验证器，验证四种正文动作对缺字段、空白正文和空来源的拒绝，与实际解析一致；同时验证合法输出及 retain／discard／审核 retain 的无正文兼容。该测试能捕获原先“Schema 接受、程序拒绝”的错误约定。

真实失败响应只读离线核对：原 Schema 接受，新 Schema 拒绝；在示例副本补全明确 content 后新 Schema 接受。示例不写入正式结果，不调用模型，正文仍留在私有历史中。

类型检查与构建通过，6 文件 76 项定向回归通过，见[定向摘要](evidence/targeted-summary.json)、[先失败的回归](evidence/red-summary.json)及[工程检查](evidence/engineering-checks.json)。[真实失败响应检查](evidence/saved-response-schema-check.json)确认原约定不一致已关闭。

[独立产品审查](INDEPENDENT_REVIEW.md)无 P0–P3 发现，1232 组新旧解析变体保持接受结果一致。[全量验收](evidence/full-test-summary.json)：229 文件、1560 项通过，0 失败、2 项既有跳过。正式部署以本目录证据及部署记录为准。离线验收不代替用户重启后的真实运行观察。

## 正式部署

已验收源码 `dcd9d8c`，包版本 0.5.3；原版本标签保留，后续修正在 main 推送。2026-10-14 12:24 安全退出 HDSI，12:25 完成正式部署。原服务及关联浏览器进程退出，5141 端口释放，停止控制文件移除。

[部署证据](evidence/deployment-summary.json)：250 个 lib 文件与验收产物指纹一致；只读启动检查通过，无网络调用；42 张表以及数据库、配置文件指纹保持，quick_check=ok。备份位于 `runtime/archive/batches/20261014-memory-content-contract-053/2026-10-14T042449506Z-3ca0d78a`，清单 SHA256 为 `db41337bbe4b94b2f7a411e6778313b5cc6193df62f2ee61cbdadf6fda7a4804`。

未重启服务或执行 resume，未修改正式任务或记忆。停服时 paused=false，15 个维护任务与264个索引任务全部完成，无未完成轮、失败任务或待确认消息。用户可直接手动运行 start-hdsi.cmd，按原调度继续；本次无需额外重开失败周期。真实模型遵守修订合同的效果须在重启后观察。
