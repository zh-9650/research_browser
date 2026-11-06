import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort, treatment] = process.argv.slice(2);
if (!model || !reasoningEffort || (treatment && !['shared','hybrid','hybrid-pair'].includes(treatment))) throw Error('用法: node experiments/visual-canvas.mjs <model> <effort> [shared|hybrid|hybrid-pair]');
const root = resolve('traces', `visual-canvas-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = {};
for (const file of ['experiments/visual-canvas.mjs', 'adapters/codex-decision.mjs', 'engine/executor.mjs', 'engine/agent-loop.mjs',
  'engine/visual-write.mjs', 'engine/decision-modes.mjs', 'engine/observation-codec.mjs', 'package-lock.json']) {
  const bytes = await readFile(file);
  sourceHashes[file] = hash(bytes);
  await writeFile(join(root, file.replaceAll('/', '-')), bytes);
}
const viewport = { width: 640, height: 360 };
const rows = [
  { id: 'NJ-681', label: '南京 · NJ-681', x: 24, y: 92, w: 180, h: 112 },
  { id: 'HZ-952', label: '杭州 · HZ-952', x: 222, y: 92, w: 180, h: 112 },
  { id: 'SZ-417', label: '苏州 · SZ-417', x: 420, y: 92, w: 180, h: 112 },
];
const writes = { dom: [], vision: [], shared: [], hybrid: [], 'hybrid-demand': [] };
const attempts = { shared: [], hybrid: [], 'hybrid-demand': [] };
const isHybrid = mode => mode === 'hybrid' || mode === 'hybrid-demand';
const expectedNote = '现场核对无误';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const [, mode, action] = url.pathname.split('/');
  if (!Object.hasOwn(writes, mode)) { res.writeHead(404).end(); return; }
  if (action === 'register' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    if (Object.hasOwn(attempts, mode)) {
      const note = url.searchParams.get('note');
      attempts[mode].push(isHybrid(mode) ? {id, note} : id);
      if (id !== 'SZ-417' || writes[mode].length || (isHybrid(mode) && note !== expectedNote)) { res.writeHead(403).end(); return; }
    }
    writes[mode].push(id);
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
    <style>body{margin:0}canvas{display:block}</style>
    <canvas width="640" height="360"></canvas>
    ${isHybrid(mode) ? '<label style="position:absolute;top:240px;left:24px">登记备注 <input id="note"></label>' : ''}
    <script>
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const rows = ${JSON.stringify(rows)};
    ctx.fillStyle = '#f1f5f9';ctx.fillRect(0,0,640,360);
    ctx.fillStyle = '#0f172a';ctx.font = 'bold 26px sans-serif';ctx.fillText('到货登记看板',24,53);
    for (const { label,x,y,w,h } of rows) {
      ctx.fillStyle = '#145274';ctx.fillRect(x,y,w,h);
      ctx.fillStyle = 'white';ctx.font = 'bold 18px sans-serif';ctx.fillText(label,x+12,y+43);
      ctx.font = '16px sans-serif';ctx.fillText('登记到货',x+12,y+76);
    }
    canvas.addEventListener('click', async event => {
      const { offsetX:x, offsetY:y } = event;
      const item = rows.find(r => x >= r.x && x < r.x+r.w && y >= r.y && y < r.y+r.h);
      const query = new URLSearchParams({id: item?.id || 'none'});
      const note = document.querySelector('#note');
      if (note) query.set('note', note.value);
      await fetch('register?' + query, {method:'POST'});
    });
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const schema = { type: 'object', properties: { action: { type: 'string', enum: ['click', 'blocked'] },
  x: { type: 'integer' }, y: { type: 'integer' }, reason: { type: 'string' } },
  required: ['action', 'x', 'y', 'reason'], additionalProperties: false };
let browser;
try {
  console.log(`Evidence directory: ${root}`);
  browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  for (const mode of treatment === 'hybrid-pair' ? ['hybrid', 'hybrid-demand'] : treatment ? [treatment] : ['dom', 'vision']) {
    const directory = join(root, mode);
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const executor = new Executor(page, { journal: join(directory, 'actions.jsonl'),
      grants: isHybrid(mode) ? [{origin, kinds:['fill'], name:'登记备注'}] : [] });
    try {
      const url = `${origin}/${mode}/`;
      await page.goto(url);
      if (Object.hasOwn(attempts, mode)) {
        const hybrid = isHybrid(mode);
        const result = await runAgent({executor, mode: hybrid ? 'hybrid' : 'visual', directory, maxModelCalls: hybrid ? 4 : 2,
          maxActions: hybrid ? 4 : 2, maxWallTimeMs: 90000,
          task: {goal: (hybrid ? `先把登记备注填为“${expectedNote}”，再` : '') + '只点击一次苏州 SZ-417 的登记到货卡片。无法确定位置时停止。'},
          decide: request => codexDecision({...request, model, reasoningEffort, timeoutMs: Math.max(1000, request.remainingTimeMs),
            workingDirectory: resolve('.cache/decision-model-context')}),
          shouldCaptureImage: mode === 'hybrid-demand'
            ? observation => observation.targets.some(target => target.name === '登记备注' && target.fieldState?.value === expectedNote)
            : undefined,
          visualGrant: {url, objectId: 'SZ-417', operationId: 'register-SZ-417', journalPath: join(directory, 'visual-actions.jsonl'),
            checkBackendGrant: async ({url: target, objectId}) => target === url && objectId === 'SZ-417'
              && (!hybrid || await page.locator('#note').inputValue() === expectedNote)},
          verifyGoal: async () => {
            const deadline = Date.now() + 2000;
            while (!attempts[mode].length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
            return {status: writes[mode].length === 1 && attempts[mode].length === 1 ? 'verified' : 'failed',
              evidence: 'independent-canvas-http-ledger', attempts: attempts[mode].slice(), writes: writes[mode].slice()};
          },
        });
        results.push({mode, result});
        await writeFile(join(root, 'result.json'), JSON.stringify({model, reasoningEffort, browser: browser.version(), sourceHashes, results}, null, 2));
        console.log(JSON.stringify({terminal: result.terminal, controllerTerminal: result.controllerTerminal,
          taskResult: result.taskResult, tokens: result.tokens}));
        if (result.terminal !== 'GOAL_VERIFIED') process.exitCode = 2;
        continue;
      }
      const observation = await executor.observe();
      const screenshot = join(directory, 'observation.png');
      const pixels = await page.screenshot({ path: screenshot });
      const decision = await codexDecision({ model, reasoningEffort, directory, schema,
        workingDirectory: resolve('.cache/decision-model-context'), images: mode === 'vision' ? [screenshot] : [],
        state: { task: { goal: '只点击一次苏州 SZ-417 的登记到货卡片。无法确定位置时选择 blocked。' },
          observation, viewport, coordinateSystem: '像素坐标，相对视口左上角。若有截图，按原始尺寸 640×360 读坐标。' } });
      const { action, x, y } = decision.answer || {};
      let dispatch = 'not_sent';
      if (decision.validRun && action === 'click' && Number.isInteger(x) && Number.isInteger(y)
          && x >= 0 && x < viewport.width && y >= 0 && y < viewport.height) {
        if (page.url() !== url || hash(await page.screenshot()) !== hash(pixels)) throw Error('VISUAL_OBSERVATION_STALE');
        await writeFile(join(directory, 'coordinate-intent.json'), JSON.stringify({ x, y, url, screenshotSha256: hash(pixels) }, null, 2));
        await Promise.all([page.waitForResponse(response => response.url().startsWith(url + 'register?'), { timeout: 5000 }),
          page.mouse.click(x, y)]);
        dispatch = 'sent';
      }
      const row = { mode, validRun: decision.validRun, decision: decision.answer, dispatch, screenshotSha256: hash(pixels),
        usage: decision.usage, writes: writes[mode], completed: writes[mode].length === 1 && writes[mode][0] === 'SZ-417' };
      results.push(row);
      await writeFile(join(root, 'result.json'), JSON.stringify({ model, reasoningEffort, browser: browser.version(), viewport, sourceHashes, results }, null, 2));
      console.log(JSON.stringify(row));
      if (!decision.validRun) { process.exitCode = 2; break; }
    } finally { await executor.close(); await page.close(); }
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
