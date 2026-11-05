import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** JSONL client for Agent runtimes. No shell interpolation, no automatic action retries.
 * `ready` resolves as soon as the initial observation arrives, including on Windows.
 */
export function createClient(configPath, { captureProtocol = false, nodeExecutable = 'node' } = {}) {
  const child = spawn(nodeExecutable, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), configPath, ...(captureProtocol ? ['--capture-protocol'] : [])], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 0, stderr = '', readyResolve, readyReject, exited = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Consumers may attach after a launch failure; avoid an unhandled rejection in that gap.
  ready.catch(() => {});
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-10000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let result;
    try { result = JSON.parse(line); } catch { return; }
    if (result.type === 'ready') readyResolve(result.observation);
    else if (result.type === 'closed') pending.get('close')?.resolve(result);
    else if (result.id !== undefined) {
      const waiter = pending.get(result.id);
      if (waiter) { pending.delete(result.id); waiter.resolve(result); }
    }
  });
  const ended = new Promise(resolve => {
    const fail = error => {
      exited = true;
      readyReject(error);
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear(); resolve();
    };
    child.on('error', () => fail(Error('CLI_LAUNCH_FAILED')));
    child.on('exit', code => fail(Error(`CLI_RESPONSE_UNKNOWN: exit=${code}; ${stderr}`)));
  });
  const request = (method, payload) => {
    if (exited) return Promise.reject(Error('CLI_RESPONSE_UNKNOWN: process exited'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(method === 'close' ? 'close' : id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, ...(payload ? method === 'observe' ? { options: payload } : { action: payload } : {}) }) + '\n', error => {
        if (error) { pending.delete(id); reject(Error('CLI_RESPONSE_UNKNOWN: stdin failed')); }
      });
    });
  };
  return { ready, request, pid: child.pid,
    async close() {
      if (!exited) { await request('close'); child.stdin.end(); }
      await ended;
    },
    kill() { child.kill(); },
  };
}
