# 最终交付就绪性独立审查

日期：2026-10-11。状态：**专项计划覆盖可接受；最终工程门、Q3工具独立复核和正式部署门仍由root完成后关闭**。

本报告是交付前的只读审查快照，不是最终全仓代码审查、全量通过证明或部署成功证明。阅读了全部六份实施计划、当前records全部摘要及23份专项review，并抽查相应源码、CLI参数和恢复矩阵。未执行Git命令、测试、构建、主检索评价、线上请求；未访问正式数据库或私有配置。唯一写入为本报告。提交号来自root提供的实施上下文、台账与交付记录，未自行验证Git祖先关系。

## 结论

- R1/R2、W1–W7、R3/R4a/R4b、M1/M2及M-D探针均有可追溯的专项回归与已解决审查意见。W7最终独立复核为14文件93项通过，不能继续按首轮收尾失败结论拒收。
- V3已接受的是`9c20a97 → 69147f9`的350个样本、25对场景；不是最终HEAD计时。保留版本限定，并让最终确定性联测覆盖后续W7即可，无需仅为补报告字段重跑计时。
- Q1/Q2的离线交付与`keep_current`裁决成立。Q3新holdout标注冻结成立；工具和线上实验须按四个独立状态记录。
- 现有文档的一处明确版本事实落后已由root更正，若干已知进度文本仍待收口。未发现需要新增全量性能实验、重跑已使用holdout或访问正式正文才能回答的交付问题。

## 需要在最终交付前收口

### D-01：实现对应表的当前提取器版本落后（已更正）

审查时`docs/v0.5/reference/V0.5_IMPLEMENTATION_MAP_20261009.md:108`仍写`dom-v2/readability-0.6.0`，列名明确为“当前含义”。实际`src/web/browser/extract.ts`和WEB_SEARCH说明已为`dom-v3/readability-0.6.0`。这是当前规则表中的具体不一致，应改为v3；同时在当前版本表补充网页持久化formatVersion=2与环境terminalAudit.version=1，可避免将它们误认作environmentPlanningVersion升级。

已向root即时报告；交付本报告前再次读取该行，确认已改为v3。此项已闭环，不要求产品测试。

### D-02：收口当前入口和批次摘要，保留旧review的历史范围

审查时records/README仍只列W4、M1-A、W6；BATCH_B仍将R4b、W7、M-D及七样本计时列“待执行”。V0.5入口和实现对应又称旧“导演联网软提示”为“最新代码交付”。这些是本轮进行中的已知收口点，最终应整体重写当前状态，而不是逐处追加互相冲突的最新说明。

专项reviews中的“root仍需跑计时/全量”等是当时审查范围，保留原文即可；最终README/DELIVERY应链接V3、最终V1与相应闭环。不要覆盖原RED、第一次typecheck或权限失败日志。

### D-03：W7实际停止失败语义需进入当前恢复说明

W7复核补修扩大到`SerialHost.stop`和`plugin-runtime.close`，这是有价值的交付事实：Host先等全部在途工作结算，再向调用者抛出终态收尾错误；runtime在确认Host已排空后继续停止媒体/浏览器并安全关库，最终仍返回失败并记录具体原因；媒体/浏览器自身排空失败则保留Storage，HTTP不返回成功或执行成功退出。RECOVERY §6/§12与网页终态owner段应明确这一行为，并链接W7最终证据。

还应说明异步环境收尾不阻塞前台选轮，wait/stop会排空，旧v0保留正文而只收尾网页，冷启动不扫描全部历史终态。不要只写“终态立即清理”，掩盖必须等待旧execution结算的边界。

### G-01：最终工程门必须标出实际源码身份

最终fresh typecheck、隔离编译、全量、demo、empty_week/required_notice插件smoke仍需独立保存实际退出码、文件/测试/skip计数、Node/npm版本、TEMP/TMP与HDSI_TEST_LIB_DIR。审查过程中已看见batch-b日志文件出现，但未读取结尾或验证退出码，不能据文件存在提前标为通过。

如果Q3仅修改scripts而最终构建已包含稳定产品代码，仍需让最终工具类型检查/定向测试覆盖Q3最终修改；若源码在集成全量启动后变动，应清楚记录其范围及必要补验。无需为纯文字修正重复全量。

Batch A为193文件1072项加权限复验2文件20项的无重叠覆盖，不能改写为“一次195文件1092项全绿”。Q1/Q2早前1项hardlink跳过须保留历史事实；最终全量若实际通过可单列新的结果，不能回填旧日志。

### G-02：最终关闭矩阵和部署状态不可合成单一pass

最终DELIVERY和closure-matrix应分别记录：code/review、functional evidence、performance、data migration、deployed build、service state、online quality。Q3供应商执行/质量/启用未发生，不能因工具完成全部标pass。M3应为“评估交付完成，候选不推荐，线上质量未证明”，不是“记忆自然问句质量已修复”。

用户已授权必要安全停止和部署；完成工程门后按既定流程停服、备份完整库文件组/配置/旧lib、重新构建并只读检查，最终保持停止。记录真实备份目录、清单hash与部署提交，不需要为了确认进程停止读取业务正文。旧v2回退演练足以支持配套回退要求，不需要在正式库再试旧二进制。

## 关闭矩阵建议逐项状态与证据

下表的“专项通过”仅表示已有实现/定向证据/独立review闭环；最终部署状态统一等待root填写。测试集合有重叠，不相加为全仓总数。路径均相对`docs/v0.5/records/comprehensive-remediation-20261011/`，源码与测试路径相对仓库根。

| 任务 / 发现 | 提交身份（root记录） | 可采纳状态与主要证据 | 最终收口 |
| --- | --- | --- | --- |
| V0 | 705f220 | 专项通过；reviews/V0.md，v0-green / v0-isolated-integration | 最终smoke实际加载隔离构建 |
| R1 / B1 / RT-2 | 026b400 | 专项通过；reviews/R1-R2.md，r1-green，task-projection与appointment-update-host | 保留冻结turn.at及新旧轮裁决说明 |
| R2 / B4 / RT-1 | f7c7a01、946584b | 专项通过；R1-R2最终resolution，r2-review-fix-targeted（6项） | API微任务边界已测，线上QQ窗口不宣称验证 |
| W1 / B2 | 1034540 | 专项通过；reviews/W1-W3.md，w1-green-final（8/31） | 旧损坏正文无法自动还原 |
| W2 / B3 / 原文档D1 | e7b834e | 专项通过；reviews/W2.md末尾最终PASS，w2-review-fix-order-green（5/33） | CLI独立browser/Embedding、退出错误说明已写 |
| W3 / B5 | 1034540 | 专项通过；reviews/W1-W3.md，w3-green（4/31，含实际Chrome） | D-01提取器版本表已更正 |
| W4 / WM-O1前段 | 78fc936 | 专项通过；reviews/W4.md，w4-green-final + w4-recovery-green（9/40） | 与W5合并映射WM-O1，不重复算发现数 |
| W5.1 / WM-O1 | 4333e83 | 专项通过；reviews/W5.md，w5-independent-review-green（10/58） | v1读/v2写，完整模型信封保真 |
| W5.2 / WM-O1 | edd7184 | 专项通过；W5 review、w5-cli-dry-run/各apply证据 | 正式bulk apply另列未执行/不需要；不可写已全库迁移 |
| W5.3 / WM-O1 | 305db52、fff41ba | 固定预算与V3通过；web-payload-cost.json，reviews/V3.md | 计时after=69147f9限定 |
| R3 / RT-O1 | fb96eb6、fff41ba | 专项+V3通过；reviews/R3.md（19/151），task-scheduling-before/after | 最终联测保留R1/R2共享调用 |
| M1-A | f0bf56c | 专项通过；reviews/M1-A.md，m1a-review（3/23） | 显式policy元数据不当正文 |
| M1-B | 4ba66c8 | 专项通过；reviews/M1-B.md（子集6/54） | 保持Infinite前台与后台1单元差别 |
| M1-C | f33de81 | 专项通过；reviews/M1-C.md（子集5/44） | 当前清理说明已对齐，最终联测 |
| M2-A | 11e67ab | 专项通过；reviews/M2-A.md（子集5/38） | 默认semantic仍null |
| M2-B | 4ce15f6、b062d06 | 专项通过；reviews/M2-B.md（5/30），m2b-boundary-compatibility | 旧/新冻结配置校验与不回补live |
| M-D / M1+M2测量 | 5b8373e、fff41ba | 探针及已测结果通过；reviews/M-D.md + V3.md，MEMORY_ACCESS_COMPARISON.md | 不把旧M-D“待测”当未做，最终文档提交 |
| R4a / RT-O2 | 5e77e04 | 专项通过；reviews/R4a.md（9/81与独立10/84），r4a-terminal-readers | 最终双场景smoke使用audit，不削弱正式学校表断言 |
| R4b / RT-O2 | 6253da0 | 专项通过；reviews/R4b.md（4/49），r4b-cli-* | 正式历史载荷是否apply单列；默认scope不扩大 |
| W6 / WM-O2 | c1ae83d、aee37f4、fff41ba | 专项+V3通过；reviews/W6.md，w6-review-green（7/36），image-payload-before/after | 与W5/W7最终联测；真实视觉效果未在线验收 |
| W7 / WM-O3 | root正在保存最终提交 | 最终专项通过；reviews/W7.md，w7-independent-final-green（14/93）及兼容6/48 | D-03、最终全量、精确提交号 |
| Q1 / M3评估基础 | c03319f、b76118b | 标签与工具通过；Q1-labels/Q1，q1-dataset-freeze，q1-baseline（仅288条开发/标定） | 不重跑Q2用过的72条holdout |
| Q2 / M3词法候选 | 00512e1 | 工具与一次主评估完成；Q2 review，q2-candidate/q2-report/q2-main-run | keep_current，fact precision .8未达.95 |
| Q3数据 | f2cde49 | 12新holdout family /72问标签通过且冻结；Q3-labels/q3-dataset-freeze | 独立于旧holdout，不根据将来结果改标签 |
| Q3离线工具 | 待root填写 | 实现进行/即将独立复核；不能由本报告代替Q3代码review | 小夹具测试+合成配置dry-plan；零实际采集 |
| Q3供应商执行 | 无 | 未执行，待明确在线授权与可用配置 | 不阻塞本轮离线交付 |
| Q3语义质量门槛 | 无 | 未执行/未证明；不应写未通过或零收益 | 无齐备真实向量则incomplete |
| Q3正式启用 | 无 | 未启用；缺省lexical 1/1、semantic null | 保留现状 |
| D1 / D2-D3 | a8fb72d及后续文档提交 | 部分已完成，当前CLI/规则基本对应；D-01–03待最终同步 | 最终链接/锚点/CLI参数检查 |
| V1 | 最终root填写 | A覆盖通过；B完整工程门审查时仍未确认 | 新日志退出码/数量/身份 |
| V2 | 69147f9 + 各任务 | 8/8固定场景专项pass，recovery-matrix.json | 加最终V1证据，不重复统计测试 |
| V3 | fff41ba | 已测快照通过；performance-validation.json、V3 review | 保留测量身份，不外推生产 |
| V4 | 最终root填写 | rollback-drill副本证据已存在；最终DELIVERY/closure尚未创建 | 全量独立集成review、本地Git/部署/保持停止 |

## 本次独立静态核对

只读Node检查实际文件而不是运行检索：

- recovery-matrix在最后一次读取时：8行全部pass、无pendingAssertions，共49个映射，跨行48个唯一file+testName；所有文件和精确测试名存在。跨行复用同一测试合理，不应称49个独立测试。
- 先前V2-07重复列相同WAL/SHM备份测试两次，已通知root；最后一次读取行内重复为0，故该项已关闭。
- Q1数据原始SHA256：`8abac8950e18ab379effe7231b04d5debebd654f6a758892a898c52caeae1366`。
- Q3数据原始SHA256：`30a2c1920b7d7b84cf9d633fdb7c0c215d4f0bf3a723bd712472e4ff4d7b5652`。
- Q2候选原始SHA256：`1e6af4bd1a422dd43ca8905bee13f7d0c81f346eb9583976a06a56fb687162be`。三者与冻结/报告一致，无主评分被本审查调用。
- R1纯投影和Host两个pause门禁仍在；Storage有pending/scene窄接口，`src`检索未见`all('tasks')`热调用残留。M2在selectCandidates前gate，configuration形状未扩大，冻结能力与实际query gate分离。
- 两维护CLI默认只读、显式数据库参数、apply必须stopped、批量默认50/20、独立uuid备份组与文档相符。网页工具batch上限50；memory工具正整数批量，文档未误写共同硬上限。
- W7源码存在tracked finalizations、执行settle后continuation、错误队列和runtime安全释放链，与最终review描述相符。没有重新审查每个已过专项测试。
- rollback-drill.json显示旧binary+新v2库在完整信封构造失败，配套旧backup恢复后信封/材料hash和计数一致；该记录仅为合成副本，不能当正式回退已执行。关闭连接后的备份只含实际存在主DB符合合同，WAL/SHM存在时的复制由R4b独立测试补证。

## 最终记录建议字段

closure-matrix每项保留`findingIds`、`taskIds`、`commits`、`implementationStatus`、`reviewEvidence`、`testEvidence`、`performanceEvidence`、`deploymentStatus`与`limitations`。另以独立顶层`gates`记录V1/V2/V3/V4、数据处理与服务停止结果，避免把一次部署信息重复混入每个test结果。

Q3可明确写`tooling=complete`、`providerCollection=not_executed`、`qualityGate=incomplete`、`productionEnabled=false`；在工具独立review前tooling仍pending。Q2写`evaluation=complete`、`recommendation=keep_current`即可，无需再设计能通过的新阈值。

目录原则要求完成计划归档，但本包仍包含独立未执行Q3在线阶段。可保留当前plans入口并清楚标识“已实施离线合同/条件在线阶段未执行”，不要为了形式归档将Q3误报已完成。若root选择移动已完成合同，必须同步所有相对链接并保留历史证据，不能在最终门里临时大范围改路径而不复查。

本审查未新增产品修正要求；最终整体合入与部署前独立代码review仍按root原定流程执行。
