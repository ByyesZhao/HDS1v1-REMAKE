# 第十轮共同活动交付修正执行计划

> **For agentic workers:** 使用superpowers:executing-plans按任务执行；用户已接受回应§6并授权实施，沿用当前会话顺序执行，不再另开设计审核。

Goal：补公开开场／提前收尾约束，回填口径，合并已接受的小维护项，再完成正式库检查／升级及隔离真实模型验收。
Architecture：原串行流水线及冻结／段B不变；共同个人合同新增末尾`publicNarration?: string | null`校验上下文。个人修补只修个人结果，空旁白时可暂不end，不回调用主叙事。Tech Stack：现有TypeScript/Zod/Vitest/SQLite/Koishi，无新增依赖。
Spec：[已接受回应](../DSH-review/CODEX_REBUTTAL_SHARED_ACTIVITY_DELIVERY_20261008.md)§3、§5～6，以及共同实施细化。起点3df5cbf。

## Global Constraints

60秒／20轮／普通15秒、独立Flash及既定思考强度、记忆来源、串行冻结边界不改。中间轮及角色允许沉默；收束只减不增，不做语义映射或自愈。正式库先只读check；确认相关服务已停再唯一目录备份apply；旧活动需要用户裁定。真实验收使用本地隔离库、RecordingSender和配置中的真实模型，不向QQ发送、不启动服务、不把密钥／背景／原始验收正文提交Git。

## Review Focus

1. 小maxSteps的首节点已是wrap_up/final时仍要求正文，不按opening判断。
2. 提前end的个人修补不能改主叙事；失败不发末标志／不计数／不消费控制，合法中间静默仍能继续。
3. 空白兼容后存旧原文，语义改写或新支线仍拒绝，不复活已删旧条目。
4. 增加clock身份资格不能丢失尚未到期的未来定时器。
5. 正式库停止备份及幂等升级不猜测旧活动；真实模型验收结果不冒充真实QQ／完整自然质量保证。

## 任务1 公开正文约束

Files：contracts.ts、directors/personal.ts、app.ts、prompts.ts及shared-v3-contracts／flow／fixture、shared-scene测试。
Interfaces：personalTask和runPersonal现有sharedMeta后追加publicNarration；app只在共同调用传本轮narrative公开正文。
- [ ] 先写首节点（max20/3/1）、提前end空旁白修补／暂停及中间静默测试；运行目标组取得业务RED。
- [ ] narrative以stepNumber=1校验非空；personal shared的end校验已给旁白非空，错误明确不得改上一阶段，可暂不end。同步提示词，调整已替代夹具，非空提前end允许reply none。
- [ ] 目标测试／全套／typecheck通过后记录并提交fix: require public shared opening and closure。

## 任务2 口径回填

Files：共同细化／执行计划、README及受影响根文档。
- [ ] 明确普通门禁与开始转交、text拼接全文、活动外wake只处理已到期工作；准备轮后续输出不作共享节点锚点、首节点仍立即。
- [ ] 同步新增个人合同上下文和正文约束，历史审核／回应不改成已实施；记录日志。

## 任务3 小维护项

Files：contracts.ts、scheduler.ts、prompts.ts、shared/input注释及相关测试。
- [ ] 新测试RED：wrap空白匹配保留旧原文，语义改写仍拒绝；clock不匹配不贡献活动截止；合法未来截止仍保留。
- [ ] 实现有限空白匹配；nextDeadline补同身份；共用叙事规则改成明确函数参数而非字面replace。仅补已接受注释，不增加锚点字段或自愈。
- [ ] 全套、类型、build、demo及Koishi离线smoke通过；一位独立审查代理最终只读复核，重要项用RED→GREEN修正，不重复派审核。整合回原目录并复验。

## 任务4 部署与真实验收

- [ ] 原目录构建更新；只读正式库报告，确认相关进程已停；可初始化时停止标志+唯一备份目录apply；旧活动不自动清空。
- [ ] 创建可复用显式验收脚本：使用本地配置真实模型，禁真实Sender与正式库；公开开场／静默至收束终结、动作输入／返回纠正及提前end场景。记录逐轮goal／endingCondition／公开正文及代写清单，报告存ignored runtime目录，文档只留必要摘要。
- [ ] 人工审阅实际输出，记录通过项／未覆盖项／失败项；关闭测试库，不启动正式服务。更新实施日志与本地提交。
