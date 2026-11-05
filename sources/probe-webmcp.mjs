import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Local WebMCP capability probe</title>'); });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const results = [];
try {
  for (const enabled of [false, true]) {
    const args = enabled ? ['--enable-features=WebMCP'] : [];
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        const d = document.modelContext, n = navigator.modelContext;
        const result = { secureContext: isSecureContext, documentModelContext: typeof d, navigatorModelContext: typeof n,
          methods: d || n ? Object.getOwnPropertyNames(Object.getPrototypeOf(d || n)) : [] };
        if (d) {
          const controller = new AbortController();
          await d.registerTool({ name: 'research-echo', description: 'Echo a test string without external effects',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
            async execute({ value }) { return { content: [{ type: 'text', text: value }] }; }
          }, { signal: controller.signal });
          const tools = await d.getTools();
          const tool = tools.find(t => t.name === 'research-echo');
          result.roundtrip = { names: tools.map(t => t.name), output: await d.executeTool(tool, { value: 'controlled-local-probe' }) };
          controller.abort();
          result.afterAbort = (await d.getTools()).map(t => t.name);
        }
        return result;
      });
      results.push({ enabled, args, browser: browser.version(), ...result });
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
await writeFile(new URL('./runs/webmcp-probe.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
