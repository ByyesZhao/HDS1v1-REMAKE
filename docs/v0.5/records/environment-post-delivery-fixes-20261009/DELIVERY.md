# 环境交付后修复与正式库升级：关闭记录

日期2026-10-09，状态：已修复、已本地合入main、已停服备份升级正式库。产品基线cc963f8，原审查存档a935209；R1提交842a40e、R2提交a72e578；附加只读启动检查修复954a23e，合入与最终产品验证基线7821918。

## 关闭结果

| 项目 | 行为与验证 |
| --- | --- |
| R1／P2 | collectReady的await返回后重查stopped、paused、openBatch、unfinishedTurn；检查到环境启动／提交无await。阻挡时保留原ready／pending，解除后按原ID只提交一次，不误判stale或重复世界调用 |
| R2／P3 | 报告按准备版本缺失／0／1分类；已开始判定补attempt>0并与迁移共享。unstarted可与async重叠；升级写入、备份、幂等及降级规则不变 |
| 启动检查附加修复 | 正式升级成功后的真实检查发现只读MemoryStore构造器尝试安装缺失索引。runtime/check.cjs改为直接读memory_schema_version；schema3通过、schema2仍被拒绝，检查不创建索引、不写业务数据。正式可写启动的索引安装保留 |

原[ASTRA报告与方案](../../reviews/environment-async-20261009/post-delivery/REVIEW.md)的缺陷判断、未勾选清单与原日志属于cc963f8；本记录完成其R1／R2全部步骤和关闭条件。原结果不重写成通过。

## 验收及独立范围

- 基线先build再146文件804项通过（85.65秒）。R1先5失败／1控制，再5文件22项通过；R2先6失败／10控制，再16项通过。首次R1恢复测试误取event.id，改为实际change.id，失败记录保留。
- R1／R2完整147文件824项通过（94.40秒），类型／构建／demo／双场景离线插件通过；ASTRA原findings七组全部passed=true。升级探针检查备份还原、旧合同0／1、混批恢复、幂等和严格降级。
- [独立差异复核](../../reviews/environment-async-20261009/post-delivery/FIX_DIFF_REVIEW.md)7文件40项通过（10.60秒），无Critical／Important／Minor。范围a935209→a72e578，未覆盖其后才发现的启动检查问题，也未接触正式库。
- 启动检查新增2项真实子进程／缺失索引夹具先RED，再与smoke定向2文件9项GREEN，类型通过。随后工作树完整148文件826项通过（101.69秒），重跑构建／demo／插件通过。
- 最终主目录7821918完整148文件826项通过（96.96秒），[全量](logs/main-final-tests.log)、[类型](logs/main-final-types.log)、[构建](logs/main-final-build.log)。最终构建与源TS保持相同，demo／双场景插件结果见[最终演示](logs/final-demo.log)、[最终插件](logs/final-smoke.log)。
- [正式配置及启动检查](logs/runtime-check-after-upgrade.log)退出0：真实Koishi插件加载、正式本地配置及凭据验证、67表情包就绪；不启动服务、不调用在线供应商。

## 正式部署与保留数据

用户明确授权修复后升级正式库，覆盖原审核方案排除正式迁移的范围条款。升级前检查绝对和相对路径Koishi进程，均未发现运行中的Koishi。实际仅执行一次：

```powershell
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --check
npm run migrate:environment-async -- --database runtime/data/hdsi-remake.sqlite --apply --stopped --backup-dir runtime/archive/restore/environment-async-backups
```

实际调用对应同一CLI的node --import tsx入口，版本1→2。原库没有消息／故事轮／记忆，有67表情包及1批次4步骤；保留全部数据，没有重置数据库。

[升级摘要](evidence/formal-upgrade-summary.json)及[启动检查后复核](evidence/formal-postcheck.json)：DB／WAL／SHM均完整备份，备份可读且匹配原数据，quick_check=ok。除runtime.environmentPlanningVersion及environment_steps.preparationVersion外，所有表数据的规范化指纹、表数量及数据库结构保持不变；图库包括向量在内的完整行指纹保持。启动检查后再确认数据与结构不变。

备份目录：`runtime/archive/restore/environment-async-backups/environment-async-747a14d1-12c1-4554-8935-ab0467f6f6c3/`。完整本地指纹报告在`runtime/data/deployments/environment-post-delivery-20261009/upgrade.json`，不入Git、不默认送审。回退应配套旧代码与完整备份，不仅改版本字段。

## 过程、裁决与边界

过程见[IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md)，临时台账保存为[TASK_LEDGER.md](TASK_LEDGER.md)。

1. 按用户提供方案同批修P3；只修改报告分类及复用判定，代价为维护分类边界回归。
2. 按本轮明确授权执行正式升级；代价是协议标记变化，完整备份保留升级前状态。
3. 将部署后实际阻断启动检查的问题纳入本批最小修复；代价只涉及检查器的schema读取和两项回归，不扩展MemoryStore／Storage接口或手工写正式库索引。

没有延期审查问题。受限环境进程枚举／Git子进程失败单独保留，并在提升权限后完成只读检查，不冒充产品缺陷。原失败证据与各基线日志保留；没有第二次独立复核。服务继续由用户双击启动器手动运行；本批未启动QQ／SnowLuma、未调用供应商模型，也未验证真实聊天或长期在线表现。
