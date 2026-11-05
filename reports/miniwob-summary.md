# 首次公开任务运行：样本分层

固定原始源码：Farama MiniWoB++ `33c3b4ddef8c6eb67c57a29663d844b1eda7e614`，MIT。均使用原始10秒上限，没有将任务或评分改为自建版本。

| 运行层 | 内容 | 结果 | 可以支持的结论 |
|---|---|---|---|
| 预编写确定性专家脚本 | click-button / enter-text / click-checkboxes / choose-list，各3 seeds | 12次原始raw reward=1 | 原始环境、输入操作与评分通道能工作；不是Agent规划成绩 |
| 根Codex模型实际选择 | click-button，seed173 | raw reward=1；4892ms；单次click | 一个真实模型观察→选择ref→操作样本完成 |
| 根Codex模型实际选择 | enter-text，seed174 | raw reward=1；5182ms；一次fill+一次click | 一个真实模型提取指令值并输入提交的样本完成 |

这三层不能合并成14/14通用成功率。没有同模型成熟Agent Harness对照，没有统计显著性声明，没有复杂任务或跨站泛化结论。两个模型实操任务都很简单，继续堆类似任务不会替代更难的验证。

原始core评分由独立研究职责在根Agent通知结束后读取，按 done=true且rawReward=1判完成。时间惩罚reward单列；done本身、部分正奖励、UI success文字或Agent宣称完成都不能替代原始评分。原始oracle位于客户端JS，不能对有任意JS篡改权限的恶意Agent提供抗篡改保证。

首任务有两次导航前的宿主启动失败（Node REPL的process全局、Chrome路径），没有生成episode或执行账本；修复驱动环境后才开始正式样本。保留此限制，不将前置失败计为任务成绩，也不将其伪装成页面恢复能力。

- 任务源码与93文件固定清单：[miniwob-audit.md](../sources/miniwob-audit.md)、[miniwob-versions.json](../sources/miniwob-versions.json)
- 专家脚本逐次结果：[miniwob-smoke.md](miniwob-smoke.md)
- 根模型click样本：[miniwob-codex.md](miniwob-codex.md)
- 根模型enter-text样本：[miniwob-codex-enter-text.md](miniwob-codex-enter-text.md)

所有原始观察、输入元数据、执行账本、oracle与源码副本均在各报告指向的traces目录。无新的外部模型API调用；根Agent模型token/成本不可可靠导出，记unknown。
