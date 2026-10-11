# R4b 独立审查

结论：**PASS**。初审发现的 P2 缺表兼容问题已修复，并经独立复核；当前无未解决的必须修改项。

审查时间：2026-10-11。按 R4b-brief.md、R4b-report.md 和当前工作区实际实现审查。范围为报告列出的 3 个产品文件和 2 个测试文件，同时读取纯 helper、MemoryStore 默认调用及原 recovery matrix。遵照任务限制，没有执行 Git 命令、全量测试、构建、正式库访问或网络调用，也没有修改产品源码。

## 初审发现与修复（已关闭）

### [P2，已修复] 缺少环境表但含网页表的旧库因静态 SQL 引用失败

初审位置（修复前）：`src/memory/payload-compaction.ts:17`（webSessions 条件引用 environment_steps）、`:32`（计数调用）；apply 和 hasMore 也复用该条件。

R4b 明确要求缺少 environment 表的旧库报告 environmentSteps=0 且不建表。但初审实现只对新增环境计数分支检测表是否存在，原网页类别的 SQL 仍无条件包含 `FROM environment_steps`。SQLite 在准备语句时解析这项引用，因此即使 web_sessions 是空表也报错，dry-run 和 apply 的预检均无法完成。

独立最小复现：在内存库仅建立 `turns`、`memory_maintenance_jobs`、`web_sessions` 三张空 JSON 表，然后调用 `countCompletedPayloads(db, {includeEnvironment:true})`。实际结果为 `Error: no such table: environment_steps`，期望为所有计数为 0、没有环境表和环境索引被创建。

初审新增的 absent-table 测试只建立 memory_index_jobs，未覆盖保留 web_sessions 的旧库。初审要求：根据已存在 owner 表构造网页残余条件（缺失 owner 表的分支应不匹配），并让 count、apply 和 hasMore 使用一致规则；不要通过创建缺失表来规避。至少新增含网页表、缺环境表的 inspect/apply 回归，并保留默认 scope。

## 已独立确认

- 默认选项不选择环境正文；MemoryStore 构造及 compactCompletedPayloads 默认调用均不传 includeEnvironment，缺 at 校验在任何更新前执行。
- SQL 环境选择限定 preparationVersion=1、committed/superseded、三个正文任一非 null。计数不在 JS 中解析环境 JSON；独立 JSON.parse 计数探针证实计数为零次解析。
- 四类原残余与环境行共用预算。独立混合样本 2 个 index + 7 个 environment，limit=3 返回总更新 3，其中环境 1；实际仅 JSON.parse 1 行。
- environment_payload_residual 仅在显式 opt-in 安装，实际 EXPLAIN QUERY PLAN 返回 `SCAN environment_steps USING INDEX environment_payload_residual`。
- 每条环境更新通过已接受的纯 helper 同时生成摘要和清除三个正文，一条 UPDATE 写回；wrapper 每批 BEGIN IMMEDIATE/COMMIT，异常 ROLLBACK。
- 独立故障探针将失败设在第二批的第二行，确认该批第一行已执行的 UPDATE 也回滚，第一批 2 行保留，3 行残余保持原 JSON；移除触发器后续跑恰更新 3 行，第一批审计字节不变，随后 no-op 无备份。
- 已运行 CLI 回归确认默认 dry-run、--include-environment、--stopped 门禁、3×2 混合预算、续跑、完整正文备份可读、已有 WAL/SHM 复制、业务表/旧协议/非终态行保留。

## 初审验证证据（保留）

命令（TEMP/TMP 均指向 `D:/HDSI-remake/.tmp/r4b-review`）：

```powershell
npx vitest run tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts tests/memory-payload-recovery-matrix.test.ts tests/environment-payload-compaction.test.ts --maxWorkers=1
node --import tsx .tmp/r4b-review/probe.ts
```

- Vitest 退出 0：4 个文件、48 项测试通过。输出中的缺 --stopped 异常是 CLI 负向断言的预期结果。
- 独立探针退出 0，其 assertions 覆盖预算/解析、索引执行计划、中途 rollback/resume/no-op；缺表错误单独捕获并记录，是本审查的失败证据，不能把探针退出 0 解读为该场景通过。
- 探针源码：`.tmp/r4b-review/probe.ts`；结果：`.tmp/r4b-review/probe-results.json`。全部数据库均为本次独立生成的合成库。

初审要求的缺表修复和复核已完成，见下节。

## 修复复核与最终证据

- 重新读取修改后的实现和新增回归。`specs(present)` 仅纳入实际存在的网页 owner 表，缺失 owner 表时无法证明终态，因此保留 checkpoint；缺 turns 的 post_jobs 同样保留。count、apply 与 hasMore 都使用相同生成规则，未创建任何缺失表。
- 重新执行原缺环境表探针，并将预期改为硬断言：全部计数为 0，apply 总更新为 0、hasMore=false，sqlite_master 无 environment 表或索引。通过。
- 加测完全缺失 owner 表、仅存 web_sessions 与 post_jobs 的合成库：计数和 apply 均成功，未知 owner checkpoint 和 post result JSON 字节保持不变。通过。
- 新增产品回归验证存在的 turn/maintenance owner 正常清理，两批之间 hasMore 从 true 变 false；缺失环境 owner 和未找到的 turn owner 原字节保留。
- 独立预算/JSON.parse 数量、partial index 查询计划、第二批第二行故障整体回滚、续跑及 no-op 探针再次全部通过。

复核命令（仍使用工作区 TEMP/TMP、maxWorkers=1）：

```powershell
node --import tsx .tmp/r4b-review/probe-fixed.ts
npx vitest run tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts tests/memory-payload-recovery-matrix.test.ts tests/environment-payload-compaction.test.ts --maxWorkers=1
```

两条命令均退出 0；最新测试结果为 **4 文件、49 测试通过**。复核探针结果保存在 `.tmp/r4b-review/probe-fixed-results.json`，原失败证据 `.tmp/r4b-review/probe-results.json` 保留未覆盖。此次审查确认 R4b 规定范围内实现和回归满足要求；没有访问正式数据或执行部署操作。
