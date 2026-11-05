import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionTaskIds, startDecisionFixture } from '../benchmarks/decision-modes/fixture.mjs';

test('配对夹具隔离实例，裁判区分空状态、正确、错误对象和重复写入', async () => {
  const fixture = await startDecisionFixture();
  const submit = (instance, data) => fetch(new URL('submit', instance.url), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  try {
    for (const taskId of decisionTaskIds) {
      const first = fixture.create(taskId, 173);
      const second = fixture.create(taskId, 173);
      assert.notEqual(first.instanceId, second.instanceId);
      assert.deepEqual(first.task, second.task);
      const initial = fixture.grade(first.instanceId);
      assert.equal(initial.taskCompleted, false);
      assert.equal(initial.requestCount, 0);
      assert.deepEqual(fixture.grade(second.instanceId).expected, initial.expected);
      // Direct fixture calls calibrate the grader. Actual experiment arms use browser UI.
      assert.equal((await submit(first, initial.expected)).status, 200);
      assert.equal(fixture.grade(first.instanceId).taskCompleted, true);
      assert.equal((await submit(first, initial.expected)).status, 200);
      const repeated = fixture.grade(first.instanceId);
      assert.equal(repeated.duplicateEffects, 1);
      assert.equal(repeated.taskCompleted, false);
      assert.equal(fixture.grade(second.instanceId).requestCount, 0);
    }
    const wrong = fixture.create('invoice', 173);
    const expected = fixture.grade(wrong.instanceId).expected.invoiceId;
    const suffix = Number(expected.split('-').at(-1));
    assert.equal((await submit(wrong, { invoiceId: `DZ-2026-${suffix + 1}` })).status, 200);
    const verdict = fixture.grade(wrong.instanceId);
    assert.equal(verdict.wrongObjects, 1);
    assert.equal(verdict.wrongTargetAttempts, 1);
    assert.equal(verdict.taskCompleted, false);
  } finally { await fixture.close(); }
});
