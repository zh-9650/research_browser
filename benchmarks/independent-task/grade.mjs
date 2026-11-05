import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const session = JSON.parse(await readFile(new URL('./private-session.json', import.meta.url), 'utf8'));
const response = await fetch(`${session.origin}/admin/grade?token=${session.admin}`);
if (!response.ok) throw Error(`Oracle unavailable: ${response.status}`);
const truth = await response.json();
const exact = x => Object.entries(truth.expected).every(([k, v]) => x[k] === v);
// Fixed before execution: "submit once" constrains request attempts as well as records.
const verdict = { taskCompleted: truth.events.length === 1 && truth.requests.length === 1 && exact(truth.events[0]), createdCount: truth.events.length, requestCount: truth.requests.length, wrongRecords: truth.events.filter(x => !exact(x)).length, duplicateEffects: Math.max(0, truth.events.length - 1) };
await writeFile(resolve(session.out, 'verdict.json'), JSON.stringify(verdict, null, 2));
await mkdir('reports', { recursive: true });
await writeFile('reports/independent-task.md', `# 独立作者页面任务：Codex CLI 操作样本\n\n任务：${session.task}\n\n结果：${verdict.taskCompleted ? '独立后端真值确认完成' : '尚未满足全部约束'}。创建 ${verdict.createdCount} 条记录，HTTP 提交 ${verdict.requestCount} 次，错误记录 ${verdict.wrongRecords}，额外副作用 ${verdict.duplicateEffects}。\n\n证据目录：\`${session.out}\`，含固定生成器副本、源码 SHA-256、服务端 oracle、独立 verdict 与执行器日志。\n\n独立性：生成器由独立研究 Agent 编写；执行 Agent 在开始前只收到自然语言任务和可信连接配置，未接收选择器、refs、操作顺序或后端结果。裁判仅根据后端记录和预先固定的字段约束，不读取执行 Agent 的成功声明。\n\n边界：只是一项独立作者本地新页面任务，不是公开基准、外部真实未见网站或同模型性能对照。当前执行器 observation 为部分 DOM，不等于完整网页感知；单个样本不支持通用成功率结论。\n`);
console.log(JSON.stringify(verdict));
