# 跨标签页引用冲突

两个独立 Executor 分别观察苏州与南京到货单。两个页面都包含同名“登记到货”按钮，首次观察均分配 `r1-1`。把苏州引用提交给南京执行器后，后端实际收到一次 `POST /popup`。根因是引用编号只包含观察轮次和目标序号，缺少执行器归属。

修复后每个执行器在创建时分配独立引用命名空间。跨执行器的点击和读回均返回 `TARGET_STALE`。关闭弹出页执行器后两张浏览器标签仍然打开，回到苏州标签时原引用只提交 `POST /original` 一次。该回归使用真实 Chrome 和独立 HTTP 账本，标签选择由宿主完成。

[修复前后端记录](../traces/tab-ownership-2026-11-06T00-57-36-124Z/cross-tab-attempt.json) · [修复后后端记录](../traces/tab-ownership-2026-11-06T00-57-55-183Z/result.json) · [回归脚本](../tests/tab-ownership.test.mjs)
