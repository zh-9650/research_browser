import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S17 无限滚动与分页组合按业务 ID 去重并核对完整性', {timeout:60000}, async t => {
  const expected = ['WH-410','WH-411','WH-412','WH-413','WH-414','WH-415'];
  const batches = new Map([['1:0',expected.slice(0,2)], ['1:1',expected.slice(1,3)],
    ['2:0',expected.slice(2,4)], ['2:1',expected.slice(4)]]);
  const requests = [];
  const server = createServer((req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/rows') {
      const page = url.searchParams.get('page');
      const cursor = url.searchParams.get('cursor');
      const key = page + ':' + cursor;
      const ids = batches.get(key);
      if (!ids) { res.writeHead(404).end(); return; }
      requests.push({page,cursor,ids});
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ids,next:cursor === '0' ? 1 : null}));
      return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html>
      <style>#list{height:130px;width:320px;overflow-y:auto;border:1px solid}#list p{height:80px;margin:0}</style>
      <h1>仓库目录</h1><div id="list"></div><p role="status"></p><button id="next" disabled>下一页</button>
      <script>
      const list = document.querySelector('#list'), next = document.querySelector('#next'), status = document.querySelector('[role=status]');
      let page=1,cursor=0,busy=false;
      async function load(){
        if(busy||cursor===null)return;
        busy=true;
        const batch=await (await fetch('/rows?page='+page+'&cursor='+cursor)).json();
        for(const id of batch.ids){const row=document.createElement('p');row.textContent=id;list.append(row);}
        cursor=batch.next;
        next.disabled=page===2||cursor!==null;
        status.textContent=cursor===null?(page===2?'全部结束':'本页结束'):'滚动加载';
        busy=false;
      }
      list.addEventListener('scroll',()=>{if(list.scrollTop+list.clientHeight>=list.scrollHeight-1)void load();});
      next.onclick=()=>{page++;cursor=0;list.replaceChildren();list.scrollTop=0;next.disabled=true;void load();};
      void load();
      </script>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome'});
  t.after(() => browser.close());
  const directory=resolve('traces',`pagination-scroll-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await mkdir(directory,{recursive:true});
  const page=await browser.newPage();
  const executor=new Executor(page,{journal:join(directory,'actions.jsonl'),timeout:3000,grants:[{origin,kinds:['click'],name:'下一页'}]});
  t.after(() => executor.close());
  await page.goto(origin);
  const seen=new Set(), observations=[];
  const capture=async marker=>{
    await page.getByRole('status').filter({hasText:marker}).waitFor({timeout:8000});
    const observation=await executor.observe();
    const ids=observation.documents.flatMap(document=>document.text.match(/\bWH-\d+\b/g)||[]);
    ids.forEach(id=>seen.add(id));
    observations.push({marker,ids,rev:observation.rev});
    return observation;
  };
  const scroll=async()=>{
    await page.locator('#list').hover();
    await page.mouse.wheel(0,400);
  };
  await capture('滚动加载');
  await scroll();
  const firstPage=await capture('本页结束');
  const next=firstPage.targets.find(target=>target.name==='下一页');
  assert.ok(next?.actions.includes('click'));
  const receipt=await executor.act({operationId:'next-page',kind:'click',ref:next.ref});
  assert.equal(receipt.dispatch,'sent');
  await capture('滚动加载');
  await scroll();
  const terminal=await capture('全部结束');
  assert.equal(terminal.targets.find(target=>target.name==='下一页').disabled,true);
  const inventory=[...seen];
  assert.deepEqual(inventory,expected);
  assert.deepEqual(requests.map(request=>request.page+':'+request.cursor),['1:0','1:1','2:0','2:1']);
  await writeFile(join(directory,'result.json'),JSON.stringify({browser:browser.version(),observations,requests,inventory,expected},null,2));
  console.log(`S17 分页滚动证据: ${directory}`);
});
