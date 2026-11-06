import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S21 受信宿主附加文件，独立后端区分接收字节与业务入账', async t => {
  const records = [];
  const requests = [];
  const expected = '编号,城市,数量\nSZ-417,苏州,12\n';
  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
        const attachment = form.get('attachment');
        const bytes = Buffer.from(await attachment.arrayBuffer());
        const accepted = bytes.toString('utf8') === expected;
        requests.push({ path: req.url, name: attachment.name, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'), accepted });
        if (accepted) records.push('SZ-417');
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ accepted }));
      } catch { res.writeHead(400).end(); }
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<form action="./import" method="post" enctype="multipart/form-data">
      <label>到货清单 <input type="FILE" name="attachment" required></label>
      <button>导入清单</button><p role="status"></p></form>
      <script>
      const form = document.querySelector('form');
      form.onsubmit = async event => {
        event.preventDefault();
        const response = await fetch(form.action, { method: 'POST', body: new FormData(form) });
        if (response.ok) document.querySelector('[role=status]').textContent = '上传成功';
      };
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `s21-upload-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [mode, content] of [['incorrect', expected.replace('SZ-417,苏州', 'NJ-681,南京')], ['correct', expected]]) {
    const page = await browser.newPage();
    const executor = new Executor(page, { journal: join(directory, `${mode}.jsonl`), grants: [
      { origin, kinds: ['attach'], name: '到货清单' },
      { origin, kinds: ['click'], name: '导入清单' },
    ] });
    try {
      await page.goto(`${origin}/${mode}/`);
      const observation = await executor.observe();
      const target = observation.targets.find(target => target.type === 'file');
      assert.deepEqual(target.actions, []);
      const attach = { operationId: 'attach-arrivals', kind: 'attach', ref: target.ref };
      const untrusted = await executor.act({ ...attach, value: 'C:/private/arrival.csv' });
      assert.equal(untrusted.error, 'INVALID_HOST_FILE');
      const chooser = await executor.act({ ...attach, kind: 'click' });
      assert.equal(chooser.error, 'MODEL_DECISION_INVALID');
      const buffer = Buffer.from(content);
      const attachment = await executor.act(attach, { hostFile: { name: 'arrival.csv', mimeType: 'text/csv', buffer } });
      assert.equal(attachment.dispatch, 'sent');
      assert.equal(requests.length, results.length);
      const selected = await executor.readTarget(target.ref);
      assert.deepEqual(selected.fieldState, { fileCount: 1 });
      const fresh = await executor.observe();
      assert.equal(JSON.stringify(fresh).includes('arrival.csv'), false);
      const submit = fresh.targets.find(target => target.name === '导入清单');
      const submission = await executor.act({ operationId: 'import-arrivals', kind: 'click', ref: submit.ref }, { postcondition: async () => {
        await page.getByRole('status').filter({ hasText: '上传成功' }).waitFor({ timeout: 5000 });
        return requests.at(-1)?.path === `/${mode}/import` && requests.at(-1).accepted;
      } });
      assert.equal(submission.dispatch, 'sent');
      assert.equal(submission.postcondition, mode === 'correct' ? 'met' : 'unmet');
      assert.equal(requests.length, results.length + 1);
      assert.equal(requests.at(-1).sha256, createHash('sha256').update(buffer).digest('hex'));
      results.push({ mode, untrusted, attachment, selected, submission, request: requests.at(-1) });
    } finally { await executor.close(); await page.close(); }
  }
  assert.deepEqual(records, ['SZ-417']);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), results, records }, null, 2));
  console.log(`S21 上传验真证据: ${directory}`);
});
