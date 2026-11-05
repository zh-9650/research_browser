# 核心候选源码审计与原始模块探针

审计日期：2026-11-04。审计范围：4 个候选的目标身份、动作反馈、恢复链路；不是全景研究完成声明，也不是成熟项目端到端性能排名。

证据分级：**S** 为所固定版本源码事实，**R** 为本地运行观察，**I** 为待验证推断，**A** 为作者主张。下文不把 I/A 当 R。

## 固定版本与使用边界

| 项目 | commit SHA | package 版本 | 许可证 | 本轮运行程度 |
|---|---|---|---|---|
| agent-browser | `6682da310c75bed8af340b39cc10b7f71bded155` | 0.41.2 | Apache-2.0（根 LICENSE） | 静态审计，未构建 Rust CLI |
| Nanobrowser | `19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458` | 0.3.0 | Apache-2.0 | 静态审计，未安装扩展 |
| Stagehand | `18b96f2227505695795208d7163e4fb03a9ae401` | SDK 4.3.0 | MIT | 原始 Progress 模块探针；未运行完整模型 act |
| Jev UltraFast | `8251e272398011cdef648965204d1c20cd838333` | 0.1.0 | MIT | 原始 snapshot.js 浏览器探针；未调用 TypeSafe |

本地 `vendor/<项目>/version.json` 保存仓库、提交日期；`tree.json` 为该 SHA 完整文件索引且均 `truncated=false`。任务书列出的上述 4 项目重点路径在这些提交全部存在，Stagehand 的 v4 路径本轮无需按旧版路径替换。`versions.json` 给出所有保存文件的 SHA-256 和固定 raw URL。这里只下载所审计文件，没有拉取整个构建依赖树。

## agent-browser：唯一名称恢复不等于业务身份恢复

- **S** 入口 `actions.rs` 命令路由将 click 交给 `handle_click`。其在 `interaction::click` 返回后给出 `{clicked: selector}`，并可能附 dialogOpened（[actions.rs L6758–6778](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/cli/src/native/actions.rs#L6758)）。该回执没有独立业务完成判定，不能把 CLI 成功直接计为任务成功。
- **S** `RefEntry` 保存 backend node、role、name、nth、selector、frame；普通 snapshot 引用允许 role fallback，而 `add_exact_backend_node` 禁止（[element.rs L8–111](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/cli/src/native/element.rs#L8)）。因此不应笼统说所有 ref 都自动修复。
- **S** `resolve_element_center` 先取旧 backend node 的 box model 并做 interception 检查；失败且允许 fallback 时，按 role/name 重读 AX tree（[L425–500](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/cli/src/native/element.rs#L425)）。`resolve_element_object_id` 有对应分支（L696–765）。
- **S** `find_node_id_by_role_name` 在旧快照 nth 非空时拒绝；`select_unique_node_id` 在现在有多个匹配时也拒绝（[L875–936](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/cli/src/native/element.rs#L875)）。**修正研究前提：当前版本不是任意挑第 nth 个同名按钮。** 不能拿早期实现印象声称这里已证实误点。
- **S** `observe_document` 按 page/frame/session/loader 维护 durable ref，`invalidate_page` 清空引用映射（[L145–231](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/cli/src/native/element.rs#L145)）。这证明有文档管理，不能据此推断所有 SPA 业务状态变换都等价于文档替换。
- **I** 仍需最小实验：快照中唯一“提交”属于订单甲，甲节点移除后仅剩订单乙的同名按钮，或者同一 backend node 被虚拟列表复用为乙。上述 RefEntry/恢复函数没有业务行摘要。唯一性保护并不证明其保存甲的业务身份；是否造成实际误操作，必须用固定版本 CLI 与 backend oracle 验证。本轮不把它报为已复现缺陷。
- **S** [evals/README](https://github.com/vercel-labs/agent-browser/blob/6682da310c75bed8af340b39cc10b7f71bded155/evals/README.md) 描述的技能评测不能替代本项目业务最终真值。需要单独保留动作层、任务层指标。

**可复用**：CDP、AX、iframe 与守护进程能力；先比较封装成本。**未决定**：不因上述潜在身份缺口直接 Fork 整个 CLI。

## Nanobrowser：把“所见对象”作为执行不变量

- **S** `RefRegistry` 将 ref 绑定到 tab/frame/loader/backend node；文档变化、frame/debugger detach 分别有 stale 原因，`KnownSet` 与 `lookupRef` 限制调用方只能用展示过的引用（[refs.ts L1–44、L184–218、L237–312](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/core/refs.ts#L184)）。
- **S** `resolveRecord` reconcile frame，校验 loaderId，解析节点，接着调用 `revalidate` 和 `checkRecordContext`；不是仅查 role/name（[resolve.ts L145–173](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/core/interaction/resolve.ts#L145)）。
- **S** `checkRecordContext` 要求按钮仍位于被展示的容器且容器内容 fingerprint 相同；容器丢失、节点不在行内、摘要变化均拒绝，并声明没有 dispatch。`context=null` 会跳过，因此其保证范围取决于观察时是否成功形成上下文（[L176–219](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/core/interaction/resolve.ts#L176)）。
- **S** `assertAsShown` 专门给 actionability 等待、滚动及 hover/press 之后再次检查 role/name，可选同时复查行上下文（[L346–359](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/core/interaction/resolve.ts#L346)）。这比只在方法入口检查更接近输入前的时刻；仍不构成浏览器到后端的原子事务保证。
- **S** 回执类型区分 dispatched（含 unknown）、effect、postcondition、用户批准来源；page read-back 失败可单独返回 pageError，不覆盖原动作回执（[results.ts L25–72](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/protocol/results.ts#L25)）。
- **S** `withEvidence` 在 dispatch 前建立 baseline，dispatch 后 settle；dispatch 自身抛错时 dispose 后抛出（[evidence.ts L436–461](https://github.com/nanobrowser/nanobrowser/blob/19dc8e8a9be6ed06c0ef9ec7de8d84bf6a88c458/src/browser-control/core/interaction/evidence.ts#L436)）。仅看到 receipt 类型有 unknown 不能证明所有异常调用点都妥善分类，仍需沿具体工具 catch 路径审计。
- **I** 全行文本 fingerprint 可能因合法状态/余额变化造成误拒绝；缺少行上下文时可能漏检。下一实验必须同时测正常动态变化、虚拟行复用及重观察恢复成本。

**可复用机制**：文档与业务容器双重身份、输入前复核、分层回执。**未实测边界**：扩展 `chrome.debugger` 冲突、多连接控制者、真实站点 false rejection，不能凭源码声称已解决。

## Stagehand v4：动作自修复与事务恢复应分开

- **S** `act` → `runWithProgress` → `actWithProgress` → cache/full pipeline。默认 selfHeal=false；开启后，确定性动作抛非 TimeoutError 才抓取新快照并再次让模型选择元素（[actService.ts L62–83、L361–465](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/services/actService.ts#L361)）。修复对象是局部动作/selector，不是独立任务真值。
- **S** `successfulActionResult` 的 success 来源是执行函数返回；没有订单/记录级 oracle（[L525–542](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/services/actService.ts#L525)）。
- **S** `replayCachedActions` 顺序重放，每个 action 成功后累积；中途失败会 throw。`withCache` 在 replay_failed 后再次跑 execute（[actService.ts L254–283](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/services/actService.ts#L254)，[cacheService.ts L264–303](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/services/cacheService.ts#L264)）。**I** 若缓存串前段已产生写入、后段失败，重新推理可能重复前段；本轮未完整复现，不报成已证实重复写缺陷。
- **S** cache key 的 shaping/hashing 在 API 服务端，该本地服务只收集 CDP tree 和请求参数；`buildCacheContext` 需要 browser sessionId 且 browserbase='client'（[cacheService.ts L22–68](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/services/cacheService.ts#L22)）。因此本地源码不足以审计服务端业务身份 key。不应推断所有本地 act 都必须购买该缓存服务。
- **S/R** `Progress.run` 使用 Promise.race；停止等候不撤销 work 的底层副作用（[progress.ts L47–96、L174–192](https://github.com/browserbase/stagehand/blob/18b96f2227505695795208d7163e4fb03a9ae401/packages/extension/understudy/progress.ts#L47)）。原始模块探针在 20ms deadline 后收到 TimeoutError，80ms 的模拟已发出请求仍完成一次。这个实验只证明 Progress 的取消语义，不证明 Stagehand 每个浏览器操作都会晚到提交。

**可复用**：观察、模型适配、定位和 deadline 工程。**必须外加**：持久化写意图、dispatch 不确定状态、业务 read-back，不能靠 timeout 后直接 self-heal 替代。

## Jev UltraFast：合法动作空间有实际边界

- **S** `action_space` 将已观察节点分配索引，各操作维护自己的可选目标；`validate_choice` 检查 choice 集合、概率 keys、有限值、归一与最大项（[model.py L32–83](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/jev_ultrafast/model.py#L32)）。这约束模型只能选择候选，不证明候选召回足够或任务必然成功。
- **S** `choose` 直接调用 TypeSafe `/v1/systemone`；文本值另用 OpenAI compatible helper；本地依赖 browser-harness==0.1.13（[model.py L86–158](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/jev_ultrafast/model.py#L86)，[pyproject.toml](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/pyproject.toml)）。不调用专有接口也能验证候选/guard机制，但不能复现其模型效果。
- **S** snapshot 保持实际 DOM 节点 WeakMap 身份、对 click/select 保存邻近 form/dialog/article/li/tr/row 文本 guard；候选以 viewport 为限，最多 250 个，文本最多 6000 字符。没有递归 frame/shadow root 遍历，也无 coverage 完整性字段（[snapshot.js L1–115](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/jev_ultrafast/snapshot.js#L1)）。
- **R** 实际 Chrome 执行未经修改的 snapshot：保留同一个 button，将订单甲行文案改为乙，node ID 不变、guard 改变；证明 guard 对这一受控行复用有辨别能力。另一页只有 iframe 和 open shadow root 各一个按钮，候选 click=0，实际按钮=2；证明这个快照路径会漏掉这些控件。完整结果见 `runs/original-modules.json`。
- **S** `Browser.fresh` 对 click/select 比较 pageKey+guard，输入执行另做 visibility/disabled/hit-test，返回 `{executed: id}`；这依然是执行回执（[browser.py L88–106、L135–185](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/jev_ultrafast/browser.py#L88)）。坐标解算到输入 dispatch 是多个协议往返，不能声称原子。
- **S** `Agent.command('act')` 先消费 decision 再动作，防止同一次调用重用同一 decision；但 DONE 直接来自模型选择并检查页面 freshness，不含独立业务 oracle（[agent.py L101–129](https://github.com/browser-use/jev-ultrafast/blob/8251e272398011cdef648965204d1c20cd838333/jev_ultrafast/agent.py#L101)）。内存单次消费不等于服务端幂等，也不等于进程重启后不重复执行。

## 运行证据与复现

命令：`node sources/probe-original-modules.mjs`。环境：Windows，Node v24.14.1，Playwright 使用根 package-lock 版本，Chrome 155.0.8059.86（launch channel=chrome，临时隔离 profile，不接用户登录会话）。实验只用本地 setContent 与模拟异步 Promise，无付费模型调用、无真实业务写入。

代码执行 Stagehand 原始 Progress/errors 模块，使用 Node stripTypeScriptTypes(mode=transform) 去除 TS，并仅把相对错误模块 import 重定向到同版本模块；Jev snapshot 原始文件直接交给 page.evaluate。输出是微型机制测试，样本各 1 次；没有置信区间，也没有完整 Agent、同模型任务基线。本轮结果支持“身份上下文值得验证”“超时不等于取消”，反驳“这个候选生成器已完整覆盖 iframe/shadow”。

## 对主线的决策建议

1. 第一批对照分开设 baseline：backend node only、role/name unique fallback、node+行身份 guard；记录误拒绝和误对象，不把自建弱基线冒充成熟系统。
2. 未知 dispatch 与已发送结果未知要进入禁止自动重放状态；先用只读观察确认，业务真值不能读取 Agent 成功宣告。
3. 给观察输出显式 partial/coverage；漏召回要能通过再次感知/切换通道恢复，不能无候选就误报任务完成。
4. 在固定版本成熟工具原样运行之前，不声称优于 agent-browser / Stagehand / Nanobrowser；本报告不构成全任务书验收。
