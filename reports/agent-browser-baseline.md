# 发布版 agent-browser 与身份校验：真实 CLI 机制对照

运行 2026-11-04T10-04-08-112Z；Chrome 155.0.8059.86；agent-browser 0.41.2；每个场景 3 次；全程没有模型调用。

| 场景 | 策略 | 样本 | 任务完成 | 错对象副作用 | 重复副作用 |
|---|---|---:|---:|---:|---:|
| S01 | agent-browser-published | 3 | 3 | 0 | 0 |
| S01 | strict-ref | 3 | 3 | 0 | 0 |
| S01 | context-reobserve | 3 | 3 | 0 | 0 |
| S02 | agent-browser-published | 3 | 0 | 0 | 0 |
| S02 | strict-ref | 3 | 0 | 0 | 0 |
| S02 | context-reobserve | 3 | 3 | 0 | 0 |
| S03 | agent-browser-published | 3 | 0 | 3 | 0 |
| S03 | strict-ref | 3 | 0 | 0 | 0 |
| S03 | context-reobserve | 3 | 0 | 0 | 0 |
| S30 | agent-browser-published | 3 | 0 | 3 | 0 |
| S30 | strict-ref | 3 | 0 | 0 | 0 |
| S30 | context-reobserve | 3 | 0 | 0 | 0 |

原始 CLI 参数、stdout/stderr、快照、截图、独立后端真值与源码副本：`C:\Users\17381\Desktop\research_browser\traces\agent-browser-2026-11-04T10-04-08-112Z`。

S01：两个同名按钮正常操作。S02：观察后重建并重排两行。S03：同一个 DOM 行被复用成另一个业务对象。S30：初始只有订单甲，观察后替换成唯一同名订单乙。
比较只覆盖确定性目标身份机制，不代表完整 Agent 成功率、模型规划或安全能力。执行器和 CLI 进程架构不同，不把总耗时用于性能优越结论。
npm tarball SHA-512 与 registry integrity 实际比对；下载 npm provenance 声明发布源为 de99b17824aff9697df6cbcbd8bd4314a60ba72d。未做 Sigstore 签名链验证，不将声明升级为密码学验证。该发布源不同于最初审计的 main SHA 6682da310c75bed8af340b39cc10b7f71bded155。
