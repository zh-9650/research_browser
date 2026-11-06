import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor, Journal } from '../engine/executor.mjs';

test('S24 请求在浏览器拦截层断线，经独立核对后一次补交', async t => {
  const writes = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/arrival/SZ-417') {
      writes.push({ path: req.url, ordinal: writes.length + 1 });
      res.end('accepted');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<article><h1>苏州到货单 SZ-417</h1><button id="submit">登记到货</button><p role="status"></p></article>
      <script>
      document.querySelector('#submit').onclick = async () => {
        const status = document.querySelector('[role=status]');
        try {
          const response = await fetch('/arrival/SZ-417', { method: 'POST' });
          status.textContent = response.ok ? '已登记' : '服务器拒绝';
        } catch { status.textContent = '连接中断，结果待核实'; }
      };
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `s24-before-server-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage();
  const journalPath = join(directory, 'actions.jsonl');
  const recoveryJournal = new Journal(join(directory, 'reconciliation.jsonl'));
  t.after(() => recoveryJournal.close());
  const grants = [{ origin, kinds: ['click'], name: '登记到货' }];
  let executor = new Executor(page, { journal: journalPath, grants });
  t.after(() => executor.close());
  await page.goto(origin);
  const url = origin + '/arrival/SZ-417';
  const interceptions = [];
  const abort = async route => {
    const request = route.request();
    interceptions.push({ method: request.method(), url: request.url(), stage: 'blocked_before_forwarding' });
    await route.abort('connectionreset');
  };
  await page.route(url, abort, { times: 1 });
  const ref = async () => (await executor.observe()).targets.find(target => target.name === '登记到货').ref;
  const initial = { operationId: 'arrival-original', kind: 'click', ref: await ref() };
  const [failedRequest, receipt] = await Promise.all([
    page.waitForEvent('requestfailed', { predicate: request => request.url() === url, timeout: 5000 }),
    executor.act(initial, { postcondition: async () => {
      await page.getByRole('status').filter({ hasText: '连接中断，结果待核实' }).waitFor({ timeout: 5000 });
      return false;
    } }),
  ]);
  assert.equal(receipt.dispatch, 'sent');
  assert.equal(receipt.error, 'POSTCONDITION_UNMET');
  assert.equal(receipt.task_goal, 'unknown');
  assert.equal(receipt.retry_safety, 'do_not_repeat_without_reconciliation');

  await executor.close();
  executor = new Executor(page, { journal: journalPath, grants });
  const recoveryRef = await ref();
  const replay = await executor.act({ ...initial, ref: recoveryRef });
  assert.equal(replay.error, 'OPERATION_ALREADY_ATTEMPTED');
  assert.deepEqual(interceptions, [{ method: 'POST', url, stage: 'blocked_before_forwarding' }]);
  assert.match(failedRequest.failure().errorText, /ERR_CONNECTION_RESET/);
  assert.deepEqual(writes, []);
  const replacementId = 'arrival-after-reconciliation';
  const reconciled = recoveryJournal.append({ event: 'trusted_reconciliation', operationId: initial.operationId,
    replacementId, conclusion: 'never_reached_server', interceptions, serverWrites: writes.slice() });
  const [, recovered] = await Promise.all([
    page.waitForResponse(response => response.url() === url && response.request().method() === 'POST', { timeout: 5000 }),
    executor.act({ operationId: replacementId, kind: 'click', ref: recoveryRef }, { postcondition: async () => {
      await page.getByRole('status').filter({ hasText: '已登记' }).waitFor({ timeout: 5000 });
      return writes.length === 1;
    } }),
  ]);
  assert.equal(recovered.postcondition, 'met');
  assert.deepEqual(writes, [{ path: '/arrival/SZ-417', ordinal: 1 }]);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(),
    networkError: failedRequest.failure().errorText, receipt, replay, reconciled, recovered, writes }, null, 2));
  console.log(`S24 断线恢复证据: ${directory}`);
});
