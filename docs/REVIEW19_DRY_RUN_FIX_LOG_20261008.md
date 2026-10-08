# REVIEW19 只读容量预测修复记录

日期：2026-10-08。基线：`4752502`。依据：[DSH第十九轮补充](../DSH-review/DSH_REVIEW19_REVIEW17_FIX_SUPPLEMENT_20261008.md)及用户“无需rebuttal则直接实施、容易修则一并修复”的指令。

## 意见取舍

主要结论成立：REVIEW17／18的五处修复无需重开审核；余下Minor只影响检查报告，启动检查不使用退出ID决定运行时归一，正式容量与清理逻辑原本正确。修法明确且无新增产品选择，直接实施，不另写rebuttal。

两处证据／措辞修正：

- 重复short ID并非合同内用`new Map`去重。`src/model/contracts.ts`拒绝重复`unit.ids`；`src/memory/lifecycle.ts`直接合并辅助函数用`new Set(ids)`后确认至少两个不同存活short。DSH“已落实”的判断成立，引用的具体机制应以源码为准。
- “误差只会少列，因此是至少这些会退出的下界”不成立。容量只需退出一个对象时，过宽保护集可以把实际优先退出者排除，从而选中另一个对象。此次回归真实复现：旧报告列`other`，实际`normalize`只退出`l`。两份ID清单不存在子集关系，不能标为下界。

## 修复范围与验证

`inspectMemoryCapacity`分别构造`exitProtectedIds`与`deletionProtectedIds`，前者用`includeRetainedShorts=false`，后者用`true`。`longCapacityExits`只使用前者；归档保护标记、容量删除及到龄归档删除继续用后者。保留只读SQLite连接，运行时归一／清理代码、数据库结构和模型设置均未修改。

报告列的是读取时刻现有快照的各阶段候选，未顺序模拟Host后续处理。若短期容量退出导致预览激活、该次临时保护，或出现新输入、逐单元清理，后续实际名单可能变化。此次一致性回归明确固定无短期容量退出、无外部临时保护的相同快照；不把这一验证扩大为整个后台调度过程的精确预测。

测试不使用mock，创建隔离SQLite文件，实际调用检查工具及`MemoryCapacity.normalize`：

| 回归 | 修复前 | 修复后 |
| --- | --- | --- |
| 到期short关联空摘要 | 预测`other`，实际退出`l`，失败 | 均为`l`；归档超量时`l`仍受删除保护 |
| 已容量退出、详情未到期short | 同上，失败 | 同上，删除保护保留 |
| 活跃short引用 | 通过 | 预测及归一均只退出`other`，保留`l` |
| 稳定认识引用 | 通过 | 同上 |

缺陷回归还验证检查前后SQLite文件字节不变、报告不含短期详情正文；退出后重读归档报告，容量差额为1但受保护长期不列入删除名单。

基线：83文件469项通过（36.83秒）。先加回归：升级测试2失败／8通过，失败为预期ID不一致。最小修复后升级10项通过；完整83文件473项通过（38.54秒），`npm run typecheck`和`npm run build`通过。此次未重复混合Host／真实模型验收，因为没有修改运行时行为。同步实施细化§9、执行计划、交付入口与REVIEW17历史状态指针，保留历史测试数量和当时延期记录。

## 证据与边界

日志保存在`runtime/review19-dry-run/verification/`：`baseline.log`、`red.log`、`green.log`、`full-test.log`、`typecheck.log`、`build.log`。临时测试库运行后清理，用户已有DSH文件原样保留。

本次开始时正式库SHA256：`BC65898A1BACDD87798554AA3C14CE2EE683E052C76F2358F90D23A8BEDF3BBD`。没有启动服务、调用模型、连接QQ或写入正式库。主目录集成及最终核对另记下文。
