import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S20 DOM 弹窗内区分原生确认，拒绝错对象并恢复焦点', {timeout:60000}, async t => {
  const writes = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/register') {
      writes.push(url.searchParams.get('id'));
      res.end('ok');
      return;
    }
    const shownId = url.pathname === '/wrong' ? 'B-681' : 'A-417';
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html>
      <button id="open">打开登记</button><p role="status"></p>
      <dialog id="entry" aria-label="苏州 A-417 登记">
        <button id="next" autofocus>确认登记</button>
      </dialog>
      <script>
      const entry = document.querySelector('#entry');
      const opener = document.querySelector('#open');
      const status = document.querySelector('[role=status]');
      opener.onclick = () => entry.showModal();
      document.querySelector('#next').onclick = async () => {
        const accepted = confirm('确认登记 ${shownId}');
        entry.close();
        if (!accepted) { status.textContent = '已取消'; return; }
        const response = await fetch('/register?id=${shownId}', {method:'POST'});
        status.textContent = response.ok ? '已登记' : '登记失败';
      };
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'chrome'});
  t.after(() => browser.close());
  const directory = resolve('traces', `dialog-focus-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, {recursive:true});
  const results = [];
  for (const mode of ['wrong','correct']) {
    const page = await browser.newPage();
    const executor = new Executor(page, {journal:join(directory,`${mode}.jsonl`), timeout:5000,
      grants:[{origin,kinds:['click'],name:'打开登记'},{origin,kinds:['click'],name:'确认登记'}]});
    try {
      await page.goto(`${origin}/${mode}`);
      const find = async name => (await executor.observe()).targets.find(target => target.name === name);
      const open = await find('打开登记');
      assert.equal((await executor.act({operationId:'open-dialog',kind:'click',ref:open.ref})).dispatch, 'sent');
      assert.equal(await page.getByRole('dialog').isVisible(), true);
      const initialFocus = await page.locator(':focus').getAttribute('id');
      assert.equal(initialFocus, 'next');
      const target = await find('确认登记');
      // Exact trusted policy. Page text alone cannot broaden the allowed object.
      const native = new Promise((resolve, reject) => {
        page.once('dialog', async dialog => {
          try {
            const type = dialog.type();
            const message = dialog.message();
            const allowed = type === 'confirm' && message === '确认登记 A-417';
            await (allowed ? dialog.accept() : dialog.dismiss());
            resolve({type,message,allowed});
          } catch (error) { reject(error); }
        });
      });
      const [decision, receipt] = await Promise.all([native,
        executor.act({operationId:'confirm-dialog',kind:'click',ref:target.ref})]);
      assert.equal(receipt.dispatch, 'sent');
      assert.equal(decision.allowed, mode === 'correct');
      await page.getByRole('status').filter({hasText:mode === 'correct' ? '已登记' : '已取消'}).waitFor({timeout:8000});
      assert.equal(await page.getByRole('dialog').isVisible(), false);
      const restoredFocus = await page.locator(':focus').getAttribute('id');
      assert.equal(restoredFocus,'open');
      assert.deepEqual(writes, mode === 'correct' ? ['A-417'] : []);
      results.push({mode,initialFocus,restoredFocus,decision,receipt,writes:writes.slice()});
    } finally { await executor.close(); await page.close(); }
  }
  await writeFile(join(directory,'result.json'), JSON.stringify({browser:browser.version(),results},null,2));
  console.log(`S20 弹窗焦点证据: ${directory}`);
});
