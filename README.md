# 通用浏览器执行能力研究

按根目录 V1.0 任务书推进。当前是可运行的源码研究与机制实验，**尚未完成通用 Agent 验收**。

已实现：真实浏览器部分 DOM 观察、节点与容器上下文校验、frame 失效检测、受控 click/fill/select、宿主授权、持久化操作意图与同 operationId 防重放、SDK 与 JSONL CLI。后端独立 oracle 评估任务结果，浏览器回执始终保留 task_goal=unknown。

## 运行

Windows、Node >=22、已安装 Chrome。实际验证：Node 24.14.1、Chrome 155.0.8059.86、Playwright 1.56.1。安装使用项目专属缓存，避免共享 npm 缓存的 EEXIST 问题。

```powershell
npm ci --cache .cache/npm --ignore-scripts
npm test
npm run bench
node sources/fetch.mjs
node sources/probe-original-modules.mjs
```

`BROWSER_CHANNEL=msedge` 可供 benchmark 使用；本轮尚未验证 Edge。完整原始实验在 `traces/<运行时间>/`：results.json、源码副本与 SHA-256、各次观察/日志/截图。受控 benchmark 不调用模型，调用数与 token 均为 0，不报告推测模型成本。

## 从 Agent/宿主接入

`node adapters/cli.mjs <可信配置.json>` 启动隔离浏览器，输出 ready 和观察。配置由用户或可信宿主产生，不能从网页读取。格式：

```json
{
  "url": "http://127.0.0.1:3000/",
  "goal": "审核指定发票",
  "constraints": ["仅处理用户指定对象"],
  "journal": ".agent/task-invoice.jsonl",
  "grants": [{"origin": "http://127.0.0.1:3000", "kinds": ["click"], "name": "审核"}]
}
```

stdin 每行一个 JSON，请从最新观察中选择 ref；不接受任意 JS/Locator：

```json
{"id":1,"method":"observe"}
{"id":2,"method":"act","action":{"operationId":"review-invoice","kind":"click","ref":"r2-1"}}
{"method":"close"}
```

SDK：`import { Executor } from './engine/executor.mjs'`，传 Playwright Page、journal 路径和 grants。`act` 可接可信宿主的只读 postcondition 回调，局部后置条件不自动提升为任务完成。CLI 独立进程集成测试已运行；这不等于自然语言自动规划已完成。

CLI观察默认启用无损共享上下文：仅在JSON更小时，把重复的`target.context`移至`observation.contexts`字符串表，以`target.contextIndex`引用；它不是元素身份。用`engine/observation-codec.mjs`的`targetContext(observation,target)`读取上下文，或`decodeObservation`还原原始结构。配置`observationEncoding: "raw"`可保留旧格式。`observe`支持`options.textOffset`补读明确裁剪的正文，返回`offset/totalChars/nextOffset`；新观察会使旧Ref失效。输入框`fieldState`和select选项供读回，password值不输出；其它字段仍可能包含用户数据，只在允许保留该数据时捕获协议。

`engine/agent-loop.mjs`增加实验性`observe → 结构化模型决定 → act → 重新观察`循环：只接受已展示Ref，保留原始目标与硬约束，限制调用数与已报告Token，未知写入立即停止、不自动更换模型或重放。模型`done`仍是未验证状态；只有可信宿主`verifyGoal`提供带证据的独立结果才能确认完成。`adapters/codex-decision.mjs`使用既有Codex CLI认证，不读取密钥；禁用常见工具功能并拒绝发生工具调用的运行，但它不是敌对输入的强隔离模型沙箱。`experiments/model-agent.mjs <可信本地任务配置> <明确选定模型> <effort>`是目前的模型驱动实验入口，尚未完成同模型A/B/C或开放网站验收。

## 结果与边界

- [机制实验结果](reports/mechanism-results.md)：严格拒绝、上下文重观察、人为位置回退的配对探索；拒绝不算任务完成。
- [核心源码审计](sources/core-audit.md)：agent-browser、Nanobrowser、Stagehand、Jev 的固定版本与原始模块实测。
- [跨路线原始证据](sources/routes-audit.md)：BrowserGym 环境、Harness IPC、Fara 局部 verifier、Browser Use 与 WebMCP 实测，分别记录运行边界。
- [真实成熟 CLI 对照](reports/agent-browser-baseline.md)：36次固定发布版机制对照，不把弱位置策略冒充成熟工具。
- [独立作者新任务](reports/independent-task.md)：Codex 通过 CLI 完成采购申请，独立后端确认字段正确、单次请求、单条记录。
- [自动模型循环回归](reports/automatic-harness-regression.md)：固定模型8次决定完成已见采购任务，独立后端确认单次提交；155922 tokens与模型耗时分别记录，未冒充盲测或低成本成果。
- [长任务恢复](reports/long-task-recovery.md)：25项独立写入、第15项未确认时重启浏览器，核实后续做；另有真实进程非正常退出账本测试。
- [公开任务分层结果](reports/miniwob-summary.md)：2个真实Codex操作样本与12次专家脚本环境冒烟分别记录，不混成通用成功率。
- [无损上下文实验](reports/context-codec.md)：145份完整历史观察逐字还原；实测JSON字节，不冒充模型Token或成本改善。
- [传输重放失败](failures/transport-replay.md)：一次浏览器点击仍可能在服务端产生重复写入；上层 operationId 不能替代服务器幂等。
- [NetLog 根因证据](failures/transport-replay-evidence.md)：单次 trusted click/JS fetch，浏览器事务内部重启与重复后端提交。
- [研究假设](hypotheses/identity-and-recovery.md)、[当前决策](decisions/001-experiment-first.md) 与 [.agent/checkpoint.md](.agent/checkpoint.md) 记录后续工作。
- [完整覆盖账本](reports/coverage-status.md)逐项列出W-A–W-L与原36场景的证据和缺口；[模型接入记录](reports/model-interface.md)保留兼容性失败、实际usage与安全边界。
- [同模型三模式初始对照](reports/decision-mode-comparison.md)与[修复补测](reports/decision-mode-recheck.md)分别保留独立业务判分、模型用量与失败轨迹。
- [发布版 agent-browser 同模型对照](reports/decision-mature-baseline.md)单列原生 CLI 行为、共享宿主的终止原因及后端真值。

不提供 exactly-once 保证。身份复核与输入之间存在竞态窗口；同文本不同业务实体可能无法区分；观察不是完整 AXTree，Canvas/closed-shadow/图片语义缺失；没有请求级外传拦截或完整抗注入策略；当前日志与截图仅使用合成数据，尚无通用脱敏。

账本以 `.lock` 防止同任务双写；正常 close 释放，进程崩溃后残锁会阻止恢复。宿主必须确认原进程已退出、核实已发出的操作并保留账本后再手动处理锁，不能通过换 journal 或 operationId 绕过未知结果。尚无断电恢复实测。

可信宿主可用 `engine/task-state.mjs` 的 `TaskState` 持久保存原始目标、硬约束、子目标依赖与证据；重启时拒绝约束漂移，未知证据不能算完成，依赖证据失效会使后续状态失效。它是证据账本而不是独立裁判。`adapters/client.mjs` 提供无需shell的常驻CLI进程客户端，避免Windows终端等待占用短任务的全部时间预算。可用 `CAPTURE_PROTOCOL=1` 留存CLI输出，输入值省略；仅在允许保留页面内容的任务启用。

仍需完成：完整跨路线候选、同模型决策对照、36 场景全覆盖、独立外部未见站点、公开基准、视觉/长任务与安全专项。当前结果不支持“通用成功率 ≥95%”或“完整 Agent 优于成熟系统”的声明。
