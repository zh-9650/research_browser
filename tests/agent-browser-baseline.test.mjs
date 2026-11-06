import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPublishedBaseline, publishedBinary } from '../adapters/agent-browser-baseline.mjs';
import { startDecisionFixture } from '../benchmarks/decision-modes/fixture.mjs';

test('发布版 CLI 基线保留原生观察和写入，拒绝参数注入', { skip: !existsSync(publishedBinary) }, async () => {
  const fixture = await startDecisionFixture();
  const directory = await mkdtemp(join(tmpdir(), 'native-decision-baseline-'));
  let executor;
  try {
    const instance = fixture.create('procurement', 173);
    executor = await openPublishedBaseline({ url: instance.url, directory });
    const observation = await executor.observe();
    const field = observation.targets.find(target => target.role === 'spinbutton');
    assert.ok(field?.actions.includes('fill'));
    assert.equal((await executor.act({ operationId: 'invalid', kind: 'fill', ref: field.ref, value: '--auto-connect' })).dispatch, 'not_sent');
    const receipt = await executor.act({ operationId: 'set-budget', kind: 'fill', ref: field.ref, value: '1680' });
    assert.equal(receipt.dispatch, 'sent');
    assert.equal((await executor.readTarget(field.ref)).fieldState.value, '1680');
    const city = observation.targets.find(target => target.name === '交付城市');
    assert.equal((await executor.act({ operationId: 'set-city', kind: 'select', ref: city.ref, value: '苏州' })).dispatch, 'sent');
    const selected = (await executor.readTarget(city.ref)).fieldState;
    assert.equal(selected.value, 'sz');
    assert.equal(selected.options[0].label, '苏州');
    assert.equal(fixture.grade(instance.instanceId).requestCount, 0);
  } finally { if (executor) await executor.close(); await fixture.close(); }
});
