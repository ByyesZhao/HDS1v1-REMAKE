# 表情包迁移与部署记录（2026-10-07）

用户提供了既有表情库导出以及正式背景和密钥，并要求把需要引用的旧内容转移到新项目。此次复制资料和图片，旧工程保留；不迁移旧聊天、记忆、经历或人物运行状态。

当前新图描述连接为 DeepSeek Flash、`reasoningEffort: high`，可独立改为 Pro；它生成描述文字，独立的 qwen Embedding 再编码描述和查询。本次直接复用旧描述，尚未在线验证新图视觉描述能力。角色各任务与审核入口见 [README](../README.md) 和 [文档核对清单](v0.5/README.md)。

## 新项目内的文件

| 内容 | 新位置 |
| --- | --- |
| 正式角色设定 | `梁思璃设定.txt` |
| 私有运行配置 | `config.local.json` |
| 本地密钥 | `key.txt`，不记录凭据值 |
| 67 张图片 | `runtime/data/stickers/qq-market/...`，保留目录结构 |
| 已导入素材表 | `runtime/data/hdsi-remake.sqlite` 的 `stickers` |
| 旧配置身份记录（不含密钥） | `runtime/data/legacy-embedding-identity.json` |
| 完整旧目录 | `references/legacy-stickers/runtime/sticker-export-20261007/sticker-catalog.json` |
| 独立旧向量 | 同目录 `sticker-embeddings.json` |
| 描述与标签 CSV | 同目录 `sticker-descriptions.csv` |
| 旧流程说明、导出脚本及用到的源码 | `references/legacy-stickers`，仅为历史参考，不加载为运行模块 |
| 本次在线检索结果 | `runtime/data/sticker-retrieval-check.json` |

历史归档中的旧绝对路径描述当时的来源。当前运行库内的所有图片路径已改到新项目；运行与验证脚本不读取旧项目目录。归档的 Python 导出器仍是旧库导出工具，不作为新库维护命令。

## 兼容核对与结果

67 条记录都为 1024 维，原 Embedding 模型为 `qwen3.7-text-embedding`，与用户本次提供的百炼兼容接口相同。原请求显式指定 1024 维，描述加标签的输入长度不超过原 20000 字符上限。

按旧算法使用模型、接口身份、维度和输入上限还原的指纹为 `emb-v1-9eb7bb5372a089d5:d1024`，全部条目一致。没有凭维度相同推断模型兼容。经用户明确授权，当前接口复算第一条原 `embeddingInput`，相似度 `0.999999185592993`；当前返回 1024 维。

导入保留原素材 ID、描述、标签（`aliases`）、原 Embedding 输入及向量，记录当前模型与端点。图片逐项 SHA256 与原目录核对，67 张一致。没有重新识图，也没有为整库重新请求向量。图库虽放在故事 SQLite 中，本次库中只有素材和默认运行控制信息，正式角色状态尚未初始化，没有故事回合、聊天、记忆或经历。

10 条真实查询的最高项已保存。多数语境与描述一致，但“好呀，赞同”选出疑惑图，“早上好”选出抱抱图，笑声查询选出坏笑图也存在语气差异。本次确认接口和向量可用，不宣称每条匹配都合适。没有增加过滤阈值、候选模型挑选或变体随机规则。

## 本地目录导入与重建

导入命令只复制本地图片和记录，不调用模型；源身份文件必须来自已经核对的配置，不从向量维数猜测。以下命令使用已复制到新项目的文件，可重复执行，既有 ID 不重复新增：

```powershell
cd D:\HDSI-remake
npm run stickers:catalog -- references/legacy-stickers/runtime/sticker-export-20261007/sticker-catalog.json runtime/data/stickers runtime/data/legacy-embedding-identity.json
```

更换模型、端点或维度时，先停止 HDSI，修改配置，然后显式重建；重建使用保存的描述与标签输入，不重复识图：

```powershell
npm run stickers -- rebuild - config.local.json runtime/data/hdsi-remake.sqlite
```

新图库使用 `src/output/stickers.ts` 的逐文字抽样及最高余弦项选择。旧版候选筛选、由回复模型挑 ID、0.94 相近变体随机等行为不迁入，因为重制版文档已有不同规则。

## 固定背景与记忆

`backgroundFile` 在每次启动时读取正式设定。初始细节按设定提取，年龄/年级使用 2026 年秋基准，未确定的手机型号、具体课表、研究结果等不预填。已有背景中的说话指导作为表达材料，未伪造聊天范例。

角色记忆本期不加 Embedding，继续按主题、中文关键词、时间和重要程度检索；如实际使用确认语义召回不足，再扩展长期记忆。表情包 Embedding 与角色记忆分开处理。

## 启动与未验收事项

HDSI 与 SnowLuma 保持停止。新 OneBot 和故事插件配置为用户下次双击时启用，启动前检查不发网络请求。用户需在 SnowLuma 登录机器人 QQ，并将反向 WebSocket 设置为 `ws://127.0.0.1:5141/onebot-remake`。本次没有登录或发 QQ，实际平台消息 ID、发送间隔和完整故事路径仍待用户手动启动后联调。
