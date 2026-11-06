import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S10 建议加载前无可选目标，晚到旧查询复用按钮后拒绝旧引用', { timeout: 60000 }, async t => {
  const held = new Map();
  const arrivals = new Map();
  const ledger = [];
  const writes = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/suggest') {
      const query = url.searchParams.get('q');
      ledger.push({ event:'query', query });
      held.set(query, res);
      arrivals.get(query)?.();
      return;
    }
    if (url.pathname === '/choose' && req.method === 'POST') {
      writes.push(url.searchParams.get('id'));
      res.end('ok');
      return;
    }
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' }).end(`<!doctype html>
      <label>仓库查询 <input id="search"></label><p role="status"></p>
      <div role="listbox"><article><span id="description"></span><div role="option" id="pick" hidden>选择仓库</div></article></div>
      <script>
      const search = document.querySelector('#search');
      const status = document.querySelector('[role=status]');
      const button = document.querySelector('#pick');
      let active;
      search.oninput = async () => {
        const query = search.value;
        button.hidden = true;
        status.textContent = '正在加载 ' + query;
        const response = await fetch('/suggest?q=' + encodeURIComponent(query));
        active = await response.json();
        document.querySelector('#description').textContent = active.label;
        button.hidden = false;
        status.textContent = '已加载 ' + query;
      };
      button.onclick = () => fetch('/choose?id=' + active.id, {method:'POST'});
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'chrome'});
  t.after(() => browser.close());
  const directory = resolve('traces', `autocomplete-race-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, {recursive:true});
  const page = await browser.newPage();
  const executor = new Executor(page, {journal:join(directory,'actions.jsonl'), timeout:3000,
    grants:[{origin,kinds:['fill'],name:'仓库查询'},{origin,kinds:['click'],name:'选择仓库'}]});
  t.after(() => executor.close());
  await page.goto(origin);
  const fill = async (query, operationId) => {
    const input = (await executor.observe()).targets.find(target => target.name === '仓库查询');
    let timer;
    const arrival = new Promise((resolve, reject) => {
      arrivals.set(query, resolve);
      timer = setTimeout(() => reject(Error('QUERY_NOT_RECEIVED')), 8000);
    });
    try {
      const [, receipt] = await Promise.all([arrival, executor.act({operationId,kind:'fill',ref:input.ref,value:query})]);
      assert.equal(receipt.dispatch, 'sent');
    } finally { clearTimeout(timer); arrivals.delete(query); }
  };
  const release = async (query, item) => {
    const response = held.get(query);
    assert.ok(response);
    held.delete(query);
    ledger.push({event:'release',query,id:item.id});
    response.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(item));
    await page.getByRole('status').filter({hasText:`已加载 ${query}`}).waitFor({timeout:8000});
  };
  const suzhou = {id:'A-417',label:'苏州 A-417'};
  await fill('南京', 'query-old');
  await fill('苏州', 'query-current');
  const pending = await executor.observe();
  assert.equal(pending.targets.some(target => target.name === '选择仓库'), false);
  assert.deepEqual(writes, []);
  await release('苏州', suzhou);
  const old = (await executor.observe()).targets.find(target => target.context.includes('A-417'));
  assert.ok(old);
  assert.equal(old.role, 'option');
  await release('南京', {id:'B-681',label:'南京 B-681'});
  const stale = await executor.act({operationId:'choose-warehouse',kind:'click',ref:old.ref});
  assert.equal(stale.error,'TARGET_STALE');
  assert.deepEqual(writes, []);

  await fill('苏州 A-417', 'query-recovery');
  await release('苏州 A-417', suzhou);
  const fresh = (await executor.observe()).targets.find(target => target.context.includes('A-417'));
  const [, recovered] = await Promise.all([
    page.waitForResponse(response => response.url().startsWith(origin + '/choose?'), {timeout:8000}),
    executor.act({operationId:'choose-warehouse',kind:'click',ref:fresh.ref}),
  ]);
  assert.equal(recovered.dispatch,'sent');
  assert.deepEqual(writes,['A-417']);
  await writeFile(join(directory,'result.json'), JSON.stringify({browser:browser.version(),pending,ledger,stale,recovered,writes}, null, 2));
  console.log(`S10 异步建议证据: ${directory}`);
});
