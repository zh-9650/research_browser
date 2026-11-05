import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Executor } from '../engine/executor.mjs';
import { startFixture } from './fixture.mjs';
import { tasks } from './tasks.mjs';
import { grade } from './grader.mjs';
import { renderMechanismReport } from './report.mjs';

const repeats = Number(process.env.REPEATS || 3);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const out = join('traces', run);
await mkdir(out, { recursive: true });
const sourceFiles = ['benchmarks/run.mjs', 'benchmarks/tasks.mjs', 'benchmarks/fixture.mjs', 'benchmarks/grader.mjs', 'benchmarks/report.mjs', 'engine/executor.mjs', 'package-lock.json'];
const sourceHashes = {};
for (const file of sourceFiles) {
  const bytes = await readFile(file);
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
  const dest = join(out, 'source', file);
  await mkdir(join(dest, '..'), { recursive: true });
  await writeFile(dest, bytes);
}
const fixture = await startFixture();
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const rows = [];
try {
  for (let repeat = 0; repeat < repeats; repeat++) for (const task of tasks) {
    // Rotate strategy order to reduce simple warmup bias. No model is used in this experiment.
    const strategies = ['position-fallback', 'strict-ref', 'context-reobserve'];
    const order = repeat % strategies.length;
    for (const strategy of [...strategies.slice(order), ...strategies.slice(0, order)]) {
      const started = performance.now();
      const world = fixture.create(task.mode);
      const context = await browser.newContext();
      const page = await context.newPage();
      const stem = `${task.id}-${repeat}-${strategy}`;
      const journal = join(out, `${stem}.jsonl`);
      const engine = new Executor(page, { journal, grants: task.denied ? [] : [{ origin: fixture.base, kinds: ['click'] }], timeout: 350 });
      let receipt, observation, observationCount = 1;
      try {
        await page.goto(world.url);
        observation = await engine.observe();
        await writeFile(join(out, `${stem}-before.json`), JSON.stringify(observation, null, 2));
        const original = observation.targets.find(t => t.name === '确认收款' && t.context.includes(world.ids[0]));
        if (!original) throw Error('fixture target missing');
        if (task.fault) await page.evaluate(name => window.fault[name](), task.fault);
        const action = { operationId: 'confirm-invoice', kind: 'click', ref: original.ref };
        if (strategy === 'position-fallback') {
          // Intentionally weak synthetic mechanism, NOT an implementation of any upstream tool.
          if (task.denied) receipt = { error: 'POLICY_DENIED', dispatch: 'not_sent' };
          else {
            try {
              await page.getByRole('button', { name: '确认收款', exact: true }).first().click({ timeout: 350 });
              receipt = { dispatch: 'sent', task_goal: 'unknown' };
              await page.getByRole('status').filter({ hasText: /保存成功|业务拒绝|连接中断/ }).waitFor({ timeout: 1000 });
              if (task.retry && await page.getByRole('status').textContent() === '连接中断，结果未知') {
                await page.getByRole('button', { name: '确认收款', exact: true }).first().click({ timeout: 350 });
              }
            } catch { receipt = { error: 'ACTION_RESULT_UNKNOWN', dispatch: 'unknown' }; }
          }
        } else {
          receipt = await engine.act(action);
          if (strategy === 'context-reobserve' && ['TARGET_STALE', 'FRAME_CHANGED'].includes(receipt.error)) {
            const fresh = await engine.observe(); observationCount++;
            const candidates = fresh.targets.filter(t => t.name === original.name && t.context === original.context);
            if (candidates.length === 1) receipt = await engine.act({ ...action, ref: candidates[0].ref });
          }
          if (receipt.dispatch === 'sent') await page.getByRole('status').filter({ hasText: /保存成功|业务拒绝|连接中断/ }).waitFor({ timeout: 1000 });
          if (task.retry && receipt.dispatch === 'sent') {
            // Reconstruct executor to test that an in-memory-only cache cannot hide replay bugs.
            await engine.close();
            const resumed = new Executor(page, { journal, grants: [{ origin: fixture.base, kinds: ['click'] }] });
            try {
              const fresh = await resumed.observe(); observationCount++;
              const target = fresh.targets.find(t => t.context === original.context && t.name === original.name);
              receipt.replay = await resumed.act({ ...action, ref: target.ref });
            } finally { await resumed.close(); }
          }
        }
        // Wait only on observable page signal; backend oracle never controls agent decisions.
        if (task.retry) await page.getByRole('status').filter({ hasText: /保存成功|业务拒绝|连接中断/ }).waitFor({ timeout: 1000 });
        await page.screenshot({ path: join(out, `${stem}-after.png`) });
        const truth = fixture.oracle(world.key);
        const verdict = grade(truth, { targetId: world.ids[0], authorized: !task.denied });
        rows.push({ task: task.id, repeat, strategy, expected: task.expected, ...verdict,
          refused: receipt.dispatch === 'not_sent', receipt, truth, observationCount,
          elapsedMs: Math.round(performance.now() - started), llmCalls: 0, tokens: 0, model: null, artifacts: stem });
      } finally { await engine.close(); await context.close(); }
    }
  }
  const result = { sourceHashes, environment: { os: os.platform(), release: os.release(), node: process.version, browser: browser.version(), playwright: '1.56.1', repeats, model: null }, rows };
  const resultsPath = join(out, 'results.json');
  await writeFile(resultsPath, JSON.stringify(result, null, 2));
  const summary = renderMechanismReport(result, resultsPath);
  await mkdir('reports', { recursive: true });
  await writeFile('reports/mechanism-results.md', summary);
  console.log(summary);
} finally { await browser.close(); await fixture.close(); }
