// Independent review probes. These assertions describe the pre-fix failures,
// not acceptance tests. Only synthetic localhost state is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { TaskState } from '../engine/task-state.mjs';

const out = resolve('traces', `independent-review-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true });
for (const file of ['engine/executor.mjs', 'engine/task-state.mjs', 'failures/review-adversarial.mjs']) {
  await copyFile(file, join(out, file.replaceAll('/', '-')));
}
const findings = [];
const formEvents = [], inputEvents = [];
let inputResolve;
const inputReceived = new Promise(r => { inputResolve = r; });
const server = http.createServer(async (req, res) => {
  if (req.url === '/submit' || req.url === '/input') {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/submit') formEvents.push(Object.fromEntries(new URLSearchParams(body)));
    else { inputEvents.push(body); inputResolve(); }
    res.end('done'); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/form') res.end(`<!doctype html><article><h1>发票 INV-A</h1><button type="submit" form="invoice-a">确认收款</button></article>
    <form id="invoice-a" action="/submit" method="post"><input type="hidden" name="invoice" value="INV-A"></form>
    <form id="invoice-b" action="/submit" method="post"><input type="hidden" name="invoice" value="INV-B"></form>`);
  else res.end(`<!doctype html><article><label>审批备注<input aria-label="审批备注" oninput="fetch('/input',{method:'POST',body:this.value})"></label></article>
    <div id="cover" style="position:fixed;inset:0;background:#eee;z-index:100"></div>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  {
    const page = await browser.newPage();
    const e = new Executor(page, { journal: join(out, 'form-owner.jsonl'), grants: [{ origin, kinds: ['click'], name: '确认收款' }] });
    try {
      await page.goto(origin + '/form');
      const observation = await e.observe();
      const before = await page.getByRole('button').getAttribute('form');
      await page.getByRole('button').evaluate(el => el.setAttribute('form', 'invoice-b'));
      const after = await page.getByRole('button').getAttribute('form');
      const navigation = page.waitForNavigation();
      const receipt = await e.act({ operationId: 'confirm-invoice-a', kind: 'click', ref: observation.targets[0].ref });
      await navigation;
      assert.equal(receipt.dispatch, 'sent');
      assert.deepEqual(formEvents, [{ invoice: 'INV-B' }]);
      findings.push({ id: 'FORM_OWNER_NOT_BOUND', before, after, observation, receipt, backendTruth: formEvents,
        firstDeviation: 'describe ignores changed HTML form association; preflight accepts old INV-A target though form now submits INV-B' });
    } finally { await e.close(); await page.close(); }
  }
  {
    const page = await browser.newPage();
    const e = new Executor(page, { journal: join(out, 'mutable-intent.jsonl'), grants: [{ origin, kinds: ['click'], name: '审批备注' }], timeout: 1500 });
    try {
      await page.goto(origin + '/input-page');
      const observation = await e.observe();
      const action = { operationId: 'focus-note', kind: 'click', ref: observation.targets[0].ref };
      let preflightResolve;
      const preflight = new Promise(r => { preflightResolve = r; });
      const append = e.journal.append.bind(e.journal);
      e.journal.append = record => { const result = append(record); if (record.event === 'preflight') preflightResolve(); return result; };
      const pending = e.act(action);
      await preflight;
      await new Promise(r => setTimeout(r, 80));
      // Host caller mutates the same object while actionability is waiting.
      // No page-owned script changes a handler, target identity or grant.
      action.kind = 'fill'; action.value = '未经fill授权的内容';
      await page.locator('#cover').evaluate(el => el.remove());
      const receipt = await pending;
      await Promise.race([inputReceived, new Promise((_, reject) => setTimeout(() => reject(Error('input event not received')), 1500))]);
      assert.equal(receipt.dispatch, 'sent');
      assert.deepEqual(inputEvents, ['未经fill授权的内容']);
      findings.push({ id: 'MUTABLE_INTENT_BYPASSES_KIND_GRANT', observation, grantKinds: ['click'], receipt, backendTruth: inputEvents,
        journal: e.journal.records, firstDeviation: 'grant check authorizes click; caller changes action.kind while trial awaits; dispatch reads mutable input again and fills' });
    } finally { await e.close(); await page.close(); }
  }
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }

{
  const file = join(out, 'task-crash.jsonl');
  const definition = { goal: '同步源数据并重算派生结果', constraints: ['派生结果必须对应当前源版本'], subgoals: [{ id: 'source' }, { id: 'derived', dependsOn: ['source'] }] };
  let state = new TaskState(file, definition);
  state.record('source', { status: 'verified', evidence: 'source:v1' });
  state.record('derived', { status: 'verified', evidence: 'derived-from:v1' });
  state.close();
  const moduleUrl = pathToFileURL(resolve('engine/task-state.mjs')).href;
  const code = `import {TaskState} from ${JSON.stringify(moduleUrl)};
    const state=new TaskState(process.argv[1]);
    const append=state.journal.append.bind(state.journal);
    state.journal.append=record=>{const result=append(record);if(record.event==='subgoal_result'&&record.id==='source'&&record.status==='unknown')process.exit(23);return result;};
    state.record('source',{status:'unknown',evidence:'source-changed-to:v2'});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, file], { stdio: 'ignore' });
  const codeReturned = await new Promise(r => child.on('exit', r));
  assert.equal(codeReturned, 23);
  // Operator recovery only after this test has observed the writer exit.
  await unlink(file + '.lock');
  state = new TaskState(file);
  try {
    const recoveredBefore = { source: state.status('source'), derived: state.status('derived'), outcome: state.outcome };
    state.record('source', { status: 'verified', evidence: 'source:v2' });
    const recoveredAfter = { source: state.status('source'), derived: state.status('derived'), outcome: state.outcome };
    const businessTruth = { sourceVersion: 2, derivedFromVersion: 1, completed: false };
    assert.equal(recoveredAfter.outcome, 'verified');
    findings.push({ id: 'DEPENDENCY_INVALIDATION_NOT_CRASH_ATOMIC', codeReturned, recoveredBefore, recoveredAfter, businessTruth,
      firstDeviation: 'record persists parent unknown then appends descendant invalidations separately; crash between records leaves old descendant verification reusable after source reverification' });
  } finally { state.close(); }
}
await writeFile(join(out, 'findings.json'), JSON.stringify({ date: new Date().toISOString(), node: process.version, findings }, null, 2));
console.log(JSON.stringify({ evidence: out, reproduced: findings.map(f => f.id) }, null, 2));
