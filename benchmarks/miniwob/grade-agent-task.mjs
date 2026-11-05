import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const configPath = process.argv[2] || 'benchmarks/miniwob/agent-task-config.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
const out = dirname(config.journal);
const oracle = JSON.parse(await readFile(join(out, 'original-oracle.json'), 'utf8'));
const protocol = (await readFile(config.journal + '.protocol.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
const actions = protocol.filter(r => r.direction === 'in' && r.payload.method === 'act');
const dispatches = (await readFile(config.journal, 'utf8')).trim().split('\n').map(JSON.parse).filter(r => r.event === 'dispatch_intent');
const reward = oracle.results[0];
const verdict = { task: oracle.task, seed: oracle.seed, sourceSha: '33c3b4ddef8c6eb67c57a29663d844b1eda7e614',
  taskCompleted: oracle.results.length === 1 && reward.done === true && reward.rawReward === 1 && reward.episodeMaxTime === 10000,
  rawReward: reward.rawReward, reward: reward.reward, elapsedMs: reward.elapsedMs, episodeMaxTime: reward.episodeMaxTime, episodeCount: oracle.results.length,
  cliActionCount: actions.length, dispatchCount: dispatches.length, protocolObservationCount: protocol.filter(r => r.direction === 'out' && (r.payload.observation || r.payload.type === 'ready')).length,
  gradedAt: new Date().toISOString(), mode: 'one Codex root-agent decision from visible query and CLI refs; separate from deterministic expert smoke', sourceAtGrading: {} };
for (const file of ['engine/executor.mjs', 'adapters/cli.mjs', 'benchmarks/miniwob/bridge.mjs', 'benchmarks/miniwob/grade-agent-task.mjs', 'package-lock.json']) {
  const bytes = await readFile(file);
  verdict.sourceAtGrading[file] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(out, 'graded-' + file.replaceAll('/', '-')), bytes);
}
await copyFile(configPath, join(out, 'task-config.json'));
await writeFile(join(out, 'verdict.json'), JSON.stringify(verdict, null, 2));
const report = ['# MiniWoB++ 原始公开任务：Codex 单次实操', '',
  `原始任务 ${oracle.task}，seed ${oracle.seed}，源码SHA ${verdict.sourceSha}。`, '',
  `独立读取上游原始奖励：rawReward=${verdict.rawReward}；时间衰减reward=${verdict.reward}；done=${reward.done}；原始上限=${verdict.episodeMaxTime}ms；环境计时到评分=${verdict.elapsedMs}ms。`,
  `本次CLI动作${actions.length}次，dispatch意图${dispatches.length}次，环境episode结果${oracle.results.length}次。严格判定taskCompleted=${verdict.taskCompleted}。`, '',
  '根Agent只从CLI可见query与目标refs作选择，未读原始任务源码/隐藏reward global；研究职责在其通知完成后才读取独立原始奖励报告。页面未改任务、奖励或计时，只通过桥接脚本初始化和被动上报。启动前的Node REPL process全局和Chrome可执行文件路径错误发生在导航前，未开始episode，未改原始时限。', '',
  `原始oracle、协议ready/observe/act、执行账本、配置及源码快照：\`${out}\`。服务启动时与判分时源文件快照分别保留；sourceAtGrading不冒充自动记录的进程加载时源码哈希。`, '',
  '**这是原始公开任务的一个真实Codex实操样本，不是公开任务集成绩，不代表通用任务成功率或模型性能排名。** 另外12次预编写专家策略的环境冒烟在[miniwob-smoke.md](miniwob-smoke.md)分报，没有混入本样本。原始客户端oracle不是抗篡改后端真值系统。模型成本/Token未可靠导出，标为unknown。'];
await writeFile(oracle.task === 'click-button' ? 'reports/miniwob-codex.md' : `reports/miniwob-codex-${oracle.task}.md`, report.join('\n') + '\n');
console.log(JSON.stringify(verdict, null, 2));
