import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { normalizeDecision } from '../engine/decision-modes.mjs';
import { startDecisionFixture } from '../benchmarks/decision-modes/fixture.mjs';

test('自由 Locator 必须唯一且绑定同一次观察中的节点', async () => {
  const fixture = await startDecisionFixture();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const instance = fixture.create('invoice', 173);
    const page = await browser.newPage();
    const directory = await mkdtemp(join(tmpdir(), 'decision-locator-'));
    const executor = new Executor(page, { journal: join(directory, 'actions.jsonl'), grants: instance.grants });
    try {
      await page.goto(instance.url);
      const observation = await executor.observe();
      const target = observation.targets.find(t => t.context && t.name);
      assert.ok(target);
      const answer = { kind: 'click', value: '', reason: 'fixture', locator: { strategy: 'role', role: 'button', query: target.name, within: '', frame: 0 } };
      await assert.rejects(normalizeDecision(answer, { mode: 'locator', observation, executor }), /TARGET_AMBIGUOUS/);
      answer.locator.within = 'missing-visible-scope';
      await assert.rejects(normalizeDecision(answer, { mode: 'locator', observation, executor }), /LOCATOR_SCOPE_TEXT_NOT_FOUND/);
      answer.locator.within = await page.locator('tbody tr').first().locator('td').first().innerText();
      answer.value = 'extra metadata has no meaning for click';
      const plan = await normalizeDecision(answer, { mode: 'locator', observation, executor });
      assert.equal(plan.actions[0].ref, target.ref);
      assert.equal(plan.actions[0].value, '');
      await instance.fault(page);
      await assert.rejects(normalizeDecision(answer, { mode: 'locator', observation, executor }), /TARGET_UNOBSERVED_OR_STALE/);
      assert.equal(fixture.grade(instance.instanceId).requestCount, 0);
    } finally { await executor.close(); }
  } finally { await browser.close(); await fixture.close(); }
});

test('复合程序预检整段动作，未知结果后不执行后续指令', async () => {
  const targets = ['r1-1', 'r1-2'].map(ref => ({ ref, frame: 0, name: ref, context: '', actions: ['click'] }));
  for (const badSuffix of [true, false]) {
    const calls = [];
    const executor = {
      observe: async () => ({ rev: 1, targets, url: 'http://localhost/' }),
      act: async action => { calls.push(action); return { dispatch: 'unknown', error: 'ACTION_RESULT_UNKNOWN' }; },
    };
    const result = await runAgent({ executor, mode: 'program', task: { goal: 'fixture' }, maxModelCalls: 1,
      directory: await mkdtemp(join(tmpdir(), 'decision-program-')),
      decide: async () => ({ validRun: true, usage: { input_tokens: 1, output_tokens: 1 }, answer: {
        kind: 'program', reason: 'fixture', steps: [{ action: 'click:r1-1', value: '' }, { action: badSuffix ? 'click:absent' : 'click:r1-2', value: '' }],
      } }) });
    assert.equal(calls.length, badSuffix ? 0 : 1);
    if (!badSuffix) assert.equal(result.terminal, 'ACTION_RECONCILIATION_REQUIRED');
  }
});
