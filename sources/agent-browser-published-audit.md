# agent-browser 发布版：补充源码与实际 CLI 验证

日期：2026-11-04。先前 `core-audit.md` 审计当前 main SHA；本轮实际运行 npm 0.41.2 的原始 Windows native CLI，二者源码版本不混用。

## 版本身份

- [npm 0.41.2 原始 metadata](https://registry.npmjs.org/agent-browser/0.41.2)，许可证 Apache-2.0。
- [原始 tarball](https://registry.npmjs.org/agent-browser/-/agent-browser-0.41.2.tgz) 的实际 SHA-512：`/agCKB5rw1EEK8SKWo4zid7a5kOwlclqALC0P3c69buJvKdhrl/dJkKdfLqGGaiNIbWzRdqqT0PxZVkwVEf2fg==`，与 registry 的 `dist.integrity` 一致。
- [npm provenance 声明](https://registry.npmjs.org/-/npm/v1/attestations/agent-browser@0.41.2) 的 resolvedDependencies 指向源码 SHA `de99b17824aff9697df6cbcbd8bd4314a60ba72d`。只做 payload 解码和 tarball hash 比对，未校验 Sigstore 签名链，因此称“发布方声明”，不称密码学证实的构建可追溯。
- 实际命令直接执行包内 `bin/agent-browser-win32-x64.exe`，`--version` 为 `agent-browser 0.41.2`；二进制 SHA-256、Chrome 版本和环境保存在每轮 `results.json`。

## 发布源码：解释所测现象

补取的原始 `cli/src/native/element.rs` 保存于 `sources/vendor/agent-browser-published/element.rs`，SHA-256 `63948ab764714459e76e44fa4694520c8d32103816d01b2c781515d99312084f`。

1. **源码事实**：[`resolve_element_center` L441–473](https://github.com/vercel-labs/agent-browser/blob/de99b17824aff9697df6cbcbd8bd4314a60ba72d/cli/src/native/element.rs#L441) 对有效旧 backend node 读取 box model、检查命中遮挡后直接返回坐标。该快速路径未比较业务行内容。由此提出同节点复用反例；是否误点由后端轨迹判断。
2. **源码事实**：[`find_node_id_by_role_name` L876–901](https://github.com/vercel-labs/agent-browser/blob/de99b17824aff9697df6cbcbd8bd4314a60ba72d/cli/src/native/element.rs#L876) 拒绝旧快照中已存在多个同名目标的恢复；[`select_unique_node_id` L905–934](https://github.com/vercel-labs/agent-browser/blob/de99b17824aff9697df6cbcbd8bd4314a60ba72d/cli/src/native/element.rs#L905) 拒绝当前多匹配。这与 S02 CLI 实际安全拒绝一致。
3. **源码事实**：[`resolve_element_center` L477–500](https://github.com/vercel-labs/agent-browser/blob/de99b17824aff9697df6cbcbd8bd4314a60ba72d/cli/src/native/element.rs#L477) 在允许 fallback 时按 role/name 获取新节点，再获取位置。旧快照唯一和新快照唯一不等于同一个业务对象，因此设计 S30 唯一同名对象替换实验。

## 实验与复现

代码：`benchmarks/agent-browser-baseline.mjs`。原始结果和每项统计见 `reports/agent-browser-baseline.md`；报告给出具体 trace 路径。每次新的独立后端实例、随机业务发票号、独立 CLI session；不使用现有 Chrome profile，不碰真实账号。

```powershell
npm install --cache .cache/npm
npm install --prefix .cache/baseline-agent-browser --cache .cache/npm-agent-browser agent-browser@0.41.2
# runner 默认使用下列精确 tarball 解包路径，也可用环境变量指向 npm 安装所得的同版 exe。
$env:AGENT_BROWSER_BINARY = "$PWD\.cache\baseline-agent-browser\node_modules\agent-browser\bin\agent-browser-win32-x64.exe"
$env:REPEATS = '3'
node benchmarks/agent-browser-baseline.mjs
```

当前 runner 的制品认证步骤还需要 `.cache/agent-browser-npm.json`、`.cache/agent-browser-attestations.json` 和 `.cache/agent-browser-0.41.2.tgz`。下载命令：

```powershell
Invoke-WebRequest 'https://registry.npmjs.org/agent-browser/0.41.2' -OutFile '.cache/agent-browser-npm.json'
Invoke-WebRequest 'https://registry.npmjs.org/-/npm/v1/attestations/agent-browser@0.41.2' -OutFile '.cache/agent-browser-attestations.json'
Invoke-WebRequest 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.41.2.tgz' -OutFile '.cache/agent-browser-0.41.2.tgz'
```

## 结论强度

这是同构任务、相同 Chrome 下的**目标身份机制对照**。S03/S30 中正确目标已经不存在，拒绝不计任务完成；因此不能用拒绝数量伪造任务成功率。完整 Browser Agent 若在动作前重新观察可以避免旧 Ref，故此实验不是“agent-browser 全局不安全”或“我们端到端更强”的证明。它为调用者明确了哪些观察与执行之间的状态变化，需要加入业务上下文复核。

真实测试中未使用 LLM；没有模型调用、Token 或模型费用优越结论；CLI 与 SDK 架构开销不作公平速度比较。
