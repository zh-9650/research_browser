import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';

test('乐观页面先显示成功，后端拒绝并回滚，独立裁判拒绝 DONE', async () => {
  let rejectWrite;
  const rejected = new Promise(resolve => { rejectWrite = resolve; });
  const requests = [], records = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      requests.push(req.url);
      await rejected;
      res.writeHead(409).end('conflict');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<button id="commit">确认调拨</button><output role="status">待确认</output>
      <script>document.querySelector('button').onclick=async()=>{
        const status=document.querySelector('output');status.textContent='保存成功';
        const reply=await fetch('/commit',{method:'POST'});
        if(!reply.ok)status.textContent='库存冲突，已回滚';
      };</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome' });
  const directory = resolve('traces', `optimistic-outcome-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage();
  const executor = new Executor(page, { journal: join(directory, 'actions.jsonl'), grants: [{ origin, kinds: ['click'] }] });
  let optimisticEvidence;
  try {
    await page.goto(origin);
    const result = await runAgent({ executor, directory, task: { goal: '创建一条已确认调拨', constraints: ['一次提交'] },
      decide: async ({ state }) => {
        if (state.history.length === 0) return { validRun: true, usage: { input_tokens: 0, output_tokens: 0 },
          answer: { kind: 'click', ref: state.observation.targets[0].ref, value: '', reason: 'controlled actor' } };
        optimisticEvidence = state.observation.documents.map(doc => doc.text).join('\n');
        assert.match(optimisticEvidence, /保存成功/);
        return { validRun: true, usage: { input_tokens: 0, output_tokens: 0 }, answer: { kind: 'done', ref: '', value: '', reason: 'controlled false success' } };
      },
      verifyGoal: async () => {
        rejectWrite();
        await page.getByRole('status').filter({ hasText: '已回滚' }).waitFor();
        return { status: records.length === 1 ? 'verified' : 'failed', evidence: `backend:requests=${requests.length}:records=${records.length}` };
      } });
    assert.equal(result.modelDone, true);
    assert.equal(result.terminal, 'GOAL_FAILED');
    assert.deepEqual(requests, ['/commit']);
    assert.deepEqual(records, []);
    await writeFile(join(directory, 'oracle.json'), JSON.stringify({ browser: browser.version(), optimisticEvidence, requests, records,
      finalStatus: await page.getByRole('status').innerText(), verdict: result.taskResult, decisionSource: 'deterministic test actor' }, null, 2));
    console.log(`乐观回滚证据: ${directory}`);
  } finally {
    rejectWrite();
    await executor.close();
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
