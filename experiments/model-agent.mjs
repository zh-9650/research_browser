import { chromium } from 'playwright';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

// Trusted config only. Local synthetic tasks during development; no real-account writes.
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const model=process.argv[3],effort=process.argv[4];
if(!model||!effort)throw Error('Specify an explicitly selected model and reasoning effort');
const directory=resolve('traces',`model-agent-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(directory,{recursive:true});
const hashes={};
for(const file of ['engine/agent-loop.mjs','engine/executor.mjs','engine/observation-codec.mjs','adapters/codex-decision.mjs','experiments/model-agent.mjs','package-lock.json']) {
  const bytes=await readFile(file);hashes[file]=createHash('sha256').update(bytes).digest('hex');
  await copyFile(file,join(directory,file.replaceAll('/','-')));
}
const browser=await chromium.launch({channel:config.channel||'chrome',...(config.executablePath?{executablePath:config.executablePath}:{}),headless:true});
let executor;
try {
  const page=await browser.newPage();
  executor=new Executor(page,{journal:join(directory,'actions.jsonl'),grants:config.grants,timeout:1500});
  await page.goto(config.url);
  const result=await runAgent({executor,task:{goal:config.goal,constraints:config.constraints},directory,
    maxModelCalls:12,maxTokens:300000,decide:async request=>{
      console.error(`Decision ${request.directory.split(/[\\/]/).at(-1)} started`);
      const decision=await codexDecision({...request,model,reasoningEffort:effort});
      console.error(`Decision returned: valid=${decision.validRun}, kind=${decision.answer?.kind}, ref=${decision.answer?.ref}`);
      return decision;
    }});
  await page.screenshot({path:join(directory,'final.png')});
  await writeFile(join(directory,'environment.json'),JSON.stringify({node:process.version,browser:browser.version(),model,effort,hashes},null,2));
  console.log(JSON.stringify({directory,terminal:result.terminal,taskResult:result.taskResult,modelCalls:result.modelCalls,tokens:result.tokens},null,2));
}finally{if(executor)await executor.close();await browser.close();}
