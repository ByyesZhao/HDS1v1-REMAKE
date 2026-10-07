# 记忆 V0.3 与共享搜索实施交付复核（DSH）

日期：2026-10-07。对象：记忆任务 1～7、搜索任务 1～6 的离线核心实现（39 个测试文件、177 项测试）。依据：[交付说明](IMPLEMENTATION_HANDOFF_20261007.md)、[记忆实施记录](MEMORY_V0.3_IMPLEMENTATION_LOG_20261007.md)、[搜索实施记录](WEB_SEARCH_IMPLEMENTATION_LOG_20261007.md)，四份规范（记忆细化／计划、搜索设计／计划）与 `src/`、`tests/`、`scripts/`。

方式：只读源码与文档，**没有运行测试、构建或服务，没有发起网络或模型请求，没有修改任何文件**。

结论：**这一版可以进入实机接入阶段。** 我抽查与两个专项线程复核的核心语义（两阶段提交、段 B 单点提交、记忆合同来源白名单、`self_web_read` 只开放短期、检索默认不限但先筛相关性、维护单槽与让出事件循环、搜索会话身份与 20/40 额度）都与规范一致，没有发现会导致数据损坏或规则失效的问题，也没有找到额度 off-by-one、计数持久化后被改、跨会话泄漏、工具结果冒充业务 JSON、未读 URL 进入白名单这几类缺陷。

**但接入真实搜索之前，建议先修三处健壮性问题**（都在第 5、6 节，都是"小改、后果不对称"）：

1. **5.1** 维护单元应用抛错时没有保护，会让 `ready` 任务以约 0 延迟无限重试同一单元；
2. **6.1** URL 归一化位于 try/catch 之外——今天不可达，但**接入真实 provider 的那一刻就会变成整轮失败**；
3. **6.2** 工具类请求会消耗格式修补额度，两次不合作即导致机器人暂停。

另需你知道一处行为取舍（**6.3**：已读尽的搜索会被记为一次 `no_candidates` 失败），以及第 2 节三处细节偏差、第 3 节一处 `webSources` 行为。

---

## 1. 已核对一致的关键语义

- **来源门禁分级正确**：`contracts.ts:90-92` 中 `shortTermChanges` 允许「基础来源 ∪ 本轮 personal_life 的 `self_web_read`」，而 `detailChanges` 与 `longTermChanges.awaken` 仍只用基础来源；`memoryTask` 同时校验 `awaken.id` 必须来自本次提供的长期 ID 集合，重复 ID 与重复 `clientRef` 被拒。`selfWebReadSources` 在 `organize.ts:22` 经 `turnId + phase==='personal_life' + sourceKind` 三重过滤，其他阶段拿不到该身份。
- **可见性门禁没有被搜索绕过**：`app.ts:96-97` 的叙事查询只在本轮为共同场景时并入消息正文，普通私聊的 `visibleSourceIds` 为空；因此归档正则不可能由未看消息触发，检索与搜索词都只能来自该阶段已合法取得的信息。
- **两阶段与恢复边界保持**：`recovery.ts:56-58` 的整理结果先落库（含 `memoryIds` 与 `selfWebReadSources`），`applyMemory` 在段 B 事务内调用（`recovery.ts:61-91`），`done` 仍是唯一写入点；`discardUnattempted` 不清理 web 阶段与计数，符合「重生成不补额度」。
- **维护单槽与让位**：`maintenance.ts:43` 的 `startOne` 在已有 `ready` 或 `active` 时直接返回 false，只把 `pending` 置为 `computing`；`applyOneReady` 全程在一个同步事务内完成索引写入／单元应用与 job 标记（:67-79）；配置签名不匹配的索引待办在空闲时逐个标 stale，不占用网络槽。
- **配额与缓存归因**：`service.ts:22` 的额度检查在启动操作前；`:46-53` 依次处理「本会话已持有 → 不扣额」「公共缓存首次取得 → 计 1 次成功」「新读取失败 → 计 1 次失败」，公共缓存的 key 为 `provider 签名 + URL` 且按 owner（`turn:<turnId>`）分桶，`finishPostprocessing` 后 `releaseOwner` 释放——与我上一轮指出的「同一轮内跨阶段各计一次」完全一致。
- **默认不限但先筛相关性**：`lexical.ts:10-13` 的 `lexicalCoverage` 逐句计算有效词覆盖率，`retrieval.ts:35` 用 `score >= calibration.lexical[fact|experience]` 作为门槛；RRF（k=60）只对已合格候选排序（:44-47），固定条数上限默认 `null`。

---

## 2. 发现的三处偏差

### 2.1 `budget()` 的「当前来源不参与裁剪」实际不生效（ID 类型不匹配）

`retrieval.ts:73`：

```ts
while(countVisibleCharacters(JSON.stringify(result))>budget){
  let i=array.length-1;while(i>=0&&protectedIds.includes(array[i].id))i--;
  ...
```

调用方传进来的 `protectedIds` 是**消息 ID**（`context.ts:10,14` 传 `request.permissions.visibleSourceIds`；`app.ts:97,118` 传的是本轮消息 ID 列表），而被裁剪数组里的元素是**记忆候选**，其 `id` 是 `short:<turnId>:short:0` 这类 owner ID。两者永远不相等，因此「本轮来源最不容易被裁掉」这条保证没有实现——裁剪总是从数组尾部盲删。

影响有限（`historyBudget` 默认 `null`，只有用户显式设置预算时才会走到裁剪），但既然规范专门写了这条保护，建议改成按 `row.sourceIds` 与 `protectedIds` 求交集判断，或在文档里注明「当前来源保护尚未生效」。

### 2.2 归档入口由查询文本的正则决定，模型的结构化请求几乎不可能生效

`retrieval.ts:12-17`：

```ts
const wantsArchive=(q:string)=>/还记得|回忆|那次|去年.*(?:生日|经历|考试)/.test(q);
const allowArchive=!currentOnly&&wantsArchive(query);
```

- 规范要求「程序依据该阶段**实际可见的当前话题**建立权限，而不是让模型任意开放档案」。现在程序确实没有让模型开放，但它用**正则匹配查询文本**代替了「按可见话题判断」，语义上比规范更窄也更机械。
- 由此产生一个死锁：`lookup()`（:65）要求 `wanted.scope==='archive'` 必须已被 `base.permissions.allowArchive` 允许，而 `allowArchive` 只由上面那个正则决定。于是模型主动提出 `{query, scope:'archive'}` 的结构化请求**永远会被拒绝**，除非它查询里恰好含有那几个词——也就是说 `LookupRequest` 里的 `scope` 字段在现有实现下几乎不可达。
- 我确认叙事查询不会把未看消息带进来（第 1 节末条），所以这不是可见性漏洞；但它是一个**功能死锁**：要么在文档里明说「归档只由程序正则开启，模型不能申请」，要么让 `lookup` 接受模型申请、但仍以本阶段可见主题为界（例如要求查询词必须出现在本阶段可见文本中）。

### 2.3 `excludedByLimits` 指标重复计数

`retrieval.ts:60`：

```ts
this.metrics.excludedByLimits=ranked.length+always.length-this.metrics.selected;
```

`ranked` 已经在 `:48` 把 `always`（常驻投喂项）拼在末尾，所以 `+always.length` 把常驻项算了两遍；`selected` 又只统计 details／short／long／learned 四个数组。这个指标会出现在 `hdsi.status` 的观测概况里，建议把 `always` 从 `ranked.length` 里剔除，或直接改成「`candidates - selected`」。

---

## 3. 接入前需要用户知情的一处行为

**已配置的 `webSources` 会被注入每一次搜索的候选池。** `web-runtime.ts:7` 把 `settings.webSources` 作为 `initialSources` 传给服务，`service.ts:36` 又把它并进每个搜索操作的 `candidateUrls`。默认 `requestedPages=1` 时不会读它（第一个候选就是搜索结果首位），但只要模型请求多页，就会读到配置里那些 URL——即使该阶段并不需要。规范里「来源URL列表可优先作为候选」是允许的，但「优先」实现成了「总是排在最前并占用页数」，建议在文档里注明，或改成「仅当搜索结果不足 `requestedPages` 时才回落到配置来源」。

---

## 4. 与交付说明一致、无需处理的部分

- 「禁用搜索仍保存阶段私有检查点」：`phases.ts:5` 在 `web` 未装配时返回 `web:null`，此时 `client.ts:16` 用默认检查点、`:19/:26/:49` 的 `save()` 都是空操作，因此不会写入私有输入；而当 `web` 服务存在但 `enabled=false` 时（`service.ts:17` 的 `available=false`），检查点会照常持久化——与交付说明第 4 条取舍的表述相符。
- 「先定义阅读来源再接搜索」：`self_web_read` 的身份、阶段绑定与恢复复用都已在记忆侧固定，搜索侧只负责登记，符合两阶段顺序。
- 「稳定认识保留结论并附新依据」：`projectionBasis` 进入索引文本（模板已升到 `memory-v3-text-2`）并在合同里校验 `sourceIds` 属于快照来源。
- 「以备份和日志替代 Git」：`runtime/implementation-backup-20261007/` 与两份 ledger 的存在与说明一致；我没有检查备份内容。

---

## 5. 补遗：维护协调器与宿主专项复核

以下由专项线程复核后交回，我已逐条回到源码确认。**修正记录：本节初稿把"受污染的待办任务造成 0 ms 空转"列为严重缺陷，该判断错误——`maintenance.ts:72` 的 `saveJob(status:'done')` 在 `valid=false` 时也会执行，因此索引任务在任何 owner 状态下都会被终结，不存在永久 `pending` 的环路。该条已撤回（见 4.3）。真正需要处理的是 4.1。**

### 5.1〈中·已确认〉单元应用抛错后没有任何保护，会形成 0 ms 重试环

`applyOneReady` 的整体是一个同步事务，但**没有 try/catch**：

```ts
// maintenance.ts:67-81（节选）
return this.store.storage.transaction(()=>{
  ...
  const valid=unit.readSet.every(ref=>this.store.owner(ref)?.stateVersion===ref.stateVersion);
  if(valid)this.applyUnit(unit,job,now);      // ← 可抛：:84 owner 断言 / :88 / :90
  ...
  this.store.saveJob(work.table,{...job,...}); // ← 抛错时不会执行
});
```

`applyUnit` 会抛出的情形至少三种：`:84` 的 `this.store.owner(r)!` 断言失败、`:88` 的 `merge requires long identities`、`:90` 的 `cannot discard awakened memory`。异常直接冒泡到宿主（`runtime.ts:32` 只交给 `onError`），于是：

1. 该 job 的单元既没有被标 `applied` 也没有被标 `stale`，`lastError` 也没写，job **永远停留在 `ready`**；
2. `nextDeadline` 因为存在 `ready` 而恒返回 `now`（`maintenance.ts:102`）→ `runtime.ts:64` 算出 `wait = 0`；
3. `pump` 每轮调用 `applyOneReady` → 抛错 → `wake()` 的 `.catch` 交给 `onError` → `finally` 里 `armTimer` 再排一个 0 ms 定时器 → 立刻再次唤醒。

结果是**约 0 延迟的重试环**：日志被同一错误刷满、事件循环持续空转，维护队列再也无法前进（其他单元排在同一个 `ready` job 后面）。这需要较不寻常的状态才会命中——正常路径下 `:76` 的 readSet 校验会先判 `stale` 而不进入抛错分支——所以它属于"未加保护的失败路径"，不是高概率必现缺陷；但一旦命中就无法自愈。

建议修法：把 `applyUnit` 单独包进 try/catch，失败时把该单元记入 `staleUnitKeys` 并写 `lastError`（必要时按 `retryAt` 退避），使 job 仍能终结；这同时把"0 ms 空转"的真实来源一并堵掉。

### 5.2〈中〉`recover` 只恢复一轮

`runtime.ts:46` 在恢复后把 `this.recover=false`（`:48` 再置一次），因此恢复过程中若又出现新的未完成轮，本次会话不会再次恢复，只能等下一次 wake。规范 §8 的"旧故事优先"比这更宽，建议要么在恢复后重新检查 `unfinishedTurn()`，要么在文档里写明"一次启动只自动恢复一轮"。

### 5.3〈已撤回〉关于"受污染待办造成 0 ms 空转"的判断

初稿据"`nextDeadline` 对任何 `pending` 都返回 `now`（`:103`），而 `startOne` 要求索引任务签名匹配（`:45`）"推出：签名不匹配的 `pending` 索引任务会既不能启动、又不被终结，从而形成空转环。**这个推导错了**：`:66` 会把"`pending` 且签名不匹配"的索引任务交给 `applyOneReady`，而 `:72` 的 `saveJob(status:'done', completionReason:'stale')` 在 `valid=false` 时同样执行，只有 `:71` 的 `queueIndex` 是条件分支。owner 为 null、`merged` 或 `discarded` 时，任务只是退化为 `stale` 并终结。因此不存在该环路。

保留一个**低优先级**的观察：`nextDeadline`（`:103`）与 `startOne`（`:45`）确实用了两套"可运行"判据，将来若有新的任务类型只满足其一，就可能重现同类空转；建议让两者共用同一判定，或在 `armTimer` 对 0 延迟加一次保护。

### 5.4 文档与测试证据的三处不符

1. **`modelRoles` 计数**：交付说明与执行计划写"新增任务后模型总数更新为 11 项"，而 `src/settings.ts:9` 的 `modelRoles` 实际是 **10 项**（`narrative, narrative_shared, personal_chat, personal_life, personal_shared, expression, memory, memory_consolidation, world, school`）。原十项里的第十项是 `stickerDescriptionModel`，它是独立可选字段而不在数组里，所以 10 + 1 = 11 才是准确写法。建议把文档改成"`modelRoles` 十项 + 贴图描述一项"。
2. **`§7.2` 的 2/3 步次序**：实现是"先判未完成旧故事（`runtime.ts:44`）后判 paused/stopped（`:43` 提前 break）"，规范文本是 2→3。因为 `:43` 会先 break，实际无功能后果，但文本与代码需要二选一对齐。
3. **"无 0 ms 空转"的测试是空断言**：`tests/memory-v3-host.test.ts:53` 只在 `maintenance.active` 非空时断言不唤醒，而 `nextDeadline` 在 `active` 时本来就返回 `null`（`:102`）。真正会产生 0 ms 的场景（4.1）没有被覆盖——这与交付说明"已证明无 0 ms 空转"的主张不符，建议在修完 4.1 后补一条"`ready` 单元的 `applyUnit` 抛错"用例。

### 5.5 其他可改进（不影响本次交付）

- `requested` 是死字段：`runtime.ts:12/26/29` 有写入与使用，但 `pump` 循环只在 `:41` 每轮开头清零、从不读取，`:53` 的继续分支也不检查它。规范 §7.2／§7.3 期望的"新输入到达即让路"因此没有落地——不构成饥饿（每单元后真实让位，`openBatch` 关闭后前台立即接管），但长积压不会被分片。建议要么在 `:53` 前检查 `requested` 优先回前台，要么删掉该字段并在文档里改成"按单元分片让位"。
- `wake` 的重入窗口：`runtime.ts:27-30` 的 `.then()` 在 `finally` 把 `this.active` 置空之前运行，理论上可并发启动第二个 pump；当前路径不可达，但建议把"置空 + 启动"放进同一临界区。
- `done` 任务永不清理（`maintenance.ts:72/75/80` 只改状态），而 `work()`（`:21`）每次全表读取再排序；长期运行后建议归档或删除 `done`。
- `armTimer` 的 24.8 天上限（`runtime.ts:64`）会产生一次无意义唤醒，功能无损。

### 5.6 这一节的总体判断

**"维护不遮挡聊天"这一核心保证站得住**：后台槽只限 computing（`maintenance.ts:43/46-47`，同步占槽无 await 间隙）、`startOne` 不 await 远程（`:42-49`）、完成后只写 `ready` 并唤醒宿主（`:59-62`）、正式记忆一律由宿主在空闲扫描里按单元同步事务应用（`:67-81`）、每单元后真实 `setImmediate` 让位（`runtime.ts:53`）、`pause`/`stop` 在宿主侧先行闸死（`:51`、`:94-99`）、`storage.close` 严格在 `await host.stop` 之后（`index.ts:104`），晚到结果被 `stopped` 守卫丢弃。没有发现"维护被应用两次""事务非原子""关库后回调写入""`setImmediate` 实为微任务""维护推迟到期故事轮"这五类问题。削弱该保证的只有 4.1 的无保护抛错（会造成 0 ms 重试环与队列卡死）与 4.5 的 `requested` 死字段（不会饿死聊天，但让位粒度未按设计分片）。

---

## 6. 补遗：共享搜索子系统专项复核

同样由专项线程交回、我逐条回源码确认。**两处已证缺陷都与"真实 provider 接入"直接相关，正好落在你列出的待办项上。**

### 6.1〈中·已确认〉URL 归一化在 try/catch 之外，接入真实 provider 后会变成整轮失败

```ts
// service.ts:32-38
if(op.candidateUrls===null){
  let candidates:Array<{url:string;title:string}>;
  try{ ...candidates=await this.provider.search(...) }        // ← 只有这一小段在 try 里
  catch(error){ ...commitStep(reason:'search_error'); return finish(...) }
  const urls=[...new Set([...this.initialSources,...candidates.map(c=>c.url)].map(normalizeWebUrl))];  // ← 在 try 之外
```

`normalizeWebUrl`（`content.ts:4`）对非 http/https 或不可解析的 URL 会 `throw`。因此只要 provider 返回一个坏 URL（相对路径、`data:`、空串）或返回的不是数组，就会在 try 之外抛出：`execute` 直接 reject → `client.ts:25` 的 `perform` 抛出 → `runModel` 失败 → **整个阶段（进而是整个回合）失败**；而且这一步**不计任何失败次数**，操作停留在 `status:'running'`（`:31` 已保存），重放时再次抛出。

一处更正：线程原本还举例「`settings.webSources` 里的 `ftp://` / `file://` 会先通过校验再爆炸」，我核对了 `zod@4.6.5` 的实现——`z.url()` 在未显式给出 `protocol` 时要求 http/https（`node_modules/zod/v4/core/schemas.js:234`），所以这条不成立。**剩下的唯一入口就是真实 provider 返回的 URL**，也就是说：这条缺陷今天不可达（`index.ts:33` 禁止启用搜索），但它恰好会在你接入搜索服务的那一刻生效。

建议：把 `normalizeWebUrl` 的调用移进 try（或对每个 URL 单独 try 并计一次 `read_error`），过滤掉非法项后继续。

### 6.2〈中·已确认〉工具类请求会消耗格式修补额度，最终导致暂停

`client.ts:39-40`：

```ts
operation=parseWebTool(value);
if(operation&&!tools.web)throw Error('web tools unavailable or quota reached; return final task JSON');
```

这句 `throw` 位于 `:37-50` 的 try 内部，于是被 `:47-49` 当成格式错误处理：`checkpoint.repairCount++`；累计到 `repairLimit`（2）后抛 `ModelFormatError` → `app.ts` 的 catch 把 `runtime.paused=true` 并发送系统 `error`。同样地，工具参数非法（例如 `requestedPages:0`，`content.ts:6`）也会走同一条修补路径。

规范 §5／§9 明确写了「工具请求不当成最终 JSON 合同，也不消耗格式修补额度」，所以这是**与文档直接冲突的误路由**。触发概率不高——额度耗尽后 `tools.web` 变 false、工具 schema 也随之从提示里撤下（`client.ts:63`），合作的模型会直接输出业务 JSON——但两次不合作就会把整个机器人暂停，代价与概率不对称。

建议：把「工具不可用／额度已满」和「工具参数非法」作为**工具反馈**回给模型（记一次工具失败或直接回一条提示），只有真正不符合任何分支的响应才计入修补。

### 6.3〈与文档不符〉已读尽的搜索被记为 `no_candidates`

`service.ts:44-56`：如果一个搜索操作的所有候选 URL 都已在本会话读过（`:47` 只推进游标、不产生材料），操作结束时 `:55` 会以 `reason:'no_candidates'` 记一次失败。规范 §3.2／§3.3 要求「同会话已持有材料的重放代价为 0」，且这里的 `no_candidates` 事实描述也不准确（候选存在，只是已读）。

这是**有意选择**（`tests/web-session.test.ts:37-38` 用 "rather than spinning for free" 明确了这个行为），材料本身仍会通过 `webMaterials` 再次投喂。后果是：模型若重复同一个查询，最多可以烧掉 40 次失败额度并让该阶段失去搜索工具。建议至少在文档里写明这一条，或把这类操作计入一个不计费的"已读尽"结果。

### 6.4 其余三处形式性偏差（不影响正确性）

1. **完成标记是独立事务**：材料／计数／步骤位置在一个 `BEGIN IMMEDIATE` 里（`store.ts:36-42`），而 `service.ts:28` 的 `finishOperation` 是另一个事务；规范 §3.1／§3.3 写的是「材料、已确认计数和操作完成标记同事务保存」。两者之间崩溃会被 `store.ts:37` 的步骤去重自愈，所以只是形式偏差。
2. **新操作不重用候选缓存**：`service.ts:32-38` 对相同 query 的新操作会重新调用 `provider.search`（规范说可以复用候选缓存）。搜索调用不计额度，只多一次网络请求。
3. **`checkpoint.repair` 从不清除**：`client.ts:34` 之后 `repair` 一直保留，续调用与恢复都会把最初的坏响应与错误再发一遍——只是提示词噪声。

一处可改进：`organize.ts:10` 的 `selfReadSources(turnId)` 不带 `runId`，会返回该 owner 下所有运行的来源；当前只有一个 `personal` 槽位会写 `personal_life` 来源，所以安全，但建议按本轮 run 限定。

### 6.5 该子系统已核验干净的部分

线程逐项做了否定证明，我抽查后认可：额度判定全部用 `>=` 且在启动 provider 之前（`service.ts:22,30,44`、`client.ts:31`），每次循环只提交一个互斥步骤，不存在 20/40 的 off-by-one；计数只在事务内写入、快照每次都重新 `JSON.parse`，没有"持久化后再改计数"；材料、`providedMaterialIds`、操作均按 `runId` 查询，公共缓存按 `ownerType:ownerId` 分桶并在 owner 结束时释放，未发现跨会话泄漏；工具形状的响应在 `task.parse` 之前被拦截，原始 `WebSearchResponse` 无法通过任何业务 schema；环境白名单只由**已提交且已提供**的材料组成，`markProvided` 拒绝未知 ID，失败读取的 URL 会被合同拒绝。`self_web_read` 两端都对：登记只在 `taskName==='personal_life'` 且材料已实际交给模型之后（`client.ts:35`、`store.ts:49-52`），记忆侧只开放给 `shortTermChanges`（`contracts.ts:90` 对比 `:91-92`）。

### 6.6 两处静态阅读无法确认的边界

1. **"网页内容不得变成第一人称经历"**：叙事／个人／表达三个合同的入参里没有来源标注字段，因此网页文字被写进 `experiences`、`parts` 或 `innerThought` 时，程序无法识别——目前只靠系统提示词约束（你在实施记录里也这么标注了）。更值得注意的是：一条由网页内容派生的 `experiences[]` 会成为记忆阶段的合法 `sourceId`（`organize.ts:17,41` → `contracts.ts:88`），也就是一条程序无法检测的"洗白"路径。这不影响本次交付，但接入真实搜索后建议专门观察。
2. **真实 provider 与真实模型行为**：坏 URL 的形状（6.1）、额度耗尽后模型是否仍反复要工具（6.2／6.3），都只能等真实接入后才知道。

---

## 7. 补遗：记忆存储与生命周期专项复核

最后一路线程的结论，我已抽查其中的关键断言。

### 7.1 核验结果：§2～§5 的规则逐条一致

行身份（`lifecycle.ts:16-20` 的确定性派生，重放保持同 ID）、`stateVersion` 的完整递增（内容／计数／期限／合并／状态／投影）、窗口锚点（`normal` 从 `shortExpiresAt`、`high` 从 `at`、生效前的进展只改未生效锚点、生效后只改正文不重开窗口）、唤醒去重（`store.ts:88-92` 的 UPSERT 保留最早 `firstEffectiveAt` 与其 `turnId`、来源并集；`lifecycle.ts:79` 的 `totalAwakenings` 取去重日期数；durable 只累计不续期；归档重新激活的日期被消费进 `reactivate` grant 的 `triggerDates`，不会再进入下一续期窗口）、合并六条子规则（按日期聚合 → UPSERT → 删副行、副本留 `mergedInto`、durable 不降级、grant 只重指向不新建、不用 sum/max、只重放最后一个已授予窗口之后的日期）、迁移幂等（`store.ts:21` 的版本标记、`legacyMentions` 冻结、重复执行 byte-identical）——**都没有发现数据损坏、off-by-one、越出事务或非幂等的问题**，时间边界的取等号方向（`shortExpiresAt` 用 `>`、`retainedFrom` 用 `<=`、`expiresAt` 用 `>`）也逐个核对过。

### 7.2〈唯一可证行为偏差〉归档范围绕过了 `retainedFrom`

```sql
-- store.ts:62-65
... (kind='long' AND status!='durable' AND
     (? OR (julianday(retainedFrom)<=julianday(?) AND julianday(expiresAt)>julianday(?))))
```

第一个 `?` 是 `archive` 标志（`store.ts:69` 传 `archive?1:0`），**同一个短路同时作用在短期分支的到期判断和长期分支的 `retainedFrom` 窗口上**。因此当查询命中归档正则（`retrieval.ts:12`，例如用户可见消息里出现"还记得那次考试"）时，`scope='archive'` 会让一条**尚未生效的预备长期**（`retainedFrom = at+7d`，创建仅一天）直接进入检索结果，模型可以看到并唤醒它。

这与两份权威文档冲突：记忆细化 §3 写的是"在 `retainedFrom` 前不提供"，§6.2 要求"检索按 `retainedFrom`／当前 owner 状态决定"；而执行计划第 80 行只要求"未生效……不进 current"，对归档范围没有表态。所以这更像**需要一次文档裁定**，而不是静默修掉：

- 若细化优先：补一个谓词，让归档范围同样尊重 `retainedFrom`（未到生效时刻的记录只在"明确追问 + 已到生效"时才给），或至少不进默认上下文；
- 若计划优先（归档本就该给出全部未合并历史）：在细化 §3/§6.2 里写明"归档范围故意包含尚未生效的预备长期"。

要说清后果有限：它不会造成数据损坏，也不会制造错误续期——提前发生的唤醒会计入 `totalAwakenings`，但续期的待处理下界是最近的 grant 锚点（`lifecycle.ts:77`），所以那个日期不会进入续期窗口。实际影响是"提前暴露"与"略微虚高的常驻候选证据"。

### 7.3 需要留意的一处语义缝隙

学习投影（stable_understanding）在合并时**不会**跟着去重：`lifecycle.ts:96-99` 只对 `durable_experience` 做处理，因此合并两条各自持有稳定认识的记录后，会留下两条 `canonicalMemoryId` 相同的 active `learned` 行，检索会把它们都返回。这不会破坏期限或计数，但同一认识会重复出现。建议在合并流程里一并处理，或至少记一条文档说明。

### 7.4 字母级偏差与可改进（不影响期限／常驻结果）

- `revision` 有三处多增：短期 `update` 把 `eventSummary` 当作文本变化（`lifecycle.ts:36`，但索引文本并不含它，`store.ts:81`）、合并无条件 `+1`（`:89`）、副本投影改指时无条件 `+1`（`:98`）。三者都只是多算一次 embedding，不会漏掉必需的重新索引。
- 合并只保留最早的 `happenedAt`（`:89`），而 §4.3 要求保留"事件时间范围"；`lastEventUpdateAt` 也没有合并。
- `promote()` 没有把 `windowAwakenings` 归零（`:122`），要等下一次唤醒触发的 refresh 才归零。
- **模型 DTO 的控制字段被写进 owner 行**：`lifecycle.ts:21,37` 用 `...change` 展开，于是 `action`、`clientRef`、`existingLongId`、`hasNewEventProgress` 都存进了 `MemoryCandidate`，并会随检索回送给后续模型（`retrieval.ts:20` 只剥掉 `normalizedVector`）。§2.3 的字段归属表把控制字段划给模型合同而不是记录，建议落库前挑字段。
- `post_jobs.memoryIds`（`recovery.ts:57-58`）写了但全库无人读取；生命周期自己按冻结结果确定性重推 ID，行为等价，属于死字段。
- `lifecycle.promotionCandidates`（`:105`）与 `store.maintenanceCandidates`（`:96`）是两份候选查询，前者只有测试在用。
- 两个窗口移动分支缺少 `status!=='durable'` 守卫（`:31,44`）：当前不可达（durable 需要 30 个日期，不可能出现在 7 天预窗口内），但一旦可达会让 durable 记录重新长出 `expiresAt`。
- 同一天重复唤醒仍会 `stateVersion++`（`:79`），使已准备的维护单元作废；空操作的 `refine` 也会（`maintenance.ts:99`）。
- `queueIndex` 在首次装配前会创建 `unconfigured` 的任务（`store.ts:78-83`），之后逐个标 stale。

### 7.5 与本次交付的关系

第 7.2 条需要一次文档裁定（或补一个谓词），第 7.3 条建议记录，第 7.4 条都不影响期限与常驻判定，可以后续处理。存储与生命周期层没有发现会损坏数据或破坏恢复语义的缺陷。

---

## 8. 本次审核的边界

**没有做**：运行测试／构建／demo／smoke；连接 QQ 或任何模型、搜索供应商；核对 177 项测试的实际通过情况；打开备份目录或正式数据库；审阅 `梁思璃设定.txt`、`config.local.json`、`key.txt` 等私有内容。

**因此无法验证**：测试断言与真实行为是否一致（例如配额边界的 19/39 用例）；真实 Qwen 标定后的语义阈值效果；搜索 provider 接入后的真实读取与正文整理质量；生产库迁移后的实际数据形态（生产库当时的 `memories=0 / details=0`，所以旧数据转换路径只在夹具上跑过）；以及「维护不遮挡聊天」在真实网络延迟下的表现（我只确认了控制流与 `setImmediate` 让位写法）。

三个专项线程已全部回报，结论分别并入第 5、6、7 节；没有未决的补遗。若要一句话概括本次审核的结果：**实现忠于规范，唯一需要裁定的是 7.2 的归档范围是否应当绕过 `retainedFrom`，另外三处建议在接入真实搜索前修掉（5.1、6.1、6.2）。**
