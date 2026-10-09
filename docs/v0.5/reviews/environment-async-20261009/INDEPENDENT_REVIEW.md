# 环境异步 E1～E5 独立复核

日期：2026-10-09。状态：已交付审查，产品未修改。源码基线：272437f → 2a6b9813ede36357d534b9749ba04e4babb4437d。依据：完整阅读 docs/v0.5/plans/environment-async/04_ENVIRONMENT_ASYNC.md 及 docs/DIRECTORY_POLICY.md。

结论：无 Critical；1 项 Important 工作量问题，1 项 Minor 合同缺口。建议先局部修正历史来源全文复制，再关闭 E 阶段。此次不包含产品修复或修复后重审。

## Important：来源存在性快照复制了历史消息全文

位置：src/environment/snapshot.ts:44–47（类型在17；后续使用在66、72）。freezeEnvironmentRetrieval 对全部候选的 sourceIds 调用 messagesByIds，保存完整 sourceMessages；后续只用其 ID。即使模型不调用 lookup，这些非 recent 历史正文也会在 Host 串行冻结期间解码、structuredClone、持久化，并随 step 状态更新重复序列化。它违背方案3.2的“捕获来源存在信息、不得为此读取全部历史消息正文”，使前台冻结成本及每日四阶段快照体积依赖历史原文长度，而不只是所需候选与 recent。

可重跑证据：`node --import tsx docs/v0.5/reviews/environment-async-20261009/evidence/independent-probe.ts`。单个当前 detail 候选引用100条历史消息、每条10,000字符，recent=0，仍保存1,000,000字符历史正文，整个 snapshot=1,021,238 bytes。这是结构性复制证据，不是实际部署延迟估计。现有 scripts/check-environment-async.ts:21 使用 sourceIds:[]，未覆盖这一成本；逐条 assertMessageSources 在V2还会重复进行活动窗口校验，本次未量化该额外成本。

局部建议：冻结候选来源的 ID/类型/存在信息，正文只保留合法 ordinary recent；来源一致性校验批量处理，避免对每个历史 ID 重扫相同活动窗口。提交存在性检查也采用轻量 ID 查询。补带历史来源且改变正文长度的工作量断言。

## Minor：实际返回的非消息来源未进入 read basis

位置：src/environment/snapshot.ts:16、44、66、72。owner.sourceIds 可包含 experiences 或 self_web_read_sources（见 src/memory/organize.ts、src/memory/lifecycle.ts），但 usedBasis 仅保存在 messages 表找到的 ID。因此返回 owner 所引用的 experience 被删除、owner版本未变时，lookupBasisCurrent 仍为 true；方案4.1的实际返回 source 存在检查不完整。

上述同一合成探针得到 usedOwnerCount=1，删除 experience-source 前后 basis 都为 true。这里直接对内存夹具删除来源；未证明当前正常前台/清理流程会独立删除 experience/self-web 来源，故不把它描述为日常已发生的数据错误。现有新测试主要使用 sourceIds:[]，未覆盖这类来源消失。

局部建议：按项目已有合法来源类别捕获存在信息，并只将实际返回 owner 的相关来源加入 usedBasis；在提交事务内检查这些来源仍存在。与上一项合并实现即可，无需增加通用任务或防御平台。

## 已核查与验证边界

检查覆盖：只读学校解析及共享 ranking 内核；Host释放前台及ready门禁；四阶段前驱；业务集合read basis；lookup checkpoint与basis同事务；稳定网页身份和累计配额；stop/晚回调lease；跨日时区；显式升级降级；轻量status/deadline。除上列问题，未发现可证实的新增阻断错误。

实际重跑：`node node_modules/vitest/vitest.mjs run tests/environment-async-host.test.ts tests/environment-async-recovery.test.ts tests/environment-async-tools.test.ts tests/environment-async-boundaries.test.ts tests/environment-async-phases.test.ts tests/environment-preparation-snapshot.test.ts tests/environment-async-upgrade.test.ts tests/environment-async-slots.test.ts`，8文件25项通过，3.05秒。独立探针输出见 logs/independent-probe.json。

未重跑整套801项、typecheck/build/demo/双场景smoke；那些结果由主任务提供，未冒充独立验证。未联网、未读取正式库或部署config/key/角色文本。探针仅内存库；没有修改产品文件。真实模型质量和长期在线表现不属于此次证据。
