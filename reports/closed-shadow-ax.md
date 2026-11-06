# S14 封闭 Shadow DOM 的能力边界

在真实 Chrome 中创建封闭 Shadow 根，内部有两个按钮，分别登记南京 B-681 与苏州 A-417。页面脚本读取宿主的 `shadowRoot` 得到 `null`，普通 DOM 执行器返回零目标并明确报告封闭 Shadow 根的观察缺口。此阶段后端零写入。

受信任的实验宿主通过 Chrome DevTools Protocol 取得无障碍树，发现两个按钮且目标名称唯一。宿主按目标节点取得内容框，在中心坐标执行一次真实点击。后端只收到苏州 A-417 一次请求。该替代通道使用标准浏览器接口，由测试脚本固定目标，无模型调用。[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/#method-getFullAXTree)

当前证据覆盖静态顶层页面中的可访问控件。通用 AX 派发、同名节点、遮挡、跨帧和身份复核仍待验证。普通 DOM 的缺口说明保持有效。

复现命令 `node --test tests/closed-shadow-ax.test.mjs`。[DOM 缺口、AX 节点和后端结果](../traces/closed-shadow-ax-2026-11-06T01-40-00-920Z/result.json)
