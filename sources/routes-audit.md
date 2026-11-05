# 跨技术路线审计与实际运行边界

日期：2026-11-04。承接 `core-audit.md`；S=固定版本源码，R=本地实测，I=推断/待验证。这里拓展完整 Agent/局部程序、视觉模型、评测环境、会话基础设施、页面工具协议五条路线。原始模块探针不替代完整系统 benchmark。

## 版本、许可与实际运行程度

| 路线 / 项目 | 固定 commit | 版本 / 许可 | 本轮运行 |
|---|---|---|---|
| 完整 Agent：Browser Use | `b49a68e4060acb226da8f784194fef301c53a6d7` | 0.13.14 / MIT | 原始 URL 安全函数；没有模型完整任务 |
| 程序式控制：Browser Harness | `b5202aefe2cff511208d5303e09670b5740c99f9` | 0.1.13 / MIT | 上游原始 IPC 单测 13 项通过，使用该 SHA 模块 |
| 视觉 Agent + verifier：Fara | `a675d6d61c41c47ae87bacefeab22caad18e3e84` | pyproject 动态版本 / MIT | 原始 verifier 评分函数局部探针；未加载模型 |
| 评测：BrowserGym | `27a90ce815098f43414e93491e06907af468e45b` | core 0.14.4 / Apache-2.0 | 实际 BrowserEnv reset/step/validate + 本地自定义任务 |
| 环境：Steel Browser | `d86cc79917f53e00c7158cd639781b944354d06c` | 0.5.4 / Apache-2.0 | 源码审计；未启动完整服务 |
| 页面工具协议：WebMCP | `6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2` | 提议标准 / W3C Software and Document License | 本地 Chrome 注册→发现→调用→注销；无模型 |

所有 GitHub 文件与 SHA-256 在 `routes-versions.json`；文件均保存在 `sources/vendor`，树索引均未截断。Chromium 补充版本为 `e69d3115830cdbd2bf0053b1bc50aba5fa5b56e1`，是在线当前源码，**不是本机 Chrome 编译提交证明**。

## 完整 Runtime：Browser Use

**S** `Agent.step` 先准备浏览器上下文，再模型推理和执行；`run` 承担循环、失败阈值和停机。`multi_act` 对 error/done 停止串行序列，还会根据动作元数据与 URL/focus 变化停止后续动作，不能把它简单归类为“盲目连续点选”（[service.py L1036–1103](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/agent/service.py#L1036)，[L2817–2848](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/agent/service.py#L2817)）。

**S** `take_step` 在 history done 后可选运行 judge，再回调；不是每个动作自带外部业务 oracle（[L2272–2305](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/agent/service.py#L2272)）。仅凭 `history.is_successful()` 不能成为本研究独立真值。

**S** DomService 同时处理 AX、snapshot bounds、可见性与 iframe；DefaultActionWatchdog 是实际动作事件处理层，SecurityWatchdog 是域名策略，三者分工不同，不应把域名白名单当业务动作授权（[dom/service.py](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/dom/service.py)，[default_action_watchdog.py](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/browser/watchdogs/default_action_watchdog.py)，[security_watchdog.py L176–250](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/browser_use/browser/watchdogs/security_watchdog.py#L176)）。

**R** `probe-routes.py` 原样抽取 `_is_ip_address` 函数体运行：127.0.0.1、整数、hex、短 IPv4 均识别为 IP，example.com 不识别。只证明所测 URL 分类器分支；不证明端到端 SSRF 防护、重定向防护或注入防护。完整 Runtime 未运行，原因是本轮没有配置模型服务，且整个依赖/浏览器版本矩阵尚未固定。

## 局部程序与常驻连接：Browser Harness

**S** `helpers.cdp` → `_send` → `_ipc.request` 是单次 JSON IPC；Windows 是 loopback TCP + token，POSIX 是私有 Unix socket。`_send` 超时后抛 `_IPCResponseTimeout` 并关闭客户端 socket，没有在这里自动重试（[helpers.py L48–78](https://github.com/browser-use/browser-harness/blob/b5202aefe2cff511208d5303e09670b5740c99f9/src/browser_harness/helpers.py#L48)，[_ipc.py L90–116](https://github.com/browser-use/browser-harness/blob/b5202aefe2cff511208d5303e09670b5740c99f9/src/browser_harness/_ipc.py#L90)）。这不证明 daemon 已撤销发出的 CDP 操作。

**S** `switch_tab` attach 后通过 `meta=set_session` 改 daemon 的当前会话；可选与可见 tab activation 分开（[helpers.py L399–427](https://github.com/browser-use/browser-harness/blob/b5202aefe2cff511208d5303e09670b5740c99f9/src/browser_harness/helpers.py#L399)）。**I** 共用同一个 daemon 名称而依赖默认 session 的多个程序可能互相切换目标；需要每任务独立 BU_NAME/daemon，或显式 session_id 与序列化写操作，不能把复用连接当并发隔离证明。

**R** 固定 SHA 的 `_ipc.py`、paths.py、原始 `tests/unit/test_ipc.py` 在临时 BH_RUNTIME_DIR/BH_TMP_DIR 下运行：13 passed。测试用 mock 验证路径命名、ping/identify PID 与 payload 校验等，不连接用户 Chrome；不是完整 daemon 性能测试。对应上游测试：[test_ipc.py](https://github.com/browser-use/browser-harness/blob/b5202aefe2cff511208d5303e09670b5740c99f9/tests/unit/test_ipc.py)。

## 视觉模型与评价：Fara

**S** Fara15Agent 从截图构造模型输入，解析 `<tool_call>`，按模型显示坐标空间映射到 viewport；`_proc` 以 DISPLAY_SIZE=1000 映射，非 backend-node 身份定位（[fara15_agent.py L220–314](https://github.com/microsoft/fara/blob/a675d6d61c41c47ae87bacefeab22caad18e3e84/src/fara/agents/fara/fara15_agent.py#L220)，[L440–503](https://github.com/microsoft/fara/blob/a675d6d61c41c47ae87bacefeab22caad18e3e84/src/fara/agents/fara/fara15_agent.py#L440)，[coord_spaces.py](https://github.com/microsoft/fara/blob/a675d6d61c41c47ae87bacefeab22caad18e3e84/src/fara/agents/coord_spaces.py)）。因此坐标转换是可复用层，业务对象核验仍须额外机制。

**S** MultimodalRubricAgent 分开计算过程 rubric、outcome、critical-point violation；`_outcome_verification` 的 prompt 包含 predicted_output、action_history、rubric 与证据摘要，然后调用 GPT5 client 并校验输出布尔类型（[mm_rubric_agent.py L2757–2826](https://github.com/microsoft/fara/blob/a675d6d61c41c47ae87bacefeab22caad18e3e84/webeval/src/webeval/rubric_agent/mm_rubric_agent.py#L2757)）。这是一种轨迹知情的 LLM judge，**不是对 Agent 自评盲化的程序化真值**；若借鉴，需要额外报告与 backend oracle 的混淆矩阵。

**R** 原样 AST 提取 `_validate_rescore` / `_compute_final_scores`：大于 max、NaN、字符串分值被拒绝；未满足的 conditional 项不计入分母；布尔 True 被 number 校验接受（Python bool 是 int 子类）。后者是已运行的 schema 边界事实，不足以说明真实 evaluator 发生多少错判。完整模型/verifier 未运行：需要模型与 judge 端点、轨迹和截图数据；本轮不下载大模型，不调用商业模型，不给 verifier 准确率。

## 可复现评价环境：BrowserGym

**S** AbstractBrowserTask 明确分 setup / validate / teardown。BrowserEnv `step` 执行动作，`post_step` 调 `_task_validate` 获取 reward/done，然后再取观察；同时记录动作错误。环境 terminated 可以来自任务 done 或 Agent 声明 infeasible，因此不能把 terminated 当 success（[task.py L31–76](https://github.com/ServiceNow/BrowserGym/blob/27a90ce815098f43414e93491e06907af468e45b/browsergym/core/src/browsergym/core/task.py#L31)，[env.py L432–555](https://github.com/ServiceNow/BrowserGym/blob/27a90ce815098f43414e93491e06907af468e45b/browsergym/core/src/browsergym/core/env.py#L432)）。

**S** 内置 OpenEndedTask validate 只是用户 exit 控制结束，reward 始终 0，不能直接拿 open-ended runner 当结果裁判（[task.py L79–122](https://github.com/ServiceNow/BrowserGym/blob/27a90ce815098f43414e93491e06907af468e45b/browsergym/core/src/browsergym/core/task.py#L79)）。Miniwob 需要 MINIWOB_URL、core JS、ready 标志；本轮没有准备上游 MiniWoB 数据服务器，不宣称跑过公开任务集（[miniwob/base.py L47–145](https://github.com/ServiceNow/BrowserGym/blob/27a90ce815098f43414e93491e06907af468e45b/browsergym/miniwob/src/browsergym/miniwob/base.py#L47)）。

**R** 从固定 SHA 下载完整 core/src（23 文件）直接运行 BrowserEnv，用自定义本地“准确登记一次”任务：仅发送“Task complete”后 reward=0/done=false，真实点击后记录数=1/reward=1/done=true，validate 共调用两次。该任务只验证评测管线和自评隔离；不是跨站通用 Agent 测试。

**版本偏差公开**：上游 requirements 锁 Playwright 1.44，本机 Python 1.58.0、Chrome 155.0.8059.86、NumPy 2.4.4、Gymnasium 1.2.3。为避免改动主环境，只在 `.cache/routes-python` 安装 Gymnasium，其余使用已有依赖。这个探针能运行，不等于复现官方依赖条件或成绩。Node 主线 Playwright 版本另见根锁文件，不与 Python 版混淆。

## 浏览器基础设施：Steel

**S** sessions route 把启动请求交 SessionService；startSession 处理 sessionContext、代理、指纹、视口、持久目录等。服务类维护一个 activeSession 和 pastSessions；结束时先关闭浏览器/CDP，再关闭代理并取稳定字节计数，最后登记 released session（[sessions.routes.ts](https://github.com/steel-dev/steel-browser/blob/d86cc79917f53e00c7158cd639781b944354d06c/api/src/modules/sessions/sessions.routes.ts)，[session.service.ts L93–184](https://github.com/steel-dev/steel-browser/blob/d86cc79917f53e00c7158cd639781b944354d06c/api/src/services/session.service.ts#L93)，[L278–333](https://github.com/steel-dev/steel-browser/blob/d86cc79917f53e00c7158cd639781b944354d06c/api/src/services/session.service.ts#L278)）。

**S** 上游已有 close 顺序与代理计数测试（[session.service.test.ts](https://github.com/steel-dev/steel-browser/blob/d86cc79917f53e00c7158cd639781b944354d06c/api/src/services/session.service.test.ts)）；本轮只读未运行。根 package 要 Node ^22.22.2 / ^24.15.0 / >=26，本机 24.14.1 不在声明范围，且 API 依赖未安装。因此没有把模拟 SessionService stub 报成 Steel 实例启动。需要在匹配 Node 的隔离环境安装完整服务后再验证 session 隔离、CDP 重连与 reset。基础设施可提供环境和账本，但不承担规划/业务成功判断。

## WebMCP：协议实际漂移与无模型调用验证

**S** 固定规范 `index.bs` 的 API 是 **document.modelContext**，提供 registerTool/getTools/executeTool，注册 signal 可以注销；与早期 navigator.modelContext 示例不能混用（[index.bs L714–739](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs#L714)，[README L269–306](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/README.md#L269)）。[官方 Chrome 说明](https://developer.chrome.com/docs/ai/webmcp) 将其描述为提议标准与网页工具接口；本研究不据作者可靠性主张推导完成率。

**S** [implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/implementation-status.md) 仍给出 Chrome Origin Trial 与本地测试 flag。Chromium about_flags 将 enable-webmcp-testing 映射到 kWebMCP；runtime feature 注释给出 `--enable-features=WebMCP`（本地保存对应源码行）。

**R** `probe-webmcp.mjs` 在临时独立 Chrome、本地 localhost 安全上下文上：默认无 document/navigator.modelContext；仅为测试启动浏览器加 `--enable-features=WebMCP` 后出现 document API。注册无副作用 echo 工具、getTools 发现、executeTool 得到原字符串、abort 后工具列表清空，全部实际完成，原始 JSON 在 `runs/webmcp-probe.json`。没有更改用户默认 flags、没有真实账户操作。这证明协议路径可调用，不证明站点普遍支持、不证明页面工具可信或工具返回就等于业务提交成功。

## 补充：一次点击也可能出现传输重发

**S** Chromium `HttpNetworkTransaction` 对 connection closed/reset/empty response 判断是否 resend；`ShouldResendRequest` 检查连接复用且未读到响应头，所见函数没有 HTTP method 判定（[固定源码 L2219–2239](https://chromium.googlesource.com/chromium/src/+/e69d3115830cdbd2bf0053b1bc50aba5fa5b56e1/net/http/http_network_transaction.cc#2219)，[L2438–2444](https://chromium.googlesource.com/chromium/src/+/e69d3115830cdbd2bf0053b1bc50aba5fa5b56e1/net/http/http_network_transaction.cc#2438)）。这提供浏览器层重发的机制证据，不是本机二次 POST 根因的完整证明；精确归因还需 NetLog 和本机构建映射。

[RFC 9110 §9.2.2](https://datatracker.ietf.org/doc/html/rfc9110#section-9.2.2) 讨论自动重试与非幂等方法的限制。实验应区分点击次数、浏览器网络请求次数、服务器提交次数。未知响应故障若目的是隔离 Agent 重试，可先 flushHeaders 再丢弃 body；原始丢 socket 场景应作为额外 transport replay 反例保留。即使执行器最多 dispatch 一次，没有服务端幂等仍不能承诺业务 exactly-once。

## 复现命令与结论范围

```powershell
python -m pip install --target .cache/routes-python --no-deps gymnasium==1.2.3
python sources/probe-routes.py
node sources/probe-webmcp.mjs
$env:PYTHONPATH = Join-Path $PWD 'sources/vendor/browser-harness/src'
$env:BH_RUNTIME_DIR = Join-Path $PWD '.cache/routes-harness/runtime'
$env:BH_TMP_DIR = Join-Path $PWD '.cache/routes-harness/tmp'
python -m pytest --confcutdir=sources/vendor/browser-harness/tests/unit -p no:cacheprovider sources/vendor/browser-harness/tests/unit/test_ipc.py -q
```

Fara/Browser Use 局部函数通过 AST 从固定文件提取执行，不能报告为完整模块 import 或模型运行；BrowserGym 是实际环境 import 与真实浏览器。每个小探针样本一次，没有成功率置信区间。现有证据足以支持采用成熟 browser driver、独立 validate、显式 coverage/副作用状态的研发方向；还不足以完成“每技术路线至少一个完整可运行核心项目”的全部广度要求，Steel 完整实例与视觉模型端到端尚待运行。
