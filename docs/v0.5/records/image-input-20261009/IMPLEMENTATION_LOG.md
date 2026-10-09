# 图片输入实施记录

依据：EXECUTION_GUIDE、DESIGN、IMAGE_INPUT_PLAN；基线 889805d。隔离 worktree image-local-search。本批正式开关保持关闭，不改正式库、不启动 QQ。

## 实施与验证过程

- I1：新解析器、新三表及索引、附件引用与消息同事务。失败回归先确认缺少模块；测试的 Koishi CJS 装配错误修正后，入口与原输入共4项通过。当前原文解析文件命名 parse.ts，与计划 ingress.ts 职责相同。
- I2／I3：字节 SHA256、落盘、平台表情、独立 incoming_image 四字段、第三参数 resolver、真正 image_url、修补原图一致。新接口缺失时失败；实现后相关3文件16项通过。qface 已锁定；旧混合用途描述不当观察，不改67项图库及向量。
- I4：ready／unrecognized 终态、pending ref／phase 固化、磁盘重开；最终 StageModelInput 的权限消息上 hydration；lookup 支持投影 DTO。原线性池测试发现新增合并用 find 造成回归，改为 Set＋Map，4文件9项通过。
- I5：保护未读／当前窗口／共同活动／未完成轮／待检查消息原图；删除前让步后重查；stop 先排空下载。只读检查 API 缺失的断言先失败，再完成所有显式路径分支。原基线2项失败是 worktree 的 runtime/node_modules 缺失，安装运行时锁定依赖后对应回归通过，不修改业务规则。
- I6：实际 middleware 解析、平台注册、下载桥、视觉连接及关库顺序已连通。补完整故事流程：普通主叙事不看新图，pause不打断本轮后续识别，睡眠不识别，最终轮保留 visualContext。
- 新夹具生成器不读取正式配置、key.txt 或数据库，真实只读 check 比较哈希；此项初版与测试同时加入，未单独保留首轮红灯，不声称每一项均逐条TDD。

- 搜索合批最终复核中补确认附件批量JOIN成本及删除deleting态重入；先确认15查询和漏清理失败，再修复并跑完整171文件875项，具体见[合批过程](../local-browser-search-20261009/IMPLEMENTATION_LOG.md)。

## 验收记录

完整批次离线门禁及独立脚本的实际结果见 DELIVERY.md 和 logs/；真实图片模型质量本轮未授权执行，另行标记，不将 mock 冒充真实模型验收。

## 决策

正式启用与真实图片上传分别操作。incoming_image 是新增用途，不加入既有无条件模型用途列表；可覆盖 incomingImageModel，未配则使用 stickerDescriptionModel。其余连接未修改。
