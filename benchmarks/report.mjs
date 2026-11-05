import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

export function renderMechanismReport(data, resultsPath) {
  const { rows, environment: env } = data;
  const strategies = [...new Set(rows.map(r => r.strategy))];
  const sum = (r, key) => r.reduce((n, x) => n + (Number(x[key]) || 0), 0);
  const percentile = (r, p) => { const sorted = r.map(x => x.elapsedMs).sort((a,b) => a-b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]; };
  const lines = ['# 元素身份与未知提交：机制实验', '', `原始数据：\`${resultsPath}\`。重复数 ${env.repeats}；浏览器 ${env.browser}；Playwright ${env.playwright}；${env.os} ${env.release}；Node ${env.node}。`, '',
    '**这是固定故障注入与确定性选择器的机制实验，无 LLM，不是完整 Agent 排名或开放网站成功率。安全拒绝不计任务完成。**', '',
    '| 策略 | 样本 | 完成 | 错对象副作用 | 错对象请求 | 重复副作用 | 执行前拒绝 | p50/p90/p95 ms |', '|---|---:|---:|---:|---:|---:|---:|---|'];
  for (const strategy of strategies) {
    const r = rows.filter(x => x.strategy === strategy);
    lines.push(`| ${strategy} | ${r.length} | ${r.filter(x=>x.taskCompleted).length} | ${sum(r,'wrongObjects')} | ${r.some(x=>x.wrongTargetAttempts === undefined) ? 'unknown' : sum(r,'wrongTargetAttempts')} | ${sum(r,'duplicateEffects')} | ${r.filter(x=>x.refused).length} | ${percentile(r,.5)}/${percentile(r,.9)}/${percentile(r,.95)} |`);
  }
  lines.push('', '耗时包含环境创建、截图与等待，是该实验流程的墙钟时间；不能拿来证明不同进程架构工具的纯执行延迟优劣。模型调用/Token/模型费用为0；浏览器协议往返未精确计数，记为unknown；每次运行1张结果截图。', '',
    '| 场景 | 策略 | 完成/样本 | 错对象副作用 | 重复副作用 |', '|---|---|---:|---:|---:|');
  for (const task of [...new Set(rows.map(x => x.task))]) for (const strategy of strategies) {
    const r = rows.filter(x => x.task === task && x.strategy === strategy);
    lines.push(`| ${task} | ${strategy} | ${r.filter(x=>x.taskCompleted).length}/${r.length} | ${sum(r,'wrongObjects')} | ${sum(r,'duplicateEffects')} |`);
  }
  lines.push('', `逐次观察、日志、截图与执行源码副本：\`${dirname(resultsPath)}\`。报告可从该固定JSON重算，无需重新运行浏览器。`, '',
    '- position-fallback 是人为弱对照，不代表成熟工具；真实发布版对照见 agent-browser-baseline.md。',
    '- S03/S04/S06/S30/S34 无可安全执行目标或权限，预期拒绝；S27 是服务端业务拒绝的简化样本，未实现完整乐观UI回滚。拒绝和业务拒绝均不算收款任务完成。S06是目标被隐藏的变体，不等同完整隐藏同名控件选择覆盖。',
    '- S23 响应正文丢失；S23-transport 响应头前断连，保留浏览器内部HTTP重试导致的重复。动作账本不能承诺服务端exactly-once。',
    '- S32 是固定控制器，不是模型抗注入实验。',
    '- C01 可见DOM/节点不变、事件处理却改指其他对象，严格策略同样误写；C02 合法状态文字变化使完整容器指纹误拒绝。这些反证未剔除。',
    '- 各重置使用同构初态和随机业务ID；重复不是独立网站样本。没有统计显著性或泛化成功率主张，未做伪独立置信区间。',
    '- 源码副本属于当次执行，当前工作树后续改动不自动继承当次结果。');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw Error('用法: node benchmarks/report.mjs <固定results.json>');
  const report = renderMechanismReport(JSON.parse(await readFile(path, 'utf8')), path);
  await writeFile('reports/mechanism-results.md', report);
  console.log('已从原始JSON重算 reports/mechanism-results.md，未重跑浏览器。');
}
