import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { startFixture } from './fixture.mjs';
import { Executor } from '../engine/executor.mjs';
import { chromium } from 'playwright';

const binary = resolve(process.env.AGENT_BROWSER_BINARY || '.cache/agent-browser-published/package/bin/agent-browser-win32-x64.exe');
const chrome = process.env.CHROME_BINARY || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const repeats = Number(process.env.REPEATS || 3);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve('traces', `agent-browser-${run}`);
await mkdir(out, { recursive: true });
const files = {};
for (const path of ['benchmarks/agent-browser-baseline.mjs', 'benchmarks/fixture.mjs', 'engine/executor.mjs', 'package-lock.json']) {
  files[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  const dest = join(out, 'source', path); await mkdir(join(dest, '..'), { recursive: true }); await copyFile(path, dest);
}
const config = join(out, 'agent-browser.json');
await writeFile(config, '{}');
const fixture = await startFixture();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const commands = [];
const results = [];
const env = { ...process.env, AGENT_BROWSER_NO_VERSION_CHECK: '1', AGENT_BROWSER_EXECUTABLE_PATH: chrome, AGENT_BROWSER_DEFAULT_TIMEOUT: '1500', AGENT_BROWSER_IDLE_TIMEOUT_MS: '30000' };
function cli(session, args) {
  return new Promise(resolveResult => {
    const argv = ['--config', config, '--session', session, '--json', ...args];
    const started = performance.now();
    const child = spawn(binary, argv, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('error', error => stderr += error.message);
    child.on('close', code => {
      clearTimeout(timer);
      const record = { session, argv, code, stdout, stderr, elapsedMs: Math.round(performance.now() - started) };
      commands.push(record);
      resolveResult(record);
    });
  });
}
const evaluate = (session, script) => cli(session, ['eval', '-b', Buffer.from(script).toString('base64')]);
const scenarios = [
  { id: 'S01', initialUnique: false },
  { id: 'S02', fault: 'reorder', initialUnique: false },
  { id: 'S03', fault: 'recycle', initialUnique: false },
  { id: 'S30', fault: 'uniqueReplacement', initialUnique: true },
];
try {
  const version = await cli('baseline-version', ['--version']);
  for (let repeat = 0; repeat < repeats; repeat++) for (const scenario of scenarios) {
    for (const strategy of ['agent-browser-published', 'strict-ref', 'context-reobserve']) {
      const world = fixture.create();
      let receipt, snapshot, after, page, engine;
      const started = performance.now();
      const session = `research-${randomUUID().replaceAll('-', '')}`;
      try {
        if (strategy === 'agent-browser-published') {
          const opened = await cli(session, ['open', world.url]);
          if (opened.code !== 0) throw Error(`Open failed: ${opened.stderr} ${opened.stdout}`);
          if (scenario.initialUnique) await evaluate(session, `document.querySelectorAll('tr')[1].remove()`);
          snapshot = await cli(session, ['snapshot']);
          const tree = JSON.parse(snapshot.stdout).data.snapshot;
          if (!tree.includes(world.ids[0])) throw Error('Expected business identity not in snapshot');
          const match = tree.match(/button "确认收款" \[ref=(e\d+)\]/);
          if (!match) throw Error(`No matching ref in snapshot: ${tree}`);
          if (scenario.fault) await evaluate(session, `window.fault.${scenario.fault}()`);
          receipt = await cli(session, ['click', '@' + match[1]]);
          // Even a failed command must be judged by backend state rather than exit code.
          after = await cli(session, ['snapshot']);
          await cli(session, ['screenshot', join(out, `${scenario.id}-${repeat}-${strategy}.png`)]);
        } else {
          page = await browser.newPage();
          engine = new Executor(page, { journal: join(out, `${scenario.id}-${repeat}-${strategy}.jsonl`), grants: [{ origin: fixture.base, kinds: ['click'] }] });
          await page.goto(world.url);
          if (scenario.initialUnique) await page.evaluate(() => document.querySelectorAll('tr')[1].remove());
          snapshot = await engine.observe();
          const original = snapshot.targets.find(x => x.name === '确认收款' && x.context.includes(world.ids[0]));
          if (scenario.fault) await page.evaluate(name => window.fault[name](), scenario.fault);
          const action = { operationId: 'confirm', kind: 'click', ref: original.ref };
          receipt = await engine.act(action);
          if (strategy === 'context-reobserve' && receipt.error === 'TARGET_STALE') {
            const fresh = await engine.observe();
            const matches = fresh.targets.filter(x => x.name === original.name && x.context === original.context);
            if (matches.length === 1) receipt = await engine.act({ ...action, ref: matches[0].ref });
          }
          if (receipt.dispatch === 'sent') await page.getByRole('status').filter({ hasText: /保存成功|业务拒绝|连接中断/ }).waitFor({ timeout: 1000 });
          after = await engine.observe();
          await page.screenshot({ path: join(out, `${scenario.id}-${repeat}-${strategy}.png`) });
        }
        const truth = fixture.oracle(world.key);
        results.push({ scenario, repeat, strategy, snapshot, after, receipt, truth,
          taskCompleted: truth.events.length === 1 && truth.events[0].id === world.ids[0],
          wrongObjectEffects: truth.events.filter(e => e.id !== world.ids[0]).length,
          duplicateEffects: Math.max(0, truth.events.filter(e => e.id === world.ids[0]).length - 1),
          elapsedMs: Math.round(performance.now() - started), model: null, llmCalls: 0 });
      } finally {
        if (strategy === 'agent-browser-published') await cli(session, ['close']);
        if (engine) await engine.close();
        if (page) await page.close();
      }
    }
  }
  const metadata = JSON.parse(await readFile('.cache/agent-browser-npm.json', 'utf8'));
  const provenance = JSON.parse(await readFile('.cache/agent-browser-attestations.json', 'utf8'));
  await writeFile(join(out, 'npm-metadata.json'), JSON.stringify(metadata, null, 2));
  await writeFile(join(out, 'npm-attestations.json'), JSON.stringify(provenance, null, 2));
  const binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  const tarballSha512 = createHash('sha512').update(await readFile('.cache/agent-browser-0.41.2.tgz')).digest('base64');
  const output = { run, version, browser: browser.version(), binarySha256, tarballSha512, integrityMatches: metadata.dist.integrity === `sha512-${tarballSha512}`, sourceHashes: files, results, commands };
  await writeFile(join(out, 'results.json'), JSON.stringify(output, null, 2));
  const report = ['# 发布版 agent-browser 与身份校验：真实 CLI 机制对照', '',
    `运行 ${run}；Chrome ${browser.version()}；agent-browser 0.41.2；每个场景 ${repeats} 次；全程没有模型调用。`, '',
    '| 场景 | 策略 | 样本 | 任务完成 | 错对象副作用 | 重复副作用 |', '|---|---|---:|---:|---:|---:|'];
  for (const scenario of scenarios) for (const strategy of ['agent-browser-published', 'strict-ref', 'context-reobserve']) {
    const subset = results.filter(x => x.scenario.id === scenario.id && x.strategy === strategy);
    report.push(`| ${scenario.id} | ${strategy} | ${subset.length} | ${subset.filter(x => x.taskCompleted).length} | ${subset.reduce((a,x)=>a+x.wrongObjectEffects,0)} | ${subset.reduce((a,x)=>a+x.duplicateEffects,0)} |`);
  }
  report.push('', `原始 CLI 参数、stdout/stderr、快照、截图、独立后端真值与源码副本：\`${out}\`。`, '',
    'S01：两个同名按钮正常操作。S02：观察后重建并重排两行。S03：同一个 DOM 行被复用成另一个业务对象。S30：初始只有订单甲，观察后替换成唯一同名订单乙。',
    '比较只覆盖确定性目标身份机制，不代表完整 Agent 成功率、模型规划或安全能力。执行器和 CLI 进程架构不同，不把总耗时用于性能优越结论。',
    'npm tarball SHA-512 与 registry integrity 实际比对；下载 npm provenance 声明发布源为 de99b17824aff9697df6cbcbd8bd4314a60ba72d。未做 Sigstore 签名链验证，不将声明升级为密码学验证。该发布源不同于最初审计的 main SHA 6682da310c75bed8af340b39cc10b7f71bded155。');
  await mkdir('reports', { recursive: true });
  await writeFile('reports/agent-browser-baseline.md', report.join('\n') + '\n');
  console.log(report.join('\n'));
} catch (error) {
  await writeFile(join(out, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, commands, results }, null, 2));
  throw error;
} finally { await browser.close(); await fixture.close(); }
