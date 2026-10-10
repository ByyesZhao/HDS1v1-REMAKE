# R1～R5 修复映射

原 [审核](../../reviews/image-search-post-implementation-20261010/REVIEW.md) 基线 2a2e77e；原 verdict／JSON／日志不改写。执行者修复与验证如下，整批及独立 review 结果见 [交付](DELIVERY.md)。

| 项目 | 修复提交 | 回归／证据 |
| --- | --- | --- |
| R1 取图错误暂停整轮 | 32bffb9、47eb14d | installed OneBot.Internal retcode=100 经协议2 runTurn 完成，unknown/unavailable，无视觉调用或系统报错；取消经 prepare 不冻结未知；T1-red/green、additional-boundaries |
| R2 关闭后延期观察丢失 | 348b207 | 磁盘库重开、无文字记忆替代、deferred_reply 的 personal/expression 保留同一观察与OCR，新增下载/模型0；pending关闭后原素材恢复；T2-red/green-final |
| R3 CSS 隐藏误读 | c124bdd | 原 DOM computed style、祖先 display/visibility、可见性覆盖、墙/空态全节点；actual Chrome + port/provider/WebService；[T3探针](evidence/T3-browser.json) |
| R4 main 登录壳正文 | 5a53d27、47eb14d | main/role-main拒绝，success0/failure1/materials[]；正文旁登录组件保留、讨论登录的正文保留；[T4探针](evidence/T4-browser.json) |
| R5 浏览器启动失败验收挂起 | 32efb3c | actual Koishi 拒绝/从不ready/正常ready，有限结算、清Context、失败报告；CLI退出1；[T5探针](evidence/T5-startup.json) |

提取器版本 dom-v2/readability-0.6.0；成功20／失败40、缓存B、原终态与pending版本恢复合同保持。关闭新识别不撤销已确认观察；原 I4a 的“仅face可ready”针对新准备。

独立审查ca74fa2..e4c4c83提出两项Important；47eb14d补修后8项RED→GREEN，完整175文件920项通过（logs/full-test-reviewed.log）；原报告保留。无Critical／Minor，不发第二次审查。实测CSS和计数包含空／仅标题／隐藏正文的登录反例，取消覆盖普通和预下载共享路径的晚到成功／失败。
