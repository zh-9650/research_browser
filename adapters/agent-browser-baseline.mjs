import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Journal } from '../engine/executor.mjs';

export const publishedBinary = resolve('.cache/agent-browser-published/package/bin/agent-browser-win32-x64.exe');

function observedTargets(data) {
  const lines = data.snapshot.split('\n');
  const stack = [], contexts = new Map();
  for (const [index, line] of lines.entries()) {
    const indent = line.search(/\S/);
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const match = line.match(/\bref=(e\d+)\b/);
    if (match && Object.hasOwn(data.refs, match[1])) {
      const container = stack.findLast(item => item.container);
      const region = container ? lines.slice(container.index, index + 1).join(' ') : line;
      contexts.set(match[1], region.replace(/\bref=e\d+\b/g, '').trim());
    }
    stack.push({ index, indent, container: /- (?:row|LayoutTableRow|form|article|group)\b/.test(line) });
  }
  return Object.entries(data.refs).flatMap(([ref, descriptor]) => {
    if (!/^e\d+$/.test(ref) || !contexts.has(ref)) return [];
    const actions = { button: ['click'], link: ['click'], checkbox: ['click'], radio: ['click'],
      textbox: ['fill'], spinbutton: ['fill'], searchbox: ['fill'], combobox: ['select'] }[descriptor.role];
    if (!actions) return [];
    return [{ ref, frame: 0, name: descriptor.name || '', role: descriptor.role, actions, context: contexts.get(ref) }];
  });
}

/** Runs the pinned released CLI in an isolated local session. Model input is
 * confined to observed native Refs and fill/select values. Native identity
 * resolution remains in the released CLI and all results are independently graded.
 */
export async function openPublishedBaseline({ url, directory, binary = publishedBinary }) {
  const initial = new URL(url);
  if (initial.protocol !== 'http:' || initial.hostname !== '127.0.0.1') throw Error('BASELINE_REQUIRES_LOCAL_FIXTURE');
  await mkdir(directory, { recursive: true });
  const config = join(directory, 'agent-browser.json');
  await writeFile(config, '{}');
  const session = `decision-${randomUUID().replaceAll('-', '')}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AGENT_BROWSER_')));
  Object.assign(env, { AGENT_BROWSER_NO_VERSION_CHECK: '1', AGENT_BROWSER_DEFAULT_TIMEOUT: '1500', AGENT_BROWSER_IDLE_TIMEOUT_MS: '180000',
    AGENT_BROWSER_EXECUTABLE_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const journal = new Journal(join(directory, 'actions.jsonl'));
  let observation, closed = false, rev = 0;

  async function cli(args) {
    const argv = ['--config', config, '--session', session, '--allowed-domains', '127.0.0.1', '--json', ...args];
    const started = Date.now();
    const child = spawn(binary, argv, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 20000);
    const code = await new Promise(resolve => {
      child.once('error', error => { stderr += error.message; });
      child.once('close', resolve);
    });
    clearTimeout(timer);
    await appendFile(join(directory, 'native-cli.jsonl'), JSON.stringify({ argv, code, stdout, stderr, elapsedMs: Date.now() - started }) + '\n');
    let result;
    try { result = JSON.parse(stdout); } catch { result = null; }
    return { ok: code === 0 && result?.success === true, result };
  }

  const executor = {
    async observe() {
      const { ok, result } = await cli(['snapshot']);
      if (!ok || new URL(result.data.origin).origin !== initial.origin || typeof result.data.snapshot !== 'string' || !result.data.refs) throw Error('NATIVE_OBSERVATION_FAILED');
      const currentUrl = result.data.origin;
      observation = { rev: ++rev, url: currentUrl, trust: 'untrusted_page_data', targets: observedTargets(result.data),
        documents: [{ frame: 0, url: currentUrl, text: result.data.snapshot }], complete: false, gaps: ['published native AX snapshot'] };
      return structuredClone(observation);
    },
    async act({ operationId, kind, ref, value }) {
      const target = observation?.targets.find(target => target.ref === ref);
      if (!target?.actions.includes(kind) || (kind !== 'click' && (typeof value !== 'string' || value.trimStart().startsWith('-')))) {
        return { dispatch: 'not_sent', error: 'MODEL_DECISION_INVALID' };
      }
      if (journal.records.some(record => record.event === 'dispatch_intent' && record.operationId === operationId)) {
        return { dispatch: 'not_sent', error: 'OPERATION_ALREADY_ATTEMPTED' };
      }
      journal.append({ event: 'dispatch_intent', operationId, kind, ref });
      const { ok } = await cli(kind === 'click' ? [kind, `@${ref}`] : [kind, `@${ref}`, value]);
      const receipt = ok ? { dispatch: 'sent', error: null } : { dispatch: 'unknown', error: 'ACTION_RESULT_UNKNOWN' };
      journal.append({ event: 'receipt', operationId, ...receipt });
      return receipt;
    },
    async readTarget(ref) {
      const target = observation?.targets.find(target => target.ref === ref);
      if (!target) return { error: 'TARGET_STALE' };
      const { ok, result } = await cli(['get', 'value', `@${ref}`]);
      if (!ok) return { error: 'NATIVE_READBACK_FAILED' };
      const fieldState = { value: result.data.value };
      if (target.role === 'combobox') {
        const snapshot = await cli(['snapshot']);
        const line = snapshot.ok && snapshot.result.data.snapshot.split('\n').find(line => new RegExp(`\\bref=${ref}\\b`).test(line));
        const label = line && /\]: (.*)$/.exec(line)?.[1];
        if (label) fieldState.options = [{ selected: true, label }];
      }
      return { fieldState, error: null };
    },
    async injectReorder() {
      const script = Buffer.from('window.__decisionModeFault.reorder()').toString('base64');
      const { ok, result } = await cli(['eval', '-b', script]);
      if (!ok || !result.data.result?.injected) throw Error('FAULT_NOT_APPLIED');
      return result.data.result;
    },
    async screenshot() { return cli(['screenshot', join(directory, 'final.png')]); },
    async close() {
      if (closed) return;
      closed = true;
      try { await cli(['close']); } finally { journal.close(); }
    },
  };
  try {
    if (!(await cli(['open', url])).ok) throw Error('NATIVE_OPEN_FAILED');
    return executor;
  } catch (error) { await executor.close(); throw error; }
}
