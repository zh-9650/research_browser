# 自动模型 Harness：独立后端回归判分

日期：2026-11-05。任务：新建采购申请，用途“华东客户交流会资料制作”、交付城市苏州、预算 1680 元、归属项目“客户成功计划”；核对后提交一次，不创建额外申请。

## 独立结果

裁判只在自动执行结束、浏览器关闭后读取后端。预声明要求全部字段精确一致、创建数为 1、HTTP 提交数也为 1。

| 指标 | 结果 |
|---|---:|
| taskCompleted | true |
| 创建记录数 | 1 |
| HTTP 提交数 | 1 |
| 错误记录数 | 0 |
| 重复副作用 | 0 |

原始申请编号为 `REQ-712bf27c`，后端记录的四项字段全部与任务相同。此结论来自 `oracle.json`，不是模型输出的编号或“已完成”声明。

## 自动执行与真值分离

请求模型为 `gpt-5.6-sol`、reasoning effort `low`，使用现有 Codex CLI 账号。8 次模型调用依次输出 `fill / select / fill / select / click / click / observe / done`，没有向模型提供这串步骤脚本或站点选择器。模型只接收可见观察、目标、硬约束及历史；各次运行记录 `toolItems=[]`。

记录的 CLI usage 总计为 155,922 个 input+output tokens；这包含 CLI 上下文开销，不能解释成浏览器快照本身的长度。没有计价或与其他系统的费用优越性声明。

Runtime 正确保留 `terminal=MODEL_DONE_UNVERIFIED` 与 `taskResult.status=unknown`、原因 `no_independent_verifier`。模型 `done` 没有被自动换成成功。之后本独立后端裁判根据服务器状态另行确认完成；结果文件没有被追改成 Runtime 已独立验证。

## 可追溯证据

- 自动执行：`traces/model-agent-2026-11-05T01-19-24-597Z/`，包含 8 次模型输入/响应、动作日志、最终截图、result.json、environment.json 和启动时源码副本。
- 独立服务与裁判：`traces/independent-2026-11-05T01-18-25-830Z/`，包含 server.mjs、预声明 grade.mjs、grade-hash.json、task-config.json、regression-manifest.json、oracle.json、verdict.json。
- 独立复核生成的 `independent-source-integrity.json` 确认启动时保存的 6 个源码/锁文件副本均与 environment.json 的 SHA-256 一致。
- `independent-usage-audit.json` 从实际逐步结果重新汇总调用数、usage 与决策种类。

主线在运行末期修改了后续工作树的单测和防御逻辑；这些没有热更新进本次进程。本报告只引用启动时副本及其哈希，不把后来的工作树版本倒贴为本次执行证据。

## 独立性与限制

本轮使用原独立作者页面和原裁判，重新创建完全隔离的服务器实例；没有为自动模型改页面或降低判分要求。裁判在执行前复制并固定，判分前不查看 Agent 成功声明作为依据。前一轮手动驱动报告 `reports/independent-task.md` 已原样保留。

根 Agent 之前已经操作过同一任务，因此本轮是**自动 Harness 回归与工程验证**，不是新的盲测、公开基准、未见站点或同模型成熟系统性能对照。只有一个样本，不能据此推导通用成功率、鲁棒性或对抗安全能力。执行层观察仍是部分 DOM；视觉任务、长链路与复杂站点能力尚需独立实验。
