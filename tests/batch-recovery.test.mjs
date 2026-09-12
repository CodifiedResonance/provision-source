import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {PrivateStore,Outbox} from '../staging/src/storage.js';
import {ApiError} from '../staging/src/api.js';
import {continueBatchPublication,recoverBatchDraft,publicationPayload} from '../staging/src/batch-recovery.js';
const user='test-owner',source='11111111-1111-4111-8111-111111111111',lot='22222222-2222-4222-8222-222222222222',offer='33333333-3333-4333-8333-333333333333';
const createId='44444444-4444-4444-8444-444444444444',publishId='55555555-5555-4555-8555-555555555555';
const envelope=data=>({contract_version:'1.0.0-draft.1',server_time:'2026-09-12T12:00:00Z',data});
const locks={queues:new Map(),request(key,fn){const next=(this.queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);this.queues.set(key,next);return next;}};
let counter=0;
async function fixture(){
 const store=new PrivateStore('recovery-'+counter++,indexedDB),calls=[],committed=new Map();let lots=0,publications=0,currentUser=user,lookupError=null,loseCreate=false,losePublish=false;
 const api={validate(){},async rpc(name,p){calls.push({name,p:structuredClone(p)});
  if(name==='integrity_operation_v1'){if(lookupError)throw lookupError;const r=committed.get(p.operation_id);return envelope(r?{operation_id:p.operation_id,action:p.action,status:'committed',record_id:r.data.lot_id||r.data.id,revision:r.data.revision,committed_at:r.server_time,error_code:null}:null);}
  if(committed.has(p.operation_id))return committed.get(p.operation_id);
  let result;
  if(name==='integrity_create_lot_v1'){lots++;result=envelope({lot_id:lot,revision:0});committed.set(p.operation_id,result);if(loseCreate){loseCreate=false;throw new ApiError('CONNECTION_UNCONFIRMED');}}
  else if(name==='integrity_publish_v2'){assert.equal(p.lot_id,lot);publications++;result=envelope({id:offer,lot_id:lot,revision:1,food_name:'Potatoes',visibility:'public'});committed.set(p.operation_id,result);if(losePublish){losePublish=false;throw new ApiError('CONNECTION_UNCONFIRMED');}}
  else if(name==='integrity_offers_v1')return envelope({items:[...committed.values()].map(r=>r.data).filter(d=>d.visibility==='public')});
  return result;
 }};
 const outbox=new Outbox(store,api,{identity:()=>currentUser,lock:locks});
 const draft=await store.saveDraft(user,source,'draft',{createId,publishId,lotId:null,baseRevision:0,foodName:'Potatoes',form:{foodId:'potatoes',unit:'kg',quantity:'20',price:{status:'free'},lifecycle:'ready',pressure:'normal',visibility:'public',reservable:false,listingExpiresAt:'2026-09-13T12:00:00Z',collectionStart:null,collectionEnd:null,note:'',dates:{}}},0);
 return {store,outbox,api,calls,committed,draft,counts:()=>({lots,publications}),switchUser:()=>{currentUser='other';},lookupError:e=>{lookupError=e;},loseCreate:()=>{loseCreate=true;},losePublish:()=>{losePublish=true;}};
}
const options={user,source};
async function create(f){const d=f.draft;const row=await f.outbox.prepare(user,source,'integrity_create_lot_v1',{source_id:source,food_id:d.form.foodId,unit:d.form.unit,physical_dates:d.form.dates},createId);return f.outbox.send(row);}
test('mobile partial commit: one lot, missing publish is checked and retried with its exact ID; consumer sees one offer',async()=>{
 const f=await fixture();await create(f);const d=await f.store.saveDraft(user,source,f.draft.id,{...f.draft,lotId:lot},f.draft.localVersion);
 let row=await f.outbox.prepare(user,source,'integrity_publish_v2',publicationPayload(d,source),publishId);
 await f.store.put('outbox',user,source,publishId,{...row,status:'attention',attempted:true,error:'INVALID_REQUEST'});
 const checked=await f.outbox.reconcile(row);assert.equal(checked.safeToRetry,true);assert.equal(checked.id,publishId);assert.equal(checked.payload,row.payload);
 assert.ok(await f.store.get('drafts',user,source,d.id));
 await continueBatchPublication(f.store,f.outbox,d,options);
 assert.deepEqual(f.counts(),{lots:1,publications:1});assert.equal(await f.store.get('drafts',user,source,d.id),undefined);
 const writes=f.calls.filter(c=>c.name==='integrity_publish_v2');assert.equal(writes.length,1);assert.equal(writes[0].p.operation_id,publishId);assert.equal(JSON.stringify(writes[0].p),row.payload);
 assert.equal((await f.api.rpc('integrity_offers_v1',{})).data.items[0].food_name,'Potatoes');
});
test('lost create acknowledgement recovers original lot into durable draft before any publish',async()=>{
 const f=await fixture();f.loseCreate();await assert.rejects(create(f),/CONNECTION_UNCONFIRMED/);
 const recovered=await recoverBatchDraft(f.store,f.outbox,f.draft,options);
 assert.equal(recovered.draft.lotId,lot);assert.equal((await f.store.get('drafts',user,source,f.draft.id)).lotId,lot);assert.deepEqual(f.counts(),{lots:1,publications:0});
 await continueBatchPublication(f.store,f.outbox,recovered.draft,options);assert.deepEqual(f.counts(),{lots:1,publications:1});
 assert.ok(f.calls.some(c=>c.name==='integrity_operation_v1'&&c.p.operation_id===createId));
});
test('committed publish with lost response adopts original acknowledgement and never republishes',async()=>{
 const f=await fixture();f.losePublish();await assert.rejects(continueBatchPublication(f.store,f.outbox,f.draft,options),/CONNECTION_UNCONFIRMED/);
 assert.ok(await f.store.get('drafts',user,source,f.draft.id));assert.deepEqual(f.counts(),{lots:1,publications:1});
 const result=await continueBatchPublication(f.store,f.outbox,f.draft,options);assert.equal(result.data.id,offer);assert.deepEqual(f.counts(),{lots:1,publications:1});
 assert.equal(await f.store.get('drafts',user,source,f.draft.id),undefined);
});
test('timeout, permission denial and HTTP404 in lookup are not proof of nonexistence',async()=>{
 for(const error of [new ApiError('CONNECTION_UNCONFIRMED'),new ApiError('FORBIDDEN',403),new ApiError('NOT_FOUND',404)]){
  const f=await fixture();f.loseCreate();await assert.rejects(create(f));f.lookupError(error);
  await assert.rejects(continueBatchPublication(f.store,f.outbox,f.draft,options));assert.deepEqual(f.counts(),{lots:1,publications:0});
  assert.ok(await f.store.get('drafts',user,source,f.draft.id));assert.equal((await f.store.get('outbox',user,source,createId)).safeToRetry,false);
 }
});
test('pending server operation remains blocked without a replacement ID',async()=>{
 const f=await fixture();let row=await f.outbox.prepare(user,source,'integrity_create_lot_v1',{},createId);await f.store.put('outbox',user,source,createId,{...row,status:'attention',attempted:true});
 f.api.rpc=async()=>envelope({operation_id:createId,action:'integrity_create_lot_v1',status:'pending'});
 await assert.rejects(f.outbox.send(row),/not confirmed/);assert.deepEqual(f.counts(),{lots:0,publications:0});assert.equal((await f.store.list('outbox',user)).length,1);
});
test('account switch during operation lookup retains the draft and prevents replay',async()=>{
 const f=await fixture();f.loseCreate();await assert.rejects(create(f));const rpc=f.api.rpc.bind(f.api);f.api.rpc=async(n,p)=>{const r=await rpc(n,p);if(n==='integrity_operation_v1')f.switchUser();return r;};
 await assert.rejects(continueBatchPublication(f.store,f.outbox,f.draft,options),/Account changed/);assert.deepEqual(f.counts(),{lots:1,publications:0});assert.ok(await f.store.get('drafts',user,source,f.draft.id));
});
test('a newer tab draft is retained even after publication acknowledgement',async()=>{
 const f=await fixture();const rpc=f.api.rpc.bind(f.api);f.api.rpc=async(n,p)=>{const result=await rpc(n,p);if(n==='integrity_publish_v2'){const d=await f.store.get('drafts',user,source,f.draft.id);await f.store.saveDraft(user,source,d.id,{...d,form:{...d.form,note:'Newer edit'}},d.localVersion);}return result;};
 await assert.rejects(continueBatchPublication(f.store,f.outbox,f.draft,options),/draft changed/);assert.equal((await f.store.get('drafts',user,source,f.draft.id)).form.note,'Newer edit');assert.deepEqual(f.counts(),{lots:1,publications:1});
 await assert.rejects(recoverBatchDraft(f.store,f.outbox,f.draft,options),/newer edits/);assert.ok(await f.store.get('drafts',user,source,f.draft.id));
});
test('two simultaneous continuation taps still produce one batch and one publication',async()=>{
 const f=await fixture();const attempts=await Promise.allSettled([continueBatchPublication(f.store,f.outbox,f.draft,options),continueBatchPublication(f.store,f.outbox,f.draft,options)]);
 assert.ok(attempts.some(r=>r.status==='fulfilled'));assert.deepEqual(f.counts(),{lots:1,publications:1});assert.equal(await f.store.get('drafts',user,source,f.draft.id),undefined);
});
