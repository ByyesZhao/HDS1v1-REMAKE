# 图片后搜索实施过程

基线889805d；隔离工作树image-local-search；执行依据为DESIGN与I/S计划。2026-10-09开始，2026-10-10完成验收。

## 任务与问题

1. I1～I6先独立交付，过程见[图片记录](../image-input-20261009/IMPLEMENTATION_LOG.md)。最后新增查询成本和deleting态恢复回归：旧版forMessages对12条消息逐条查询共15次，旧cleanup忽略已unlink的deleting资产；失败确认后，改为一次批量JOIN、索引候选与可重入删除。确认历史观察不触发下载。
2. S1：FIFO预约、迟到factory/close、取消和dispose；新模块缺失先失败，实现后转绿。关闭错误无法证明资源消失时不释放槽。共享限额不改变每阶段原20／40。
3. S2a→S5a：同一DOM提取函数用于fixture和真实page.evaluate。加入koishi-plugin-puppeteer3.9.0、Readability0.6.0，qface1.4.1；固定版本进入锁文件。公开Context只加载HTTP/Puppeteer，不加载HDSI／OneBot／库／模型。
4. 真实probe第一次拿到候选却只读出版权页脚230字符，脚本初版将其误报passed，人工检查拒绝。补footer/class/role反例确认RED，去除这些节点和aria-busy导航壳后GREEN。DuckDuckGo返回captcha，保留独立失败，不绕过不自动换引擎。
5. Bing目标页有二次导航，最初evaluate遇Execution context was destroyed；补真实形态端口回归RED后，沿原deadline重新等待context和注入提取器，不额外goto或扩大预算。attempt4实际中文正文2703字符／10候选，通过门禁才继续S3／S4。
6. S2b：结构性登录墙、验证码文章、查询含no results但无空态、main、长正文尾部哨兵、动态就绪、direct-read搜索页等均纳入同提取器测试。
7. S3：7文件32项涵盖原阶段工具、预算、缓存B、no_candidates、恢复、来源资格。注入原assembleWeb，不重写核心。结果不足仍传回模型，允许角色询问用户。
8. S4：拆plugin-runtime与browser-runtime；真实Koishi Context验证两种注册顺序、服务移除换代、旧close等待和最大Host1。独立静态check支持启用分组／实例后缀／禁用分组，三个显式路径从不回读正式路径。后来补服务start拒绝，原错误可在Koishi取得，故事工厂0调用。
9. 首次完整全量失败4项，另1个未处理异常：关闭搜索原同步升级检查被async迁移改变为延迟拒绝；通过createPluginRuntimeSync恢复原契约。其余是旧源码位置与webSearch新增默认字段的断言过时，明确更新测试定位和matchObject；没有删原升级／smoke场景以换通过。
10. 修复后完整171文件875项通过，构建／类型／demo／显式合成check／哈希verify／双场景smoke通过。实际full公开浏览包含中文与英文候选正文、合成动态和登录墙，所有持有页关闭。隔离验收Context曾因上游Canvas与Puppeteer并行停止出现ProtocolError，脚本只先关闭自己Context拥有的Canvas，再ctx.stop；产品不停止其他插件服务。

## 命令与证据

从隔离项目根运行；日志中路径为实际工作树，保存后不伪改为D盘：

```powershell
npm run build
npm run typecheck
npm test
npm run demo
npx tsx scripts/prepare-feature-check.ts --mode search --output "$PWD\.tmp\search-feature-check"
node --require "$PWD\.tmp\search-feature-check\no-network.cjs" runtime/check.cjs --config "$PWD\.tmp\search-feature-check\story.json" --database "$PWD\.tmp\search-feature-check\story.sqlite" --koishi-config "$PWD\.tmp\search-feature-check\koishi.yml"
npx tsx scripts/prepare-feature-check.ts --verify "$PWD\.tmp\search-feature-check"
npm run smoke --prefix runtime
npx tsx scripts/validate-local-web.ts --report "<absolute-report>"
npx tsx scripts/validate-local-web.ts --online --probe --engine bing --report "<absolute-report>"
npx tsx scripts/validate-local-web.ts --online --engine bing --report "<absolute-report>"
```

夹具输出目录必须空；复核时换新的临时目录，不覆盖旧证据。online浏览仅公开页面，无密钥、角色背景或聊天。脚本计数是自有页和provider操作；realNetworkRequests=null意为未统计浏览器全部子资源，不是0。原attempt1误报与后续失败JSON按产生时保存，canonical probe由最后实际成功attempt4的副本表示，原HTTP探针仍保留在计划包。

## 执行口径

- Ruling: 入站原文解析文件取parse.ts，等价于计划ingress.ts职责；错误成本为后续改名，接口／测试合同不变。
- Ruling: 完成合同保留原plans路径直到本批交付复核，以稳定ASTRA送审链接；复核关闭后归档，成本是再执行一次导航迁移。
- 模型保持原值；正式两项enabled不修改。没有安装到旧HDSI或导入旧运行配置。
- 并非每项都保留独立红灯日志：图片夹具生成器与测试初版同时加入；服务自身拒绝是补验已实现分支，不虚称新产品修复TDD。具体已发生的行为失败与修复如上记录。
