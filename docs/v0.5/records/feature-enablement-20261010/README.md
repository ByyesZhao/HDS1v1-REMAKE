# 新图片识别与本地搜索配置启用

日期：2026-10-10。状态：配置已启用，只读启动检查通过；服务由用户启动／重启。代码基线`31f331c`，产品代码未改。返回[版本索引](../../README.md)。

用户明确要求打开两项功能，本次直接按已有实现配置：

| 项目 | 修改 |
| --- | --- |
| `config.local.json`的`visualInput.enabled` | false→true；不另配incomingImageModel，继续复用素材描述Flash/high |
| `webSearch` | enabled=true、provider=browser、engine=bing、navigationTimeoutMs=60000、maxConcurrentPages=1；额度仍20成功／40失败 |
| `runtime/koishi.yml` | 在plugins加入`puppeteer:hdsi-web`，headless=true；原OneBot、HDSI及其他插件配置不改 |

修改前完整复制上述两份配置到本地忽略目录`runtime/archive/batches/feature-enablement-20261010-1791605688978/`。这是配置回退副本，不是数据库／完整故事恢复快照；不纳入Git或默认送审。配置结构比较确认其他故事设置、所有模型、两套Embedding及既有Koishi插件值均未改变。公开差异见[白名单记录](evidence/configuration-change.json)。

静态浏览器查找确认`C:\Program Files\Google\Chrome\Application\chrome.exe`存在，Puppeteer依赖已安装。执行`start-hdsi.cmd --check`退出0，67项图库就绪，见[检查日志](evidence/startup-check.log)。该检查按正常入口加载本地认证、背景与只读库，不输出凭据／背景，不启动浏览器或故事服务，不调用模型／网页，也不改数据库。

已同步当前索引、模型参考、实现对应、导演／上下文／搜索的部署状态；启用前审核证据保留原false／unconfigured，不改写成新结果。[文档链接检查](evidence/document-check.json)无缺失；未重跑产品测试或在线质量验收。

用户接下来启动`start-hdsi.cmd`和`start-snowluma.cmd`；如果HDSI已经运行，先用Ctrl+C正常退出HDSI，再启动它，SnowLuma无需因这次配置重启。收到的原图在角色读取资格成立时送给现有观察模型；网页查询由各阶段模型按需提出。真实图片识别质量及网页模型续调用仍需运行中观察。
