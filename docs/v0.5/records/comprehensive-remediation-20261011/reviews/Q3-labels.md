# Q3 新 holdout 独立标签审核

状态：**PASS**（2026-10-11）。未发现需要修改的数据标签。该结论仅为独立静态标注审核通过，冻结与后续实验由 root 决定；不表示主语义检索质量通过。

数据：`tests/fixtures/memory-retrieval-semantic-v2.json`，datasetId：`synthetic-memory-retrieval-semantic-v2-20261011`，schema version：2。

## 审核边界与覆盖

阅读 Q3-brief、Q3-dataset-report、Q1-label-review、现行记忆规则和严格 validator。逐条全读新增 `semantic-fact-01..06`、`semantic-experience-01..06` 的 48 个 owner 正文、72 条 query、期望与理由，以及六条事实历史。另阅读 Q1 全部 240 个 owner 正文，核对新事件与保留及旧 holdout 事件的隔离。元数据使用独立静态断言逐项验证，不以作者报告代替验证。

本审核没有执行检索、评价指标、阈值选择、holdout 运行、query/provider、向量采集、在线请求或正式数据库访问；没有从算法结果反推或调整标签。只写本报告，未修改数据集、产品、其他测试或 Git。

## 全读结论

| 新 family | 正例唯一目标 | 三个干扰的排除依据 | negative 缺失信息 |
| --- | --- | --- | --- |
| semantic-fact-01 | 卓砚的阅读器正文字体：思源宋体 | 卓研与蒋岚是其他人；行距不是字体 | 屏幕英寸数 |
| semantic-fact-02 | 邢葭的科技邮件接收频率：每两周一期 | 邢嘉与柳闻是其他人；八点是时刻而非周期 | 收件箱标签 |
| semantic-fact-03 | 翁岑的绿萝浇水提醒：每六天一次 | 翁涔与金棠是其他人；施肥提醒不是浇水提醒 | 花盆直径 |
| semantic-fact-04 | 齐芮的打印耗材直径：一点七五毫米 | 齐蕊与辛原是其他人；喷嘴口径不是耗材直径 | 成型平台长宽 |
| semantic-fact-05 | 柏珂的键盘字母布局：Dvorak | 柏柯与辛楠是其他人；六十八键不是字母排列方案 | 键帽材质 |
| semantic-fact-06 | 钟栩的十二孔陶笛指法：日式 | 钟诩与冯芷是其他人；中音 C 调不是指法 | 陶笛重量 |
| semantic-experience-01 | 茅澄九月十八日刻边款：擦除反向转印、改用镜像稿 | 茅澈；九月四日换刀；同日下午拓印 | 十月三日皮划艇翻艇复位 |
| semantic-experience-02 | 甄霁九月十八日装订：按页码重排书帖后穿线 | 甄济；九月四日修正孔距；同日下午裁书衣 | 十月二日采蜜过滤 |
| semantic-experience-03 | 嵇朔九月十八日冲印：缩短曝光重做试条 | 嵇烁；九月四日清理灰尘；同日下午底片归档 | 十月四日围棋判活 |
| semantic-experience-04 | 蒲遥九月十八日抄纸：搅散纸浆、平稳提帘 | 蒲瑶；九月四日晾干揭纸；同日下午染纸 | 十月五日滑板绕桩 |
| semantic-experience-05 | 苗砚九月十八日雨声拟音：降低输入增益消除削波 | 苗彦；九月四日关空调补录；同日下午脚步拟音 | 十月六日织锦换纬线 |
| semantic-experience-06 | 岑弥九月十八日压印盲文：重新设定单元间隔 | 岑祢；九月四日磨边；同日下午凸线地图 | 十月七日帆船迎风转向 |

每个 family 的 direct、conversational、paraphrase、multi_topic、temporal 五条正例均支持目标 owner 一项，另有三个真实干扰。事实问句明确属性，没有 Q1 曾出现的同名身份歧义；补水提醒未被误当实际浇水行为，布局与键数、周期与时刻、字体与行距等边界清楚。六条经历的问句均给出人物、九月十八日、地点及所问活动，能排除同人早期事件和同日另一活动。multi_topic 的旁支话题明确搁置，不形成第二个待回答目标。

十二条 negative 所问属性或事件均不在各自四个 owner、事实历史或来源中。没有因为人物相同而把其他属性、九月另一活动标为可回答，空期望正确。六条事实 temporal 明确询问“登记记录”的变化；历史只表明此前未登记、后来补充当前值，不推断现实设置、偏好或实际值曾变化。

新人物、属性主题、经历地点、活动、具体问题与解决步骤均与 Q1 保留和移除的事件分离，没有发现旧 holdout 改名复用或跨 split 同事件改写。句式和元数据模板有复用，属于合成数据的既定组织形式；这不能代表真实用户语言分布已被全面覆盖。

## 独立静态验证

两次只读命令均退出码 0：一次 `node --import tsx` 仅调用 `loadRetrievalDataset` 与 `retrievalDatasetHash`；一次 `node` stdin 使用 JSON、原始字节 SHA256 和独立断言。没有调用评估器的执行函数。

- 严格 schema PASS：60 family / 360 query；development 两组各 16，calibration 两组各 8，holdout 两组各 6；每 family 六类齐全。validator 对原句权限构造与 scope/history 标签的一致性检查通过，不执行检索。
- 保留的 48 个 development/calibration family 对象与 288 个 query 对象和 Q1 深比较完全相同。旧 12 个 holdout family ID 及其 query 全部移除；新 holdout 恰为 12 family / 72 query。
- 全库 360 个 query ID、360 条 query 文本、240 个 typed owner key、240 条 owner 正文、240 个 message ID、60 个 turn ID、30 个 history ID 分别唯一。每条 query 的候选严格等于本 family 全部四个 owner；正例期望首个目标，negative 为空。
- 240 条 owner 来源与 message 正文、eventSummary 一致；sourceIds、seenTurnId、turn.inputMessageIds、batchId/batchIds 双向闭合。turn 均完成，完成时间不早于来源，来源时间等于登记与 lastEventUpdateAt。没有 linkedLongId、mergedInto、canonicalMemoryId、evidenceVersions、projectionBasis；evidenceMemoryIds 为空，没有未声明的相关 owner。
- 全部 30 条 detailHistory 的 key、newValue、effectiveAt、sourceIds、turnId 对应当前 detail 及其来源；previousValue 均为“此前未登记”。其中新增六条的登记时间为九月二十日 10:00，理由与正文一致。
- 所有事件开始不晚于结束，结束不晚于登记。新增经历目标及近名人物为九月十八日 09:00–10:00，早期事件为九月四日 09:00–10:00，另一活动为九月十八日 14:00–15:00，消息、登记与完成 turn 在九月十八日 16:10，时间链一致。
- 全部 120 个 long owner 的 retainedFrom 等于 createdAt，expiresAt 恰为其后 90 天。普通问句位于有效期内；经历 temporal 位于到期后且申请 archive，并仍在到期后 90 天归档窗口内。新增经历到期为 `2026-12-17T08:10:00Z`，temporal 为 `2027-01-20T10:00:00+08:00`。
- visibleSourceIds 全部为空；新增事实仅 temporal 开启 detailHistory，新增经历仅 temporal 开启 archive。没有通过标签授予原句未申请的额外权限。
- 新 JSON 无 CR 字节，保持 LF；Q1 原始文件哈希未变。

## 接受的数据身份

Q1 原始字节 SHA256：`8abac8950e18ab379effe7231b04d5debebd654f6a758892a898c52caeae1366`。

本次 Q3 接受的原始字节 SHA256：`30a2c1920b7d7b84cf9d633fdb7c0c215d4f0bf3a723bd712472e4ff4d7b5652`。

本审核没有修改数据，因此无需作者修订轮次。任何后续字节修改使该身份失效，须重新复核受影响标签与静态合同。root 可据此记录冻结；本报告自身不冻结数据、不授权运行盲测、不宣称语义效果或部署门槛通过。
