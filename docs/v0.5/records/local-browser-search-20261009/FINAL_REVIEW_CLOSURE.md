# 独立复核修复关闭

2026-10-10。对照[原独立报告](INDEPENDENT_REVIEW.md)；三个Important均接受、复现并在一次修复批中解决。无Critical、Minor或被搁置判断；没有发起第二轮独立审查。

| 问题 | 修复与真实验证 |
| --- | --- |
| OneBot token与桥 | assets.ts区分可用HTTP/data源和file令牌；plugin-runtime.ts绑定internal.getImage（保留通用getImage兼容）。incoming-media-onebot-review使用当前安装适配器的adaptMessage生成真实元素，直达resolver及实际runtime middleware；RED回调0／unavailable，GREEN平台回调1且真实字节落盘ready |
| 导航／加载壳 | extract.ts剔除结构status/progress/navigation；article/main需非链接、非仅标题的正文证据，短正文不设字符阈值；判定用的副本不裁已接受全文。browser-final-review的链接菜单、标题菜单、状态壳RED，动态port返回旧Loading而非正文RED；修复后全部GREEN |
| popup排空 | koishi-port.ts登记每个自有popup的close promise，parent close等待，未能证明消失的失败传给槽；isClosed包括全部自有页。browser-final-review延迟和失败close原先dispose提前成功RED；修复后延迟等待、失败拒绝且不释放资源，GREEN |

新六项与原端口／DOM／槽合计5文件15项通过。首次OneBot装配回归误引用未导出的settingsSchema，改为真实loadSettings后再次跑红确认bridge0；首次转绿轮固定setImmediate次数不足以保证磁盘完成，改为等待真实ready，未修改产品来迎合时间断言。这两次工具问题也保留日志。

修复后完整173文件882项、build、typecheck、demo、显式隔离只读check、哈希verify、双场景smoke通过；[修复后公开浏览](evidence/public-browser-final.json)通过中文／英文候选正文、合成动态和登录墙、资源排空。英文候选相关性仍由上层模型判断，此探针只证明工程读取，不证明搜索质量。

随后报告加入共享extractor版本字段，既有脚本测试确认缺字段RED→GREEN；产品算法未再次改变。最终本地整合门禁会单独保存，不拿前述882冒充之后的重跑。

证据：logs/final-review-red.log、final-review-onebot-red.log、final-review-green-attempt1.log、final-review-green.log、final-test.log、final-build.log、final-typecheck.log、final-check.log、final-fixture-verify.log、final-smoke.log；报告版本断言另见final-report-version-*。原失败日志及public报告不改成成功。
