# 作者背景用途映射

当前加载、用途选择及缺失事实初始化规则已按`19cdf58`源码核对，见[文档复核记录](../records/document-current-sync-20261014/README.md)。下表是2026-10-11[白名单中的批准映射元数据](../records/document-current-sync-20261011/evidence/effective-models.json)；本轮未读取私有映射、原背景或正式库，也不将元数据说明视为重新审批。

2026-10-08用户批准本期候选，条件为风格可后续修改。启用文件为`runtime/data/background-views.local.json`，在`config.local.json`配置`backgroundViewsFile`；各块和sourceMap可手动编辑，下一次启动读取。已冻结环境步骤仍使用原输入快照。原`梁思璃设定.txt`和pending候选保留。

| 用途 | 原文段号（0起始） |
| --- | --- |
| core（叙事／个人／基础记忆） | 全部36段，暂不删作者事实 |
| style（表达） | 8、9、32 |
| world | 25、26、28、31 |
| campus | 2、5、25、26、27、30、34 |
| group | 2、5、27、30、33、34 |

facts为空：本期没有迁移作者事实。未来如经审阅迁移可变事实，用来源段号、原文和key明确责任，并只初始化不存在的detail；已经更新的事实不被作者旧副本覆盖。导师、培养阶段等必要身份保留相应用途。使用`backgroundFor`的阶段在无批准映射时回退完整backgroundFile；正式表达调用只在批准映射时传入style，不因此接收完整作者背景。深度整理／固定信息审核使用维护快照，新周通知合同使用结构化通知资料，不另附作者背景。pending文件不能通过backgroundViewsFile启用。候选生成命令：`npm run memory:background -- 梁思璃设定.txt --mapping runtime/data/background-purpose-mapping-candidate.json`，输出仍是pending候选，不覆盖已批准文件。
