# 检索质量评估交付

Q1/Q2已完成离线评估，结论为 **keep_current：正式词法阈值仍为fact=1、experience=1，semantic=null**。工具与数据交付不代表实际聊天质量已经改善。

## 数据与隔离

Q1数据为60个合成family、360条问句，每个family六种句型，每个正例有目标与三个相似干扰项。独立审核者全读全部标注，按family固定development／calibration／holdout；来源、完成轮、事实历史及有效期闭合。冻结后未根据检索错误改标签。Q1仅运行288条开发／标定问句，盲测72条留给Q2同次比较。

原始数据SHA256：`8abac8950e18ab379effe7231b04d5debebd654f6a758892a898c52caeae1366`。详见[标签复核](reviews/Q1-labels.md)、[冻结记录](evidence/q1-dataset-freeze.json)、[开发／标定基线](evidence/q1-baseline.json)。评估使用真实MemoryStore、MemoryRetrieval、ContextBuilder和个人阶段输入，保留原权限、直接键、alwaysInclude及历史规则；每条问句新建内存库。

## Q2一次盲测

仅在calibration选择，facts保留1，experience选0.8125，semantic仍为null。候选先落盘冻结，SHA256为`1e6af4bd1a422dd43ca8905bee13f7d0c81f346eb9583976a06a56fb687162be`，之后同次命令对72条holdout运行baseline与candidate。记录已使用，不再据此调参或重复声称独立盲测。

| 指标 | 默认阈值 | 已冻结候选 |
| --- | --- | --- |
| 总TP / FP / FN | 24 / 6 / 36 | 30 / 6 / 30 |
| 总precision | 0.8000 | 0.8333 |
| 总recall | 0.4000 | 0.5000 |
| 总F1 | 0.5333 | 0.6250 |
| fact precision / recall | 0.8 / 0.8 | 0.8 / 0.8 |
| experience precision / recall | null / 0 | 1 / 0.2 |
| 全负问句误命中 | 0 / 12 | 0 / 12 |

总体召回增加10个百分点，但fact precision未达到0.95，因此不推荐启用候选。无预测正例的precision保留null，不伪作满分或0分。现有私有配置、标定文件和运行时缺省均未修改。候选可以审阅，但不应因部分指标提高就部署。

证据：[候选与所有标定档位](evidence/q2-candidate.json)、[逐问句成对结果与差异](evidence/q2-report.json)、[实际执行日志](evidence/q2-main-run.txt)、[独立代码复核](reviews/Q2.md)。44项定向测试通过，1项硬链接夹具因宿主EPERM明确跳过；Windows大小写别名保护测试通过。CLI使用记录保留在原数据文件旁；它是本地审计标记，复制文件或删除标记不会让已看过的family重新成为盲测。

## Q3状态

语义实验使用新数据集：保留48个development／calibration family，替换全部12个holdout family（72问）。独立全读通过，SHA256为`30a2c1920b7d7b84cf9d633fdb7c0c215d4f0bf3a723bd712472e4ff4d7b5652`；[标签复核](reviews/Q3-labels.md)与[冻结记录](evidence/q3-dataset-freeze.json)已保存。

离线工具已完成，提交`d0a9963`：[独立复核](reviews/Q3.md)的合成定向26项通过、0跳过；最终全仓1370项通过也包含这些工具。向量准备按原MemoryIndex签名与唯一文本hash复用，支持中断续跑；重放通过真实检索／上下文及个人输入装配，分别记录采集网络数、回放provider调用数与回放网络0。数据／签名／revision／正文hash／覆盖不齐均明确incomplete，不删掉缺向量问句来缩小分母。

语义候选使用预先固定网格`[-1,0,0.5,0.75,0.9,1]`的两组笛卡尔积，加全局关闭基线；词法均固定1，只用calibration选参。完整向量包与候选文件hash先冻结，再允许新holdout的一次成对评价。网格是有限研究范围，不是连续阈值全局最优承诺。向量包冻结后不要继续采集或重新格式化；CLI将其原始字节hash绑定到候选和使用记录。

实际运行了[合成配置](evidence/q3-dry-plan-config.json)的[默认计划模式](evidence/q3-vector-plan.json)：计划600个唯一文本请求，实际网络0，status=incomplete；[执行状态](evidence/q3-dry-plan-status.json)确认未创建向量包、未占用主语义holdout。该配置的`offline.invalid`和模型名仅作离线计划验收，不是正式供应商设置。

```powershell
npx --no-install tsx scripts/prepare-memory-retrieval-vectors.ts --dataset tests/fixtures/memory-retrieval-semantic-v2.json --config docs/v0.5/records/comprehensive-remediation-20261011/evidence/q3-dry-plan-config.json --output .tmp/q3-dry-plan/uncollected-vectors.json
```

未执行真实Embedding采集，未运行新主数据语义评分，正式未启用语义检索。后续得到明确在线授权后，使用实际memoryEmbedding连接的专用配置和新输出路径加`--online`采集；齐备向量冻结后，才执行`evaluate-memory-retrieval.ts --dataset <新数据> --vectors <齐备包> --select-semantic --candidate <新候选> --report <新报告> --splits holdout`。候选即便通过质量门槛，接入正式calibrationFile仍需单独决定，并匹配整个provider签名。测试中的已知向量不作为真实效果证据。
