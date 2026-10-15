# 模型接口响应诊断补强

2026-10-15，前置基线 `1c29f71`，包版本沿用 0.5.3，后续修正在 main 交付，原发布标签保留。

## 此前错误核对

范围为 10 月 14 日 16:00 至 10 月 15 日上午。三条自动修复记录均未发现程序误判：

| 北京时间 | 原因与证据 | 恢复 |
| --- | --- | --- |
| 10-14 18:14:35 | 未修改的表达模型原文无法被 JSON.parse 解析，属性名后缺冒号 | 一次格式修补，18:15:27 完成 |
| 10-14 19:41:10 | 模型将 onsite 观察关联至18:21经历，但实例19:00才开始；原历史状态回放同样拒绝，示例只改为19:00经历索引即通过 | 一次格式修补，19:43:31 完成 |
| 10-14 21:20:18 | 表达模型原文同样存在 JSON 属性语法错误 | 一次格式修补，21:20:52 完成 |

今天09:00学校通知轮的 narrative 请求在09:15报 `invalid response envelope` 并暂停。该旧错误合并了响应体读取、外层JSON解析以及缺少content等情况，没有保留可区分的原始响应信息，无法在事后确认具体原因。不能凭15分钟耗时断言一定是超时，也不能归因为故事JSON格式问题。

## 局部修改

`model/client.ts` 对响应体只读一次，分阶段诊断，不改用流式响应、不重试或猜测其他供应商协议：

| 阶段 | 原因 |
| --- | --- |
| request | network_error，附允许名单内的网络原因码 |
| body | body_read_failed，读取中断与JSON错误分开 |
| json | empty_body、invalid_json |
| http | http_error，保留HTTP状态及既有context_limit判断 |
| envelope | provider_error、invalid_envelope、missing_choices、empty_choices、missing_message、missing_content、non_string_content |

`model/request-diagnostics.ts` 构建简短诊断。`ModelRequestError.diagnostic` 与不可变失败历史的可选 `requestDiagnostic` 保存HTTP状态、请求耗时、已解码响应体UTF8字节数、MIME、安全请求ID、网络／供应商错误码、choices数量、content类型和已知finish_reason。仅记录实际获得的信息；连接失败时不会虚构HTTP状态。

诊断不保存响应正文、供应商message、完整请求头、URL、堆栈或cause对象。请求ID有字符与长度限制，过滤常见凭据形态及本机API key回显；供应商码有格式和长度限制。原有模型内容格式错误仍按既有raw/checkpoint取证合同保存，不与本次接口正文诊断混淆。

`app.ts` 在既有安全暂停通知及status的safeSummary中显示原因码、HTTP状态、耗时及可用请求ID等信息。未知异常沿用通用摘要；请求失败不消耗格式修补预算。调用者取消保持原取消原因；持久检查点、恢复路径及后台失败周期保持原规则。可选JSON字段不需要数据库迁移，历史记录不回填或改写。

## 验证与部署边界

离线测试覆盖各类响应、读取失败、网络原因、HTTP上下文超限、安全元数据、结构化持久记录、暂停通知、成功响应与取消。三个历史错误的回放仅使用只读正式库；模型正文不复制到公开交付材料。

[历史三条错误回放](evidence/prior-three-error-check.json)仅读取正式库，[定向回归](evidence/targeted-summary.json)4文件81项通过，[工程检查](evidence/engineering-checks.json)确认类型与构建通过。[独立产品审查](INDEPENDENT_REVIEW.md)无P0–P3发现，另13项内存探针通过。[全量验收](evidence/full-test-summary.json)：230文件1578项通过，0失败、2项既有跳过。正式部署状态由本目录证据确认。本次不会替用户恢复今天暂停的旧轮；部署后仍由用户手动启动并按需要执行 hdsi.resume。新诊断对下一次请求生效，不能补出旧请求当时丢失的信息。

## 正式部署

验收源码 `2d05c72`，包版本 0.5.3。2026-10-15 09:31安全退出、备份并部署，原服务及关联浏览器进程退出，5141无监听，停止控制文件移除。

[部署证据](evidence/deployment-summary.json)：252个lib文件与验收构建逐一匹配；只读运行检查通过，无网络请求；数据库与配置指纹、42张表内容保持，quick_check=ok。备份为 `runtime/archive/batches/20261015-model-response-diagnostics-053/2026-10-15T013145532Z-d7088292`，清单SHA256为 `82acf5beb0645f2292fc5bc5bdb1479fe82a92adf6b68dbc1105c5d31e5b6e3d`。

正式库仍保留paused=true、今天09:00学校通知未完成轮及其checkpoint，未执行resume、未改写历史错误。用户手动运行start-hdsi.cmd后，再发送hdsi.resume恢复原轮。21个维护任务与346个索引任务均已完成，既有250条发送记录均确认。
