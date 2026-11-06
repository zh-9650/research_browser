# 同模型决策模式配对实验

固定模型 gpt-5.6-sol，推理档 low，Chrome 155.0.8059.86，Node v24.14.1，seed 173。已留存 8/9 个计划运行。

原始数据和源码哈希位于 traces/decision-modes-2026-11-05T06-09-59-651Z/results.json。每个任务和模式使用独立 BrowserContext 和服务端实例。任务目标、随机种子、模型和预算按任务配对。每次上限为 10 次模型调用、20 次动作尝试、230000 个已报告 Token 和 150000 毫秒。

| 任务 | 模式 | 独立完成 | HTTP 提交 | 错误记录 | 重复副作用 | 模型调用 | 总 Token | 缓存输入 | 模型秒数 | 循环秒数 | 主要拒绝 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| procurement | locator | false | 0 | 0 | 0 | 10 | 195417 | 65024 | 92.00 | 92.56 | LOCATOR_NOT_FOUND ×8 |
| procurement | ref | true | 1 | 0 | 0 | 7 | 136551 | 0 | 71.50 | 72.17 | GOAL_VERIFIED |
| procurement | program | true | 1 | 0 | 0 | 3 | 58144 | 0 | 30.91 | 31.27 | GOAL_VERIFIED |
| invoice | ref | true | 1 | 0 | 0 | 7 | 131491 | 0 | 69.99 | 70.33 | MODEL_DECISION_INVALID ×3, TARGET_STALE ×1 |
| invoice | program | true | 1 | 0 | 0 | 5 | 94489 | 0 | 45.30 | 45.59 | TARGET_STALE ×1 |
| invoice | locator | false | 0 | 0 | 0 | 10 | 188570 | 162560 | 122.04 | 122.43 | LOCATOR_NOT_FOUND ×10 |
| cascading | program | true | 1 | 0 | 0 | 6 | unknown | unknown | 55.08 | 55.51 | GOAL_VERIFIED |
| cascading | locator | false | 0 | 0 | 0 | 1 | unknown | unknown | 6.76 | 6.84 | MODEL_UNAVAILABLE |

同模型的三个处理组共享候选观察、节点身份检查、授权、写入账本和独立后端裁判。自由 Locator 使用 Playwright 匹配后绑定到同一次观察的节点。程序模式最多八条已观察动作，整段预检后依次执行。时长包含各自定位、模型和读回开销，顺序按任务轮换。

每个单元格只有一次开发集样本。总 Token 含缓存输入，缓存命中单列。未获得实际金额账单，未估计统计显著性。该实验覆盖决策接口和局部复合程序，成熟工具的端到端对照另需执行。

原始运行在联动表单 Locator 组遇到模型服务额度拒绝，Ref 组尚未开始。程序组完成了后端提交，随后第 6 次模型请求被拒绝。前 5 次有效请求共报告 97,326 Token，整组用量保留 unknown。原始控制器把业务完成判分覆盖到了停止状态，补测版本分开保留 `terminal` 和 `controllerTerminal`。

采购的程序组把四项输入和一次进入核对页合并成一段，7 次模型调用降到 3 次。两组均有一次正确提交，Token 从 136,551 降到 58,144。发票的程序组和 Ref 组均从节点重排中恢复，7 次调用与 5 次调用的差异也包含 Ref 组的三次多余 click value 拒绝。

采购 Locator 原始失败来自模型把 `within` 当作标签名。发票 Locator 原始失败复用了完整可见行文本，Playwright `hasText` 与观察 `innerText` 的相邻单元格空白规则不同。修复和复验结果单列在 [复验记录](decision-mode-recheck.md)。
