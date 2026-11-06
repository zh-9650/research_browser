import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S14 普通 DOM 报告封闭 Shadow 缺口，Chrome AX 观察定位受控目标', { timeout: 60000 }, async t => {
  const writes = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/register') {
      writes.push(url.searchParams.get('object'));
      res.end('ok');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
      <div id="host"></div>
      <script>
      const host = document.querySelector('#host');
      const root = host.attachShadow({mode:'closed'});
      for (const [name, object] of [['登记南京 B-681','B-681'],['登记苏州 A-417','A-417']]) {
        const button = document.createElement('button');
        button.textContent = name;
        button.onclick = () => fetch('/register?object=' + object,{method:'POST'});
        root.append(button);
      }
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `closed-shadow-ax-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage();
  const executor = new Executor(page, { journal: join(directory, 'actions.jsonl'), grants: [{origin,kinds:['click']}] });
  t.after(() => executor.close());
  await page.goto(origin);
  assert.equal(await page.locator('#host').evaluate(host => host.shadowRoot), null);
  const observation = await executor.observe();
  assert.deepEqual(observation.targets, []);
  assert.ok(observation.gaps.some(gap => gap.includes('closed shadow roots')));
  assert.deepEqual(writes, []);
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send('Accessibility.getFullAXTree');
  const buttons = tree.nodes.filter(node => !node.ignored && node.role?.value === 'button');
  assert.equal(buttons.length, 2);
  const matches = buttons.filter(node => node.name?.value === '登记苏州 A-417');
  assert.equal(matches.length, 1);
  const { backendDOMNodeId } = matches[0];
  assert.ok(Number.isInteger(backendDOMNodeId));
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId:backendDOMNodeId });
  const [left, top, , , right, bottom] = model.content;
  const point = { x:(left+right)/2, y:(top+bottom)/2 };
  await page.screenshot({ path:join(directory, 'before.png') });
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().startsWith(origin + '/register?'), { timeout:8000 }),
    page.mouse.click(point.x, point.y),
  ]);
  assert.equal(response.status(), 200);
  assert.deepEqual(writes, ['A-417']);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser:browser.version(),
    dom:{targets:observation.targets,gaps:observation.gaps}, ax:{buttons,model,point}, writes }, null, 2));
  console.log(`S14 封闭 Shadow 证据: ${directory}`);
});
