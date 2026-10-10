# V0.5 最终文档核对

日期：2026-10-10。状态：已同步当前说明。代码基线`c4477da`，其中最新产品修复为`47eb14d`；返回[版本索引](../../README.md)。本次只修改当前文档、导航与核对证据，不改产品、正式配置、数据库或历史报告，不启动HDSI／SnowLuma，不调用模型或搜索服务。

## 1. 核对范围与依据

| 当前材料 | 对照实现与结论 |
| --- | --- |
| 总架构 | `app.ts`、`host/runtime.ts`、`scheduler.ts`、`recovery.ts`；同步每日世界、搜索状态、预备长期占用与最新交付入口 |
| 导演与环境 | `directors/*`、`environment/preparation.ts`、`snapshot.ts`、`school/knowledge.ts`、`notices.ts`；四步依赖、已知版本、提醒与模型边界保持；修正未接入搜索的旧表述 |
| 调度与生活 | `host/runtime.ts`、`scheduler.ts`、`state.ts`、`probability.ts`、`memory/idle.ts`；15秒、60秒、150～210分钟、作息／预约／概率仍对应；补明确环境执行前二次门禁 |
| 记忆 | `memory/lifecycle.ts`、`capacity.ts`、`retrieval.ts`、`batch-selection.ts`、`maintenance.ts`及图片来源投影；保留7／90／3／30、100／1000／500、15分钟、完整字符选批和同事件例外，修正章节跳号 |
| 共同活动 | `host/shared.ts`、`dialogue/activity-context.ts`、`model/contracts.ts`、`prompts.ts`；本轮新用户输入决定代写、约10轮软目标／20轮硬上限、活动全文与四段隔离保持 |
| 提示与上下文 | `model/context-views.ts`、`resource-pool.ts`、`prompt-policy.ts`、`reply-guidance.ts`、`background-views.ts`、`input-media/context.ts`；补消息观察绑定及预取字节／角色观察的区别，标明旧性能样本基线 |
| 表达与素材 | `output/qq.ts`、`stickers.ts`、`expression.ts`、`input-media/service.ts`、`assets.ts`；修正关闭开关的绝对化说法，保留pending接续、取消优先与受控来源降级 |
| 网页搜索 | `web/service.ts`、`store.ts`、`browser/extract.ts`、`koishi-port.ts`、`deployment/browser-runtime.ts`、`scripts/validate-local-web.ts`；补用户图观察用途、清理后正文证明和当前开关／provider状态 |
| 报错与恢复 | `recovery.ts`、`environment/preparation.ts`、`memory/maintenance.ts`、`input-media/service.ts`及对应恢复测试；补图片取消／关闭恢复口径，修正重复章节号 |
| 实现对应／模型参考 | `settings.ts`、`config.ts`、`model/client.ts`、`package.json`及白名单；统一为15个逻辑用途、14个模型任务名、13个已配置连接，更新最新基线和现有搜索配置 |

上表为源码人工对照，不是自动功能测试。背景用途映射仍使用原批准结果；本次只核对映射代码和公开说明，没有重新读取角色背景或批准映射。

## 2. 实际修订

1. 世界搜索已具备本地browser适配器，正式仍`enabled=false`、`provider=unconfigured`；不再笼统称“没有实现／选定搜索供应商”。有真实正文才可作外部引用，启用也不是每天强制搜索。
2. `visualInput.enabled=false`只阻止新视觉准备；已确认观察继续按消息权限提供，旧pending可以继续原模型调用。输入预取只有字节下载，不证明角色已经看图；受控来源失败与取消／模型失败分开处理。
3. DOM登录区域边界用清理后的独立正文证明；空main、纯标题／链接、隐藏壳不解除登录墙。用户图观察也有独立搜索接线，但不成为生活本人网页来源。
4. 模型用途表直接列出incoming_image；固定审核和用户图观察的两项连接复用分别写明。模型和思考强度保持原值；删除当前参考中的未接入付费服务价格／建议，聚焦真实配置。
5. 入口改指最新175文件920项代码交付；前批173／882、环境和T1～T9结果仍保留在各自历史证据中。修正“本批”“最新”误指旧任务及记忆／恢复章节编号。

其余核心规则未发现需要按新需求重写的地方。本次没有新增实施计划或移动历史合同，原review、原始JSON和日志未改写。

## 3. 配置与验证

[配置白名单](evidence/effective-models.json)重新核对：13个配置连接为Flash，10个low／3个high；用户图观察未单独覆盖，继承素材描述的Flash/high；两个Embedding连接均为Qwen／1024维。搜索和新视觉准备关闭，语义标定仍未启用。只导出指定字段及源码缺省，没有读取密钥、加载完整故事设置或接触正式数据库。

[文档检查结果](evidence/document-check.json)记录本地Markdown目标和当前编号章节检查；[检查脚本](check-docs.cjs)可以从项目根目录重跑：

```powershell
node docs/v0.5/records/document-final-audit-20261010/check-docs.cjs
git diff --check
```

首次检查本地链接无缺失，检测到记忆§14跳号与恢复两个§9；修正后检查60份Markdown、490个本地目标，缺失目标0、当前编号章节问题0。最终结果以JSON为准。脚本会更新本任务的检查及配置白名单证据；不会改正式配置或运行服务。该检查不验证所有正文含义、历史证据内源码定位或所有锚点。

未重跑产品测试。175文件920项及类型／构建／demo／双场景smoke是[前一代码交付的主目录结果](../image-search-post-review-fixes-20261010/INTEGRATION_20261010.md)，本次不将其算作新的验收。

## 4. 下一次送审

继续提供整个`docs/v0.5/`，从[版本索引](../../README.md)按总架构→8份子系统→实现对应阅读。模型配置可补读reference；review／records按所审功能查阅，旧计划和失败探针按原基线理解。审核代码时另提供`src/`、`tests/`、`scripts/`和公开运行检查文件，不默认附密钥、正式配置／库、私有人物背景或`runtime/archive/`。
