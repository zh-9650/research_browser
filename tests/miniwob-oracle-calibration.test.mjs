import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startBridge } from '../benchmarks/miniwob/bridge.mjs';
import { gradeMiniwobOracle } from '../benchmarks/miniwob/oracle.mjs';

test('公开 MiniWoB 原始奖励区分正确点击、误点、超时和证据缺失', { timeout: 60000 }, async t => {
  const bridge = await startBridge();
  t.after(() => bridge.close());
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const directory = resolve('traces', `miniwob-oracle-calibration-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(directory, { recursive: true });
  const rows = [];
  for (const [behavior, expected] of [['correct', 'verified'], ['wrong', 'failed'], ['timeout', 'failed']]) {
    const instance = bridge.create('click-button', 42);
    const page = await browser.newPage();
    try {
      await page.goto(instance.url);
      const prompt = await page.locator('#query').innerText();
      const targetName = prompt.match(/"([^"]+)"/)[1];
      const buttons = await page.locator('#area button').allTextContents();
      const pending = bridge.results(instance.id);
      assert.equal(gradeMiniwobOracle(pending, instance).status, 'unknown');
      let clicked = null;
      if (behavior !== 'timeout') {
        clicked = behavior === 'correct' ? targetName : buttons.find(name => name !== targetName);
        assert.ok(clicked);
        await page.getByRole('button', { name: clicked, exact: true }).first().click();
      }
      // Poll host-side delivery of the passive upstream reward report.
      const until = Date.now() + 15000;
      let oracle = bridge.results(instance.id);
      while (oracle.results.length === 0 && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 50));
        oracle = bridge.results(instance.id);
      }
      const verdict = gradeMiniwobOracle(oracle, instance);
      assert.equal(verdict.status, expected);
      if (behavior === 'timeout') assert.ok(oracle.results[0].elapsedMs >= 10000);
      await page.screenshot({ path: join(directory, `${behavior}.png`) });
      rows.push({ behavior, expected, prompt, buttons, clicked, pending, oracle, verdict, instance });
    } finally { await page.close(); }
  }
  const { oracle, instance } = rows[0];
  const probes = [
    { label: 'missing', input: null },
    { label: 'different-instance', input: { ...oracle, id: 'different' } },
    { label: 'duplicate-episode', input: { ...oracle, results: [...oracle.results, ...oracle.results] } },
    { label: 'incomplete-episode', input: { ...oracle, results: [{ ...oracle.results[0], done: false }] } },
  ].map(({ label, input }) => ({ label, verdict: gradeMiniwobOracle(input, instance) }));
  for (const { verdict } of probes) assert.equal(verdict.status, 'unknown');
  await writeFile(join(directory, 'result.json'), JSON.stringify({ browser: browser.version(), rows, probes }, null, 2));
  console.log(`MiniWoB 裁判校准证据: ${directory}`);
});
