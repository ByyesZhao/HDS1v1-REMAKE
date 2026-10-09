# REVIEW26：关联长期 create 修复与合并例外说明

日期：2026-10-09。开发基线：`81ba5df`。用户批准的范围仅为REVIEW26 §5.6的create路径修复，以及V0.5记忆文档的同事件合并例外说明；无需新的方案或执行计划。

## 1. 原因与修复

原有update路径要求真实进展才顺延预备长期，create引用existingLongId却只检查预备期，没有进展标志。同时该create路径无条件更新lastEventUpdateAt，使重谈也改变有意义更新时间。

本次修改：

| 位置 | 行为 |
| --- | --- |
| [操作类型](../../../src/memory/types.ts) | ShortCreate增加可选hasNewEventProgress，保留旧保存结果的结构兼容 |
| [模型合同](../../../src/model/contracts.ts) | 新模型create引用existingLongId时，必须给布尔值；缺失或非布尔值经既有格式修补处理 |
| [记忆提示](../../../src/model/prompts.ts) | 明确重谈／改写为false，新增sourceId不等于真实事件进展 |
| [生命周期](../../../src/memory/lifecycle.ts) | 严格为true才更新关联长期lastEventUpdateAt，并仅在尚未生效时顺延预备窗口及原initial grant |

false可以补充正文、来源和派生投影，但保留长期lastEventUpdateAt、retainedFrom、expiresAt和initial grant。true在已经生效的长期上也不重开90天，续期仍须走原唤醒规则。

首次新事件create不引用existingLongId时无需该字段，7天／90天规则不变。引用已有长期的新详细短期仍按原逻辑建立自己的7天窗口，不新增另一个长期身份。原update分支、同事件合并、常驻晋升及归档清理逻辑均未改。

旧post_jobs中已保存的结果不重新做新模型解析；缺字段由生命周期按false保守应用，可完成原后处理，不重调模型、不迁移数据。控制字段仍只属于操作结果，不写入记忆owner。

## 2. 文档同步

- [V0.5记忆§4～5](../subsystems/REMAKE_V0.5_MEMORY.md)：补关联create的进展门槛，并区分独立归档、同事件混合成员合并、全归档成员合并。
- [记忆V0.3细化§4](../../MEMORY_V0.3_IMPLEMENTATION_20261007.md)：同步条件必填字段和旧结果恢复口径。
- [实现对应](../reference/V0.5_IMPLEMENTATION_MAP_20261009.md)与[版本入口](../README.md)：链接此次代码修复，区分此前纯文档整理批次。

同事件例外沿用已批准的行为：归档重复项并入既有未归档同事件成员，可继承该成员真实保留资格及既有唤醒日期／许可；不新造唤醒、不从维护now重开期限。全部成员归档则仍归档并保留最早真实归档锚点。独立归档记忆仍须真实重谈恢复后再考虑晋升。

## 3. 回归与验证

先新增[专项测试](../../../tests/review26-memory-create.test.ts)，再改产品代码：

| 检查 | 实跑结果 | 证据 |
| --- | --- | --- |
| RED：专项8项 | 6失败、2通过，退出1；均为预期旧行为失败 | [red.log](../../../runtime/data/review26-memory-create-fix-20261009/red.log) |
| GREEN：专项及3份相关测试 | 4文件32项通过，退出0 | [green.log](../../../runtime/data/review26-memory-create-fix-20261009/green.log) |
| TypeScript | npm run typecheck退出0 | [typecheck.log](../../../runtime/data/review26-memory-create-fix-20261009/typecheck.log) |
| 构建 | npm run build退出0 | [build.log](../../../runtime/data/review26-memory-create-fix-20261009/build.log) |
| 完整离线回归 | 107文件620项通过，退出0 | [full-test.log](../../../runtime/data/review26-memory-create-fix-20261009/full-test.log) |

专项覆盖：缺失／非布尔标志拒绝；预备期false保留锚点、真实来源仍更新；true顺延且initial grant仅一份；同轮重放幂等；已生效长期false／true均不续期；旧post_jobs缺字段恢复；固定模型传输下缺字段进入修补后按false完成。三个原真实进展fixture补显式true，没有削弱原断言。首次无关联create、update对照及合并规则继续由既有全量用例验证。

独立审查只读核对源码、测试及文档，未发现实质缺陷或阻断性遗漏。git diff --check及本次5份文档共71个本地链接检查通过。

## 4. 执行边界

所有验证均为离线测试和合成SQLite数据；模型修补测试使用固定传输，无真实HTTP。没有连接QQ、启动HDSI／SnowLuma、读取或修改正式故事库、修改私有配置或调用在线模型。

测试命令需编译器子进程，因此在获准的本地执行环境运行；该权限不用于服务启动或外发。保留现有用户审查文件与历史记录，不将其他REVIEW26可选建议扩成此次开发项。全量620项是此次实跑证据，旧612项仍是此前REVIEW24批次记录。
