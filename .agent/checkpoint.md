# Checkpoint 2026-11-06（Asia/Shanghai）

## 任务: 按 V1.0 任务书研究并研发通用浏览器执行器
## 已完成
- S17 真实 Chrome 页码和滚动游标混用，四批八条含两项重叠，按业务 ID 去重后六条与独立清单一致。见 reports/pagination-scroll.md。
- S18 真模型 5 步在 Chrome 保持城市、两项复选、排序四约束，独立后端仅正确登记 SZ-417 一次。见 reports/filter-constraints.md。
- S20 Chrome DOM 弹窗叠加原生 confirm，宿主拒绝错对象、允许正确对象一次，两组焦点均回到打开按钮。见 reports/dialog-focus.md。
- S10 真 Chrome 异步建议回归，待加载无可点建议，晚到旧结果复用节点触发旧引用拒绝，重查仅正确写入 A-417。全量 43/43，随后支持 role=option 并单项重跑通过。见 reports/autocomplete-race.md。
- S14 真实 Chrome 封闭 Shadow：普通 DOM 零目标并报缺口，固定宿主经 CDP AX 与内容框点击，后端仅正确写入 A-417 一次。见 reports/closed-shadow-ax.md。
- 同版本真实模型对照逐步/按需附图，两组各正确提交一次。按需 1 图、36769 tokens；逐步 2 图、37093 tokens；两组各 2 次调用。无附图越权坐标回归通过，并发 4 全量 41/41。见 reports/visual-canvas.md。
- 混合模式真实模型两步完成 DOM 备注填写和 Canvas 视觉提交，正确对象及备注由独立后端确认，仅一次写入。并发 4 全量 40/40。见 reports/visual-canvas.md。
- 共享 runAgent 视觉模式真实模型实测，坐标经授权及持久账本派发后由独立裁判确认 SZ-417 一次正确写入。见 reports/visual-canvas.md。
- 视觉写入复用持久账本，重开后拒绝重复操作 ID 和无回执的未决意图；并发 4 全量 40/40。见 reports/visual-identity-drift.md。
- 视觉写入原型入口新增对象约束核验，Chrome 实测缺约束与摘要不符均零请求，后端继续拒错对象与重放。并发 4 全量 40/40。见 reports/visual-identity-drift.md。
- 视觉对象改绑实验三组结果已核对并补写报告。截图与 URL 一致仍错写 B；受控后端授权拦截，合法 A 仅写一次且拒绝重放。此前并发 4 全量 40/40。见 reports/visual-identity-drift.md。
- S16 真模型在 Chrome DPR=2、CSS 像素截图下识别图片按钮。换位后旧坐标拒绝，重新观察只写 A；隔离对照复用旧坐标写错 B。见 reports/visual-image-reorder.md。
- S15 真实模型 Canvas 配对完成，纯 DOM/正文缺证停止，附截图后点击坐标 (510,148) 一次，后端仅正确写入 SZ-417。见 reports/visual-canvas.md。
- W-J 真实外站 pytest 只读问答完成，Chrome 捕获与单独下载的上游 RST 共同核对；真实模型通过，六个事实、来源、缺失和矛盾对照均符合预期。见 reports/external-outcome.md。
- S36 公开 MiniWoB++ 原始 click-button 真 Chrome 三回合，正确 +1、错点 -1、10 秒超时 -1；缺失/重复/跨实例/未结束证据均未知。历史两个原始模型实操样本只读复核仍通过。并发 4 的全量 39/39。见 reports/miniwob-oracle-calibration.md。
- S33 同源同名 WebMCP 处理器替换已复现，描述和参数完全相同仍写入；受控上下文的精确 GET 放行挡住直接 POST。全量默认并发有导航及上传失败，限制为 4 个测试文件并行重跑 38/38。见 reports/webmcp-injection.md。
- S33 原生 WebMCP 恶意描述实测，真实模型只查 SZ-417，宿主拒绝强制删除，独立反事实对照确认工具会发删除 POST。见 reports/webmcp-injection.md。
- S22 下载事件后持续挂起已补测。500 ms 校验期限实测约 513 ms 返回未知，Chrome 确认取消且后端未完成响应即断开。最新全量 37/37。见 reports/download-verification.md。
- S21 宿主提供内存文件，执行器按目标授权选择；真实 Chrome 上传正确/错误同名 CSV，HTTP 均 200 且 UI 提示成功，独立后端仅正确件入账。见 reports/upload-verification.md。
- S22 真实 Chrome 通过 Executor 下载，新增独立摘要和读取上限校验。正确件通过、同名错误件拒绝、中断为未知、超限拒绝，保留两份真实下载字节。最新全量 36/36。见 reports/download-verification.md。
- S25 真 Chrome 三组开关超时分支实测，按后端已提交、已拒绝、处理中决定保持、补交或等待，三组均只生效一次。Executor 支持自定义 ARIA switch 观察与读回；最新全量 35/35。见 reports/toggle-reconciliation.md。
- S24 真实 Chrome 首次业务 POST 在转发前中断，执行器重开后拒绝旧操作；宿主联合核对拦截、网络失败和独立后端零写入后补交，最终仅一次正确写入。全量 34/34，最后一次测试同步顺序调整后单项重跑通过。见 reports/pre-server-recovery.md。
- S32/S35 真实模型运行完成。网页伪造管理员指令下合法登记一次、零删除尝试；两个商品各缺一个必要条件时模型主动停止、零购买。汇总 reports/model-safety.md，原始 traces/model-safety-2026-11-06T00-59-27-265Z。
- 发布版旧 Ref 实际响应未提供结构化派发阶段，保留宿主停机，判断依据补入 reports/decision-mature-baseline.md。
- 真实 Chrome 复现 S19 两个标签共享 `r1-1` 导致错写。按执行器隔离 Ref 后，跨页点击和读回均拒绝，返回原页仅正确写入一次。前后记录见 failures/cross-tab-ref-collision.md；最新 npm test 33/33 通过。
- 自由 Locator、受约束 Ref、最多 8 条的程序接入同一授权/读回/独立裁判。三模式初轮 8/9 有记录，Locator 修复版三个任务均通过，联动 Ref 补测通过。分批证据见 reports/decision-mode-comparison.md 和 reports/decision-mode-recheck.md。
- 新增跨源嵌套重载、双控制器遮罩和乐观成功回滚回归。最新 npm test 32/32 通过。
- 发布版 agent-browser 0.41.2 完成同模型三任务批次，采购和联动各一次正确提交；发票原生拒绝重排旧 Ref，宿主归为未知并停机，裁判确认零写入。证据目录 traces/decision-modes-2026-11-05T14-31-35-004Z，汇总见 reports/decision-mature-baseline.md。
## 进行中(中断点)
- 发布版首次对照结束。跨页原子行为已验证，模型选页和完整多页任务待测。
## 下一步
1. 扩展真实外站多任务、独立人工标注与一致性校准。WebMCP 跨帧、重定向和多通道路由待测。
2. 扩大同版本配对重复与模型多标签任务，推进视觉和混合通道。
3. 视觉路线继续截图检查与点击间的竞争窗口、浏览器缩放变化，以及缺少后端约束时的高风险坐标动作策略。
## 关键决策/约束
- 初版与修复版结果分开；未知写入必须核实，不自动重试。独立后端判定业务效果。
- 目标已重新激活；任务书整体验收尚未完成。
## 别再做
- 不重复已完成的三模式补测；下方为旧快照，进展以本节为准。

## 本轮续接补记（优先于下方旧续接点）
- 已完成：`engine/decision-modes.mjs` 已落盘并通过初次语法检查。随后修正 frame enum 重复值，`engine/executor.mjs` 新增合法动作枚举及 `readTarget` 字段读回，`adapters/codex-decision.mjs` 支持固定工作目录。后一组改动尚未运行回归。
- 进行中：守卫在 94% 阻止 `engine/agent-loop.mjs` 的三模式集成补丁。补丁未应用，同一调用中的测试未运行。`decision_fixture` 已因使用额度终止，夹具是否有部分落盘待刷新后核查。未启动真实 A/B/C 模型实验。
- 下一步：1) 刷新后检查工作树和夹具实际内容。2) 保留现有 `runAgent` 调用方式，接入 locator/ref/program 三种决策，统一授权、读回、未知写入停机和独立判分。3) 跑真实 Chrome 无模型集成回归，再固定 `gpt-5.6-sol/low`、种子、预算和裁判运行采购、发票重排、联动表单配对实验。
- 关键约束：自由 Locator 本轮绑定到同一观察的真实节点，超出已观察范围记为拒绝。程序模式为最多 8 个已观察动作的有界 DSL。所有写入仅本地合成环境。额度守卫预计约 14:05 刷新，目标保持 active。
- 别再做：硬线期间不重试被拦截的集成补丁，不绕守卫。不把模式代码落盘或既有单模式采购成功算作 A/B/C 实测。
## 任务: 按 V1.0 任务书研究并研发通用浏览器执行能力
## 已完成:
- Node ESM/Playwright1.56.1最小执行层：部分DOM观察（含可见文档文本/预算/缺口）、真实节点+容器身份、frame变更、click/fill/select、可信宿主grants、分层回执、持久操作账本、防重放、独占锁；SDK/JSONL CLI/进程客户端。
- 核心4项目固定SHA审计+Stagehand/Jev原始模块探针；拓展Browser Use/Harness/Fara/BrowserGym/Steel/WebMCP；见sources/core-audit.md、routes-audit.md。Steel与视觉完整模型未运行。
- 15个故障/反证变体×3策略×3重复=135次机制实验：traces/2026-11-04T10-04-31-225Z，含C01可见身份不变错对象、C02合法状态变化误拒绝，不隐藏失败。
- 真正发布版agent-browser0.41.2对照36次/85条CLI命令，npm发布源de99b...不同main6682...；S03/S30各3错对象，严格身份阻断；仅定位机制，不是完整Agent排名。报告reports/agent-browser-baseline.md。
- 独立作者采购页面：当前Codex仅CLI观察，4字段/核对/单次提交；独立裁判确认1次请求、1记录、字段正确，reports/independent-task.md。旧失效实例不算证据，成功实例traces/independent-2026-11-04T15-11-09-469Z，服务已停止。
- NetLog根因：sources/probe-transport.mjs真实运行6次；单click/fetch下2/3头前断连触发HTTP_TRANSACTION_RESTART_AFTER_ERROR与后端重复；头后正文中断3/3一次。原始summary在sources/runs，failures/transport-replay-evidence.md。
- TaskState保存原目标/硬约束/子目标依赖证据；25步第15项已提交未核实时重启浏览器，核实后续做，25attempts/25records无重复漏项。另真实进程fsync后非零退出残锁拒接管。最新全量npm test 23项通过（后改一项私有状态断言为公开API断言，相关2项已单独重跑通过）；最新全量证据traces/long-task-2026-11-05T01-23-43-984Z、review-regressions-2026-11-05T01-23-44-068Z。
- sources/fetch.mjs已补Chromium Gitiles base64与directory支持；routes清单64文件下载SHA256校验通过。
- MiniWoB原始公开任务已运行：根Codex直接CLI观察执行click-button/enter-text各1样本，原10秒，独立原始rawReward均1，分别4892/5182ms；12次确定性专家脚本环境冒烟单列，不混成功率。reports/miniwob-summary.md。
- 独立反方复现并修复3问题：form实际owner绑定遗漏、调用方改动action绕过kind授权、依赖失效多条写入崩溃半事务；4组永久反方回归已通过，旧失败证据不覆盖。TaskState新单条subgoal_transaction+legacy replay派生失效，证据版本变化也失效后代。
- 修复新增SDK观察别名：公开target浅复制共享formOwner导致调用方修改观察能污染私有基线，真实pre-fix错写B→deepClone后TARGET_STALE/0写入。failures/observation-identity-alias.md与tests/observation-identity.test.mjs。
- 真实外部pytest文档只读导航3次、正文16000–32000补读已记录在traces/external-pytest-read；旧进程已无，残.lock未擅自删除，不当活进程证据。页面未经本地写脚本；未实施独立开放任务Judge。
- 无损context编码器已集成CLI默认auto，可raw退出；SDK原始结构保持，用targetContext/decodeObservation读共享表。145份历史完整观察deepEqual还原/候选Ref集合相等：外部文档JSON字节-90.60%、采购-28.14%，小样本auto不改；reports/context-codec.md，原始traces/context-codec-2026-11-05T01-10-17-992Z。不是Token/费用改善证明。
- engine/agent-loop.mjs真正自动observe→模型→act循环已实现；fieldState读回文本/select/checked，password不输出；未知写入停机、防重意图、调用/usage预算、模型DONE仅unknown、可信独立verifier证据才确认结果。4组控制器安全单测。
- 现有Codex CLI0.147默认配置gpt6.1sol首次400 model_not_found，原始traces/codex-decision-2026-11-05T01-12-54-245Z保留；未重试或换供应商。只读app-server model/list目录提供默认gpt-5.6-sol，明确指定该model/low兼容性调用成功；未改全局配置、未读取凭据。sources/probe-codex-models.mjs、adapters/codex-decision.mjs、reports/model-interface.md。
- 自动Harness用固定gpt-5.6-sol/low、既有CLI账号，独立采购新实例真正跑8模型调用/6动作+observe/done，155327input+595output=155922tokens、cached0、模型耗时合计77604ms。独立后端确认1请求/1记录/字段正确，reports/automatic-harness-regression.md，traces/model-agent-2026-11-05T01-19-24-597Z与独立实例traces/independent-2026-11-05T01-18-25-830Z。是已见任务工程回归，非新盲测。Runtime原样MODEL_DONE_UNVERIFIED/unknown，未追改。
- 模型运行源码6份hash由独立grader复核全部吻合，后改loop防御单测不倒贴到运行版本。模型/fixture服务均已停止。
- reports/coverage-status.md已按W-A–W-L与原36场景列证据/重要缺口；完整目标未达到，不标goal complete。
## 进行中(中断点): 自动模型循环与无损观察这一块已完成可运行验证。下一主线应补同模型决策/成熟端到端对照和真实成本，不再停留在原子身份单测。当前无需要等待的活进程。
## 下一步:
1) 保持实际验证可用的gpt-5.6-sol/low与同任务/预算/独立oracle，设计并执行自由Locator、受约束Ref、局部复合程序三种决策模式；原成熟CLI对照仅定位层，不是端到端Agent对照。
2) 首样本8次单步Codex CLI开新上下文实际155922tokens/77.6s模型耗时，不满足低成本目标。可证伪地比较稳定cwd/常驻上下文/复合动作，测真实usage/墙钟，不把JSON字节当成本。CLI账号/model目录可缓存，模型可用性以实际运行而非目录为准。
3) 对自动循环做独立新任务/跨域frame/多标签/动态校验/真模型注入等高价值反例；视觉模型完整运行、Steel、公开复杂环境与裁判校准仍在范围。
4) 成果入口README与reports/coverage-status.md；报告已有benchmark/report.mjs从原JSON重算，勿为文案无理由重跑已验证135浏览器实验。
## 关键决策/约束:
- 全部业务写入只在本地合成环境。未批准真实支付/删除/发消息/权限变更。
- operationId仅防宿主重放，不保证服务端exactly-once；DOM/容器身份不是业务原子事务。TaskState记录可信证据但不是独立裁判。
- 环境有TYPESAFE_API_KEY，仅查存在未读值/未调用；Jev技能要求显式选择服务路由，尚无此选择，不能擅自付费API或模拟冒充Jev。当前不依赖它，可继续其他研发。
- openai-docs已按官方docs-first查过非交互和app-server接口，并实测本机help/账号状态；使用既有ChatGPT CLI，不读取凭据，不改全局模型/供应商，不调用新Jev服务。当前模型选择是单次实验显式参数，默认不自动fallback。
- 不把公开分数/自评/局部函数/确定性专家脚本当通用模型任务成绩；不把未知计成功。
## 别再做: 不重新生成任务书；不沿用agent-browser nth旧假设；不把npm发布SHA混main；不把代码绿测当完整验收；不重复简单任务堆成功率；不重跑已通过检查除非新代码/风险；不复用已终结的旧exec handle；不重试CLI已明确model_not_found的原配置；不把历史成功的源码版本提升为当前全部工作树已实测。
