import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const template=fs.readFileSync('scripts/service-worker.template.js','utf8');
function worker(app,{failAsset=false}={}){
 const events={},deleted=[],puts=[],scope=`https://preview.example/${app}/`,prefix=`provision:${app}:staging:${encodeURIComponent(scope)}:`;
 const cache={put:async(u)=>puts.push(u),match:async()=>undefined};
 const context={URL,Request,Set,Promise,Error,fetch:async()=>new Response('shell',{status:failAsset?500:200,headers:{'content-type':'text/html'}}),caches:{open:async()=>cache,keys:async()=>[prefix+'old','provision:source:staging:unrelated','the-kingdom-v10','field-ledger-v7','provision-leeds-live-v5.0.0'],delete:async k=>deleted.push(k)},self:{registration:{scope},addEventListener:(n,f)=>events[n]=f,clients:{claim:async()=>{}},skipWaiting:()=>{throw Error('Must not activate automatically');}}};
 vm.runInNewContext(template.replace('__APP__',app).replace('__REVISION__','new').replace('__SHELL__','["./index.html"]'),context);
 return {events,deleted,puts,prefix,scope};
}
for(const app of ['consumer','source'])test(app+' activation preserves neighbour and other-deployment caches',async()=>{const w=worker(app);let promise;w.events.activate({waitUntil:p=>promise=p});await promise;assert.deepEqual(w.deleted,[w.prefix+'old']);});
test('an incomplete shell fails installation rather than swallowing fetch failures',async()=>{const w=worker('consumer',{failAsset:true});let p;w.events.install({waitUntil:x=>p=x});await assert.rejects(p,/Incomplete shell/);assert.equal(w.puts.length,0);});
test('callbacks, private requests, API and signed images are never intercepted',()=>{const w=worker('consumer');for(const [url,headers]of [[w.scope+'?code=secret',{}],[w.scope+'index.html',{authorization:'Bearer private'}],['https://qaaskvbhssonbktdjdki.supabase.co/rest/v1/rpc/integrity_offers_v1',{}],[w.scope+'private.png?token=secret',{}]]){let handled=false;w.events.fetch({request:new Request(url,{headers}),respondWith:()=>handled=true});assert.equal(handled,false);}});
