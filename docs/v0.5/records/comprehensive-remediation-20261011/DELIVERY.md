# 综合审核整改交付

日期：2026-10-11。当前阶段：**离线代码、专项复核、整分支复核与工程验收完成，部署尚待执行**。用户已授权本地Git交付及安全停止后部署，最终由用户手动启动。

## 实现与效果

5项代码问题已修复：消费过的预约只按明确未来改期规则重新激活；暂停覆盖两个异步选择边界；网页纯文本不再重复按HTML清理；图库CLI按用途独立装配浏览器；DOM提取排除同档嵌套子树重复。详见[批次A](BATCH_A.md)。

[批次B](BATCH_B.md)完成 pending任务工作集、网页轻量查询／材料引用、图片字节与编码复用、记忆策略元数据／批量唤醒／向量门禁、环境终态摘要与结算后清理。默认容量、网页20／40预算、输入正文、业务优先级及未完成任务恢复合同保留。

[350个合成样本](reviews/V3.md)确认25组前后比较的业务结果等价，确定性工作预算通过。10,000条历史／3条pending任务物化行40012→6；20页网页重复解析字符625127121→2005080；普通图片观察读／编码3／2→1／1；未标定1000×1024语义向量读取4096000→0字节。原始样本、时间与限制见[性能比较](PERFORMANCE_COMPARISON.md)及[记忆比较](MEMORY_ACCESS_COMPARISON.md)。测量after是`69147f9`，不是最终交付提交；其后生命周期接线已由最终确定性测试覆盖。

[检索质量交付](RETRIEVAL_EVALUATION.md)完成Q1／Q2：候选总recall提升10个百分点，但fact precision仅0.8，未达0.95，故保持默认词法1／1、semantic=null。Q3离线工具和新标注数据单列交付；供应商采集未执行、真实语义质量仍incomplete、正式语义未启用。没有重复使用已看过的盲测来调参。

## 已执行验收

| 门禁 | 结果与证据 |
| --- | --- |
| 类型／隔离构建 | 退出0：[typecheck](evidence/batch-b-typecheck.txt)、[build](evidence/batch-b-isolated-build.txt) |
| 最终全量 | **217文件、1370项全部通过，无跳过**；[完整日志](evidence/batch-b-full-suite.txt)，195.98秒；Chrome与junction夹具在获准的宿主权限下执行 |
| 模拟演示 | [demo](evidence/batch-b-demo.txt)退出0，无真实QQ／供应商调用 |
| 插件smoke | [smoke](evidence/batch-b-plugin-smoke.txt)退出0，empty_week／required_notice均四步骤提交，实际加载隔离构建 |
| 恢复兼容 | [矩阵](evidence/recovery-matrix.json)八类场景通过；49项映射复用48个唯一测试名称，不能相加作全量数量 |
| 独立审查 | 各任务review及[最终集成复核](reviews/FINAL.md)通过；最终review为静态检查，未冒充另一次全量执行 |
| 构建／源码身份 | [环境与源码标识](evidence/batch-b-identity.json)、[399个源码／夹具文件哈希](evidence/batch-b-source-manifest.json)；Node v24.21.0，npm12.2.0；测试时HEAD为`f60afa6`并包含当时未提交、内容已冻结的Q3工具 |

批次A原有权限失败／分次复验、各任务RED和中间失败均保留；最终全量是上述一次独立通过，不能用它改写历史日志。没有为纯文档编辑重复运行全量。

## 存储、部署与回退

新代码会写网页formatVersion=2材料引用，并为preparationVersion=1的终态环境步骤保留terminalAudit摘要。兼容读取旧格式，不对历史库自动全量转换；旧v0环境恢复正文保留。`web:migrate-payloads`与`memory:compact-payloads --include-environment`均为独立显式工具，默认只读，apply要求停服声明与完整备份。

副本[回退演练](evidence/rollback-drill.json)已证实：旧构建读取新网页引用失败；恢复匹配的旧数据库副本与旧构建后，完整输入、材料和计数一致。因此实际回退须停止服务并恢复配套旧构建、完整DB／WAL／SHM文件组及匹配配置，不能只切回Git代码，且会放弃备份后的业务。

正式停止、备份、构建、只读检查及最终进程状态待执行后补入本节。当前未运行正式bulk apply、压缩或VACUUM。实现期间只改源码与合成数据，正式运行的旧lib保持到安全停止之后再替换。

## 未执行范围

真实QQ持续收发、实际网页／图片模型质量、数月运行表现与Q3真实Embedding采集未验收。测试中的假向量不代表语义质量。R2修复证明Host API交错边界，未宣称复现了线上QQ命令窗口。旧版本已经破坏的网页文字和已经删去的恢复正文不会自动重建。

交付后由用户运行项目根目录`start-hdsi.cmd`。本轮不自动启动HDSI。
