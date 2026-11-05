# 模型接入：实际兼容性与当前边界

本机CLI `codex-cli 0.147.0`。遵照[官方非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)使用JSONL事件和输出schema，复用现有CLI认证；未读取、复制或打印认证令牌，未改全局模型/供应商配置。先按本机`--help`核实可用参数，未采用旧版`--full-auto`。

首次使用现有全局默认模型时，返回明确的`model_not_found`，未产生答案或usage，证据`traces/codex-decision-2026-11-05T01-12-54-245Z`。不能把它计成有效判断或零Token调用。初版结果中的`toolItems`错误地包含两条诊断error事件；原始事件没有命令/MCP执行。后续已把诊断与真实工具事件分开，历史文件保留。

通过[官方app-server协议](https://learn.chatgpt.com/docs/app-server)的`model/list`只读探针获取目录：`sources/runs/codex-model-catalog.json`。目录可能来自缓存，单凭目录不是推理可用证明。因此只明确指定其中默认`gpt-5.6-sol`/low做一次兼容性调用，实际成功，输出选中正确业务对象、usage为17721输入/53输出、无工具调用；证据`traces/codex-decision-2026-11-05T01-15-02-371Z`。没有自动试遍模型或切换供应商。

随后同一明确模型/effort用于真正自动的浏览器循环。8次调用、6次UI动作及1次主动观察后请求DONE，运行时仍返回unknown，由独立后端另行确认。详见[自动Harness独立回归](automatic-harness-regression.md)，不能把根Agent过去的手动操作、不同模型或专家脚本混入这组结果。

当前8次模型调用共155327输入+595输出=155922 tokens，cached输入为0，模型调用耗时合计77604ms（非全流程墙钟）。这暴露了每步启动完整CLI模型会话的较高成本；它是可运行接入，不是性能最优选择。应继续比较固定工作目录、常驻会话与专用模型接口，而非把观察JSON字节改善当作已兑现的Token改善。

禁用了常见shell/apps/browser/plugins/hooks/多Agent等功能，并对日志中非消息/推理的工具事件拒绝放行；但用户配置的MCP启动等仍可能存在，CLI不是敌对页面输入的强隔离纯模型端点。目前只发送合成任务。本轮无网页注入强度结论、无新供应商或Jev调用、无成本金额推算。

模型驱动循环的`done`不等于完成；后端未配置时保持unknown。后续工作树增加了缺失usage停机、回调异常、无效裁判证据拒绝等单测，它们没有热更新进已经启动的实验进程。实际运行源码副本与哈希在原运行目录，不能用后来的绿测倒贴覆盖原始运行版本。
