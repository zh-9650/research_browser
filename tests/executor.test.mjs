import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Executor, Journal } from '../engine/executor.mjs';
import { startFixture } from '../benchmarks/fixture.mjs';

test('真实浏览器：身份变化、权限与写操作持久防重放', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const dir = await mkdtemp(join(tmpdir(), 'browser-executor-'));
  try {
    for (const fault of ['reorder', 'recycle', 'replace', 'uniqueReplacement']) {
      const world = fixture.create();
      const page = await browser.newPage();
      const engine = new Executor(page, { journal: join(dir, fault + '.jsonl'), grants: [{ origin: fixture.base, kinds: ['click'] }] });
      try {
        await page.goto(world.url);
        const obs = await engine.observe();
        const target = obs.targets.find(t => t.context.includes(world.ids[0]));
        await page.evaluate(f => window.fault[f](), fault);
        const receipt = await engine.act({ operationId: 'confirm', kind: 'click', ref: target.ref });
        assert.equal(receipt.error, 'TARGET_STALE', fault);
        assert.equal(fixture.oracle(world.key).events.length, 0);
      } finally { await engine.close(); await page.close(); }
    }
    const world = fixture.create('lost-response');
    const page = await browser.newPage();
    const journal = join(dir, 'restart.jsonl');
    let engine = new Executor(page, { journal, grants: [] });
    try {
      await page.goto(world.url);
      let obs = await engine.observe();
      let ref = obs.targets[0].ref;
      assert.equal((await engine.act({ operationId: 'blocked', ref, kind: 'click', risk: 'read' })).error, 'POLICY_DENIED');
      assert.equal((await engine.act({ operationId: 'bad', ref, kind: 'javascript' })).error, 'MODEL_DECISION_INVALID');
      await engine.close();
      engine = new Executor(page, { journal, grants: [{ origin: fixture.base, kinds: ['click'] }] });
      obs = await engine.observe(); ref = obs.targets[0].ref;
      await engine.act({ operationId: 'confirm', ref, kind: 'click' });
      await page.getByRole('status').filter({ hasText: '连接中断' }).waitFor();
      await engine.close();
      engine = new Executor(page, { journal, grants: [{ origin: fixture.base, kinds: ['click'] }] });
      obs = await engine.observe(); ref = obs.targets[0].ref;
      assert.equal((await engine.act({ operationId: 'confirm', ref, kind: 'click' })).error, 'OPERATION_ALREADY_ATTEMPTED');
      assert.equal(fixture.oracle(world.key).events.length, 1);
    } finally { await engine.close(); await page.close(); }
  } finally { await browser.close(); await fixture.close(); }
});

test('账本：禁止双写、损坏时拒绝恢复、先写意图再调用浏览器', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-journal-'));
  const file = join(dir, 'journal.jsonl');
  const j = new Journal(file);
  j.append({ event: 'dispatch_intent', operationId: 'invoice' });
  assert.throws(() => new Journal(file), { code: 'EEXIST' });
  j.close();
  const resumed = new Journal(file);
  assert.equal(resumed.prior('invoice')[0].event, 'dispatch_intent');
  resumed.close();
  await writeFile(file, '{torn');
  assert.throws(() => new Journal(file), SyntaxError);
});

test('短时遮罩移除后只执行一次，同时到达的另一控制器被拒绝', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ channel: 'chrome' });
  const dir = await mkdtemp(join(tmpdir(), 'browser-shared-tab-'));
  const page = await browser.newPage();
  const world = fixture.create();
  const grants = [{ origin: fixture.base, kinds: ['click'] }];
  const a = new Executor(page, { journal: join(dir, 'a.jsonl'), grants, timeout: 1500 });
  const b = new Executor(page, { journal: join(dir, 'b.jsonl'), grants, timeout: 1500 });
  try {
    await page.goto(world.url);
    const refA = (await a.observe()).targets.find(t => t.context.includes(world.ids[0])).ref;
    const refB = (await b.observe()).targets.find(t => t.context.includes(world.ids[0])).ref;
    await page.evaluate(() => window.fault.overlay());
    const pending = a.act({ operationId: 'confirm-a', ref: refA, kind: 'click' });
    const blocked = await b.act({ operationId: 'confirm-b', ref: refB, kind: 'click' });
    assert.equal(blocked.error, 'SESSION_BUSY');
    assert.equal(fixture.oracle(world.key).events.length, 0);
    await page.locator('#cover').evaluate(el => el.remove());
    assert.equal((await pending).dispatch, 'sent');
    await page.getByRole('status').filter({ hasText: '保存成功' }).waitFor();
    assert.deepEqual(fixture.oracle(world.key).events.map(event => event.id), [world.ids[0]]);
    assert.equal(b.journal.records.some(record => record.event === 'dispatch_intent'), false);
  } finally { await a.close(); await b.close(); await browser.close(); await fixture.close(); }
});
