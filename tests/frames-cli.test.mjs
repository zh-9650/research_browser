import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '../adapters/client.mjs';
import { targetContext } from '../engine/observation-codec.mjs';
import { Executor } from '../engine/executor.mjs';
import { startFixture } from '../benchmarks/fixture.mjs';

test('frame 重载拒绝旧目标，open Shadow 控件可操作但不声称覆盖完整', async () => {
  const f = await startFixture();
  const b = await chromium.launch({ channel: 'chrome' });
  const dir = await mkdtemp(join(tmpdir(), 'browser-frames-'));
  const page = await b.newPage();
  const e = new Executor(page, { journal: join(dir, 'frames.jsonl'), grants: [{ origin: f.base, kinds: ['click'] }] });
  try {
    await page.goto(f.create().url);
    await page.evaluate(() => { window.fault.frame(); window.fault.shadow(); });
    await page.frameLocator('iframe').getByRole('button', { name: '归档' }).waitFor();
    const observation = await e.observe();
    assert.equal(observation.complete, false);
    const shadow = observation.targets.find(t => t.name === '审核');
    assert.ok(shadow);
    assert.equal((await e.act({ operationId: 'review', kind: 'click', ref: shadow.ref }, { postcondition: async () => await page.getByRole('button', { name: '已审核' }).count() === 1 })).postcondition, 'met');
    const frameTarget = observation.targets.find(t => t.name === '归档');
    assert.ok(frameTarget);
    const frame = page.frames()[1];
    await frame.goto(frame.url() + '?reload=1');
    const stale = await e.act({ operationId: 'archive', kind: 'click', ref: frameTarget.ref });
    assert.ok(['FRAME_CHANGED', 'TARGET_STALE'].includes(stale.error));
    const fresh = await e.observe();
    const target = fresh.targets.find(t => t.name === '归档');
    assert.equal((await e.act({ operationId: 'archive', kind: 'click', ref: target.ref }, { postcondition: async () => await frame.getByRole('button', { name: '已归档' }).count() === 1 })).postcondition, 'met');
  } finally { await e.close(); await b.close(); await f.close(); }
});

test('CLI JSONL：独立进程接收 task/observe/act，后端独立判分', async () => {
  const f = await startFixture();
  const dir = await mkdtemp(join(tmpdir(), 'browser-cli-'));
  const world = f.create();
  const cfg = join(dir, 'task.json');
  await writeFile(cfg, JSON.stringify({ url: world.url, goal: `核对 ${world.ids[0]} 的收款`, constraints: ['只处理指定发票'], observationEncoding: 'shared-context-v1', grants: [{ origin: f.base, kinds: ['click'] }], journal: join(dir, 'cli.jsonl') }));
  const client = createClient(cfg, { captureProtocol: true });
  try {
    const observation = await client.ready;
    assert.equal(observation.encoding, 'shared-context-v1');
    const candidate = observation.targets.find(t => targetContext(observation, t).includes(world.ids[0]));
    const result = await client.request('act', { operationId: 'confirm', kind: 'click', ref: candidate.ref });
    assert.equal(result.receipt.dispatch, 'sent');
    assert.equal(result.receipt.task_goal, 'unknown');
    assert.equal((await client.request('unsupported')).error, 'METHOD_NOT_SUPPORTED');
    assert.equal((await client.request('observe', { textOffset: -1 })).error, 'MODEL_DECISION_INVALID');
    await client.close();
    assert.equal(f.oracle(world.key).events.length, 1);
    assert.equal(f.oracle(world.key).events[0].id, world.ids[0]);
  } finally { client.kill(); await f.close(); }
});

test('进程客户端：启动失败返回错误，不重试或发出业务动作', async () => {
  const client = createClient('not-opened.json', { nodeExecutable: 'definitely-no-node-executable-browser-research' });
  await assert.rejects(client.ready, /CLI_LAUNCH_FAILED/);
  await assert.rejects(client.request('act', { operationId: 'never-send', ref: 'r1-1', kind: 'click' }), /CLI_RESPONSE_UNKNOWN/);
  await client.close();
});

test('观察显式报告文本裁剪、候选预算与不可信来源', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-observation-'));
  const b = await chromium.launch({ channel: 'chrome' });
  const page = await b.newPage();
  const e = new Executor(page, { journal: join(dir, 'observe.jsonl'), maxTargets: 2, maxTextChars: 20 });
  try {
    await page.setContent('<p>这是一段超过观察预算的普通页面文字，用于验证裁剪会明确报告。</p><button>一</button><button>二</button><button>三</button>');
    const observation = await e.observe();
    assert.equal(observation.trust, 'untrusted_page_data');
    assert.equal(observation.targets.length, 2);
    assert.equal(observation.documents[0].text.length, 20);
    assert.equal(observation.documents[0].truncated, true);
    const rest = await e.observe({ textOffset: observation.documents[0].nextOffset });
    assert.equal(rest.documents[0].offset, 20);
    assert.notEqual(rest.documents[0].text, observation.documents[0].text);
    await assert.rejects(e.observe({ textOffset: -1 }), /MODEL_DECISION_INVALID/);
    assert.ok(observation.gaps.some(x => x.includes('target budget')));
    assert.equal(observation.complete, false);
  } finally { await e.close(); await b.close(); }
});
