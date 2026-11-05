import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function startBridge() {
  const root = resolve('sources/vendor/miniwob-plusplus/miniwob/html');
  const instances = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/result/')) {
      const item = instances.get(url.pathname.split('/')[2]);
      if (!item || req.method !== 'POST') { res.writeHead(404).end(); return; }
      let body = ''; for await (const chunk of req) body += chunk;
      try { item.results.push({ receivedAt: new Date().toISOString(), ...JSON.parse(body) }); }
      catch { res.writeHead(400).end(); return; }
      res.end('{}'); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      let bytes = await readFile(path);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      const item = instances.get(url.searchParams.get('instance'));
      if (item && extname(path) === '.html') {
        // The original task and original scoring implementation remain unchanged.
        // Standard task initialization, as BrowserGym does, plus passive reporting.
        const bootstrap = `<script>window.addEventListener('load',()=>{
          const originalEnd=core.endEpisode;
          core.endEpisode=function(...args){
            const before=WOB_EPISODE_ID;originalEnd.apply(core,args);
            if(WOB_EPISODE_ID!==before)fetch('/result/${item.id}',{method:'POST',body:JSON.stringify({
              rawReward:WOB_RAW_REWARD_GLOBAL,reward:WOB_REWARD_GLOBAL,done:WOB_DONE_GLOBAL,
              reason:WOB_REWARD_REASON,episodeId:WOB_EPISODE_ID,elapsedMs:Date.now()-core.ept0,
              utterance:core.getUtterance(),episodeMaxTime:core.EPISODE_MAX_TIME})});
          };
          Math.seedrandom(${JSON.stringify(item.seed)});
          ${item.maxTime === null ? '' : `core.EPISODE_MAX_TIME=${item.maxTime};`}
          core.startEpisodeReal();
        });</script>`;
        bytes = Buffer.from(bytes.toString('utf8').replace('</body>', bootstrap + '</body>'));
      }
      res.end(bytes);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    create(task, seed = 42, maxTime = null) {
      if (!['click-button', 'enter-text', 'click-checkboxes', 'choose-list'].includes(task)) throw Error('Unsupported smoke task');
      const id = randomUUID();
      const item = { id, task, seed, maxTime, results: [] };
      instances.set(id, item);
      return { id, url: `${origin}/miniwob/${task}.html?instance=${id}`, task, seed, maxTime };
    },
    results(id) { return structuredClone(instances.get(id)); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
