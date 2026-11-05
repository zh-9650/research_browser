import { readFile, writeFile } from 'node:fs/promises';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw Error('用法: node experiments/report-decision-modes.mjs <results.json> <report.md>');
const result = JSON.parse(await readFile(source, 'utf8'));
const text = [
  '# 同模型决策模式配对实验',
  '',
  `固定模型 ${result.model}，推理档 ${result.reasoningEffort}，Chrome ${result.browser}，Node ${result.node}，seed ${result.seed}。已留存 ${result.rows.length}/${result.planned.length} 个计划运行。`,
  '',
  `原始数据和源码哈希位于 ${source}。每个任务和模式使用独立 BrowserContext 和服务端实例。任务目标、随机种子、模型和预算按任务配对。每次上限为 ${result.budgets.maxModelCalls} 次模型调用、${result.budgets.maxActions} 次动作尝试、${result.budgets.maxTokens} 个已报告 Token 和 ${result.budgets.maxWallTimeMs} 毫秒。`,
  '',
  '| 任务 | 模式 | 独立完成 | HTTP 提交 | 错误记录 | 重复副作用 | 模型调用 | 总 Token | 缓存输入 | 模型秒数 | 循环秒数 | 主要拒绝 |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
];
for (const row of result.rows) {
  const errors = new Map();
  for (const code of row.errors) errors.set(code, (errors.get(code) || 0) + 1);
  text.push(`| ${row.taskId} | ${row.mode} | ${row.completed ?? 'unknown'} | ${row.requests ?? 'unknown'} | ${row.wrongRecords ?? 'unknown'} | ${row.duplicateEffects ?? 'unknown'} | ${row.modelCalls} | ${row.tokenAccountingComplete ? row.tokens : 'unknown'} | ${row.tokenAccountingComplete ? row.cachedInput : 'unknown'} | ${(row.modelElapsedMs / 1000).toFixed(2)} | ${(row.elapsedMs / 1000).toFixed(2)} | ${[...errors].map(([code, count]) => `${code} ×${count}`).join(', ') || row.terminal} |`);
}
text.push('', '同模型的三个处理组共享候选观察、节点身份检查、授权、写入账本和独立后端裁判。自由 Locator 使用 Playwright 匹配后绑定到同一次观察的节点。程序模式最多八条已观察动作，整段预检后依次执行。时长包含各自定位、模型和读回开销，顺序按任务轮换。', '', '每个单元格只有一次开发集样本。总 Token 含缓存输入，缓存命中单列。未获得实际金额账单，未估计统计显著性。该实验覆盖决策接口和局部复合程序，成熟工具的端到端对照另需执行。', '');
await writeFile(output, text.join('\n'));
