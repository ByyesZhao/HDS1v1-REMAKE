# 本地浏览器搜索交付

更新：2026-10-10。独立整批复核3个Important已修，详见[最终关闭](FINAL_REVIEW_CLOSURE.md)。实施基线889805d，S1～S5已完成；代码提交bd298d0、e830285、4b69c24及后续交付提交。先完成[图片批](../image-input-20261009/DELIVERY.md)，再实现搜索；沿用13个既有DeepSeek连接／强度及两套embedding。本批未读写正式库或私有配置，不启动HDSI、SnowLuma或QQ。

主目录最终173文件882项及构建／类型／演示／只读隔离检查／双场景验收全部通过，见[本地整合](INTEGRATION_20261010.md)。

## 当前能力

本机Puppeteer搜索与正文读取接入原WebSearchService，不新增搜索API费用，不内置付费回退。Bing／DuckDuckGo为可选引擎；当前公网验收Bing成功，DuckDuckGo遇到验证码。每阶段正文成功20／失败40、跨阶段缓存B、checkpoint、生活本人查阅资格保持原合同。

页槽从预约到实际close才释放；排队、导航和动态就绪共用60000ms默认期限；调用方取消后仍排空迟到资源。无法证明关闭时保留占槽并报错，不允许新实例掩盖未决资源。只关闭HDSI持有的页，不关闭产品共享浏览器或其他插件页面。

正文取article/main/Readability，不把搜索摘要、导航页脚或登录验证码壳当成功；不新增字符／token截断。required Puppeteer服务尚未就绪时不打开故事库；服务换代先停止输入和旧资源，关闭完成才新建Host与Storage。关闭搜索保留原同步启动检查。

## 实际验收

- 修复后完整离线门禁：173文件／882项通过，build、typecheck、demo、双场景插件smoke通过。初批171／875、服务拒绝补验以及独立复核6项红绿均保留各自产生时日志。
- search模式独立合成库／配置／YAML通过显式runtime/check；no-network禁止请求；verify确认库和配置指纹不变。未使用默认正式路径。
- 默认独立脚本：真实网络0，mock DOM验证候选、正文、访问墙及dispose；图片独立离线报告亦保留。
- [真实公开最小probe](evidence/public-browser-probe-attempt4.json)：中文“中国气象局”10候选，候选百度百科主体2703字符；所有页排空。
- [初批真实公开完整浏览](evidence/public-browser-full.json)：中文、英文均取候选正文；合成动态页250ms后出现article、合成密码登录墙被拒绝；自有页最大1、剩余0。报告逐项标明public/synthetic，未连接故事模型或读取正式资料。
- 修复后[公开完整重跑](evidence/public-browser-final.json)亦通过；英文候选正文读取成功不等于相关性质量已验收，仍由上层模型判断是否使用。
- DuckDuckGo验证码失败及Bing早期失败均保存；attempt1虽然原脚本passed=true，实际上仅230字符版权页脚，已人工拒绝作为验收，并补DOM失败回归后修复。最终以attempt4/full为成功证据。
- 真实模型搜索续调用质量、QQ适配器持续收发、真实图片观察质量、数月运行未由本批验证。

完整命令／失败原因见[过程](IMPLEMENTATION_LOG.md)、logs/；代码与Review逐项证据见[关闭对应](REVIEW_CLOSURE.md)。

## 可审部署差异

正式两项开关仍关闭。依赖和编译更新后，可在故事配置中加入：

```json
{
  "visualInput": { "enabled": true },
  "webSearch": {
    "enabled": true,
    "provider": "browser",
    "browser": {
      "engine": "bing",
      "navigationTimeoutMs": 60000,
      "maxConcurrentPages": 1
    },
    "maxSuccessReads": 20,
    "maxFailures": 40
  }
}
```

incomingImageModel可选，未配复用stickerDescriptionModel（当前Flash/high）；不用为此复制其他模型。runtime/koishi.yml的plugins树需启用puppeteer（不能以~puppeteer禁用），可保持插件自动查找已安装Chrome／Edge。若没有可用浏览器，保留Koishi原启动异常；HDSI等待服务，不私自另开共享服务。不要覆盖已有OneBot／HDSI配置。

```powershell
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix runtime
npm run build
```

正式部署需停服并完整一致备份当前构建／配置／DB及伴随文件／素材，再按项目README做本地检查，用户手动启动。新图片表是加法建表，不需要删除旧表或更改已有协议版本。回退优先关闭开关并恢复相应构建／配置；涉及已保存新回合状态时用匹配的完整备份，不删表或图片目录来回退。
