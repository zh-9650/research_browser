import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Executor } from '../../engine/executor.mjs';
import { startBridge } from './bridge.mjs';

const out = resolve('traces', `miniwob-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true });
for (const file of ['benchmarks/miniwob/smoke.mjs', 'benchmarks/miniwob/bridge.mjs', 'engine/executor.mjs', 'package-lock.json']) await copyFile(file, join(out, file.replaceAll('/', '-')));
const bridge = await startBridge();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const runs = [];
try {
  for (const task of ['click-button', 'enter-text', 'click-checkboxes', 'choose-list']) for (const seed of [42, 43, 44]) {
    const instance = bridge.create(task, seed);
    const page = await browser.newPage();
    const stem = `${task}-${seed}`;
    const engine = new Executor(page, { journal: join(out, `${stem}.jsonl`), grants: [{ origin: bridge.origin, kinds: ['click', 'fill', 'select'] }], timeout: 800 });
    const decisions = [];
    try {
      await page.goto(instance.url);
      const goal = await page.locator('#query').innerText();
      const obs = await engine.observe();
      await writeFile(join(out, `${stem}-observation.json`), JSON.stringify(obs, null, 2));
      const before = await page.evaluate(() => ({ reward: WOB_RAW_REWARD_GLOBAL, done: WOB_DONE_GLOBAL, maxTime: core.EPISODE_MAX_TIME }));
      const act = async (target, kind = 'click', value) => {
        if (!target) throw Error('Expert selector did not find a target');
        const input = { operationId: `${task}-${decisions.length}`, kind, ref: target.ref, ...(value === undefined ? {} : { value }) };
        const receipt = await engine.act(input); decisions.push({ input, receipt });
      };
      // Deterministic task-specific expert policies: environment/adapter smoke, NOT an Agent.
      if (task === 'click-button') {
        const name = goal.match(/"([^"]+)"/)[1];
        await act(obs.targets.find(t => t.tag === 'BUTTON' && t.name === name));
      } else if (task === 'enter-text') {
        const text = goal.match(/"([^"]+)"/)[1];
        await act(obs.targets.find(t => t.tag === 'INPUT' && t.type === 'text'), 'fill', text);
        await act(obs.targets.find(t => t.tag === 'BUTTON' && t.name === 'Submit'));
      } else if (task === 'choose-list') {
        const text = goal.match(/^Select (.*) from the list and click Submit\.$/)[1];
        await act(obs.targets.find(t => t.tag === 'SELECT'), 'select', text);
        await act(obs.targets.find(t => t.tag === 'BUTTON' && t.name === 'Submit'));
      } else {
        const labels = goal.match(/^Select (.*) and click Submit\.$/)[1];
        if (labels !== 'nothing') for (const name of labels.split(', ')) await act(obs.targets.find(t => t.tag === 'INPUT' && t.name === name));
        await act(obs.targets.find(t => t.tag === 'BUTTON' && t.name === 'Submit'));
      }
      await page.waitForFunction(() => WOB_DONE_GLOBAL);
      const oracle = await page.evaluate(() => ({ rawReward: WOB_RAW_REWARD_GLOBAL, reward: WOB_REWARD_GLOBAL, done: WOB_DONE_GLOBAL, reason: WOB_REWARD_REASON, episode: WOB_EPISODE_ID, maxTime: core.EPISODE_MAX_TIME }));
      await page.screenshot({ path: join(out, `${stem}-after.png`) });
      runs.push({ task, seed, goal, before, decisions, oracle, completed: oracle.done && oracle.rawReward === 1, modelCalls: 0 });
    } catch (error) { runs.push({ task, seed, completed: false, error: error.message, decisions }); }
    finally { await engine.close(); await page.close(); }
  }
} finally { await browser.close(); await bridge.close(); }
const output = { date: new Date().toISOString(), sourceSha: '33c3b4ddef8c6eb67c57a29663d844b1eda7e614', browser: browser.version(), playwright: '1.56.1', node: process.version,
  mode: 'task-specific deterministic expert policies; no model; not a BrowserGym leaderboard reproduction', bootstrap: 'original default 10000ms; original genProblem/endEpisode; seeded initialization and passive reporting', runs };
await writeFile(join(out, 'results.json'), JSON.stringify(output, null, 2));
await mkdir('reports', { recursive: true });
const lines = ['# MiniWoB++ 原始公开任务：环境与执行器冒烟', '', `源码 SHA：${output.sourceSha}；Chrome ${output.browser}；Playwright 1.56.1。`, '', '**本轮是4个公开任务的预编写专家策略，不是通用 Agent 成功率或模型排名。没有模型调用。**', '', '| 原始任务 | seed | 原始raw reward | 带时间惩罚reward | 完成 |', '|---|---:|---:|---:|---|'];
for (const r of runs) lines.push(`| ${r.task} | ${r.seed} | ${r.oracle?.rawReward ?? 'unknown'} | ${r.oracle?.reward ?? 'unknown'} | ${r.completed} |`);
lines.push('', `全部逐步回执、初始观察、截图、源码副本与原始奖励：\`${out}\`。`, '', '原始10秒上限未修改。初始化仅 seed + core.startEpisodeReal，保留原始任务genProblem与原始评分endEpisode；奖励报告 wrapper不计算奖励。判分读取上游公开环境WOB_RAW_REWARD_GLOBAL/WOB_DONE_GLOBAL，不读取执行器的成功声明。', '初始before字段确认动作前rawReward=0/done=false；Agent若此时宣称完成仍不得判成功。点击复选框与选择控件使用当前执行器，专家脚本按任务类型解析公开可见指令并选择ref，不能当作自然语言通用规划。');
await writeFile('reports/miniwob-smoke.md', lines.join('\n') + '\n');
console.log(JSON.stringify({ out, total: runs.length, completed: runs.filter(r => r.completed).length, failures: runs.filter(r => !r.completed).map(r => ({ task: r.task, seed: r.seed, error: r.error, oracle: r.oracle })) }, null, 2));
