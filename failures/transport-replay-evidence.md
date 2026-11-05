# NetLog 确认一次输入的传输重放

运行命令：`node sources/probe-transport.mjs`。原始结果见 `sources/runs/transport-netlog-summary.json`，包括 Chrome 版本、CDP requestId、各原始 NetLog 路径与 SHA-256。探针与 fixture 源码副本随运行保存。

两个故障模式各3次独立临时 Chrome profile，仅本地合成数据：

| 模式 | 单次 trusted click | 单次 JS fetch | 服务端提交数 | commit 对应 NetLog 重启事件 |
|---|---:|---:|---|---|
| 响应头前断连 | 每次1 | 每次1 | 2 / 1 / 2 | 1 / 0 / 1 |
| 响应头后正文中断 | 每次1 | 每次1 | 1 / 1 / 1 | 0 / 0 / 0 |

发生重复的两次运行中，commit URL 所属 sourceId 各记录 `HTTP_TRANSACTION_RESTART_AFTER_ERROR`，`net_error=-100`。CDP requestWillBeSent 仍仅一个逻辑请求；单看 CDP 逻辑请求或动作调用账本会漏掉传输内部重启。

因此现在有运行层证据把重复提交归因到浏览器 HTTP 事务重启，而不是 Agent 再点击或页面主动再次调用 fetch。该实验不是所有断连都重放的证明；复用连接与时序影响结果，本轮3次里1次没有重启。

固定 Chromium 源码路径与分支见 sources/routes-audit.md；那个在线源码 SHA 不是本机 Chrome 编译映射，不宣称源码版本完全相同。运行 NetLog 已独立确认本机行为。

结论：上层最多一次 dispatch 能限制 Agent 重试，不能推出服务端 exactly-once。结果未知时应核实业务状态、避免重复输入；若站点无可用去重/幂等协议，仍须保留不可消除的传输层重复风险。
