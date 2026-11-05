import { chromium } from 'playwright';
import { startFixture } from '../benchmarks/fixture.mjs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve('traces', `transport-netlog-${runId}`);
await mkdir(out, { recursive: true });
await copyFile('sources/probe-transport.mjs', join(out, 'probe-transport.mjs'));
await copyFile('benchmarks/fixture.mjs', join(out, 'fixture.mjs'));
const fixture = await startFixture();
const results = [];
try {
  for (const mode of ['transport-replay', 'lost-response']) for (let repeat = 0; repeat < 3; repeat++) {
    const world = fixture.create(mode);
    const logPath = join(out, `${mode}-${repeat}-netlog.json`);
    const browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: [`--log-net-log=${logPath}`, '--net-log-capture-mode=Default'] });
    const cdp = [], trustedClicks = [];
    let fetchCalls;
    const version = browser.version();
    try {
      const page = await browser.newPage();
      const session = await page.context().newCDPSession(page);
      await session.send('Network.enable');
      session.on('Network.requestWillBeSent', e => {
        if (e.request.url.endsWith('/commit')) cdp.push({ requestId: e.requestId, method: e.request.method, url: e.request.url, timestamp: e.timestamp });
      });
      await page.exposeFunction('recordTrustedClick', trusted => trustedClicks.push(trusted));
      await page.addInitScript(() => {
        window.commitFetchCalls = 0;
        const original = window.fetch;
        window.fetch = function(input, options) {
          if (String(input) === 'commit') window.commitFetchCalls++;
          return original.call(this, input, options);
        };
        document.addEventListener('click', event => { window.recordTrustedClick(event.isTrusted); }, true);
      });
      await page.goto(world.url);
      await page.getByRole('button', { name: '确认收款' }).first().click();
      await page.getByRole('status').filter({ hasText: '连接中断' }).waitFor();
      fetchCalls = await page.evaluate(() => window.commitFetchCalls);
    } finally { await browser.close(); }
    const bytes = await readFile(logPath);
    const netlog = JSON.parse(bytes);
    const typeNames = Object.fromEntries(Object.entries(netlog.constants.logEventTypes).map(([name, n]) => [n, name]));
    const commitSources = new Set(netlog.events.filter(e => e.params?.url?.endsWith('/commit')).map(e => e.source.id));
    const matching = netlog.events.filter(e => commitSources.has(e.source.id));
    const restarts = matching.filter(e => /RESTART|RESEND/.test(typeNames[e.type])).map(e => ({ type: typeNames[e.type], sourceId: e.source.id, params: e.params, time: e.time }));
    const truth = fixture.oracle(world.key);
    results.push({ mode, repeat, browser: version, trustedClicks, fetchCalls, cdpRequests: cdp,
      backendAttempts: truth.attempts.length, backendEffects: truth.events.length,
      netlog: { path: logPath, sha256: createHash('sha256').update(bytes).digest('hex'), commitSourceIds: [...commitSources], restartEvents: restarts,
        commitEventTypes: [...new Set(matching.map(e => typeNames[e.type]))] } });
  }
} finally { await fixture.close(); }
const summary = { runId, node: process.version, observations: results, scope: 'synthetic localhost, one explicit click per isolated Chrome profile; no model' };
await mkdir('sources/runs', { recursive: true });
await writeFile('sources/runs/transport-netlog-summary.json', JSON.stringify(summary, null, 2));
await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(results.map(({mode, repeat, trustedClicks, fetchCalls, backendAttempts, backendEffects, netlog}) => ({mode, repeat, trustedClicks, fetchCalls, backendAttempts, backendEffects, restarts: netlog.restartEvents})), null, 2));
