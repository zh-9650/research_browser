import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { TaskState } from '../engine/task-state.mjs';

test('25步受控任务：第15次写入后重启浏览器，约束不漂移，核实后续做且不重放', async () => {
  const dir = resolve('traces', `long-task-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(dir, { recursive: true });
  const sourceHashes = {};
  for (const file of ['engine/task-state.mjs', 'engine/executor.mjs', 'tests/long-task.test.mjs', 'package-lock.json']) {
    await copyFile(file, join(dir, file.replaceAll('/', '-')));
    sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  const boxes = Array.from({ length: 25 }, () => `PKG-${randomUUID().slice(0, 8)}`);
  const committed = [];
  const attempts = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/commit') {
      let data = ''; for await (const chunk of req) data += chunk;
      const { box } = JSON.parse(data); attempts.push(box);
      committed.push(box);
      res.end('{}'); return;
    }
    if (req.url === '/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(committed)); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const current = boxes[committed.length];
    res.end(`<article><h1>仓储到货登记</h1><p>当前箱号 ${current || '已全部登记'}</p><button ${current ? '' : 'disabled'}>登记此箱</button></article>
      <script>document.querySelector('button').onclick=async()=>{await fetch('/commit',{method:'POST',body:JSON.stringify({box:${JSON.stringify(current || '')}})});location.reload();};</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const definition = { goal: '按清单顺序各登记一次25箱到货', constraints: ['不能遗漏', '不得重复登记', '严格按清单顺序'],
    subgoals: boxes.map((box, i) => ({ id: `box-${i + 1}`, box, dependsOn: i ? [`box-${i}`] : [] })) };
  const statePath = join(dir, 'task.jsonl');
  const operationPath = join(dir, 'actions.jsonl');
  let state = new TaskState(statePath, definition);
  let browser, page, executor;
  const open = async () => {
    browser = await chromium.launch({ channel: 'chrome' });
    page = await browser.newPage();
    executor = new Executor(page, { journal: operationPath, grants: [{ origin, kinds: ['click'] }] });
    await page.goto(origin);
  };
  const verify = async (index) => {
    // Authorized read-only reconciliation; never a backdoor write to setup/complete data.
    const status = await (await fetch(origin + '/status')).json();
    assert.equal(status[index], boxes[index]);
    assert.equal(status.filter(id => id === boxes[index]).length, 1);
    state.record(`box-${index + 1}`, { status: 'verified', evidence: `backend-status:${boxes[index]}:count=1` });
  };
  try {
    await open();
    for (let i = 0; i < 15; i++) {
      const obs = await executor.observe();
      await writeFile(join(dir, `step-${i + 1}-observation.json`), JSON.stringify(obs, null, 2));
      const target = obs.targets.find(t => t.context.includes(boxes[i]));
      const navigated = page.waitForNavigation();
      assert.equal((await executor.act({ operationId: `box-${i + 1}`, kind: 'click', ref: target.ref })).dispatch, 'sent');
      await navigated;
      if (i < 14) await verify(i);
    }
    // Emulate the gap between external commit and local checkpoint confirmation.
    assert.equal(state.status('box-15'), 'pending');
    await executor.close(); await browser.close(); state.close();
    assert.throws(() => new TaskState(statePath, { ...definition, constraints: ['只登记20箱也算完成'] }), /TASK_CONSTRAINTS_CHANGED/);
    state = new TaskState(statePath);
    assert.deepEqual(state.definition.constraints, definition.constraints);
    assert.equal(state.next()[0].id, 'box-15');
    await open();
    const fresh = await executor.observe();
    await writeFile(join(dir, 'restart-observation.json'), JSON.stringify(fresh, null, 2));
    const replay = await executor.act({ operationId: 'box-15', kind: 'click', ref: fresh.targets[0].ref });
    assert.equal(replay.error, 'OPERATION_ALREADY_ATTEMPTED');
    await verify(14);
    for (let i = 15; i < 25; i++) {
      assert.equal(state.next()[0].id, `box-${i + 1}`);
      const obs = await executor.observe();
      await writeFile(join(dir, `step-${i + 1}-observation.json`), JSON.stringify(obs, null, 2));
      const target = obs.targets.find(t => t.context.includes(boxes[i]));
      const navigated = page.waitForNavigation();
      await executor.act({ operationId: `box-${i + 1}`, kind: 'click', ref: target.ref });
      await navigated;
      await verify(i);
    }
    assert.equal(state.outcome, 'verified');
    assert.deepEqual(committed, boxes);
    assert.deepEqual(attempts, boxes);
    await page.screenshot({ path: join(dir, 'final.png') });
    await writeFile(join(dir, 'result.json'), JSON.stringify({ committed: committed.length, attempts: attempts.length, records: committed, submitted: attempts, sourceHashes, taskOutcome: state.outcome, browser: browser.version(), node: process.version }, null, 2));
    console.log(`长任务证据: ${dir}`);
  } finally {
    if (executor) await executor.close();
    if (browser) await browser.close();
    state.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('任务状态拒绝循环依赖、越过依赖和无证据完成', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-state-'));
  assert.throws(() => new TaskState(join(dir, 'cycle.jsonl'), { goal: 'x', constraints: [], subgoals: [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }] }), /CYCLIC/);
  const state = new TaskState(join(dir, 'normal.jsonl'), { goal: 'x', constraints: [], subgoals: [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }] });
  try {
    assert.throws(() => state.record('b', { status: 'verified', evidence: 'test' }), /DEPENDENCY_UNMET/);
    assert.throws(() => state.record('a', { status: 'verified', evidence: '' }), /EVIDENCE_REQUIRED/);
    state.record('a', { status: 'unknown', evidence: 'missing-business-state' });
    assert.equal(state.outcome, 'unknown');
    assert.deepEqual(state.next().map(s => s.id), ['a']);
    state.record('a', { status: 'verified', evidence: 'observed-a' });
    state.record('b', { status: 'verified', evidence: 'observed-b' });
    assert.equal(state.outcome, 'verified');
    state.record('a', { status: 'unknown', evidence: 'contradicting-a' });
    assert.equal(state.status('b'), 'unknown');
    state.record('a', { status: 'verified', evidence: 'reverified-a' });
    assert.deepEqual(state.next().map(s => s.id), ['b']);
    const copy = state.definition; copy.constraints.push('caller change');
    assert.deepEqual(state.definition.constraints, []);
  } finally { state.close(); }
});
