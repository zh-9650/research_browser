import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';
import { openPublishedBaseline, publishedBinary } from '../adapters/agent-browser-baseline.mjs';
import { startDecisionFixture, decisionTaskIds } from '../benchmarks/decision-modes/fixture.mjs';

const modes = ['locator', 'ref', 'program'];
const [model, reasoningEffort, selectedTask, selectedMode] = process.argv.slice(2);
if (!model || !reasoningEffort || (selectedTask && selectedTask !== 'all' && !decisionTaskIds.includes(selectedTask)) || (selectedMode && ![...modes, 'published'].includes(selectedMode))) {
  throw Error('用法: node experiments/decision-modes.mjs <model> <effort> [task|all] [mode]');
}
const seed = 173;
const budgets = { maxModelCalls: 10, maxTokens: 230000, maxActions: 20, maxWallTimeMs: 150000 };
const root = resolve('traces', `decision-modes-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const workingDirectory = resolve('.cache/decision-model-context');
await mkdir(root, { recursive: true });
const sourceHashes = {};
for (const file of ['engine/agent-loop.mjs', 'engine/executor.mjs', 'engine/decision-modes.mjs', 'engine/observation-codec.mjs', 'adapters/codex-decision.mjs', 'adapters/agent-browser-baseline.mjs', 'benchmarks/decision-modes/fixture.mjs', 'experiments/decision-modes.mjs', 'package-lock.json']) {
  sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  await copyFile(file, join(root, file.replaceAll('/', '-')));
}
const fixture = await startDecisionFixture();
const browser = await chromium.launch({ channel: 'chrome' });
const planned = decisionTaskIds.flatMap((taskId, index) => {
  if (selectedTask && selectedTask !== 'all' && selectedTask !== taskId) return [];
  if (selectedMode === 'published') return [{ taskId, mode: 'published' }];
  return modes.map((_, i) => ({ taskId, mode: modes[(i + index) % modes.length] })).filter(row => !selectedMode || row.mode === selectedMode);
});
const report = { model, reasoningEffort, browser: browser.version(), node: process.version, seed, budgets,
  sourceHashes, planned, rows: [], complete: false, scope: 'development fixtures, one paired run per task and mode' };
if (selectedMode === 'published') report.publishedBinarySha256 = createHash('sha256').update(await readFile(publishedBinary)).digest('hex');
const save = () => writeFile(join(root, 'results.json'), JSON.stringify(report, null, 2));
console.log(`Evidence directory: ${root}`);
try {
  await save();
  for (const { taskId, mode } of planned) {
    const directory = join(root, `${taskId}-${mode}`);
    const instance = fixture.create(taskId, seed);
    const native = mode === 'published';
    const context = native ? null : await browser.newContext();
    const page = native ? null : await context.newPage();
    const executor = native ? await openPublishedBaseline({ url: instance.url, directory })
      : new Executor(page, { journal: join(directory, 'actions.jsonl'), grants: instance.grants, timeout: 1500 });
    console.log(`Starting ${taskId}/${mode}`);
    try {
      if (page) await page.goto(instance.url);
      const result = await runAgent({ executor, mode: native ? 'ref' : mode, task: instance.task, directory, ...budgets,
        beforeExecute: taskId === 'invoice' ? () => instance.fault(native ? { evaluate: () => executor.injectReorder() } : page) : undefined,
        verifyGoal: () => fixture.grade(instance.instanceId),
        decide: async request => {
          const response = await codexDecision({ ...request, model, reasoningEffort, workingDirectory,
            timeoutMs: Math.max(1000, Math.min(90000, request.remainingTimeMs)) });
          console.log(`${taskId}/${mode} ${request.directory.split(/[\\/]/).at(-1)} valid=${response.validRun}`);
          return response;
        } });
      await (native ? executor.screenshot() : page.screenshot({ path: join(directory, 'final.png') })).catch(() => {});
      const verdict = result.taskResult;
      const executions = result.steps.flatMap(step => step.executions || []);
      const row = { taskId, mode, terminal: result.terminal, controllerTerminal: result.controllerTerminal, completed: verdict.taskCompleted ?? null,
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
      if (result.controllerTerminal === 'MODEL_UNAVAILABLE') { process.exitCode = 2; break; }
    } finally { await executor.close(); if (context) await context.close(); }
  }
  report.complete = report.rows.length === planned.length;
  await save();
} finally { await browser.close(); await fixture.close(); }
