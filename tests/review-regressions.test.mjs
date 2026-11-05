import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { Executor, Journal } from '../engine/executor.mjs';
import { TaskState } from '../engine/task-state.mjs';

// These are the safe expectations for the three independently reproduced failures.
// Historical pre-fix evidence/script stays unchanged under failures/ and traces/.
const out = resolve('traces', `review-regressions-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true });
const sourceHashes = {};
for (const file of ['engine/executor.mjs', 'engine/task-state.mjs', 'tests/review-regressions.test.mjs', 'package-lock.json']) {
  const bytes = await readFile(file);
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
  await copyFile(file, join(out, file.replaceAll('/', '-')));
}
await writeFile(join(out, 'environment.json'), JSON.stringify({ node: process.version, sourceHashes,
  beforeFixEvidence: 'traces/independent-review-2026-11-04T15-26-38-055Z/findings.json' }, null, 2));

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
async function body(req) { let data = ''; for await (const chunk of req) data += chunk; return data; }

test('反方回归：外置表单owner或提交目的地改变时拒绝；正常原表单仅提交指定发票', async () => {
  const events = [];
  const server = await listen(async (req, res) => {
    if (req.url.startsWith('/submit')) {
      events.push({ endpoint: req.url, fields: Object.fromEntries(new URLSearchParams(await body(req))) });
      res.end('done'); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><article><h1>发票 INV-A</h1><button type="submit" form="invoice-a">确认收款</button></article>
      <form id="invoice-a" action="/submit" method="post"><input type="hidden" name="invoice" value="INV-A"></form>
      <form id="invoice-b" action="/submit" method="post"><input type="hidden" name="invoice" value="INV-B"></form>`);
  });
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  try {
    for (const scenario of ['changed-owner', 'changed-destination', 'normal-original-form']) {
      const page = await browser.newPage();
      const e = new Executor(page, { journal: join(out, `${scenario}.jsonl`), grants: [{ origin: server.origin, kinds: ['click'], name: '确认收款' }] });
      try {
        await page.goto(server.origin + '/form');
        const observation = await e.observe();
        if (scenario === 'changed-owner') await page.getByRole('button').evaluate(el => el.setAttribute('form', 'invoice-b'));
        if (scenario === 'changed-destination') await page.getByRole('button').evaluate(el => el.setAttribute('formaction', '/submit-bypass'));
        const attrs = await page.getByRole('button').evaluate(el => ({ form: el.getAttribute('form'), formAction: el.getAttribute('formaction') }));
        const navigation = scenario === 'normal-original-form' ? page.waitForNavigation() : null;
        const receipt = await e.act({ operationId: 'confirm-invoice-a', kind: 'click', ref: observation.targets[0].ref });
        if (navigation) await navigation;
        if (scenario === 'normal-original-form') {
          assert.equal(receipt.dispatch, 'sent');
          assert.deepEqual(events, [{ endpoint: '/submit', fields: { invoice: 'INV-A' } }]);
        } else {
          assert.equal(receipt.error, 'TARGET_STALE');
          assert.equal(receipt.dispatch, 'not_sent');
          assert.equal(events.length, 0);
          assert.equal(e.journal.records.some(r => r.event === 'dispatch_intent'), false);
        }
        results.push({ scenario, observation, attrs, receipt, backendTruth: structuredClone(events) });
      } finally { await e.close(); await page.close(); }
    }
    await writeFile(join(out, 'form-owner-results.json'), JSON.stringify({ browser: browser.version(), results }, null, 2));
  } finally { await browser.close(); await server.close(); }
});

test('反方回归：等待期间修改调用方action不越权；真正获授权的fill正常写入', async () => {
  const events = [];
  let receivedResolve;
  const received = new Promise(r => { receivedResolve = r; });
  const server = await listen(async (req, res) => {
    if (req.url === '/input') { events.push(await body(req)); receivedResolve(); res.end('{}'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><article><label>审批备注<input aria-label="审批备注" oninput="fetch('/input',{method:'POST',body:this.value})"></label></article>
      <div id="cover" style="position:fixed;inset:0;background:#eee;z-index:100"></div>`);
  });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  let e = new Executor(page, { journal: join(out, 'immutable-action.jsonl'), grants: [{ origin: server.origin, kinds: ['click'], name: '审批备注' }], timeout: 1500 });
  try {
    await page.goto(server.origin);
    const observation = await e.observe();
    const action = { operationId: 'focus-note', kind: 'click', ref: observation.targets[0].ref };
    let preflightResolve;
    const preflight = new Promise(r => { preflightResolve = r; });
    const append = e.journal.append.bind(e.journal);
    e.journal.append = record => { const result = append(record); if (record.event === 'preflight') preflightResolve(); return result; };
    const pending = e.act(action);
    await preflight;
    await new Promise(r => setTimeout(r, 80));
    action.kind = 'fill'; action.value = '未经fill授权的内容'; action.operationId = 'mutated-operation-id';
    await page.locator('#cover').evaluate(el => el.remove());
    const receipt = await pending;
    assert.equal(receipt.operationId, 'focus-note');
    assert.equal(receipt.dispatch, 'sent');
    assert.equal(await page.getByRole('textbox').inputValue(), '');
    assert.deepEqual(events, []);
    const dispatches = e.journal.records.filter(r => r.event === 'dispatch_intent');
    assert.deepEqual(dispatches.map(r => ({ kind: r.kind, operationId: r.operationId })), [{ kind: 'click', operationId: 'focus-note' }]);
    const denied = await e.act({ operationId: 'explicit-unapproved-fill', kind: 'fill', value: '未授权', ref: observation.targets[0].ref });
    assert.equal(denied.error, 'POLICY_DENIED');
    await e.close();
    e = new Executor(page, { journal: join(out, 'authorized-fill.jsonl'), grants: [{ origin: server.origin, kinds: ['fill'], name: '审批备注' }] });
    const fresh = await e.observe();
    const authorized = await e.act({ operationId: 'approved-note', kind: 'fill', value: '已核对合同附件', ref: fresh.targets[0].ref });
    const timer = setTimeout(() => receivedResolve(), 1500); timer.unref();
    await received; clearTimeout(timer);
    assert.equal(authorized.dispatch, 'sent');
    assert.deepEqual(events, ['已核对合同附件']);
    await writeFile(join(out, 'immutable-intent-results.json'), JSON.stringify({ browser: browser.version(), observation, mutatedCallerAction: action, receipt, dispatches, denied, authorized, backendTruth: events }, null, 2));
  } finally { await e.close(); await browser.close(); await server.close(); }
});

const definition = { goal: '同步源数据并更新两层派生结果', constraints: ['派生结果必须对应当前源版本'], subgoals: [
  { id: 'source' }, { id: 'derived', dependsOn: ['source'] }, { id: 'summary', dependsOn: ['derived'] },
] };
async function exitedChild(code, file) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, file], { stdio: 'ignore' });
  return await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
}
function summarize(state) { return { source: state.status('source'), derived: state.status('derived'), summary: state.status('summary'), outcome: state.outcome }; }

test('反方回归：旧格式父失效半事务崩溃后，重放派生失效，不复用旧下游证据', async () => {
  const file = join(out, 'legacy-half-transaction.jsonl');
  let state = new TaskState(file, definition);
  state.close();
  const journalUrl = pathToFileURL(resolve('engine/executor.mjs')).href;
  const code = `import {Journal} from ${JSON.stringify(journalUrl)};
    const j=new Journal(process.argv[1]);
    for(const id of ['source','derived','summary'])j.append({event:'subgoal_result',id,status:'verified',evidence:id+':v1'});
    j.append({event:'subgoal_result',id:'source',status:'unknown',evidence:'source-changed-to:v2'});
    process.exit(23);`;
  assert.equal(await exitedChild(code, file), 23);
  assert.throws(() => new TaskState(file), { code: 'EEXIST' });
  await unlink(file + '.lock'); // test has independently observed its writer exit
  state = new TaskState(file);
  try {
    const recovered = summarize(state);
    assert.deepEqual(recovered, { source: 'unknown', derived: 'unknown', summary: 'unknown', outcome: 'unknown' });
    state.record('source', { status: 'verified', evidence: 'source:v2' });
    const reverifiedParent = summarize(state);
    assert.equal(reverifiedParent.outcome, 'unknown');
    assert.deepEqual(state.next().map(s => s.id), ['derived']);
    state.record('derived', { status: 'verified', evidence: 'derived:v2' });
    assert.equal(state.outcome, 'unknown');
    state.record('summary', { status: 'verified', evidence: 'summary:v2' });
    assert.equal(state.outcome, 'verified');
    await writeFile(join(out, 'legacy-recovery-results.json'), JSON.stringify({ recovered, reverifiedParent, final: summarize(state), businessTruthBeforeRecompute: { sourceVersion: 2, derivedFromVersion: 1, summaryFromVersion: 1, completed: false } }, null, 2));
  } finally { state.close(); }
});

test('反方回归：新事务fsync后崩溃保留完整失效，已核实证据版本改变也失效下游', async () => {
  const file = join(out, 'atomic-invalidation.jsonl');
  let state = new TaskState(file, definition);
  for (const id of ['source', 'derived', 'summary']) state.record(id, { status: 'verified', evidence: id + ':v1' });
  state.close();
  const stateUrl = pathToFileURL(resolve('engine/task-state.mjs')).href;
  const code = `import {TaskState} from ${JSON.stringify(stateUrl)};
    const state=new TaskState(process.argv[1]);const append=state.journal.append.bind(state.journal);
    state.journal.append=record=>{const result=append(record);if(record.event==='subgoal_transaction'&&record.results[0].id==='source'&&record.results[0].status==='unknown')process.exit(23);return result;};
    state.record('source',{status:'unknown',evidence:'source-changed-to:v2'});`;
  assert.equal(await exitedChild(code, file), 23);
  assert.throws(() => new TaskState(file), { code: 'EEXIST' });
  await unlink(file + '.lock');
  state = new TaskState(file);
  try {
    const rawLast = state.journal.records.at(-1);
    assert.equal(rawLast.event, 'subgoal_transaction');
    assert.deepEqual(rawLast.results.map(r => [r.id, r.status]), [['source', 'unknown'], ['derived', 'unknown'], ['summary', 'unknown']]);
    const recovered = summarize(state);
    assert.equal(recovered.outcome, 'unknown');
    for (const id of ['source', 'derived', 'summary']) state.record(id, { status: 'verified', evidence: id + ':v2' });
    assert.equal(state.outcome, 'verified');
    state.record('source', { status: 'verified', evidence: 'source:v2' });
    assert.equal(state.outcome, 'verified', 'repeating unchanged verified evidence must not invalidate descendants');
    state.record('source', { status: 'verified', evidence: 'source:v3' });
    const changedEvidence = summarize(state);
    assert.deepEqual(changedEvidence, { source: 'verified', derived: 'unknown', summary: 'unknown', outcome: 'unknown' });
    assert.deepEqual(state.next().map(s => s.id), ['derived']);
    await writeFile(join(out, 'atomic-recovery-results.json'), JSON.stringify({ rawLast, recovered, changedEvidence }, null, 2));
  } finally { state.close(); }
});

console.log(`独立修复回归证据: ${out}`);
