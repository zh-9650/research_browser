import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort, treatment] = process.argv.slice(2);
if (!model || !reasoningEffort || (treatment && treatment !== 'early-verify')) throw Error('用法: node experiments/cross-site-tabs.mjs <model> <effort> [early-verify]');
const directory=resolve('traces',`cross-site-tabs-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(directory,{recursive:true});
const sourceHashes={};
for(const file of ['experiments/cross-site-tabs.mjs','engine/agent-loop.mjs','engine/executor.mjs',
  'engine/decision-modes.mjs','engine/observation-codec.mjs','engine/visual-write.mjs','adapters/codex-decision.mjs','package-lock.json']){
  const bytes=await readFile(file);
  sourceHashes[file]=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory,file.replaceAll('/','-')),bytes);
}
async function serve(handler){
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,
    close(){server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
const sourceRequests=[], attempts=[], records=[];
const expected={id:'SZ-417',quantity:'26'};
const source=await serve((req,res)=>{
  sourceRequests.push({method:req.method,url:req.url});
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const archive=req.url==='/archive';
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(archive
    ? '<title>到货档案（历史）</title><h1>历史记录</h1><p>苏州 SZ-417 实收 19 箱</p>'
    : '<title>到货档案（今日）</title><h1>今日到货档案</h1><article>南京 NJ-681 实收 62 箱</article><article>苏州 SZ-417 实收 26 箱</article>');
});
const destination=await serve(async(req,res)=>{
  if(req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const {id,quantity}=Object.fromEntries(new URLSearchParams(body));
    const accepted=req.url==='/register' && id===expected.id && quantity===expected.quantity && !records.length;
    attempts.push({path:req.url,id,quantity,accepted});
    if(accepted)records.push({id,quantity});
    res.writeHead(accepted?200:422,{'Content-Type':'text/html; charset=utf-8'}).end(accepted?'已登记':'业务拒绝');
    return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><title>库存登记台</title>
    <h1>库存登记台</h1><form action="/register" method="post"><label>到货编号 <input name="id"></label>
    <label>实收箱数 <input name="quantity"></label><button>提交登记</button></form>`);
});
const decide=({remainingTimeMs,...input})=>codexDecision({...input,model,reasoningEffort,
  timeoutMs:Math.max(1000,Math.min(60000,remainingTimeMs??60000)),workingDirectory:resolve('.cache/decision-model-context')});
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'};
const task={goal:'从今日到货档案中读取苏州 SZ-417 的实收箱数，在库存登记台登记一次。禁止用历史档案值。'};
let browser, reader, writer;
try{
  console.log(`Evidence directory: ${directory}`);
  browser=await chromium.launch({channel:'chrome'});
  const context=await browser.newContext();
  const tabs=new Map();
  for(const [ref,url] of [['tab-a',source.origin+'/archive'],['tab-b',destination.origin],['tab-c',source.origin]]){
    const page=await context.newPage();
    await page.goto(url);
    tabs.set(ref,{page,url:new URL(url).href,title:await page.title()});
  }
  const metadata=[...tabs].map(([ref,{url,title}])=>({ref,url,title}));
  const tabRef={type:'string',enum:[...tabs.keys()]};
  const routing=await decide({directory:join(directory,'routing'),schema:schema({source:tabRef,destination:tabRef}),
    state:{task,observation:{trust:'untrusted_page_data',tabs:metadata}}});
  const from=tabs.get(routing.answer?.source), to=tabs.get(routing.answer?.destination);
  if(!routing.validRun || from?.url!==source.origin+'/' || to?.url!==destination.origin+'/'
      || from.page.url()!==from.url || to.page.url()!==to.url)throw Error('TAB_ROUTE_NOT_AUTHORIZED');
  await from.page.bringToFront();
  reader=new Executor(from.page,{journal:join(directory,'read.jsonl'),grants:[]});
  const observation=await reader.observe();
  const extract=await decide({directory:join(directory,'extract'),schema:schema({id:string,quantity:string,evidence:string}),
    state:{task:{goal:'当前步骤只读。提取今日到货档案中苏州 SZ-417 的编号和实收箱数。quantity 只填数字；evidence 逐字复制一行页面原文。登记由后续步骤执行。'},observation}});
  if(!extract.validRun || extract.answer?.id!==expected.id || !/^\d+$/.test(extract.answer?.quantity)
    || !extract.answer.evidence || !observation.documents.some(document=>document.text.includes(extract.answer.evidence)))throw Error('UNBOUND_EXTRACTION');
  await to.page.bringToFront();
  if(to.page.url()!==to.url)throw Error('DESTINATION_TAB_CHANGED');
  writer=new Executor(to.page,{journal:join(directory,'write.jsonl'),timeout:3000,
    grants:[{origin:destination.origin,kinds:['fill','click']}]});
  const result=await runAgent({executor:writer,mode:'program',directory:join(directory,'register'),maxModelCalls:4,maxActions:7,
    maxWallTimeMs:90000,decide,task:{...task,sourceValues:{id:extract.answer.id,quantity:extract.answer.quantity}},
    isFinalAction:treatment==='early-verify' ? ({kind,target,url})=>kind==='click' && target.name==='提交登记' && url===to.url : undefined,
    verifyGoal:()=>({status:records.length===1&&attempts.length===1?'verified':'failed',evidence:'independent-destination-ledger',
      attempts:attempts.slice(),records:records.slice()})});
  await from.page.bringToFront();
  const openTabs=[...tabs].map(([ref,{page}])=>({ref,open:!page.isClosed(),url:page.url()}));
  const resultPath=join(directory,'result.json');
  await writeFile(resultPath,JSON.stringify({model,reasoningEffort,treatment:treatment??'baseline',browser:browser.version(),sourceHashes,metadata,
    routing:routing.answer,extract:extract.answer,sourceRequests,openTabs,returnedTo:routing.answer.source,result},null,2));
  console.log(JSON.stringify({routing:routing.answer,extract:extract.answer,terminal:result.terminal,taskResult:result.taskResult,openTabs}));
  if(result.terminal!=='GOAL_VERIFIED'||sourceRequests.some(request=>request.method!=='GET')||openTabs.some(tab=>!tab.open))process.exitCode=2;
}finally{
  await reader?.close();await writer?.close();await browser?.close();
  await Promise.all([source.close(),destination.close()]);
}
