# MiniWoB++ 原始公开任务：环境与执行器冒烟

源码 SHA：33c3b4ddef8c6eb67c57a29663d844b1eda7e614；Chrome 155.0.8059.86；Playwright 1.56.1。

**本轮是4个公开任务的预编写专家策略，不是通用 Agent 成功率或模型排名。没有模型调用。**

| 原始任务 | seed | 原始raw reward | 带时间惩罚reward | 完成 |
|---|---:|---:|---:|---|
| click-button | 42 | 1 | 0.9812 | true |
| click-button | 43 | 1 | 0.9878 | true |
| click-button | 44 | 1 | 0.9857 | true |
| enter-text | 42 | 1 | 0.985 | true |
| enter-text | 43 | 1 | 0.9844 | true |
| enter-text | 44 | 1 | 0.9842 | true |
| click-checkboxes | 42 | 1 | 0.9864 | true |
| click-checkboxes | 43 | 1 | 0.9435 | true |
| click-checkboxes | 44 | 1 | 0.9601999999999999 | true |
| choose-list | 42 | 1 | 0.9849 | true |
| choose-list | 43 | 1 | 0.9872 | true |
| choose-list | 44 | 1 | 0.985 | true |

全部逐步回执、初始观察、截图、源码副本与原始奖励：`C:\Users\17381\Desktop\research_browser\traces\miniwob-smoke-2026-11-04T15-19-41-549Z`。

原始10秒上限未修改。初始化仅 seed + core.startEpisodeReal，保留原始任务genProblem与原始评分endEpisode；奖励报告 wrapper不计算奖励。判分读取上游公开环境WOB_RAW_REWARD_GLOBAL/WOB_DONE_GLOBAL，不读取执行器的成功声明。
初始before字段确认动作前rawReward=0/done=false；Agent若此时宣称完成仍不得判成功。点击复选框与选择控件使用当前执行器，专家脚本按任务类型解析公开可见指令并选择ref，不能当作自然语言通用规划。
