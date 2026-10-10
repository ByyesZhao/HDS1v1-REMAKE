# 主目录整合与最终验收

日期2026-10-10；D:/HDSI-remake 的main由ca74fa2本地快进到d939056；最终产品补修47eb14d。未推送远程。

| 主目录门禁 | 结果 | 日志 |
| --- | --- | --- |
| typecheck | 通过 | [main-typecheck](logs/main-typecheck.log) |
| build | 通过 | [main-build](logs/main-build.log) |
| demo | 通过；合成QQ/模型，不连接正式服务 | [main-demo](logs/main-demo.log) |
| 两场景插件验收 | empty_week / required_notice 均通过 | [main-plugin-smoke](logs/main-plugin-smoke.log) |
| 完整测试 | 175文件/920项全部通过，119.59s | [main-full-test](logs/main-full-test.log) |

不改正式配置／数据库／模型及思考强度；不启动HDSI、正式Koishi或QQ服务，不调用真实模型。真实Chrome只用于合成离线DOM，页面请求0且自有页面排空。公开搜索可达性和真实模型质量不重新验收。

一次独立[审查原报告](INDEPENDENT_REVIEW.md)的两项Important已用8项RED→GREEN及完整套件关闭，无Critical/Minor；没有第二次独立重审。原ASTRA报告、原红日志及途中失败保留，按[运行来源](evidence/RUNS.json)区分基线。过程工作树在全部记录提交后由宿主归档，所有需要的证据已经位于主目录及Git。
