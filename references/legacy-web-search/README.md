# 旧项目图片入口与本地搜索参考

复制日期：2026-10-09。状态：参考快照，不是新项目运行代码。入口为[待审设计与计划](../../docs/v0.5/plans/image-input-local-search-20261009/README.md)。运行和后续开发不要求旧目录存在。

## 来源

- `source/`来自旧本地增强仓库`D:/HDSI/hds-interlude-integration-0.1.4`当时源码，Git HEAD为`a0f0f8c`；文件摘要见[source-hashes.json](source-hashes.json)。这里只复制公开源码，不复制旧配置、凭据、数据库或聊天。
- `upstream/`是本地保存的作者参考版`hds-interlude-1.0.1-rc28-cc3452d`源码片段，证明该作者版已有Puppeteer浏览功能；不代表已核查作者今天的最新版本。

| 文件 | 可参考的部分 |
| --- | --- |
| [public-web-reader.ts](source/public-web-reader.ts) | 页槽、读取取消、建页／关闭、可见文本提取与访问结果 |
| [web-page.ts](source/web-page.ts) | 搜索链接、正文／登录／验证码判断、Bing轻量XML结果处理 |
| [web-observation.ts](source/web-observation.ts) | 查询模板与URL目标解析；不是新项目的会话／记忆协议 |
| [media-input.ts](source/media-input.ts) | 当前消息附件解析；避免复用历史session.elements及face内部展示图 |
| [qq-face.ts](source/qq-face.ts) | QQ原生表情ID名称映射，未知保留未知；依赖qface |
| [作者版配置片段](upstream/browser-config-excerpt.txt) | browser开关、搜索URL模板及旧文字上限 |
| [作者版读取片段](upstream/browser-reader-excerpt.txt) | Puppeteer打开目标页并提取可见文字 |

旧源码的引用、导入、剪裁预算、20／20计数和故事观察存储不能直接用于重制版。只借鉴或适配所需底层逻辑，正式新代码放`src/`；不得把参考目录加入编译或用绝对路径加载旧插件。已有[旧图库参考](../legacy-stickers/README.md)继续保留，不重复复制视觉模型客户端。
