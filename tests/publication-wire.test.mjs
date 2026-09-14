import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {IntegrityApi} from '../staging/src/api.js';
import {eligible} from '../staging/src/domain.js';
import operations from '../staging/src/operations.json' with {type:'json'};
import {PrivateStore,Outbox} from '../staging/src/storage.js';
import {continueBatchPublication,publicationPayload,recoverBatchDraft} from '../staging/src/batch-recovery.js';

// These fixtures use the pinned RPC schemas, including the complete response.
// No real backend, Auth account, or publication is used by this transport.
const config={url:'https://qaaskvbhssonbktdjdki.supabase.co',project:'qaaskvbhssonbktdjdki',publishableKey:'controlled-test-key',contractVersion:'1.0.0-draft.1',revision:'staging-20260910.1',checksum:'f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad'};
const ids={user:'10000000-0000-4000-8000-000000000001',source:'10000000-0000-4000-8000-000000000002',food:'10000000-0000-4000-8000-000000000003',lot:'10000000-0000-4000-8000-000000000004',offer:'10000000-0000-4000-8000-000000000005',event:'10000000-0000-4000-8000-000000000006',create:'10000000-0000-4000-8000-000000000007',publish:'10000000-0000-4000-8000-000000000008'};
const now='2026-09-12T22:10:00.000Z',expiry='2026-09-15T19:44:00.000Z';
const physicalDates={harvested_at:null,landed_at:null,baked_at:null,packed_at:null,date_type:null,date_value:null,date_timezone:null,handling:null,allergen_information:null};
const unknownPrice={status:'unknown',amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null};
const envelope=data=>({contract_version:config.contractVersion,server_time:now,data});
const identity={project_ref:config.project,document_revision:config.revision,contract_sha256:config.checksum,integration_ready:true,capabilities:Object.keys(operations)};
const health={contract_version:config.contractVersion,server_time:now,write_mode:'degraded',capabilities:{claims:true,evidence_upload:true,public_evidence:true,demand_capture:true,demand_summary:false,notifications:true,integrations:false}};
const options={user:ids.user,source:ids.source};
let sequence=0;

function serialLocks(){
  const queues=new Map();
  return {request(key,fn){const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,next);return next;}};
}
function offerFor(p,create){
  return {id:ids.offer,source_id:p.source_id,source_slug:'controlled-potato-fixture',source_name:'Controlled fixture',food_id:create.food_id,food_name:'Potatoes',lot_id:p.lot_id,legacy_identity:null,latest_event_id:ids.event,revision:1,classification:'test',lifecycle:p.lifecycle,pressure:p.pressure,visibility:p.visibility,reservable:p.reservable,withdrawal_state:'clear',source_active:true,physical_quantity:p.physical_quantity,held_quantity:'0',claimable_quantity:p.physical_quantity,shortfall_quantity:'0',unit:create.unit,price:p.price,availability_confirmed_at:now,received_at:now,listing_expires_at:p.listing_expires_at,collection_start:p.collection_start,collection_end:p.collection_end,next_expiry_at:p.collection_end||p.listing_expires_at,physical_dates:create.physical_dates,provenance:{truth_class:'declared',channel:'source_direct',business_control:'approved',corroboration:'none',label:'Declared by source'},latitude:null,longitude:null};
}
async function fixture(t){
  const store=new PrivateStore('publication-wire-'+sequence++,indexedDB),calls=[],committed=new Map(),locks=serialLocks();
  let lots=0,publications=0,dropNext=null,malformedNext=false,beforePublish=async()=>{};
  const fetcher=async(url,request)=>{
    assert.equal(new URL(url).origin,config.url);
    assert.equal(request.method,'POST');
    assert.equal(request.credentials,'omit');
    const body=JSON.parse(request.body);assert.deepEqual(Object.keys(body),['p_request']);
    const name=new URL(url).pathname.split('/').at(-1),p=body.p_request;
    calls.push({name,p:structuredClone(p)});
    if(name==='integrity_contract_identity_v1')return Response.json(envelope(identity));
    if(name==='integrity_health_v1')return Response.json(envelope(health));
    if(name==='integrity_offers_v1'){
      const item=committed.get(ids.publish)?.result.data;
      return Response.json(envelope({items:item?[item]:[],next_cursor:null,next_expiry_at:item?.next_expiry_at||null}));
    }
    assert.equal(request.headers.Authorization,'Bearer controlled-test-session');
    assert.equal(p.source_id,ids.source);
    if(name==='integrity_operation_v1'){
      const saved=committed.get(p.operation_id);
      if(saved)assert.equal(p.action,saved.name);
      return Response.json(envelope(saved?{operation_id:p.operation_id,action:saved.name,status:'committed',record_id:saved.result.data.id||saved.result.data.lot_id,revision:saved.result.data.revision,committed_at:saved.result.server_time,error_code:null}:null));
    }
    if(name==='integrity_member_offer_v1')return Response.json(envelope({...committed.get(ids.publish).result.data,note:null}));
    const prior=committed.get(p.operation_id);
    if(prior){assert.equal(name,prior.name);assert.deepEqual(p,prior.request);return Response.json(prior.result);}
    let result;
    if(name==='integrity_create_lot_v1'){
      assert.equal(p.operation_id,ids.create);assert.equal(p.food_id,ids.food);assert.equal(p.unit,'kg');
      lots++;result=envelope({lot_id:ids.lot,revision:0});
    }else if(name==='integrity_publish_v2'){
      await beforePublish(p);
      assert.equal(p.operation_id,ids.publish);assert.equal(p.lot_id,ids.lot);assert.equal(p.expected_revision,0);
      assert.equal(p.physical_quantity,'20');assert.deepEqual(p.price,unknownPrice);
      const created=committed.get(ids.create);assert.ok(created,'the original lot must exist before publication');
      publications++;result=envelope(offerFor(p,created.request));
    }else throw Error('Unexpected fixture RPC: '+name);
    committed.set(p.operation_id,{name,request:structuredClone(p),result});
    if(dropNext===name){dropNext=null;throw Error('Controlled response loss after commit');}
    if(malformedNext&&name==='integrity_publish_v2'){
      malformedNext=false;const invalid=structuredClone(result);delete invalid.data.claimable_quantity;
      return Response.json(invalid);
    }
    return Response.json(result);
  };
  async function client(){
    const api=new IntegrityApi(config,{fetcher,session:()=>({access_token:'controlled-test-session'}),clock:()=>Date.parse(now)});
    await api.rpc('integrity_contract_identity_v1',{});await api.rpc('integrity_health_v1',{});
    return {api,outbox:new Outbox(store,api,{identity:()=>ids.user,lock:locks})};
  }
  const {api,outbox}=await client();
  const draft=await store.saveDraft(ids.user,ids.source,'potato-draft',{createId:ids.create,publishId:ids.publish,lotId:null,baseRevision:0,foodName:'Potatoes',form:{foodId:ids.food,unit:'kg',quantity:'20',price:structuredClone(unknownPrice),lifecycle:'ready',pressure:'normal',visibility:'public',reservable:true,listingExpiresAt:expiry,collectionStart:'2026-09-12T19:45:00.000Z',collectionEnd:'2026-09-14T19:45:00.000Z',note:'',noteTouched:false,dates:structuredClone(physicalDates)}},0);
  t.after(()=>store.db?.close());
  return {store,api,outbox,draft,calls,committed,client,counts:()=>({lots,publications}),dropNext:name=>{dropNext=name;},malformedNext:()=>{malformedNext=true;},beforePublish:fn=>{beforePublish=fn;}};
}
async function create(f){
  const d=f.draft,row=await f.outbox.prepare(ids.user,ids.source,'integrity_create_lot_v1',{source_id:ids.source,food_id:d.form.foodId,unit:d.form.unit,physical_dates:d.form.dates},ids.create);
  return f.outbox.send(row,{reviewed:true});
}
async function assertPublished(f,api=f.api){
  assert.deepEqual(f.counts(),{lots:1,publications:1});
  assert.equal(await f.store.get('drafts',ids.user,ids.source,f.draft.id),undefined);
  const rows=await f.store.list('outbox',ids.user,ids.source);
  assert.deepEqual(rows.map(r=>r.id).sort(),[ids.create,ids.publish].sort());
  assert.ok(rows.every(r=>r.status==='committed'));
  const response=await api.page('integrity_offers_v1',{food_id:ids.food,source_id:ids.source});
  assert.equal(response.data.items.length,1);assert.equal(response.data.items[0].food_name,'Potatoes');
  assert.equal(eligible(response.data.items[0],api.now(),'test'),true,'recovered offer must pass the staging consumer visibility filter');
  assert.equal(response.data.items[0].unit,'kg');assert.equal(response.data.items[0].physical_quantity,'20');
  assert.deepEqual(response.data.items[0].price,unknownPrice);
}

test('validated HTTP recovery publishes one 20 kg potato offer with unknown price using the saved operation ID',async t=>{
  const f=await fixture(t);await create(f);
  const draft=await f.store.saveDraft(ids.user,ids.source,f.draft.id,{...f.draft,lotId:ids.lot},f.draft.localVersion);
  const row=await f.outbox.prepare(ids.user,ids.source,'integrity_publish_v2',publicationPayload(draft,ids.source),ids.publish);
  await f.store.put('outbox',ids.user,ids.source,ids.publish,{...row,status:'attention',attempted:true,error:'CONNECTION_UNCONFIRMED'});
  f.beforePublish(async()=>{
    assert.ok(await f.store.get('drafts',ids.user,ids.source,draft.id),'draft must exist until full acknowledgement');
    assert.ok(f.calls.some(c=>c.name==='integrity_operation_v1'&&c.p.operation_id===ids.publish),'uncertain publish must be checked before retry');
  });
  await continueBatchPublication(f.store,f.outbox,draft,options);
  assert.equal(f.calls.filter(c=>c.name==='integrity_create_lot_v1').length,1);
  const publications=f.calls.filter(c=>c.name==='integrity_publish_v2');assert.equal(publications.length,1);
  assert.deepEqual(publications[0].p,JSON.parse(row.payload));
  await assertPublished(f);
});

test('validated HTTP lost create and publication acknowledgements adopt read-only results without duplicating either record',async t=>{
  const f=await fixture(t);f.dropNext('integrity_create_lot_v1');
  await assert.rejects(create(f),/CONNECTION_UNCONFIRMED/);
  const recovered=await recoverBatchDraft(f.store,f.outbox,f.draft,options);
  assert.equal(recovered.draft.lotId,ids.lot);
  assert.equal((await f.store.get('drafts',ids.user,ids.source,f.draft.id)).lotId,ids.lot);
  assert.deepEqual(f.counts(),{lots:1,publications:0});
  f.dropNext('integrity_publish_v2');
  await assert.rejects(continueBatchPublication(f.store,f.outbox,recovered.draft,options),/CONNECTION_UNCONFIRMED/);
  assert.ok(await f.store.get('drafts',ids.user,ids.source,f.draft.id));
  assert.deepEqual(f.counts(),{lots:1,publications:1});
  const result=await continueBatchPublication(f.store,f.outbox,recovered.draft,options);
  assert.equal(result.data.id,ids.offer);
  for(const [name,id] of [['integrity_create_lot_v1',ids.create],['integrity_publish_v2',ids.publish]]){
    const writes=f.calls.filter(c=>c.name===name);assert.equal(writes.length,1);
    assert.equal(writes[0].p.operation_id,id);
    assert.ok(f.calls.some(c=>c.name==='integrity_operation_v1'&&c.p.operation_id===id));
  }
  await assertPublished(f);
});

test('incomplete publication response fails real schema validation and retains the draft until exact committed lookup and read',async t=>{
  const f=await fixture(t);f.malformedNext();
  await assert.rejects(continueBatchPublication(f.store,f.outbox,f.draft,options),/UPDATE_REQUIRED/);
  assert.equal(f.api.incompatible,true);
  assert.ok(await f.store.get('drafts',ids.user,ids.source,f.draft.id));
  assert.notEqual((await f.store.get('outbox',ids.user,ids.source,ids.publish)).status,'committed');
  assert.deepEqual(f.counts(),{lots:1,publications:1});
  // A refreshed client verifies identity/health again, then adopts the original
  // authoritative state through operation lookup plus authorised reads.
  const refreshed=await f.client();
  await continueBatchPublication(f.store,refreshed.outbox,f.draft,options);
  assert.equal(f.calls.filter(c=>c.name==='integrity_publish_v2').length,1);
  await assertPublished(f,refreshed.api);
});

test('known unpublished-lot absence preserves Source selection while genuine permission failures still invoke denial handling',async()=>{
  const memberRequest={source_id:ids.source,offer_id:null,lot_id:ids.lot};
  const cases=[
    {label:'confirmed draft lot is not yet an offer',status:403,message:'NOT_FOUND',request:memberRequest,options:{unpublishedLot:true},denied:0},
    {label:'ordinary missing member offer',status:403,message:'NOT_FOUND',request:memberRequest,options:undefined,denied:1},
    {label:'explicit false does not grant the exception',status:403,message:'NOT_FOUND',request:memberRequest,options:{unpublishedLot:false},denied:1},
    {label:'actual forbidden Source',status:403,message:'FORBIDDEN',request:memberRequest,options:{unpublishedLot:true},denied:1},
    {label:'unauthorised session',status:401,message:'NOT_FOUND',request:memberRequest,options:{unpublishedLot:true},denied:1},
    {label:'an existing offer is not an unpublished lot',status:403,message:'NOT_FOUND',request:{...memberRequest,offer_id:ids.offer},options:{unpublishedLot:true},denied:1},
    {label:'no known lot',status:403,message:'NOT_FOUND',request:{...memberRequest,lot_id:null},options:{unpublishedLot:true},denied:1},
    {label:'operation lookup retains its permission boundary',name:'integrity_operation_v1',status:403,message:'NOT_FOUND',request:{source_id:ids.source,operation_id:ids.publish,action:'integrity_publish_v2'},options:{unpublishedLot:true},denied:1},
  ];
  for(const entry of cases){
    const calls=[],denials=[];
    const api=new IntegrityApi(config,{clock:()=>Date.parse(now),session:()=>({access_token:'controlled-test-session'}),fetcher:async(url,init)=>{
      const name=new URL(url).pathname.split('/').at(-1);
      if(name==='integrity_contract_identity_v1')return Response.json(envelope(identity));
      if(name==='integrity_health_v1')return Response.json(envelope(health));
      calls.push({name,request:JSON.parse(init.body).p_request});
      return Response.json({message:entry.message},{status:entry.status});
    }});
    await api.rpc('integrity_contract_identity_v1',{});await api.rpc('integrity_health_v1',{});
    api.onPermissionDenied=async(...args)=>{denials.push(args);};
    const name=entry.name||'integrity_member_offer_v1';
    await assert.rejects(api.rpc(name,entry.request,entry.options),error=>error.code===entry.message&&error.status===entry.status,entry.label);
    assert.deepEqual(calls,[{name,request:entry.request}],entry.label);
    assert.equal(denials.length,entry.denied,entry.label);
    if(entry.denied)assert.deepEqual(denials[0],[name,entry.request],entry.label);
    assert.equal(api.incompatible,false,entry.label);
    assert.equal(api.identity.integration_ready,true,entry.label);
  }
});
