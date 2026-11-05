import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { Executor } from '../engine/executor.mjs';
import { encodeObservation, SHARED_CONTEXT_ENCODING } from '../engine/observation-codec.mjs';

// JSONL host protocol. Config and stdin are trusted host inputs, page text is not.
const configPath = process.argv[2];
if (!configPath) { console.error('用法: node adapters/cli.mjs <可信任务配置.json>'); process.exit(2); }
const config = JSON.parse(await readFile(configPath, 'utf8'));
const url = new URL(config.url);
if (!['http:', 'https:'].includes(url.protocol)) throw Error('Only HTTP(S) URLs are supported');
if (!Array.isArray(config.grants) || !config.grants.some(g => g.origin === url.origin)) throw Error('Initial URL origin is not granted');
if (!['raw', 'auto', SHARED_CONTEXT_ENCODING].includes(config.observationEncoding || 'auto')) throw Error('Invalid observation encoding');
const browser = await chromium.launch({ channel: config.channel || 'chrome', ...(config.executablePath ? { executablePath: config.executablePath } : {}), headless: config.headless !== false });
let engine;
const capture = (direction, payload) => {
  if (process.env.CAPTURE_PROTOCOL === '1' || process.argv.includes('--capture-protocol')) appendFileSync(config.journal + '.protocol.jsonl', JSON.stringify({ timestamp: new Date().toISOString(), direction, payload }) + '\n');
};
const send = value => {
  if (value.observation) value = { ...value, observation: encodeObservation(value.observation, { mode: config.observationEncoding || 'auto' }) };
  capture('out', value); process.stdout.write(JSON.stringify(value) + '\n');
};
try {
  const page = await browser.newPage();
  engine = new Executor(page, { journal: config.journal, grants: config.grants, timeout: config.timeout || 1000 });
  engine.journal.append({ event: 'task', goalDigest: createHash('sha256').update(JSON.stringify({ goal: config.goal, constraints: config.constraints })).digest('hex') });
  await page.goto(config.url);
  send({ type: 'ready', observation: await engine.observe() });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    let request;
    try {
      request = JSON.parse(line);
      capture('in', { ...request, ...(request.action ? { action: { ...request.action, value: request.action.value === undefined ? undefined : '[omitted]' } } : {}) });
      if (request.method === 'close') { send({ type: 'closed' }); break; }
      if (request.method === 'observe') send({ id: request.id, observation: await engine.observe(request.options) });
      else if (request.method === 'act') send({ id: request.id, receipt: await engine.act(request.action) });
      else send({ id: request.id, error: 'METHOD_NOT_SUPPORTED' });
    } catch (error) {
      const known = ['MODEL_DECISION_INVALID', 'SESSION_BUSY', 'SESSION_CLOSED'];
      send({ ...(request?.id !== undefined ? { id: request.id } : {}), error: known.includes(error.message) ? error.message : 'REQUEST_FAILED' });
    }
  }
} finally {
  // `close` is a terminal protocol request; do not keep the process alive on host stdin.
  process.stdin.destroy();
  if (engine) await engine.close();
  await browser.close();
}
