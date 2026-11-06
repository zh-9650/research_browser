import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

async function serve(handler, hostname = '127.0.0.1') {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://${hostname}:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test('跨源嵌套 iframe 分别授权，重载后旧 Ref 无法命中同名业务按钮', async () => {
  const events = [];
  const inner = await serve((req, res) => {
    if (req.method === 'POST') {
      events.push(new URL(req.url, 'http://localhost').searchParams.get('box'));
      res.end('ok');
      return;
    }
    const box = req.url.includes('new') ? 'BOX-NEW' : 'BOX-OLD';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<article><p>${box}</p><button onclick="fetch('/register?box=${box}',{method:'POST'})">登记到货</button></article>`);
  }, 'localhost');
  const outer = await serve((req, res) => {
    if (req.method === 'POST') events.push('WRONG-OUTER');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<button onclick="fetch('/wrong',{method:'POST'})">登记到货</button><iframe src="${inner.origin}/old"></iframe>`);
  });
  const top = await serve((req, res) => {
    if (req.method === 'POST') events.push('WRONG-TOP');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<button onclick="fetch('/wrong',{method:'POST'})">登记到货</button><iframe src="${outer.origin}/embed"></iframe>`);
  });
  const browser = await chromium.launch({ channel: 'chrome' });
  const directory = resolve('traces', `cross-origin-frame-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage();
  const grants = [top, outer].map(server => ({ origin: server.origin, kinds: ['click'] }));
  let executor = new Executor(page, { journal: join(directory, 'denied.jsonl'), grants });
  try {
    await page.goto(top.origin);
    let observation = await executor.observe();
    assert.equal(observation.targets.filter(t => t.name === '登记到货').length, 3);
    const denied = await executor.act({ operationId: 'register', kind: 'click', ref: observation.targets.find(t => t.context.includes('BOX-OLD')).ref });
    assert.equal(denied.error, 'POLICY_DENIED');
    assert.deepEqual(events, []);
    await executor.close();

    executor = new Executor(page, { journal: join(directory, 'authorized.jsonl'), timeout: 3000,
      grants: [...grants, { origin: inner.origin, kinds: ['click'] }] });
    observation = await executor.observe();
    const old = observation.targets.find(t => t.context.includes('BOX-OLD'));
    const frame = page.frames().find(frame => frame.url() === `${inner.origin}/old`);
    assert.equal(new URL(frame.parentFrame().url()).origin, outer.origin);
    await frame.goto(`${inner.origin}/new`);
    const stale = await executor.act({ operationId: 'register', kind: 'click', ref: old.ref });
    assert.ok(['FRAME_CHANGED', 'TARGET_STALE'].includes(stale.error));
    assert.deepEqual(events, []);
    const fresh = await executor.observe();
    const target = fresh.targets.find(t => t.context.includes('BOX-NEW'));
    const [, receipt] = await Promise.all([
      page.waitForResponse(response => response.url() === `${inner.origin}/register?box=BOX-NEW`, { timeout: 8000 }),
      executor.act({ operationId: 'register', kind: 'click', ref: target.ref }),
    ]);
    assert.equal(receipt.dispatch, 'sent');
    assert.deepEqual(events, ['BOX-NEW']);
    await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), origins: [top.origin, outer.origin, inner.origin], denied, stale, receipt, events }, null, 2));
    console.log(`跨源嵌套证据: ${directory}`);
  } finally { await executor.close(); await browser.close(); await Promise.all([top.close(), outer.close(), inner.close()]); }
});
