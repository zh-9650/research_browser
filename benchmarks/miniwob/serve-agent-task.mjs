import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startBridge } from './bridge.mjs';

const bridge = await startBridge();
const task = process.argv[2] || 'click-button';
const seed = Number(process.argv[3] || 173);
const instance = bridge.create(task, seed, null);
const out = resolve('traces', `miniwob-codex-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true });
const configPath = resolve(task === 'click-button' ? 'benchmarks/miniwob/agent-task-config.json' : `benchmarks/miniwob/${task}-agent-config.json`);
await writeFile(configPath, JSON.stringify({ url: instance.url, goal: 'Complete the original MiniWoB++ task stated in the visible page query.', constraints: ['Use original 10-second timer', 'Do not inspect task source or hidden reward globals'], journal: join(out, 'executor.jsonl'), executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', grants: [{ origin: bridge.origin, kinds: ['click', 'fill', 'select'] }], timeout: 1000 }, null, 2));
await writeFile(join(out, 'instance.json'), JSON.stringify(instance, null, 2));
for (const file of ['benchmarks/miniwob/serve-agent-task.mjs', 'benchmarks/miniwob/bridge.mjs', 'engine/executor.mjs', 'adapters/cli.mjs', 'package-lock.json']) await copyFile(file, join(out, file.replaceAll('/', '-')));
const timer = setInterval(async () => {
  const result = bridge.results(instance.id);
  if (result.results.length) {
    clearInterval(timer);
    await writeFile(join(out, 'original-oracle.json'), JSON.stringify(result, null, 2));
  }
}, 250);
console.log(JSON.stringify({ ready: true, configPath, evidenceDirectory: out, timerStartsOnPageLoad: true }));
const stop = async () => { clearInterval(timer); await bridge.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
