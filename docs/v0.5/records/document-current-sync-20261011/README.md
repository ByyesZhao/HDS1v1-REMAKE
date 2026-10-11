# V0.5当前文档与源码核对

日期：2026-10-11（Asia/Shanghai）。源码基线：`65f0785`。状态：已完成。返回[版本索引](../../README.md)。

范围为总架构、8份子系统、3份参考及全目录导航。此次以代码和本地配置白名单为准同步文档，不新增产品要求、改代码或部署；计划、审核、日志和JSON继续表达它们产生时的状态与证据。

## 1. 本次更新

- 总架构、上下文与模型／搜索参考补入世界当日新闻、三类个人兴趣／需要查阅软提示。只有本次工具实际可用才注入；修补／续调用按剩余额度重查，不强制搜索、不改变回应／主动联系资格。
- 导演和搜索说明将独立本人查阅来源明确指向搜索§6；只有personal_life实际成功提供才有独立来源，聊天／共同个人导演没有因新提示扩大记忆资格。
- 索引、总架构和实现对应不再把安全停止R1标为最新代码交付；增加联网软提示与动作限定线下的证据入口、更新当前源码／配置基线。
- 部署记录的“服务停止，由用户启动”只表示当时状态，索引不再将其当作实时运行结论。早间没有搜索操作也是当时只读检查结果，不保证之后仍没有。
- 重新核对当前功能说明的日期、普通15秒合批、共同60秒／20轮、四段窗口、记忆生命周期／容量／空闲整理、查看资格、睡眠、概率、恢复和显式停止；没有发现需要变更这些规则的文档差异。

## 2. 源码对照

源码路径相对项目根目录。将当前代码与上次完整文档核对基线726eb00比较，产品差异仅在5份文件：叙事阶段模式、个人／表达／公共动作校验、提示与阶段软提示。逐项对照这些变化，并重新核对其余主题的配置与关键控制接点；没有将所有历史证据按新代码重跑。

| 主题 | 对照位置 | 结论 |
| --- | --- | --- |
| 15秒合批／回复新鲜度 | `src/host/input.ts`、`src/host/reply-freshness.ts`、`src/app.ts`、`src/recovery.ts` | 最近普通新输入刷新；首次尝试前可等批换代；尝试后沿冻结稿 |
| 查看／睡眠／预约／自主 | `src/host/state.ts`、`src/host/scheduler.ts`、`src/host/runtime.ts` | 可读不等于回应；150～210分钟；睡眠／夜间预约仍有资格；预约内容与到期调度分工不变 |
| 共同推进／代写／归属 | `src/host/shared.ts`、`src/model/contracts.ts`、`src/model/prompts.ts` | 60秒、成功20轮硬上限；冻结用户输入决定代写；旧活动未读不改归属 |
| 动作表达 | `src/directors/narrative.ts`、`src/output/expression.ts`、`src/model/contracts.ts` | 仅线下允许；开场／收尾使用实际输出模式；公共包装也校验；已尝试旧稿仍沿恢复合同 |
| 普通／活动原文与资源池 | `src/dialogue/chat-window.ts`、`src/dialogue/activity-context.ts`、`src/model/context-views.ts`、`src/model/resource-pool.ts` | 普通4段、活动整体排除；当前活动完整获准原文；结束后相关记忆召回；单请求按身份去重 |
| 基础提取／网页来源 | `src/memory/organize.ts`、`src/web/store.ts` | 合格本轮来源；只有personal_life独立本人查阅，最终有效代际才消费 |
| 生命周期／容量／选批 | `src/memory/store.ts`、`src/memory/lifecycle.ts`、`src/memory/capacity.ts`、`src/memory/cleanup.ts`、`src/memory/batch-selection.ts` | 7／90／3／30，池100／1000／500；同事件合并资格例外；完整正文FIFO软目标、依赖不裁 |
| 空闲／后台恢复 | `src/memory/idle.ts`、`src/memory/maintenance.ts` | 深度整理15分钟刷新；索引／机械清理不等同重整理；checkpoint按持久ready／done压缩 |
| 世界学校环境／获知 | `src/environment/scheduler.ts`、`src/environment/preparation.ts`、`src/directors/school.ts`、`src/school/knowledge.ts`、`src/school/notices.ts` | 每日06:00串行依赖、异步准备；无必需通知免周模型；学校实际获知按版本，不强迫参加 |
| 联网建议的实际注入 | `src/model/prompt-policy.ts`、`src/model/client.ts` | system中按world／personal_*及实际工具资格选提示；不可用／额度耗尽不注入 |
| 搜索计数／可见性／恢复 | `src/web/service.ts`、`src/web/store.ts`、`src/web/browser/extract.ts`、`src/web/phases.ts` | 20／40、缓存B、真实提供、DOM可见性及阶段恢复规则不变 |
| 用户图／表达／图库 | `src/input-media/context.ts`、`src/input-media/service.ts`、`src/model/reply-guidance.ts`、`src/output/stickers.ts`、`src/output/qq.ts` | 入站独立观察，关闭仍合法复用；取图失败未知；三条回复规则及附件分支、图库与概率不变 |
| 显式停止与失败 | `src/deployment/stop-control.ts`、`src/deployment/browser-runtime.ts`、`src/host/runtime.ts` | 等当前前台整轮／后台阶段；关页失败不成功退出；文档不据此判断当前运行状态 |
| 配置／背景／检索边界 | `src/settings.ts`、`src/config.ts`、`src/memory/retrieval.ts`、`src/model/background-views.ts` | 明确配置与缺省分开；用途映射批准状态和元数据核对；语义标定未启用；无默认人为注入预算 |

## 3. 检查与证据

执行`node docs/v0.5/records/document-current-sync-20261011/check-docs.cjs`，重用此前检查逻辑，把输出写入本目录，不覆盖旧证据。检查整个V0.5的本地目标、锚点、当前规则章节编号及明确源码路径；只输出本地配置白名单和批准用途映射元数据，不加载key.txt或原角色背景文件，不读取正式库或调用模型／浏览器／QQ。

结果见[文档检查](evidence/document-check.json)及[有效配置](evidence/effective-models.json)。全目录90份Markdown、783个本地目标、17个锚点、73个明确源码路径；缺失目标／锚点／源码路径及章节编号异常均为0。`git diff --check`通过，改动路径全部位于docs/v0.5，无产品改动。

[配置对比](evidence/configuration-comparison.json)确认模型、图片／搜索开关、Embedding、业务参数、Puppeteer配置、批准用途映射元数据和语义标定状态均与上次白名单一致：13个连接均Flash，10 low／3 high；用户图仍复用素材high，Bing／图片开关true，语义标定false。没有因文档同步新增配置。

检查工具首次隔离复用时缺少vm的URL全局，补齐运行环境后重跑通过；故障只涉及本次文档检查器，不涉及产品或运行服务。旧检查器及证据未改写。

最新产品验证仍是[导演联网软提示交付](../runtime-web-guidance-20261011/README.md)的189文件／1034项及工程验收；本次没有重跑产品测试，也不将文档检查当作真实图片／模型搜索质量、语义召回标定或连续数月运行验收。没有停止／启动服务、修改私有配置或数据库，也没有推送GitHub。送审仍提供整个docs/v0.5，从版本索引开始。
