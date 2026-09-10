import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {PrivateStore,Outbox} from '../staging/src/storage.js';
import {IntegrityApi,ApiError} from '../staging/src/api.js';
import {decimal,quantity,priceText,locationText,replaceRecords,eligible,safeUrl,exportOffers,defaultUnit} from '../staging/src/domain.js';
import {Reconciler} from '../staging/src/reconcile.js';
const uuid='11111111-1111-4111-8111-111111111111',user='user-a',source='source-a';
const config={url:'https://qaaskvbhssonbktdjdki.supabase.co',publishableKey:'test-key',contractVersion:'1.0.0-draft.1'};
const health={contract_version:config.contractVersion,server_time:'2026-09-08T12:00:00Z',write_mode:'enabled',capabilities:{claims:true,evidence_upload:true,public_evidence:true,demand_capture:true,demand_summary:false,notifications:true,integrations:false}};
const envelope=data=>({contract_version:config.contractVersion,server_time:'2026-09-08T12:00:00Z',data});
const locks={request:async(_key,fn)=>fn()};
let dbId=0;const db=()=>new PrivateStore('test-'+dbId++,indexedDB);
test('prices unknown, free and five for ten are distinct',()=>{
 assert.equal(priceText({status:'unknown'},'each'),'Price not supplied');
 assert.equal(priceText({status:'free'},'each'),'Free');
 assert.equal(priceText({status:'priced',amount:'10',currency:'GBP',basis:'bundle',bundle_quantity:'5'},'each'),'5 each for £10.00');
});
test('exact decimals and whole-count units; historical item stays item',()=>{
 assert.equal(decimal('0.1')+decimal('0.2'),decimal('0.3'));
 assert.equal(quantity('3.125','kg'),'3.125');assert.throws(()=>quantity('1.5','each'));assert.throws(()=>decimal('1e2'));assert.throws(()=>decimal(2));
 assert.equal(quantity('3','item'),'3');
 assert.deepEqual(['courgettes','tomatoes','red snapper','potatoes','eggs','bread'].map(defaultUnit),['each','each','each','kg','dozen','loaf']);
});
test('replacement propagates rename and removed coordinates',()=>{
 let records=replaceRecords([{id:uuid,source_name:'Old',latitude:53,longitude:-1}]);
 records=replaceRecords([{id:uuid,source_name:'New',latitude:null,longitude:null}]);
 assert.equal(records.get(uuid).source_name,'New');assert.equal(locationText(records.get(uuid)),'Location not yet resolved');
 assert.equal(replaceRecords([]).size,0);
});
test('unsafe protocols rejected; exports retain inert text and classification',()=>{
 for(const v of ['javascript:alert(1)','data:text/html,<script>','file:///tmp/a','https://user:pass@example.com'])assert.equal(safeUrl(v),null);
 const text='<img src=x onerror=alert(1)>';const out=exportOffers([{id:uuid,source_name:text,classification:'test',physical_quantity:'20',held_quantity:'3',claimable_quantity:'17'}],'now','hash');
 assert.equal(out.items[0].source_name,text);assert.equal(out.items[0].classification,'test');assert.equal(out.items[0].claimable_quantity,'17');
});
test('test/demo/directory, expired and withdrawn records cannot become recommendations',()=>{
 const o={classification:'live',source_active:true,visibility:'public',withdrawal_state:'clear',listing_expires_at:'2026-09-08T12:00:00Z'};
 assert.equal(eligible(o,Date.parse('2026-09-08T11:59:59Z')),true);
 assert.equal(eligible(o,Date.parse(o.listing_expires_at)),false);
 for(const classification of ['test','demo','directory'])assert.equal(eligible({...o,classification},0),false);
 assert.equal(eligible({...o,withdrawal_state:'recalled'},0),false);
});
test('server refresh and a new day never replace drafts or attachment blobs',async()=>{
 const s=db();await s.saveDraft(user,source,'lot-a',{text:'70 courgettes',baseRevision:1},0);
 await s.put('files',user,source,'file-a',{blob:new Blob(['private photo'],{type:'image/png'})});
 await s.put('server',user,source,'catalogue',{items:[],day:'next-day'});
 assert.equal((await s.get('drafts',user,source,'lot-a')).text,'70 courgettes');
 assert.equal(await(await s.get('files',user,source,'file-a')).blob.text(),'private photo');
 assert.equal((await s.list('drafts','user-b')).length,0);assert.equal((await s.list('files',user,'source-b')).length,0);
 s.db.close();s.db=null;assert.equal((await s.get('drafts',user,source,'lot-a')).baseRevision,1);
});
test('two-tab draft edits detect local version conflicts',async()=>{
 const s=db();await s.saveDraft(user,source,'lot',{text:'first'},0);
 const r=await Promise.allSettled([s.saveDraft(user,source,'lot',{text:'second'},1),s.saveDraft(user,source,'lot',{text:'third'},1)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);
 assert.equal((await s.get('drafts',user,source,'lot')).localVersion,2);
});
test('quota/storage failure prevents sending',async()=>{
 let called=false;const s={get:async()=>null,put:async()=>{throw Error('quota');}},a={validate(){},rpc(){called=true;}};
 const b=new Outbox(s,a,{identity:()=>user,lock:locks});await assert.rejects(b.enqueue(user,source,uuid,'write',{operation_id:uuid}),/quota/);assert.equal(called,false);
});
test('lost response replays identical values; never generates a new operation',async()=>{
 const s=db(),calls=[];let first=true;const api={validate(){},async rpc(n,p){calls.push([n,JSON.stringify(p)]);if(first){first=false;throw new ApiError('CONNECTION_UNCONFIRMED');}return envelope({physical_quantity:'17',held_quantity:'0',claimable_quantity:'17'});}};
 const b=new Outbox(s,api,{identity:()=>user,lock:locks}),row=await b.enqueue(user,source,uuid,'integrity_collect_claim_v1',{operation_id:uuid,quantity:'3.0'});
 await assert.rejects(b.send(row));const retry=await s.get('outbox',user,source,uuid);assert.equal(retry.status,'saved');
 const result=await b.send(retry);assert.deepEqual(calls[0],calls[1]);assert.equal(result.data.physical_quantity,'17');assert.equal((await s.get('outbox',user,source,uuid)).status,'published');
 await assert.rejects(b.enqueue(user,source,uuid,'integrity_collect_claim_v1',{operation_id:uuid,quantity:'3'}),/exact payload/);
});
test('a new identity cannot submit an earlier operator queue',async()=>{
 const s=db(),b=new Outbox(s,{validate(){}},{identity:()=> 'user-b',lock:locks}),r=await b.enqueue(user,source,uuid,'write',{});await assert.rejects(b.send(r),/account/);
});
test('repeated submission reuses an unresolved operation; edited payload cannot bypass it',async()=>{
 const s=db(),b=new Outbox(s,{validate(){},rpc:async()=>{throw new ApiError('CONNECTION_UNCONFIRMED');}},{identity:()=>user,lock:locks});
 const first=await b.prepare(user,source,'claim',{offer_id:uuid,quantity:'3.0'});await assert.rejects(b.send(first));
 const again=await b.prepare(user,source,'claim',{quantity:'3.0',offer_id:uuid});assert.equal(again.id,first.id);assert.equal(again.payload,first.payload);
 await assert.rejects(b.prepare(user,source,'claim',{offer_id:uuid,quantity:'4'}),/unresolved/);
});
test('account switch while persisting sending state prevents the network call',async()=>{
 const s=db();let current=user,called=false;const b=new Outbox(s,{validate(){},rpc:async()=>{called=true;}},{identity:()=>current,lock:locks});const r=await b.enqueue(user,source,uuid,'write',{});
 const put=s.put.bind(s);s.put=async(...args)=>{await put(...args);current='user-b';};
 await assert.rejects(b.send(r),/Account changed/);assert.equal(called,false);
});
test('old unsent stock requires explicit review; role denial remains needs-attention',async()=>{
 const s=db(),api={validate(){},rpc:async()=>{throw new ApiError('FORBIDDEN',403);}},b=new Outbox(s,api,{identity:()=>user,lock:locks});
 let r=await b.enqueue(user,source,uuid,'write',{});await s.put('outbox',user,source,uuid,{...r,createdAt:0});
 await assert.rejects(b.send(r),/Review/);await assert.rejects(b.send(r,{reviewed:true}),/FORBIDDEN/);assert.equal((await s.get('outbox',user,source,uuid)).status,'attention');
});
test('exact wire envelope and restricted RPC surface',async()=>{
 const seen=[],api=new IntegrityApi(config,{fetcher:async(u,o)=>{seen.push([u,o]);return Response.json(envelope(health));}});
 await api.rpc('integrity_health_v1',{});assert.equal(seen[0][1].body,'{"p_request":{}}');assert.equal(seen[0][1].cache,'no-store');
 await assert.rejects(api.rpc('request_claim',{}),/UNDOCUMENTED_OPERATION/);
 await assert.rejects(api.rpc('integrity_offers_v1',{page:{limit:50,cursor:null}}),/INVALID_REQUEST/);
 assert.throws(()=>new IntegrityApi({...config,url:'https://production.example'}),/STAGING_ONLY/);
});
test('malformed/changed response disables writes instead of coercing quantities',async()=>{
 const a=new IntegrityApi(config,{fetcher:async()=>Response.json({contract_version:'future',server_time:'2026-09-08T12:00:00Z',data:health})});
 await assert.rejects(a.rpc('integrity_health_v1',{}),/UPDATE_REQUIRED/);assert.equal(a.incompatible,true);
});
test('fresh read clock is not changed by old mutation replay timestamps',async()=>{
 let now=Date.parse('2026-09-08T12:00:00Z');const a=new IntegrityApi(config,{clock:()=>now,session:()=>({access_token:'test'}),fetcher:async u=>Response.json(u.endsWith('health_v1')?envelope(health):{...envelope({lot_id:uuid,revision:0}),server_time:'2020-01-01T00:00:00Z'})});
 await a.rpc('integrity_health_v1',{});const offset=a.offset;a.identity={integration_ready:true}; // Runtime binding is exercised independently in runtime-contract.test.mjs.
 await a.rpc('integrity_create_lot_v1',{operation_id:uuid,source_id:uuid,food_id:uuid,unit:'kg',physical_dates:{harvested_at:null,landed_at:null,baked_at:null,packed_at:null,date_type:null,date_value:null,date_timezone:null,handling:null,allergen_information:null}});
 assert.equal(a.offset,offset);assert.equal(a.lastSynced,'2026-09-08T12:00:00Z');
});
test('expiry reconciliation is bounded and invalidation bursts are coalesced',()=>{
 let active=new Map(),id=0;const r=new Reconciler(async()=>null,()=>0,{visible:()=>true,set:(fn,ms)=>{active.set(++id,{fn,ms});return id;},clear:i=>active.delete(i)});
 r.schedule('1970-01-01T00:00:03Z');assert.equal([...active.values()][0].ms,3300);for(let i=0;i<100;i++)r.hint();assert.equal(active.size,1);r.stop();assert.equal(active.size,0);
});
