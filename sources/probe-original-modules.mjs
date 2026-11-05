// Run selected upstream modules unchanged except TypeScript transpilation/import resolution.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const root = new URL('./vendor/', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const errors = stripTypeScriptTypes(await read('stagehand/packages/extension/errors.ts'), { mode: 'transform' });
const progressCode = stripTypeScriptTypes(await read('stagehand/packages/extension/understudy/progress.ts'), { mode: 'transform' })
  .replace('"../errors.js"', JSON.stringify(url(errors)));
const { Progress } = await import(url(progressCode));
let committed = 0, timeout = false;
const progress = new Progress('probe', 20);
try {
  await progress.run('simulated already-issued request', () => new Promise(resolve => setTimeout(() => { committed++; resolve(); }, 80)));
} catch (error) { timeout = error.name === 'TimeoutError'; }
await new Promise(resolve => setTimeout(resolve, 110));
assert.equal(timeout, true);
assert.equal(committed, 1);
progress.dispose();
const output = { date: new Date().toISOString(), node: process.version, progress: { timeoutReturned: timeout, laterCommitCount: committed }, snapshot: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  output.browser = browser.version();
  const page = await browser.newPage();
  await page.setContent('<table><tr><td id="record">订单甲</td><td><button>提交</button></td></tr></table>');
  const snapshot = await read('jev-ultrafast/jev_ultrafast/snapshot.js');
  const before = await page.evaluate(snapshot);
  const selected = before.actions.find(a => a.kind === 'click');
  await page.locator('#record').evaluate(e => e.textContent = '订单乙');
  const after = await page.evaluate(snapshot);
  assert.equal(selected.node, after.actions.find(a => a.kind === 'click').node);
  assert.notDeepEqual(before.guards[selected.node], after.guards[selected.node]);
  output.snapshot.push({ case: 'reused-row-changed-business-text', sameNode: true, guardChanged: true });
  await page.setContent('<div id="host"></div><iframe srcdoc="<button>内嵌按钮</button>"></iframe>');
  await page.locator('#host').evaluate(e => { e.attachShadow({mode:'open'}).innerHTML = '<button>影子按钮</button>'; });
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('button'));
  const missing = await page.evaluate(snapshot);
  assert.equal(missing.actions.filter(a => a.kind === 'click').length, 0);
  output.snapshot.push({ case: 'iframe-and-shadow-buttons', actualButtons: 2, exposedClickCandidates: 0, coverageField: Object.hasOwn(missing, 'coverage') });
} finally { await browser.close(); }
await mkdir(new URL('./runs/', import.meta.url), { recursive: true });
await writeFile(new URL('./runs/original-modules.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
