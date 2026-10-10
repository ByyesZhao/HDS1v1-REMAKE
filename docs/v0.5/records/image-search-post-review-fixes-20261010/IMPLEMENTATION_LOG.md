# 图片与搜索交付后修复过程

计划：docs/v0.5/reviews/image-search-post-implementation-20261010/FIX_PLAN.md
基线：ca74fa2；原产品基线 2a2e77e。
范围：T1～T5；不改正式配置、数据库，不启动正式服务，不调用在线模型。
预检：五项边界相互兼容；T3/T4 顺序共享 extractor，T2 不改变既有终态，T5 仅独立验收脚本。
执行：逐项 RED→GREEN，整批门禁后做一次新上下文全分支审查。

T1：ca74fa2 起；真实 Internal retcode=100 导致整轮失败，取消时晚到的 API 错误覆盖取消原因，RED 2 失败。仅 getImage 来源 catch 分类，GREEN 2文件/7测试。

T2：32bffb9 起；磁盘重开后关闭识别，延期 personal 观察丢失，RED 1失败。历史确认先于新准备门禁；pending 保持冻结恢复。初次 GREEN 揭示新测试 DTO 写错层级，校正为 ref/version/observation 后 GREEN 3文件/6测试；不改变实际内容期望。

T3：348b207 起；真实 Chrome + port/provider 红回归 8失败。连接原 DOM 一次预序计算样式与继承状态，对应克隆删除不可见内容；访问墙/空态遍历所有匹配。dom-v2；GREEN 5文件/20测试（真实 Chrome 9），额外探针 hiddenArticle 正文正确、hiddenCaptcha=1/0、4页面排空。中间绿跑发现遗留克隆 style 循环因 CRLF 未移除，已定位移除，保留日志。

T4：c124bdd 起；main/role-main 登录壳 RED 5失败。删除凭据区域及提示，区域外独立 article/main 可保留；多表单逐项判定。GREEN 4文件/31测试，真实离线探针 loginMain=login_wall、0/1、无材料，R3保持1/0与0剩余页。新测试起初错误假定失败 DTO 传递异常文本；现沿原合同断言 read_error，DOM/探针另验 login_wall，保留中间日志。
