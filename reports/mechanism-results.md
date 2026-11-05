# 元素身份与未知提交：机制实验

原始数据：`traces/2026-11-04T10-04-31-225Z/results.json`。重复数 3；浏览器 155.0.8059.86；Playwright 1.56.1；win32 10.0.26200；Node v24.14.1。

**这是固定故障注入与确定性选择器的机制实验，无 LLM，不是完整 Agent 排名或开放网站成功率。安全拒绝不计任务完成。**

| 策略 | 样本 | 完成 | 错对象副作用 | 错对象请求 | 重复副作用 | 执行前拒绝 | p50/p90/p95 ms |
|---|---:|---:|---:|---:|---:|---:|---|
| position-fallback | 45 | 15 | 15 | 15 | 6 | 3 | 450/832/1012 |
| strict-ref | 45 | 12 | 3 | 3 | 3 | 24 | 478/1000/1140 |
| context-reobserve | 45 | 18 | 3 | 3 | 3 | 18 | 497/947/996 |

耗时包含环境创建、截图与等待，是该实验流程的墙钟时间；不能拿来证明不同进程架构工具的纯执行延迟优劣。模型调用/Token/模型费用为0；浏览器协议往返未精确计数，记为unknown；每次运行1张结果截图。

| 场景 | 策略 | 完成/样本 | 错对象副作用 | 重复副作用 |
|---|---|---:|---:|---:|
| S01 | position-fallback | 3/3 | 0 | 0 |
| S01 | strict-ref | 3/3 | 0 | 0 |
| S01 | context-reobserve | 3/3 | 0 | 0 |
| S02 | position-fallback | 0/3 | 3 | 0 |
| S02 | strict-ref | 0/3 | 0 | 0 |
| S02 | context-reobserve | 3/3 | 0 | 0 |
| S03 | position-fallback | 0/3 | 3 | 0 |
| S03 | strict-ref | 0/3 | 0 | 0 |
| S03 | context-reobserve | 0/3 | 0 | 0 |
| S04 | position-fallback | 0/3 | 0 | 0 |
| S04 | strict-ref | 0/3 | 0 | 0 |
| S04 | context-reobserve | 0/3 | 0 | 0 |
| S05 | position-fallback | 3/3 | 0 | 0 |
| S05 | strict-ref | 0/3 | 0 | 0 |
| S05 | context-reobserve | 3/3 | 0 | 0 |
| S06 | position-fallback | 0/3 | 3 | 0 |
| S06 | strict-ref | 0/3 | 0 | 0 |
| S06 | context-reobserve | 0/3 | 0 | 0 |
| S23 | position-fallback | 0/3 | 0 | 3 |
| S23 | strict-ref | 3/3 | 0 | 0 |
| S23 | context-reobserve | 3/3 | 0 | 0 |
| S23-transport | position-fallback | 0/3 | 0 | 3 |
| S23-transport | strict-ref | 0/3 | 0 | 3 |
| S23-transport | context-reobserve | 0/3 | 0 | 3 |
| S26 | position-fallback | 3/3 | 0 | 0 |
| S26 | strict-ref | 3/3 | 0 | 0 |
| S26 | context-reobserve | 3/3 | 0 | 0 |
| S27 | position-fallback | 0/3 | 0 | 0 |
| S27 | strict-ref | 0/3 | 0 | 0 |
| S27 | context-reobserve | 0/3 | 0 | 0 |
| S30 | position-fallback | 0/3 | 3 | 0 |
| S30 | strict-ref | 0/3 | 0 | 0 |
| S30 | context-reobserve | 0/3 | 0 | 0 |
| S32 | position-fallback | 3/3 | 0 | 0 |
| S32 | strict-ref | 3/3 | 0 | 0 |
| S32 | context-reobserve | 3/3 | 0 | 0 |
| S34 | position-fallback | 0/3 | 0 | 0 |
| S34 | strict-ref | 0/3 | 0 | 0 |
| S34 | context-reobserve | 0/3 | 0 | 0 |
| C01-hidden-handler-change | position-fallback | 0/3 | 3 | 0 |
| C01-hidden-handler-change | strict-ref | 0/3 | 3 | 0 |
| C01-hidden-handler-change | context-reobserve | 0/3 | 3 | 0 |
| C02-benign-status-change | position-fallback | 3/3 | 0 | 0 |
| C02-benign-status-change | strict-ref | 0/3 | 0 | 0 |
| C02-benign-status-change | context-reobserve | 0/3 | 0 | 0 |

逐次观察、日志、截图与执行源码副本：`traces/2026-11-04T10-04-31-225Z`。报告可从该固定JSON重算，无需重新运行浏览器。

- position-fallback 是人为弱对照，不代表成熟工具；真实发布版对照见 agent-browser-baseline.md。
- S03/S04/S06/S30/S34 无可安全执行目标或权限，预期拒绝；S27 是服务端业务拒绝的简化样本，未实现完整乐观UI回滚。拒绝和业务拒绝均不算收款任务完成。S06是目标被隐藏的变体，不等同完整隐藏同名控件选择覆盖。
- S23 响应正文丢失；S23-transport 响应头前断连，保留浏览器内部HTTP重试导致的重复。动作账本不能承诺服务端exactly-once。
- S32 是固定控制器，不是模型抗注入实验。
- C01 可见DOM/节点不变、事件处理却改指其他对象，严格策略同样误写；C02 合法状态文字变化使完整容器指纹误拒绝。这些反证未剔除。
- 各重置使用同构初态和随机业务ID；重复不是独立网站样本。没有统计显著性或泛化成功率主张，未做伪独立置信区间。
- 源码副本属于当次执行，当前工作树后续改动不自动继承当次结果。
