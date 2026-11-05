# Checkpoint 2026-11-05，额度硬线中断（Asia/Shanghai）

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
