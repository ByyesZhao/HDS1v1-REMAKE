# 图片输入 Review 关闭对应

| 项 | 实现／证据 |
| --- | --- |
| 历史图片仅按权限消息投影 | context.ts；incoming-media-context.test.ts |
| ready与未知终态恢复 | service.ts；incoming-media-turn.test.ts（关库重开） |
| 图片真正发送给模型，修补不换图 | client.ts／observe.ts；incoming-image-model.test.ts |
| 不提前看未读、pause不中断前台、睡眠不准备 | app.ts；incoming-media-integration.test.ts |
| 只读显式路径，不改库 | runtime/check.cjs；runtime-check-paths／readonly／feature-check-fixture |
| 真实字节及旧图库隔离 | assets.ts／store.ts；incoming-media-assets.test.ts |
| 删除前重查、新引用保护、观察保留 | incoming-media-cleanup.test.ts |

全量与在线状态另见 DELIVERY；文档中的测试只证明所列路径，不证明 QQ 适配器所有来源或模型识图质量。
