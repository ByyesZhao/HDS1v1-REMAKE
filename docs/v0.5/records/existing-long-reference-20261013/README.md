# existingLongId 修复与0.5.2交付

日期：2026-10-13（上海时间）。状态：**产品实现、完整离线验收及独立代码复核通过；正式部署进行中**。
源码起点：`44cfdbd`；T1 `ac47cc6`、T2 `56d657b`、T3 `de597fe`。原计划、Astra审核和原始证据保留原基线。

本批独立区分shortUpdateIds、longAwakenIds和existingLongIds；允许基础memory复用已提供short的合法关联preview long，保持普通检索生效门禁和awaken权限。确认lookup恢复同时重建活动checkpoint中的累计权限投影；最终apply拒绝discarded规范目标，保存post结果的恢复也不能绕过。

| 审核项 | 当前关闭证据 |
| --- | --- |
| 原bug | 真检索／实际HTTP首次响应复用，未另建long；[源码修复探针](logs/fixed-source.txt) |
| R1 P2 | discarded及其别名磁盘恢复红绿，整批回滚、post保留、无业务重发；[稳定红灯](logs/t3-red-stable.txt)、[绿灯](logs/t3-green.txt) |
| R2 P2 | raw／StageModelInput、视觉包装、有／无确认结果、pending与保存失败；实际发送快照及原runId／repair／网页1成功1失败计数验证；[T2绿灯](logs/t2-green.txt)、[T3绿灯](logs/t3-green.txt) |
| R3 P3 | 基线与修复后直接src包装器，无正式lib覆盖；[基线](logs/baseline-source.txt)、[修复后](logs/fixed-source.txt) |
| 独立最终复核 | [代码复核](INDEPENDENT_REVIEW.md)：4文件47项、source expect-fixed通过，Ready to merge，无发现 |

初始定向T1为3文件36项、T2为7文件50项、T3为6文件53项，均通过；各阶段typecheck通过。它们不代替整批验收。T3第一／第二次web计数fixture误用session.readPage接口，随后补齐真实operationId；稳定红灯仅剩discarded及别名2项，修复后转绿。初始失败日志保留，不把测试装配错误当产品问题。

本轮用户明确授权安全停止、备份部署、Git推送及0.5.2；服务由用户手动重启，本批不启动或resume。不自动合并此前可能重复的正式记忆，不更改人物、模型／强度、配置、协议或检索标定。

## 工程验收

最终完整验收：226文件1530项通过、0失败、2项既有跳过（总1532项），见[完整JSON](logs/final-tests-accepted.json)。[类型检查](logs/final-typecheck-accepted.txt)、[构建](logs/final-build.txt)、[demo](logs/final-demo.txt)、[插件合同](logs/final-plugin-contract.txt)和[双场景smoke](logs/final-smoke.txt)均退出0，两个场景各四阶段提交。独立代码复核另运行4文件47项及源码expect-fixed通过。

第一次完整运行1508通过、3项断言失败、21项未运行／跳过：Chrome套件beforeAll受沙箱阻挡，19项没有执行；只读launcher的2项目录联接亦被沙箱拒绝；另1项旧memory-final-review断言仍读取raw.retrieved。原[失败JSON](logs/final-tests.json)保留。旧断言改为检查实际标准投影和三权限集合，原恢复／无二次lookup断言保留；放行受控Chrome及临时联接后[3文件26项复验](logs/full-failure-recheck.txt)通过，随后全量重新通过。未改产品代码来绕过环境限制。

全部产品验证使用合成库、假HTTP和sender，不进行供应商或QQ在线验收。[文档检查](evidence/document-verification.json)验证168份Markdown、1434本地链接及标题锚点，错误0；原计划3份输入字节指纹保持。隔离目录仅复制本机runtime/archive/README.md用于校验既有本地导航，没有复制私有历史数据。

## 正式部署与Git

安全停止、进程／端口确认、一致备份、构建校验、只读check、数据状态对照、最终commit/tag/远端SHA及服务状态在完成后补齐。当前不声明已经部署或推送。

