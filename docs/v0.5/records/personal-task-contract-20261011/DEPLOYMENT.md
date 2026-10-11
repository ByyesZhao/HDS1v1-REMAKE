# 个人任务合同正式部署与停止记录

日期：2026-10-11。版本：`0.5.1`。状态：**已部署并安全停止，待用户手动重启；未解除暂停／未恢复失败轮**。用户授权修复后上传Git、安全停止运行服务，由用户手动重启修改版本。本批未执行hdsi.resume或线上模型／QQ验收。

## 实际操作与验证

- `main`快进到已验收的`0074891`并推送；远端哈希确认相同。源码／测试与隔离验收树一致。原有输入文档已在`8dbcdb6`完整保存，并额外以限定路径stash保留，未清理整个原工作区。
- 上海时间约15:22，执行`node runtime/stop.cjs`，入口返回“Current work saved. HDSI stopped.”；未强制结束进程。停止描述文件消失，进程检查确认Koishi启动进程退出。进程检查第一次受沙箱CIM权限限制，提升只读检查权限后通过；该失败发生在备份／部署前。
- 停服后唯一私有备份：`runtime/archive/batches/20261011-personal-task-contract/20261011-152300/`。包含正式DB、当时存在的WAL／SHM、旧lib、故事配置、Koishi配置及hash manifest；此前完整离线执行日志另存于其中`offline-execution-evidence/`。备份及配置未进入Git。
- 将隔离目录已验收lib放入主目录，246个构建文件逐一SHA256比对一致。运行`start-hdsi.cmd --check`退出0，插件解析到`D:\HDSI-remake\lib\index.js`，67个表情资产可用；没有网络请求。备份时及检查后DB／实际WAL／SHM／配置哈希一致，无迁移、恢复或业务写入。

[停止前只读分类](evidence/deployment-precheck.json)与[部署后检查](evidence/deployment-postcheck.json)分别保留。后者记录已验收源码提交而非后来仅补现场文档的提交；主目录代码、配置与构建事实可据此核对。

## 手动启动与恢复边界

现场仍为`paused=true`；失败轮`20653c6a-c492-4a63-b7f5-23d94a6f7e54`的原at保持`2026-10-11T06:03:24.873Z`，无frozenResult、无outbox、outputComplete=false，个人阶段仍为personal_life、repairCount=2；一条输入仍未读。此次没有重试轮或改写checkpoint。

用户可使用原`start-hdsi.cmd`手动启动。启动后的暂停确认由用户完成，当前只验证磁盘暂停状态仍保留。重启不等于resume；若随后明确执行hdsi.resume，既有恢复代码会按恢复时刻重生成该未尝试轮，并使用预约专用合同，原修补预算不重置。角色、活动、回应内容取决于恢复时输入，不能保证仍为life或沉默。真实QQ和模型质量仍未由此次离线验收证明。
