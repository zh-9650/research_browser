import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort] = process.argv.slice(2);
if (!model || !reasoningEffort) throw Error('用法: node experiments/visual-image-reorder.mjs <model> <effort>');
const root = resolve('traces', `visual-image-reorder-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = {};
for (const file of ['experiments/visual-image-reorder.mjs', 'adapters/codex-decision.mjs', 'engine/executor.mjs', 'package-lock.json']) {
  const bytes = await readFile(file);
  sourceHashes[file] = hash(bytes);
  await writeFile(join(root, file.replaceAll('/', '-')), bytes);
}
const writes = { guarded: [], control: [] };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const [, world, action] = url.pathname.split('/');
  if (world === 'tile') {
    const label = { a: '仓库 A-417', b: '仓库 B-681' }[action];
    if (!label) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="112">
      <rect width="220" height="112" fill="#1b5472"/><text x="20" y="65" fill="white" font-size="28">${label}</text></svg>`);
    return;
  }
  if (!Object.hasOwn(writes, world)) { res.writeHead(404).end(); return; }
  if (req.method === 'POST' && action === 'select') {
    writes[world].push(url.searchParams.get('warehouse'));
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
    <style>body{margin:0;background:#f1f5f9} main{display:flex;gap:36px;margin:88px 42px}
    button{width:220px;height:112px;border:0;background-size:100% 100%;cursor:pointer}</style>
    <main><button></button><button></button></main>
    <script>
    let items = ['a','b'];
    const buttons = [...document.querySelectorAll('button')];
    function draw() { buttons.forEach((button, i) => button.style.backgroundImage = 'url(/tile/' + items[i] + ')'); }
    window.reorder = () => { items.reverse(); draw(); };
    buttons.forEach((button, i) => button.onclick = () => fetch('select?warehouse=' + items[i], {method:'POST'}));
    draw();
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const viewport = { width: 560, height: 290 };
const deviceScaleFactor = 2;
const schema = { type: 'object', properties: {
  action: { type: 'string', enum: ['click', 'blocked'] }, x: { type: 'integer' }, y: { type: 'integer' }, reason: { type: 'string' },
}, required: ['action', 'x', 'y', 'reason'], additionalProperties: false };
const snapshot = (page, path) => page.screenshot({ path, scale: 'css' });
const validClick = answer => answer?.action === 'click' && Number.isInteger(answer.x) && Number.isInteger(answer.y)
  && answer.x >= 0 && answer.x < viewport.width && answer.y >= 0 && answer.y < viewport.height;
const invoke = async (page, answer) => {
  await Promise.all([page.waitForResponse(response => response.url().startsWith(page.url() + 'select?'), { timeout: 5000 }),
    page.mouse.click(answer.x, answer.y)]);
};
let browser, executor;
try {
  console.log(`Evidence directory: ${root}`);
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  await page.goto(origin + '/guarded/');
  executor = new Executor(page, { journal: join(root, 'observations.jsonl'), grants: [] });
  const decide = async stage => {
    const directory = join(root, stage);
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'observation.png');
    const pixels = await snapshot(page, path);
    const observation = await executor.observe();
    const decision = await codexDecision({ model, reasoningEffort, directory, schema, images: [path],
      workingDirectory: resolve('.cache/decision-model-context'),
      state: { task: { goal: '只选择一次图片中标为 A-417 的仓库按钮。位置无法确认时停止。' },
        observation, viewport, coordinateSystem: '截图按 CSS 像素输出，坐标相对视口左上角。' } });
    return { decision, screenshotSha256: hash(pixels), url: page.url() };
  };
  const dispatch = async captured => {
    if (!captured.decision.validRun || !validClick(captured.decision.answer)) return { dispatch: 'not_sent', reason: 'NO_VALID_CLICK' };
    if (page.url() !== captured.url || hash(await snapshot(page)) !== captured.screenshotSha256) {
      return { dispatch: 'not_sent', reason: 'VISUAL_OBSERVATION_STALE' };
    }
    await invoke(page, captured.decision.answer);
    return { dispatch: 'sent' };
  };
  const first = await decide('before');
  await page.evaluate(() => window.reorder());
  const reorderedSha256 = hash(await snapshot(page, join(root, 'reordered.png')));
  const stale = await dispatch(first);
  const beforeRecovery = writes.guarded.slice();
  const fresh = await decide('after');
  const recovered = await dispatch(fresh);
  if (first.decision.validRun && validClick(first.decision.answer)) {
    const control = await browser.newPage({ viewport, deviceScaleFactor });
    await control.goto(origin + '/control/');
    await control.evaluate(() => window.reorder());
    await invoke(control, first.decision.answer);
  }
  const summarize = captured => ({ validRun: captured.decision.validRun, answer: captured.decision.answer,
    usage: captured.decision.usage, screenshotSha256: captured.screenshotSha256 });
  const result = { model, reasoningEffort, browser: browser.version(), sourceHashes, viewport, deviceScaleFactor,
    first: summarize(first), reorderedSha256, stale, beforeRecovery, fresh: summarize(fresh), recovered, writes };
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (stale.reason !== 'VISUAL_OBSERVATION_STALE' || beforeRecovery.length !== 0
      || JSON.stringify(writes.guarded) !== '["a"]' || JSON.stringify(writes.control) !== '["b"]') process.exitCode = 2;
} finally {
  await executor?.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
