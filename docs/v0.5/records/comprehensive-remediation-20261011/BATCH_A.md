# 批次A：错误修复验收

日期：2026-10-11。状态：**错误修复、复核补修与工程门通过，尚未部署；继续批次B/C**。

源码包含R1 `026b400`、R2 `f7c7a01`及补充发送回归`946584b`、W1/W3 `1034540`，以及当时尚未提交的W2首版实现。构建路径为`.tmp/comprehensive-remediation-build`，通过`HDSI_TEST_LIB_DIR`提供给插件smoke和只读启动夹具；正式`lib`未覆盖。

| 验收 | 实际结果与证据 |
| --- | --- |
| 类型与隔离编译 | 退出0：[typecheck](evidence/batch-a-typecheck.txt)、[build](evidence/batch-a-build.txt) |
| 全量测试 | [全量日志](evidence/batch-a-full.txt)：195文件，193文件／1072项通过；Chrome启动被沙箱拦截致18项未执行，两项junction夹具因EPERM失败 |
| 权限定向复验 | [复验](evidence/batch-a-permission-recheck.txt)：仅上述2文件20项，全部通过。与全量通过集合不重叠，因此195文件1092项均有通过覆盖；不能表述为一次全量全绿 |
| 模拟演示 | [demo](evidence/batch-a-demo.txt)退出0，模拟QQ、内存／临时数据、无外部模型 |
| 插件smoke | 首次未设置工作区TEMP，临时stop descriptor重命名受限，保留[失败日志](evidence/batch-a-plugin-smoke.txt)；设置TEMP/TMP后[复验](evidence/batch-a-plugin-smoke-workspace-temp.txt)退出0，empty_week／required_notice各四步提交 |

以上全量在W2复核补修之前运行。完整启动预算、异步停止、迟到资源和真实canvas scope关闭顺序均已补修，最终[5文件33项定向通过](evidence/w2-review-fix-order-green.txt)，[W2复核](reviews/W2.md)末尾的最终结论为PASS，提交`e7b834e`。早前失败结论和红测保留，用于追溯。

复核收尾后再次[typecheck](evidence/batch-a-review-final-typecheck-corrected.txt)、[隔离编译](evidence/batch-a-review-final-build.txt)、[新构建smoke](evidence/batch-a-review-final-smoke.txt)均退出0；当时源码为`c1ae83d`加一行W6测试类型修正，已包含W4、M1-A、W6的独立通过实现。前一轮[typecheck](evidence/batch-a-review-final-typecheck.txt)仅发现W6新增readFile模拟的重载类型不符，修正测试返回类型后通过。新增／受影响测试由各任务定向覆盖，B结束再统一跑完整套件；不把这些有重叠的测试数直接相加。

R1与R2[复核](reviews/R1-R2.md)、W1与W3[复核](reviews/W1-W3.md)、V0[复核](reviews/V0.md)均已通过。暂停的新增回归证明Host API选择边界与已进入整轮发送合同，不代表真实QQ命令线上竞态已复现。
