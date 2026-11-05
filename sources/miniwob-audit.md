# MiniWoB++ 公开任务源码与运行边界

固定仓库：[Farama-Foundation/MiniWoB-plusplus](https://github.com/Farama-Foundation/MiniWoB-plusplus)，commit `33c3b4ddef8c6eb67c57a29663d844b1eda7e614`，提交时间 2026-08-13T20:55:32+02:00，许可证 MIT。`sources/miniwob-versions.json` 固定93个原始文件的 URL 和 SHA-256；源文件来自该 commit 的 Git blob，不以工作树换行转换后的文本充当原始校验值。

## 任务与裁判的实际来源

- **源码事实**：[core.js L44–50](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/core/core.js#L44) 定义原始奖励、done、ready 等环境状态，默认 `EPISODE_MAX_TIME=10000` 毫秒。
- **源码事实**：[core.startEpisode / startEpisodeReal L72–104](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/core/core.js#L72) 前者显示 START 同步遮罩，后者调用原任务 `genProblem`、清空上次奖励、启动超时。超时使用 `core.endEpisode(-1, false, 'timed out')`。
- **源码事实**：[core.endEpisode L106–143](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/core/core.js#L106) 仅在 episode timer 有效时计分，保留 raw reward，并按耗时可选衰减reward。done=true 不代表成功；错误输入和超时同样 done。我们的完成判定需要 `done && rawReward === 1`。
- **源码事实**：[click-button.html](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/miniwob/click-button.html) 随机生成文本/输入框/按钮，以公开 query 指定按钮文本。相同文本都属于正确目标；错误按钮raw reward=-1。
- **源码事实**：[enter-text.html](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/miniwob/enter-text.html) 仅提交内容精确等于随机目标姓名时raw reward=1，否则=-1。
- **源码事实**：[click-checkboxes.html](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/miniwob/click-checkboxes.html) 对各复选框正确/错误状态分别加/减1后除以项数；部分正确可能获得正奖励，不能简单用reward>0判整任务成功。
- **源码事实**：[choose-list.html](https://github.com/Farama-Foundation/MiniWoB-plusplus/blob/33c3b4ddef8c6eb67c57a29663d844b1eda7e614/miniwob/html/miniwob/choose-list.html) 使用选项可见文本与目标值精确比较。

## 本地桥接方式与限制

`benchmarks/miniwob/bridge.mjs` 提供隔离 localhost 静态服务，原始 core/common/task 文件固定版本。仅在 HTML body末尾注入初始化与奖励报告：load之后 `Math.seedrandom(seed); core.startEpisodeReal()`，与 BrowserGym标准启动方式同类；包装原 `core.endEpisode` 调用后上报其原始全局值。没有改变 genProblem、奖励函数、输入事件或计分逻辑。HTML served bytes 因 bootstrap 而不同于原文件，不能声称服务器返回原始逐字节HTML。

这不是通过 BrowserGym 完整默认配置运行，也不是 Farama Python/Selenium API 复现。Node Playwright 1.56.1、系统Chrome、临时profile、默认viewport，由本地 Executor执行。奖励读取来自上游页面内评分器，不是独立服务器业务数据库；受控CLI不暴露任意JavaScript，但完整敌对Agent若能篡改page JS，仍可破坏这类客户端oracle。这里不将它宣称为抗篡改裁判。

## 已实际运行

`node benchmarks/miniwob/smoke.mjs`：原始4任务 × seeds42/43/44 共12次，全部raw reward=1；各次原始10秒上限未修改。逐次指令、观察、动作回执、原始奖励、截图和运行源码副本位于 `traces/miniwob-smoke-2026-11-04T15-19-41-549Z`，汇总见 `reports/miniwob-smoke.md`。

这些是按任务类型预编写的确定性专家策略，不是通用模型规划，也不是未知网站验证；不能拿12/12宣称Agent成功率100%。

## 重现

```powershell
node sources/fetch.mjs sources/miniwob-versions.json
node benchmarks/miniwob/smoke.mjs
```

若需从Git完整取源：clone该仓库后checkout上述完整SHA。任务manifest已覆盖本轮用到的core/common资产和4个task文件，license一并保留。没有下载或调用外部模型。

## Codex 原始计时单次样本

`serve-agent-task.mjs` 为主Agent生成两个独立配置：click-button/seed173与enter-text/seed174。原始10000ms未修改，任务计时在CLI导航后load时才开始。主Agent可见query但未读取任务源码或隐藏reward。完成后本研究职责独立读取原始评分：两个样本rawReward均为1；前者4892ms、1次click，后者5182ms、1次fill+1次click。详见 reports/miniwob-codex.md 与 reports/miniwob-codex-enter-text.md；不与专家策略混报，也不根据两个简单样本作通用成功率结论。

首样本启动前由于Node REPL子进程缺系统Chrome环境，主线只增加可信配置 `executablePath`；此前journal及lock均不存在，任务尚未初始化，属于驱动启动环境修复而非任务时间修改。第二个实例从开始即使用显式Chrome路径。服务及所有临时浏览器均在结果保存后关闭。
