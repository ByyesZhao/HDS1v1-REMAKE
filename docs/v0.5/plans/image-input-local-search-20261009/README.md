# 图片输入理解与本地网页搜索：SOL 执行包

日期：2026-10-09。状态：**审核意见已写回，细化方案可交实施；功能尚未实施**。源码基线 `4fe090c`，产品代码沿用 `b9d5514`。本轮只修订文档，没有改产品代码、安装依赖、修改正式配置／数据库、启停服务或调用真实模型。

**把整个本目录及对应 [review 目录](../../reviews/image-input-local-search-20261009/PLAN_REVIEW.md)交给 SOL，从[执行与验收指南](EXECUTION_GUIDE.md)开始。** 不再执行 `4fe090c` 中的旧待审正文；它由 Git 和 review 的原始基线留存追溯。

| 顺序 | 文件 | SOL 要从中取得什么 |
| --- | --- | --- |
| 1 | [执行与验收指南](EXECUTION_GUIDE.md) | 工作指令、任务依赖、隔离命令、review 关闭矩阵、交付及部署边界 |
| 2 | [修订设计](DESIGN.md) | 唯一行为合同、类型／接口、权限矩阵、恢复及生命周期 |
| 3 | [图片 I1～I6](IMAGE_INPUT_PLAN.md) | 文件、接口、红绿步骤、精确断言、提交与图片批验收 |
| 4 | [搜索 S1～S5](LOCAL_SEARCH_PLAN.md) | 页槽、DOM、早期 S5a 浏览验证、工具接入、服务就绪和搜索批验收 |
| 依据 | [原计划审核](../../reviews/image-input-local-search-20261009/PLAN_REVIEW.md) | R1～R5 的原因、原代码探针和具体反例，非新功能失败报告 |
| 参考 | [已复制旧源码](../../../../references/legacy-web-search/README.md) | 仅复用适当底层思路，不导入旧配置／运行环境 |
| 本轮检查 | [修订自查](evidence/revision-self-review.json)、[修订链接检查](evidence/revision-document-links.json) | 文档一致性及可达性，不是产品实现验收 |

仍采用原方案的大方向：独立看图后把观察交给故事阶段；浏览器适配当前网页工具；先图片、后搜索，分别交付。既有模型／思考强度不改，两项开关默认 false。

本轮已裁定的细节包括：消息持久观察关联和历史只读装载、图库旧描述不直接当客观观察、图文位置及同图多次出现、本轮 unknown 冻结、原资产恢复、服务 required 就绪、真实页槽排空、DOM 正文／空态证据、真正隔离的 runtime/check，以及先 build 再完整验证。执行任务和验收证据逐项对应，SOL 无须再自行选择架构。

当前图片仍只有占位与附件标记；本地搜索 provider 尚未实现，不能只开正式开关。既有[公开 HTTP 探针](evidence/public-http-probe.json)仅记录当时直连：DuckDuckGo 失败，Bing HTTP200 但未检出结果项；不能证明真实浏览器成功或失败。真实可行性由 S5a 验证，真实图片质量由单列在线验收验证。

原稿的[自查](evidence/plan-self-review.json)及[链接结果](evidence/document-link-check.json)保持原样；本轮另存 revision-* 证据。完成任务后按[目录原则](../../../DIRECTORY_POLICY.md)归档计划、同步当前功能规则，不提前宣布产品已具备计划能力。
