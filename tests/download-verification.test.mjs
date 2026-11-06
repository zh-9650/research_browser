import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { verifyDownload } from '../engine/download-verification.mjs';

test('S22 同名下载按内容判分，中断或挂起时保持未知', { timeout: 60000 }, async t => {
  const expected = Buffer.from('编号,城市,数量\nSZ-417,苏州,12\n');
  const incorrect = Buffer.from('编号,城市,数量\nNJ-681,南京,12\n');
  const expectedSha256 = createHash('sha256').update(expected).digest('hex');
  const requests = [];
  const hangingConnections = [];
  const server = createServer((req, res) => {
    const [, mode, action] = req.url.split('/');
    if (action !== 'export') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<a href="export">下载苏州到货清单</a>');
      return;
    }
    requests.push({ mode, range: req.headers.range ?? null });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=arrival.csv', 'Content-Length': expected.length });
    if (mode === 'interrupted') {
      res.write(expected.subarray(0, 4), () => res.destroy());
    } else if (mode === 'hanging') {
      hangingConnections.push(new Promise(resolve => res.once('close', () => resolve({ completed: res.writableFinished }))));
      res.write(expected.subarray(0, 4));
    } else {
      res.end(mode === 'incorrect' ? incorrect : expected);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `s22-download-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const outcomes = { correct: 'verified', incorrect: 'failed', interrupted: 'unknown', overLimit: 'failed', hanging: 'unknown' };
  const results = [];
  for (const [mode, expectedStatus] of Object.entries(outcomes)) {
    const page = await browser.newPage({ acceptDownloads: true });
    const executor = new Executor(page, { journal: join(directory, `${mode}.jsonl`),
      grants: [{ origin, kinds: ['click'], name: '下载苏州到货清单' }] });
    try {
      await page.goto(`${origin}/${mode}/`);
      const target = (await executor.observe()).targets.find(target => target.name === '下载苏州到货清单');
      const [download, receipt] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        executor.act({ operationId: 'export-arrivals', kind: 'click', ref: target.ref }),
      ]);
      assert.equal(receipt.dispatch, 'sent');
      assert.equal(receipt.task_goal, 'unknown');
      const started = performance.now();
      const verdict = await verifyDownload(download, { expectedSha256, maxBytes: mode === 'overLimit' ? 4 : 1024,
        timeoutMs: mode === 'hanging' ? 500 : 15000 });
      const elapsedMs = Math.round(performance.now() - started);
      assert.equal(verdict.filename, 'arrival.csv');
      assert.equal(verdict.status, expectedStatus);
      if (mode === 'incorrect') assert.equal(verdict.reason, 'DOWNLOAD_DIGEST_MISMATCH');
      if (mode === 'interrupted') assert.equal(verdict.reason, 'DOWNLOAD_CONTENT_UNAVAILABLE');
      if (mode === 'overLimit') assert.equal(verdict.reason, 'DOWNLOAD_SIZE_LIMIT');
      if (mode === 'correct' || mode === 'incorrect') await download.saveAs(join(directory, `${mode}.csv`));
      const browserDownloadFailure = await download.failure();
      let connection;
      if (mode === 'hanging') {
        assert.equal(verdict.reason, 'DOWNLOAD_VERIFICATION_TIMEOUT');
        assert.ok(elapsedMs < 5000);
        assert.equal(browserDownloadFailure, 'canceled');
        assert.equal(hangingConnections.length, 1);
        let closeTimer;
        try {
          connection = await Promise.race([hangingConnections[0],
            new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('SERVER_CONNECTION_STILL_OPEN')), 5000); })]);
          assert.deepEqual(connection, { completed: false });
        } finally { clearTimeout(closeTimer); }
      }
      results.push({ mode, receipt, verdict, elapsedMs, browserDownloadFailure, connection });
    } finally { await executor.close(); await page.close(); }
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), expectedSha256, results, requests }, null, 2));
  console.log(`S22 下载证据: ${directory}`);
});
