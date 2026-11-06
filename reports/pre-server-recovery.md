# S24 请求抵达后端前的断线恢复

在真实 Chrome 中点击苏州到货单的登记按钮。Playwright 路由拦截了唯一一笔业务 POST，在转发前以 `ERR_CONNECTION_RESET` 中断请求。浏览器点击回执为 `sent`，页面后置条件未达成，业务结果保持 `unknown`。

关闭并重新打开执行器后，原操作 ID 仍被持久化账本拒绝。受信任的实验宿主同时核对了该请求的故障注入记录、浏览器失败事件和后端零写入记录，将原操作与补交 ID 关联并落盘，再重新使用已观察到的目标发出一次补交。页面显示已登记，后端只记录一笔苏州到货单。

补交授权来自实验宿主掌握的转发前拦截证据。普通网络错误、单次后端空查和迟到响应仍可能对应未决写入，通用自动恢复策略待验证。

复现命令 `node --test tests/pre-dispatch-network-fault.test.mjs`。[浏览器与后端结果](../traces/s24-before-server-2026-11-06T01-02-14-389Z/result.json) · [动作账本](../traces/s24-before-server-2026-11-06T01-02-14-389Z/actions.jsonl) · [补交授权](../traces/s24-before-server-2026-11-06T01-02-14-389Z/reconciliation.jsonl)
