# 最新代码与文档核对

2026-10-14核对的产品代码基线为`19cdf58`，插件和runtime包版本均为0.5.2。本轮同步总架构、8份子系统和3份参考中的当前规则与导航，修正普通活动空闲资格、个人输出必填字段和网页检查点归档时机。产品源码、测试、配置及历史计划／审核／记录保持原内容。

## 1. 当前代码与版本

| 产品提交 | 当前行为 | 已有工程验收 |
| --- | --- | --- |
| `bb23480` | 研究进度只接受已知plan_item的kind=research；区分未知任务和错误类型，提供任务ID与修补指引 | 227文件1537项通过、0失败、2项既有跳过；类型检查、构建、独立复核通过 |
| `19cdf58` | 普通生活活动不单独阻挡记忆深度整理；保留暂停、未完成轮、消息合批、共同活动、15分钟等待及睡眠配置 | 227文件1546项通过、0失败、2项既有跳过；类型检查、构建、独立复核通过；Host定时器覆盖33条20／13分批 |

数字来自各产品验收的[报告摘要与指纹](evidence/product-verification-summary.json)，没有作为本轮文档修改的重新运行结果。两次正式部署的[研究进度摘要](evidence/research-progress-deployment.json)及[记忆空闲摘要](evidence/memory-idle-deployment.json)记录了当次安全停止、备份、250构建文件一致、只读启动检查及数据库／配置保持情况；不能由历史摘要推断当前服务状态。

`v0.5.2`初次发布标签固定于`7138aad`；main包含后续修正，包版本仍为0.5.2。文档体系V0.5、npm版本与数据库协议版本各自独立。

## 2. 修正的说明

| 问题 | 当前说明 | 源码依据 |
| --- | --- | --- |
| 调度睡眠段仍暗示普通场景活动限制维护；总架构未明确普通活动已不阻挡 | 普通生活活动不因手机权限或预计结束时间阻挡；关闭睡眠维护时等到wakeAt再核对完整等待 | [memory/idle.ts](../../../../src/memory/idle.ts) |
| “活动变化”没有说明身份字段 | 普通activity.startsAt或shared.activityId变化刷新锚点；仅改描述、预计结束或手机权限不单独刷新 | [activityChanged与空闲资格](../../../../src/memory/idle.ts)、[故事最终提交](../../../../src/recovery.ts) |
| 只说life可省略taskChanges，未明确chat/shared必填 | chat/shared始终提供数组，无变化为[]；无获准预约时数组元素只开放create，life可省略 | [personalTask](../../../../src/model/contracts.ts)、[合同回归](../../../../tests/personal-task-contract.test.ts) |
| 搜索文档写成每个模型阶段成功就压缩checkpoint | 普通轮在最终B事务标记done时归档并压缩owner各阶段检查点，事务成功后释放缓存；维护与环境按各自边界收尾 | [ModelClient](../../../../src/model/client.ts)、[最终提交](../../../../src/recovery.ts)、[维护准备](../../../../src/memory/maintenance.ts) |
| 当前入口／参考仍以7138aad及关联权限修复为最新 | 更新为19cdf58，新增两项修正和工程摘要；初次发布与原核对保留原日期和含义 | [版本索引](../../README.md)、[实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md) |

研究进度的research类型限定及分类型诊断已在导演§7准确描述，保留现有说明。

## 3. 当前说明覆盖

| 当前说明 | 核对位置与结果 |
| --- | --- |
| [总架构](../../architecture/REMAKE_V0.5.md) | app、host、memory及近期源码差额；补普通活动与前台工作资格的区别 |
| [导演](../../subsystems/REMAKE_V0.5_DIRECTORS.md) | directors、school/progress、model/contracts及prompts；补taskChanges必填，研究进度说明保持 |
| [调度](../../subsystems/REMAKE_V0.5_SCHEDULING.md) | host/scheduler、state、shared及memory/idle；修正睡眠维护措辞，澄清锚点 |
| [记忆](../../subsystems/REMAKE_V0.5_MEMORY.md) | idle、maintenance、references、organize、lifecycle；空闲资格与三类权限保持，补锚点身份定义 |
| [共同活动](../../subsystems/REMAKE_V0.5_SHARED_ACTIVITY.md) | host/shared、活动归属与恢复；公开开始／结束、60秒时钟、代写及旧输入转移说明保持 |
| [上下文](../../subsystems/REMAKE_V0.5_CONTEXT.md) | context-views、resource-pool、background-views；窗口、资料池与视觉权限说明保持 |
| [表达与素材](../../subsystems/REMAKE_V0.5_EXPRESSION_STICKERS.md) | output、input-media、sticker-web-runtime；表达模式、检索、观察与CLI生命周期说明保持 |
| [网页搜索](../../subsystems/REMAKE_V0.5_WEB_SEARCH.md) | web/service、store、client及owner收尾；修正普通轮归档时机，额度／来源规则保持 |
| [报错与恢复](../../subsystems/REMAKE_V0.5_RECOVERY.md) | recovery、maintenance、stop；换代、封口、暂停／人工恢复、历史与安全停止说明保持 |
| [实现对应](../../reference/V0.5_IMPLEMENTATION_MAP_20261009.md) | 模块、版本、测试入口与批次证据；更新近期修正及标签／main含义 |
| [模型与配置](../../reference/MODEL_CALLS_AND_WEB_OPTIONS_20261009.md) | settings、model/client；连接与默认参数未随本轮产品修正改变，部署值仍引用有日期证据 |
| [背景映射](../../reference/BACKGROUND_VIEW_MAPPING_20261008.md) | settings、background-views；加载、用途选择及缺失事实初始化说明保持，审批日期与原快照保持 |

## 4. 文档验证

入口为[verify-docs.cjs](evidence/verify-docs.cjs)，结果见[document-verification.json](evidence/document-verification.json)。170份Markdown、1382个本地链接及对应标题锚点均通过，当前架构编号无重复；包版本、发布标签、改动范围与文件指纹检查均通过。

[修改前指纹](evidence/pre-edit-fingerprints.json)覆盖981份既有历史文件和415份产品文件。仅更新当前说明、导航索引及本记录；新记录中的部署和工程摘要是已有证据的副本，未替换原证据。

本轮仅修改文档，没有停止／启动HDSI、重新部署、修改正式库、读取私有配置或调用在线模型／QQ。工程回归沿用各产品提交的已完成验收，本轮新增验证针对文档一致性、导航及证据保留。
