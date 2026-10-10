# 本次审核证据

基线 `2a2e77e`，日期 2026-10-10。返回 [REVIEW](../REVIEW.md)；执行交接见 [FIX_PLAN](../FIX_PLAN.md)。

| 文件 | 内容 |
| --- | --- |
| [verification.json](verification.json) | 独立验证命令、状态及边界 |
| [reproduce-images.cjs](reproduce-images.cjs)／[image-results.json](image-results.json) | R1／R2，真实协议 2 App、合成消息、mock 模型 |
| [reproduce-browser.cjs](reproduce-browser.cjs)／[browser-results.json](browser-results.json) | R3／R4，真实 Chrome＋产品 port/provider/WebSearchService，合成无外链 DOM |
| [reproduce-startup.cjs](reproduce-startup.cjs)／[startup-ready-results.json](startup-ready-results.json) | R5，真实 Koishi＋进程内启动失败服务替身 |

从项目根目录运行；可选最后一个参数为**新的** JSON 输出路径，不传则只输出控制台。不要把修复后的结果写回本目录的原始 JSON：

```powershell
node docs/v0.5/reviews/image-search-post-implementation-20261010/evidence/reproduce-images.cjs
node docs/v0.5/reviews/image-search-post-implementation-20261010/evidence/reproduce-browser.cjs
node docs/v0.5/reviews/image-search-post-implementation-20261010/evidence/reproduce-startup.cjs
```

Chrome 默认使用本机 `C:/Program Files/Google/Chrome/Application/chrome.exe`；可用 `REVIEW_CHROME_PATH` 指定其他已安装路径。图片探针只在项目 `.tmp/post-implementation-review/` 创建自己的随机目录，退出时清理该目录。浏览器探针只使用 `setContent`，禁止页面网络请求；不启动 HDSI、QQ 或正式 Koishi。启动探针不启动 Chrome。

这些脚本用于记录实际行为，没有把“当前缺陷仍存在”写成永久应通过的产品断言。修复者需要按 FIX_PLAN 将期望行为加入正式回归测试。脚本内 `baseline` 是原审核基线标识；后续重跑应另记实际提交。

## 验证日志与环境诊断

- [build.log](../logs/build.log)、[typecheck.log](../logs/typecheck.log)：成功。
- [full-test.log](../logs/full-test.log)：第一次运行，Vitest SSR 临时缓存导入 ENOENT；不能据此认定产品回归。
- [temp-diagnostic.log](../logs/temp-diagnostic.log)：把 TEMP/TMP 指向工作区 `.tmp` 后，小范围 2 文件／4 项成功。
- [full-test-workspace-temp.log](../logs/full-test-workspace-temp.log)：173 文件／882 项中的 172 文件／880 项成功；两项因沙箱禁止创建 junction 而失败。
- [readonly-check-unsandboxed.log](../logs/readonly-check-unsandboxed.log)：经工具批准补跑剩余 1 文件／2 项，成功。没有改原测试或放宽断言。
- [demo.log](../logs/demo.log)、[plugin-smoke.log](../logs/plugin-smoke.log)：演示及双场景插件验收成功。
- [image-probe.log](../logs/image-probe.log)：R1／R2 真实 App 复现。
- [browser-probe.log](../logs/browser-probe.log)：沙箱中 Chrome crashpad 启动失败；[browser-probe-unsandboxed.log](../logs/browser-probe-unsandboxed.log) 是经工具批准、实际完成的 R3／R4 复现。
- [startup-probe.log](../logs/startup-probe.log)、[startup-results.json](startup-results.json)：第一次审核探针错误地从 Context.prototype 取委托方法，属于**探针自身错误，不作为产品缺陷证据**。已保留原结果。
- [startup-probe-corrected.log](../logs/startup-probe-corrected.log)：改用真实 Context 子类观测后，成功复现 R5；有效结果为 `startup-ready-results.json`。

公开网站可用性与真实图片模型质量不在本次复跑范围内。所有成功／失败记录只对应运行时的基线，不能代替修复后的验证。
