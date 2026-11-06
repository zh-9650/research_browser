import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { dispatchVisualWrite } from '../engine/visual-write.mjs';
import { Journal } from '../engine/executor.mjs';

test('截图不变的视觉目标改绑由后端对象授权拒绝', { timeout: 60000 }, async t => {
  const worlds = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, id, action] = url.pathname.split('/');
    const world = worlds.get(id);
    if (!world) { res.writeHead(404).end(); return; }
    if (req.method === 'POST' && action === 'register') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { object, grant } = JSON.parse(raw);
      let status = 200;
      if (world.protected && (grant !== world.grant || object !== world.expected)) status = 403;
      else if (world.protected && world.consumed) status = 409;
      else {
        world.consumed = true;
        world.records.push(object);
      }
      world.attempts.push({ object, status });
      res.writeHead(status).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <style>body{margin:0}</style><canvas width="480" height="240"></canvas>
      <script>
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle='#174667'; ctx.fillRect(40,50,240,100);
      ctx.fillStyle='white'; ctx.font='26px sans-serif'; ctx.fillText('登记 A-417',70,110);
      let binding = 'A-417';
      window.replaceBinding = () => { binding = 'B-681'; };
      canvas.onclick = () => fetch('register', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ object: binding, grant: ${JSON.stringify(world.grant)} })
      });
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `visual-identity-drift-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const results = [];
  for (const [scenario, guarded, drift, expectedStatuses, expectedRecords] of [
    ['screenshot-only', false, true, [200], ['B-681']],
    ['host-denies-without-backend-constraint', false, true, [], []],
    ['protected-drift', true, true, [403], []],
    ['protected-correct-and-replay', true, false, [200, 409], ['A-417']],
  ]) {
    const id = randomUUID();
    const world = { protected: guarded, grant: randomUUID(), expected: 'A-417', consumed: false, records: [], attempts: [] };
    worlds.set(id, world);
    const url = `${origin}/${id}/`;
    const page = await browser.newPage({ viewport: { width: 480, height: 240 } });
    try {
      await page.goto(url);
      const before = sha256(await page.screenshot({ path: join(directory, `${scenario}-before.png`), scale: 'css' }));
      if (drift) await page.evaluate(() => window.replaceBinding());
      const after = sha256(await page.screenshot({ path: join(directory, `${scenario}-before-dispatch.png`) }));
      assert.equal(after, before);
      assert.equal(page.url(), url);
      const journalPath = join(directory, `${scenario}.jsonl`);
      const act = (screenshotSha256 = before, operationId = 'register-A-417') => dispatchVisualWrite(page, { x: 150, y: 100 }, {
        url, objectId: 'A-417', screenshotSha256,
        operationId, journalPath,
        checkBackendGrant: ({ url: target, objectId }) => target === url && world.protected && world.expected === objectId,
      });
      const receipts = [];
      if (guarded) {
        const journal = new Journal(journalPath);
        try { journal.append({ event: 'dispatch_intent', operationId: 'pending-without-receipt' }); }
        finally { journal.close(); }
        const unresolved = await act(before, 'pending-without-receipt');
        assert.deepEqual(unresolved, { dispatch: 'not_sent', reason: 'OPERATION_ALREADY_ATTEMPTED' });
        const stale = await act('0'.repeat(64));
        assert.deepEqual(stale, { dispatch: 'not_sent', reason: 'VISUAL_OBSERVATION_STALE' });
        assert.deepEqual(world.attempts, []);
        receipts.push(unresolved, stale);
      }
      if (scenario === 'host-denies-without-backend-constraint') {
        const receipt = await act();
        assert.deepEqual(receipt, { dispatch: 'not_sent', reason: 'OBJECT_CONSTRAINT_REQUIRED' });
        assert.deepEqual(world.attempts, []);
        receipts.push(receipt);
      }
      const statuses = [];
      for (const expected of expectedStatuses) {
        const [response, receipt] = await Promise.all([
          page.waitForResponse(response => response.url() === url + 'register', { timeout: 8000 }),
          guarded ? act(before, statuses.length === 0 ? 'register-A-417' : 'backend-replay-control') : page.mouse.click(150, 100),
        ]);
        if (guarded) {
          assert.equal(receipt.dispatch, 'sent');
          receipts.push(receipt);
        }
        statuses.push(response.status());
        assert.equal(response.status(), expected);
      }
      if (guarded) {
        const replay = await act();
        assert.deepEqual(replay, { dispatch: 'not_sent', reason: 'OPERATION_ALREADY_ATTEMPTED' });
        assert.equal(world.attempts.length, expectedStatuses.length);
        receipts.push(replay);
      }
      assert.deepEqual(world.records, expectedRecords);
      results.push({ scenario, before, after, statuses, receipts, attempts: world.attempts, records: world.records });
    } finally { await page.close(); }
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), results }, null, 2));
  console.log(`视觉业务身份漂移证据: ${directory}`);
});
