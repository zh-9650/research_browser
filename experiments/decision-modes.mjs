import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';
import { startDecisionFixture, decisionTaskIds } from '../benchmarks/decision-modes/fixture.mjs';

const [model, reasoningEffort, selectedTask] = process.argv.slice(2);
if (!model || !reasoningEffort || (selectedTask && !decisionTaskIds.includes(selectedTask))) {
  throw Error('用法: node experiments/decision-modes.mjs <model> <effort> [task]');
}
const modes = ['locator', 'ref', 'program'];
const seed = 173;
const budgets = { maxModelCalls: 10, maxTokens: 230000, maxActions: 20, maxWallTimeMs: 150000 };
const root = resolve('traces', `decision-modes-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const workingDirectory = resolve('.cache/decision-model-context');
await mkdir(root, { recursive: true });
const sourceHashes = {};
for (const file of ['engine/agent-loop.mjs', 'engine/executor.mjs', 'engine/decision-modes.mjs', 'engine/observation-codec.mjs', 'adapters/codex-decision.mjs', 'benchmarks/decision-modes/fixture.mjs', 'experiments/decision-modes.mjs', 'package-lock.json']) {
  sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  await copyFile(file, join(root, file.replaceAll('/', '-')));
}
const fixture = await startDecisionFixture();
const browser = await chromium.launch({ channel: 'chrome' });
const planned = decisionTaskIds.flatMap((taskId, index) => {
  if (selectedTask && selectedTask !== taskId) return [];
  return modes.map((_, i) => ({ taskId, mode: modes[(i + index) % modes.length] }));
});
const report = { model, reasoningEffort, browser: browser.version(), node: process.version, seed, budgets,
  sourceHashes, planned, rows: [], complete: false, scope: 'development fixtures, one paired run per task and mode' };
const save = () => writeFile(join(root, 'results.json'), JSON.stringify(report, null, 2));
console.log(`Evidence directory: ${root}`);
try {
  await save();
  for (const { taskId, mode } of planned) {
    const directory = join(root, `${taskId}-${mode}`);
    const instance = fixture.create(taskId, seed);
    const context = await browser.newContext();
    const page = await context.newPage();
    const executor = new Executor(page, { journal: join(directory, 'actions.jsonl'), grants: instance.grants, timeout: 1500 });
    console.log(`Starting ${taskId}/${mode}`);
    try {
      await page.goto(instance.url);
      const result = await runAgent({ executor, mode, task: instance.task, directory, ...budgets,
        beforeExecute: taskId === 'invoice' ? () => instance.fault(page) : undefined,
        verifyGoal: () => fixture.grade(instance.instanceId),
        decide: async request => {
          const response = await codexDecision({ ...request, model, reasoningEffort, workingDirectory,
            timeoutMs: Math.max(1000, Math.min(90000, request.remainingTimeMs)) });
          console.log(`${taskId}/${mode} ${request.directory.split(/[\\/]/).at(-1)} valid=${response.validRun}`);
          return response;
        } });
      await page.screenshot({ path: join(directory, 'final.png') }).catch(() => {});
      const verdict = result.taskResult;
      const executions = result.steps.flatMap(step => step.executions || []);
      const row = { taskId, mode, terminal: result.terminal, completed: verdict.taskCompleted ?? null,
        requests: verdict.requestCount, wrongRecords: verdict.wrongRecords, wrongAttempts: verdict.wrongTargetAttempts,
        duplicateEffects: verdict.duplicateEffects, modelCalls: result.modelCalls, tokens: result.tokens,
        tokenAccountingComplete: result.tokenAccountingComplete,
        cachedInput: result.steps.reduce((sum, step) => sum + (step.usage?.cached_input_tokens || 0), 0),
        modelElapsedMs: result.steps.reduce((sum, step) => sum + (step.decision.elapsedMs || 0), 0),
        elapsedMs: result.elapsedMs, actionAttempts: result.actionAttempts,
        dispatches: executions.filter(x => x.receipt.dispatch === 'sent').length,
        errors: [...result.steps.map(x => x.resolutionError), ...executions.map(x => x.receipt.error)].filter(Boolean),
        faultInjected: verdict.faultInjected, evidence: directory };
      report.rows.push(row);
      await save();
      console.log(JSON.stringify(row));
      if (result.terminal === 'MODEL_UNAVAILABLE') break;
    } finally { await executor.close(); await context.close(); }
  }
  report.complete = report.rows.length === planned.length;
  await save();
} finally { await browser.close(); await fixture.close(); }
