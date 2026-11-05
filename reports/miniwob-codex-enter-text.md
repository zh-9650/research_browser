# MiniWoB++ 原始公开任务：Codex 单次实操

原始任务 enter-text，seed 174，源码SHA 33c3b4ddef8c6eb67c57a29663d844b1eda7e614。

独立读取上游原始奖励：rawReward=1；时间衰减reward=0.4818；done=true；原始上限=10000ms；环境计时到评分=5182ms。
本次CLI动作2次，dispatch意图2次，环境episode结果1次。严格判定taskCompleted=true。

根Agent只从CLI可见query与目标refs作选择，未读原始任务源码/隐藏reward global；研究职责在其通知完成后才读取独立原始奖励报告。页面未改任务、奖励或计时，只通过桥接脚本初始化和被动上报。启动前的Node REPL process全局和Chrome可执行文件路径错误发生在导航前，未开始episode，未改原始时限。

原始oracle、协议ready/observe/act、执行账本、配置及源码快照：`C:\Users\17381\Desktop\research_browser\traces\miniwob-codex-2026-11-04T15-23-21-434Z`。服务启动时与判分时源文件快照分别保留；sourceAtGrading不冒充自动记录的进程加载时源码哈希。

**这是原始公开任务的一个真实Codex实操样本，不是公开任务集成绩，不代表通用任务成功率或模型性能排名。** 另外12次预编写专家策略的环境冒烟在[miniwob-smoke.md](miniwob-smoke.md)分报，没有混入本样本。原始客户端oracle不是抗篡改后端真值系统。模型成本/Token未可靠导出，标为unknown。
