# 用户图片输入交付

I1～I6 已接入；正式 visualInput.enabled 保持原关闭值。新独立用途 incoming_image 可指定 incomingImageModel，未配复用 stickerDescriptionModel；13个既有连接及 embedding 未修改。

当前消息解析→引用同事务→异步资产保存→角色可读时独立识别→不可变观察＋本轮终态→按授权消息装载历史→本轮来源记忆。已知 QQ face 走名称映射；图上文字不当用户指令；旧图库混合描述不作入站观察。

图片、完整观察、传输分开保存；消息和checkpoint不保存二进制。pending磁盘恢复沿原assetRef；ready／unrecognized不重看。仅取得消息的窗口或lookup能带回对应观察。

## 验收

- 独立图片门禁：build、typecheck、全量159文件854项（加入最后2项插件开关验收前）；随后新插件2项单独通过，最终全量结果更新到本次搜索批交付。
- demo、显式隔离config/database/koishi路径只读check、夹具哈希verify、原双场景smoke通过。
- 离线独立图片验证：2次出现／1个观察正文、模型mock一次、本轮再读0新增调用；真实网络0。
- 在线图片质量未执行；无正式聊天、图片或角色背景上传。脚本提供显式online入口，需确定实际公开／合成输入再运行。
- 不启动HDSI／QQ、不改正式库／私有配置。运行原图在所选数据库同级 incoming-media，不混入发送图库。

证据：[离线报告](evidence/offline-validation.json)、logs/、[过程](IMPLEMENTATION_LOG.md)、[Review对应](REVIEW_CLOSURE.md)。

## 配置与回退

审阅后启用visualInput.enabled=true即可；独立incomingImageModel可后续调整，不复制其他用途。关闭开关会停止新的下载／模型识别，已确认历史观察仍可用于获准原文。部署前备份、回退合同仍按执行指南，不删除新表或抹除失败证据。
