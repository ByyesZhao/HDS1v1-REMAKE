# 图片与搜索交付后修复过程

计划：docs/v0.5/reviews/image-search-post-implementation-20261010/FIX_PLAN.md
基线：d337a28（以 git rev-parse 的实际值为准）；原产品基线 2a2e77e。
范围：T1～T5；不改正式配置、数据库，不启动正式服务，不调用在线模型。
预检：五项边界相互兼容；T3/T4 顺序共享 extractor，T2 不改变既有终态，T5 仅独立验收脚本。
执行：逐项 RED→GREEN，整批门禁后做一次新上下文全分支审查。

T1：ca74fa2 起；真实 Internal retcode=100 导致整轮失败，取消时晚到的 API 错误覆盖取消原因，RED 2 失败。仅 getImage 来源 catch 分类，GREEN 2文件/7测试。
