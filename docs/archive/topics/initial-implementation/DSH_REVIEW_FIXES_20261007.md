# DSH 第二轮审查：实施与验证记录

日期：2026-10-07。依据：[DSH 第二轮复核](../../dsh-review/docs/DSH_REVIEW2_20261007.md)。第二轮已接受主要复核结论，没有生成新的 rebattle；本记录说明实际改动及验收边界。

## 1. 本轮实施范围

| 项目 | 已实施内容 | 源码 |
| --- | --- | --- |
| I11 | 新增 `ContextBuilder.buildForMemory()`，整理检索只构造 `{ details, retrieved }`；沿用最多 12 项细节、8 条长期及原相关性排序，只按实际投喂字段算 historyBudget，先裁低排名长期、再裁细节。主叙事／个人导演的完整历史预算保持原规则。 | `src/memory/context.ts`、`src/memory/organize.ts` |
| K3 | 个人导演 create/update 合并后的最终 `check_messages.at` 必须晚于本轮 at。违规走现有格式修补；既有到期检查、取消、其他任务种类及程序维护任务不受该新增规则限制。 | `src/model/contracts.ts`、`src/model/prompts.ts` |
| I9 | 值变化时，非空 aliases 替换旧别名，空 aliases 沿用旧别名；首次创建无旧别名时保持空。不累加旧属性值别名，同值变更仍整条跳过。 | `src/memory/organize.ts` |
| I12 | 用户确认“要求至少一个来源”。新建短期／长期记忆及细节变更的 sourceIds 至少一项，且属于本轮经历、首次可见输入或实际输出；提示明确旧 reconsiderMessages 不能当本轮来源。合法三个空数组与已有长期 ID 的 reinforce 仍有效。 | `src/model/contracts.ts`、`src/model/prompts.ts` |
| I8／K6 | 补受控冻结失败、静默冻结、文件重开恢复和真实 InputBuffer 合批路径验证，保留原 saveInput 夹具用于直接请求测试。 | `tests/review-recovery.test.ts` |

Schema 将新增记忆来源设置为 `minItems: 1`，本地解析也执行相同约束。来源有效只能证明引用范围正确，事实是否确立仍由模型按提示词判断。已保存旧记忆不做迁移，也不追补旧记录的空来源。

## 2. 测试过程与证据

新增 `tests/review-fixes.test.ts` 15 项与 `tests/review-recovery.test.ts` 8 项，共 23 项。

第一批测试在修复前运行：15 项中 10 项按预期失败，分别复现过期／当前时间检查被接受、空来源被接受、无用长历史挤掉整理所需长期记忆、空别名清掉旧别名。五项合法行为与预算用例通过。修正实现后 15 项全部通过。

新增恢复覆盖包括：

- 完整有序 outbox、冻结 turn、post job 在平台调用前保存。
- 无输出冻结立即 outputComplete，后处理提交且不发送。
- SQLite trigger 在 post job 写入时主动失败，冻结 turn 更新和所有 outbox 写入一起回滚。
- 正常关闭后用同一路径重新打开文件库，遗留 sending 依次持久化 retry／sending／confirmed；已确认项跳过，未知项保留旧稿续发，两次恢复不重复发送或提交。
- 真实输入闭合后经睡眠扫描清队列，起床交付旧批，排除刚打开的新批。
- 多个真实闭合批次在到期检查中一起交付；unread 检查无剩余未读时取消，deferred_reply 检查正常完成。
- 暂停中的到期合批先关闭 openBatch，随后截止时间为空，不留下同一过期批次的重复调度候选。

完整套件第一次运行有一个测试预期错误：把清空未读后的 unread 检查预期成 completed，实际按原维护规则应为 cancelled。核对代码后将该场景明确为 cancelled，并另加 deferred_reply → completed 场景；未修改生产调度规则。

最终离线验证：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 18 个文件、78 项通过 |
| `npm run typecheck` | 退出码 0 |
| `npm run build` | 退出码 0，更新 lib 供下次手动启动使用 |
| `npm run smoke --prefix runtime` | 真实 Koishi Context 离线插件注册、初始环境轮及三条管理命令通过 |
| `start-hdsi.cmd --check` | 本地配置、凭据、插件及 67 项素材检查通过；无网络请求 |
| `start-snowluma.cmd --check` | 启动文件与 Node 版本检查通过 |

独立只读代码复核未发现需要修正的问题。上述测试使用临时／内存数据库、固定模型结果与模拟发送，没有调用在线模型或真实 QQ；没有启动 HDSI／SnowLuma 服务。

暂停用例使用手动 wake 且 timers=false，不等于完整计时器实机验收。同文件关闭重开不等于真实进程强杀／断电；冻结写入失败注入不等于段 B 所有写入位置故障矩阵。真实 QQ 返回 ID、角色任务输出及四条完整故事路径仍待用户手动启动后验收。

## 3. 文档与保留项

六份当前 REMAKE 文档、README、DOCUMENT_AUDIT 与实施日志已同步本轮规则和测试数量。模型数量明确为九项故事任务加一项素材描述；配置键 `stickerDescriptionModel` 对应任务名 `sticker_description`；共享类型入口标为完整工程内路径，纯文档包没有失效源码附件链接。历史测试数字标为当时阶段，entryMode 说明为审计记录。

`DSH-review/` 保留上一轮交付的文档快照和 DSH 审查材料，没有用本轮文档覆盖审查依据。原 `docs/DSH-review-20261007.zip` 仍是二轮修订前快照，本轮没有重打包；复审当前实现请读取工作区源码、当前文档及本记录。

以下不在本轮实施范围：I5 全表查询优化、I13 重复 recent 清理、I2 resume 外层错误日志、I10 同 key 多变更规则。K1／K2／K4 已撤回，睡眠队列与调度规则保持原实现；未添加重复平台超时、自动跳过冻结素材或非法引用、睡眠时间截断。新图视觉描述、真实 QQ 与完整故事路径的验收状态仍如当前文档所述。
