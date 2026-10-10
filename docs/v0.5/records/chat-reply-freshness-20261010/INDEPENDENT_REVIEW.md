# 普通回复跟进新消息：独立全分支审查

日期：2026-10-10。代码范围：`3fb4e1c..82254ef`。实际验证工作树 HEAD 为 `84f8b48f84de1f84eb9dba03e47764b8983271c2`；已核实 `82254ef..84f8b48` 仅修改实施记录和两份文档链接证据，没有产品或测试变更。

本报告由 fresh-context reviewer 独立完成，遵循 requesting-code-review/code-reviewer.md。依据 [执行方案](../../reviews/chat-reply-freshness-20261010/EXECUTION_PLAN.md)、[方案审核](../../reviews/chat-reply-freshness-20261010/REVIEW.md)、[原方案](../../plans/chat-reply-freshness-20261010/README.md) 与 [实施记录](IMPLEMENTATION_LOG.md) 的 Ruling。只读检查产品、测试、历史及证据；仅新增本报告，没有修改产品、测试、配置、数据库或服务，没有网络、供应商或 QQ 调用。

## Strengths

- 选择时的 revision 随请求传递，输入落库和 revision 更新同事务。App 不会把选择之后才收到的新消息版本盖到旧输入集合上。
- 等待状态仍占用唯一 unfinished 身份；专用调度只允许等待轮重新绑定，同 ID 增加 generation。必要事件接管明确清空普通输入、批次和检查任务，并保留 event scope，故障恢复不重新套普通新消息门禁。
- 冻结和首次 sending 的判断都在同步事务内；sending 检查位于分段等待之后、sender try/catch 之外。未确认发送也锁定冻结，空输出则在冻结事务中封口。
- 新业务阶段键同时包含 generation 和 taskName。旧业务 checkpoint 压缩不触碰 incoming_image；个人来源按实际 personalRunId 过滤。测试使用真实 ModelClient、实际 DTO 与 SQLite 文件关闭重开验证关键边界。

## Issues

### Critical

无。

### Important

无。

### Minor

无需要修复的代码发现。

## 五项重点回归及代码核查

| 场景 | 独立核查与结论 |
| --- | --- |
| 1. 旧批 ready、新开放批剩 1 ms | `src/host/scheduler.ts:79` 的 foreground 在开放批存在时不选择普通未读或 check_messages；等待轮由 `:47` 同一 waitingDecision 供选择和期限查询使用。定向回归验证 14999/15000 ms；额外内存探针同时加入已到期 check_messages，在只剩 1 ms 时确认 deadline 等于 openBatch.readyAt，collectWaitingContinuation 仍返回 wait。没有旧回复抢跑或永久 now 空转。 |
| 2. 连续追加期间必要事件到期 | `scheduler.ts:51` 先选择 eventsOnly，排除 check_messages；接管返回空 inputMessageIds/batchIds。`app.ts:58` 改绑清理旧绑定后从当前提交状态重新绑定；完成只消费最终轮 batchIds 和候选任务。独立执行 appointment、school notice、睡眠/起床、事件失败后磁盘重开并再追加的用例，验证事件一次、原消息未提前已看、检查任务保留且随后处理。 |
| 3. 首次 sending 前后输入/崩溃 | `src/recovery.ts:13` 冻结事务先检查；`:35` 发送事务在 wait 后检查并持久 sealed/firstAttemptAt/sending，之后直接调用 sender。`src/app.ts:75` 恢复区分全 pending、已有尝试及 sealed 后处理。定向测试包括事务前输入、静默封口、真实文件重开、sending 已登记但尚未调用 QQ、未知发送结果、confirmed 尾段 retry，以及 post result 已保存但提交中断。额外探针验证普通 personal 返回 sharedChange.start 时，首次 narration sending 前新输入阻止活动开始，登记后新输入仍保留开始通知及冻结。 |
| 4. 换代检索/图片/最终来源 | `src/web/phases.ts:9` 为业务阶段换键；`app.ts:65` 仅压缩旧业务阶段；`src/memory/organize.ts:16` 过滤最终 personalRunId；`src/input-media/context.ts:8` 按本次 resources.messages 投影视图。真实 ModelClient 用例确认旧 lookup/repair/webMaterials/toolResults 不自动进入新阶段，缓存重新请求才获得新阶段成功计数；原阶段计数保留。实际 DTO 用例确认事件不可见旧图正文、ready/unrecognized 不重判、pending 保留原 asset/phase/checkpoint，新图获准后识别。 |
| 5. 等待跨睡眠/不可查看且 pending 清空 | `scheduler.ts:36` 睡眠准备清索引，`:56` 续普通前重判 canRead，`:111` 不可查看沿现有检查任务机制暂存；恢复选取完整 unreadMessages，不依赖 pendingBatchIds。除现有睡眠和事件导致 phoneAccess=false 的用例，另用仍处于 waiting 的同 ID 内存探针：到期后不可查看、索引清空、模型调用数 0；deadline 为活动结束时间；到期后重选 a/b 并提交为同一轮已看。 |

其他逐项核查：

- 昂贵阶段后的程序门禁：`app.ts:157,164,167,183,197,205,217,272,281` 覆盖上下文准备、叙事、图片准备、个人上下文/导演、表达、表情检索和最终返回；生成入口也检查。检查在模型阶段外，符合不取消在途 HTTP、不把内部控制中断交给 JSON 修补的裁决。
- 同代际故障恢复沿原 stageKey/runId；真实磁盘重开测试确认已成功页计数不刷新。20/40 默认上限与 WebSearchService 配额判断没有改动。新代际独立额度符合方案明确裁决。
- event scope 恢复在普通 revision 改变/openBatch 存在时继续原事件请求，不再进入 waiting 或重复选事件；磁盘回归验证 generation=2、事件完成一次。
- ordinaryInputRevision 更新位于普通输入事务分支，共同活动输入和控制输入提前返回，重复平台消息也提前返回。Storage.unreadMessages 的既有活动路由查询未变。
- waiting 释放 hold，重绑删除旧 dialogueBinding/chatBinding/activityContext 后重新计算；没有改四段窗口、消息正文、接收时间或原 batchId。最终提交才设置 seenTurnId、应用经历/任务/情绪/概率。
- 实施记录的跨活动测试 Ruling 合理：开放批期间原先用旧普通批启动 B 已不符合新合同；改为到期预约后仍保留 A 身份、B DTO 隔离及 A 最终只读取一次的断言。独立运行该文件通过。

## 独立验证命令与结果

工作目录：`C:\Users\<user>\.codex\worktrees\chat-reply-freshness\HDSI-remake`。测试与探针通过 require_escalated 在授权隔离工作树执行。

1. 定向测试，退出码 **0**，**7 文件 / 44 项通过**，耗时 6.58 s：

```powershell
node node_modules/vitest/vitest.mjs run tests/reply-freshness-scheduler.test.ts tests/reply-freshness-host.test.ts tests/reply-freshness-turn.test.ts tests/reply-freshness-context.test.ts tests/reply-freshness-recovery.test.ts tests/shared-v3-cross-activity.test.ts tests/web-recovery.test.ts --reporter=dot
```

原始输出摘要：

```text
Test Files  7 passed (7)
     Tests  44 passed (44)
Start at  17:12:20
Duration  6.58s (tests 77%, import 15%, transform 8%)
```

2. 独立内存探针，由 PowerShell 单引号 here-string 经标准输入运行 `node --import tsx --input-type=module -`，退出码 **0**。仅使用 modern fixture、InputBuffer、Scheduler、HdsiApp、node:assert/strict、脚本模型及 RecordingSender，无探针文件落盘。原始输出：

```text
PASS shared start before first sending
PASS shared start after first sending
PASS 1ms deadline, unreadable waiting with cleared pending, complete reselect
```

可复现步骤：输入 a、推进 15000 ms、取得普通请求；两次独立夹具分别在 personal_chat 返回 sharedChange.start 后、sender 收到首段时接收 b。断言前者无发送/仍 chat/waiting，后者首段 narration/已 shared_offline/sealed。第三个夹具在选中 a 后加入 b 进入 waiting，再加入已到期 unread check；推进 14999 ms 核对 wait/deadline；设置从当前时刻起 phoneAccess=false、60000 ms 后结束的活动，再推进 1 ms，核对 wait、end deadline、pending=[]、models.calls=[]、a 未读；到 end 选择 a/b，继续同 ID 并确认两条 seenTurnId 均等于该 ID。

3. `git diff --check 3fb4e1c 82254ef -- src tests`：退出码 **0**。
4. `git diff --check 3fb4e1c 82254ef`：退出码 **1**，只报告 records 原始测试日志的末尾空行/输出尾随空格，没有源码问题。不修饰原始失败或成功日志。
5. 探针前 `git status --short` 为空；确认 HEAD 与 `git diff --name-only 82254ef 84f8b48`，后续提交仅为文档证据。初次非提升 git status 因工作树访问权限失败；后续提升只读检查成功，不是产品失败。

没有重复全量 suite、typecheck/build/demo/smoke。已读 [full-final](logs/full-final.txt)、[typecheck-final](logs/typecheck-final.txt)、[build-final](logs/build-final.txt)、[demo](logs/demo.txt)、[smoke](logs/smoke.txt) 与交付说明；其中 184 文件/990 项等属于执行者证据，不冒充本审查独立运行结果。

## Recommendations

现有工程证据足以合并这批源码。共同活动开始首段边界与不可查看 waiting 的额外探针已通过；将来扩展该功能时可将这些探针转为永久回归，当前不据此要求追加实现或第二轮审查。

## Declined to judge

- 真实模型连聊的语义质量、供应商延迟、QQ 平台结果未知时是否实际重复投递：本审查按授权只做离线验证，没有访问外部服务；未知发送重试是方案保留合同。
- 物理断电/文件系统损坏及长期连续运行：验证限于同步事务检查、隔离 SQLite 文件关闭重开和故障注入，不能等同硬件故障验证。
- 正式进程是否已加载新构建及部署成效：本任务禁止操作正式服务/库/配置；交付明确尚未更新正式进程。
- 原始测试日志的空白规范：全分支 diff-check 已如实记录，按保留原始证据的要求不把它当产品修复项。

## Assessment

**Ready to merge? Yes（源码工程范围）。**

没有发现 Critical、Important 或需要修复的 Minor 问题。状态机、等待/事件续办、阶段身份/权限以及首次发送原子边界与明确裁决一致，独立定向回归及补充探针支持上述结论；该结论不代替正式部署或在线语义验收。
