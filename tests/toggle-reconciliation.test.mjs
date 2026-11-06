import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S25 开关请求超时后核实已提交、未提交和处理中三种状态', async t => {
  const worlds = new Map(['committed', 'rejected', 'pending'].map(mode => [mode,
    { enabled: false, phase: 'new', requests: 0, transitions: [] }]));
  const commit = world => {
    world.enabled = !world.enabled;
    world.transitions.push(world.enabled);
    world.phase = 'committed';
  };
  const server = createServer((req, res) => {
    const [, mode, action] = req.url.split('/');
    const world = worlds.get(mode);
    if (!world) { res.writeHead(404).end(); return; }
    if (action === 'toggle' && req.method === 'POST') {
      world.requests++;
      if (world.requests === 1) {
        if (mode === 'committed') commit(world);
        else world.phase = mode;
        // Hold the response until the real browser request times out.
        return;
      }
      commit(world);
      res.end('ok');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<main><h1>到货提醒</h1><div id="toggle" role="switch" tabindex="0" aria-checked="${world.enabled}">切换提醒</div><p role="status"></p></main>
      <script>
      const button = document.querySelector('#toggle');
      const status = document.querySelector('[role=status]');
      button.onclick = async () => {
        status.textContent = '处理中';
        try {
          const response = await fetch('/${mode}/toggle', { method: 'POST', signal: AbortSignal.timeout(1000) });
          if (response.ok) {
            button.setAttribute('aria-checked', 'true');
            status.textContent = '已开启';
          }
        } catch (error) { status.textContent = error.name; }
      };
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `s25-toggle-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [mode, world] of worlds) {
    const page = await browser.newPage();
    const executor = new Executor(page, { journal: join(directory, `${mode}.jsonl`),
      grants: [{ origin, kinds: ['click'], name: '切换提醒' }] });
    try {
      await page.goto(`${origin}/${mode}/`);
      const toggleRef = async () => (await executor.observe()).targets.find(target => target.name === '切换提醒').ref;
      const click = { operationId: 'initial-toggle', kind: 'click', ref: await toggleRef() };
      const receipt = await executor.act(click, { postcondition: async () => {
        await page.getByRole('status').filter({ hasText: 'TimeoutError' }).waitFor({ timeout: 5000 });
        return false;
      } });
      assert.equal(receipt.dispatch, 'sent');
      assert.equal(receipt.task_goal, 'unknown');
      assert.equal(receipt.postcondition, 'unmet');
      assert.equal((await executor.readTarget(click.ref)).fieldState.checked, false);
      assert.equal(world.requests, 1);
      const observed = structuredClone(world);
      assert.equal(observed.phase, mode);
      const ref = await toggleRef();
      const replay = await executor.act({ ...click, ref });
      assert.equal(replay.error, 'OPERATION_ALREADY_ATTEMPTED');

      // Host reconciliation reads the authoritative state and transaction phase.
      // A false value while processing is insufficient to permit another toggle.
      let recovery = 'already_enabled';
      if (observed.phase === 'rejected' && !observed.enabled) {
        recovery = 'retried_after_definitive_rejection';
        const retry = await executor.act({ ...click, ref, operationId: 'reconciled-toggle' }, { postcondition: async () => {
          await page.getByRole('status').filter({ hasText: '已开启' }).waitFor({ timeout: 5000 });
          return world.enabled;
        } });
        assert.equal(retry.postcondition, 'met');
      } else if (observed.phase === 'pending') {
        recovery = 'held_for_pending_transaction';
        assert.equal(observed.enabled, false);
        assert.equal(world.requests, 1);
        commit(world); // Release the simulated pending server transaction.
      }
      assert.equal(world.enabled, true);
      assert.equal(world.requests, mode === 'rejected' ? 2 : 1);
      assert.deepEqual(world.transitions, [true]);
      await page.reload();
      const finalUi = (await executor.readTarget(await toggleRef())).fieldState;
      assert.equal(finalUi.checked, true);
      results.push({ mode, receipt, replay, observed, recovery, finalUi, final: structuredClone(world) });
    } finally { await executor.close(); await page.close(); }
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), results }, null, 2));
  console.log(`S25 开关超时证据: ${directory}`);
});
