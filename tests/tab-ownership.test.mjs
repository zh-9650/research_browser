import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('标签页引用不可跨执行器使用，返回原页后只提交原业务对象', async t => {
  const writes = [];
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      writes.push(pathname);
      res.end('ok');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<article><p>${pathname === '/original' ? '苏州到货单' : '南京到货单'}</p>
      <button onclick="fetch(location.pathname, {method: 'POST'})">登记到货</button>
      <a href="/popup" target="_blank">查看另一个到货单</a></article>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const original = await context.newPage();
  await original.goto(origin + '/original');
  const directory = resolve('traces', `tab-ownership-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const attach = (page, file) => {
    const executor = new Executor(page, { journal: join(directory, file), grants: [{ origin, kinds: ['click'] }] });
    t.after(() => executor.close());
    return executor;
  };
  const first = attach(original, 'original.jsonl');
  const before = await first.observe();
  const [popup] = await Promise.all([
    original.waitForEvent('popup', { timeout: 3000 }),
    first.act({ operationId: 'open-tab', kind: 'click', ref: before.targets.find(target => target.tag === 'A').ref }),
  ]);
  await popup.waitForLoadState();
  const second = attach(popup, 'popup.jsonl');
  const popupObservation = await second.observe();
  const originalRef = before.targets.find(target => target.name === '登记到货').ref;
  const popupRef = popupObservation.targets.find(target => target.name === '登记到货').ref;
  const foreign = await second.act({ operationId: 'wrong-tab', kind: 'click', ref: originalRef });
  if (foreign.dispatch === 'sent') await popup.waitForLoadState('networkidle');
  await writeFile(join(directory, 'cross-tab-attempt.json'), JSON.stringify({ originalRef, popupRef, foreign, writes }, null, 2));
  assert.equal(foreign.error, 'TARGET_STALE');
  assert.equal((await first.readTarget(popupRef)).error, 'TARGET_STALE');
  assert.deepEqual(writes, []);
  await second.close();
  assert.equal(original.isClosed(), false);
  assert.equal(popup.isClosed(), false);
  await original.bringToFront();
  const [, receipt] = await Promise.all([
    original.waitForResponse(response => response.request().method() === 'POST' && response.url() === origin + '/original', { timeout: 3000 }),
    first.act({ operationId: 'register-original', kind: 'click', ref: originalRef }),
  ]);
  assert.equal(receipt.dispatch, 'sent');
  assert.deepEqual(writes, ['/original']);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), foreign, receipt, writes }, null, 2));
  console.log(`标签页归属证据: ${directory}`);
});
