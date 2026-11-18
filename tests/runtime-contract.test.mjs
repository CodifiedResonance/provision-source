import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IntegrityApi} from '../staging/src/api.js';
import {mergePlan} from '../staging/src/draft-merge.js';
import operations from '../staging/src/operations.json' with {type:'json'};
const config={url:'https://qaaskvbhssonbktdjdki.supabase.co',project:'qaaskvbhssonbktdjdki',publishableKey:'test-key',contractVersion:'1.0.0-draft.1',revision:'staging-20260910.1',checksum:'f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad'};
const identity={project_ref:config.project,document_revision:config.revision,contract_sha256:config.checksum,integration_ready:true,capabilities:Object.keys(operations)};
const wrap=data=>({contract_version:config.contractVersion,server_time:'2026-09-10T12:00:00Z',data});
const health={contract_version:config.contractVersion,server_time:'2026-09-10T12:00:00Z',write_mode:'degraded',capabilities:{claims:true,evidence_upload:true,public_evidence:true,demand_capture:true,demand_summary:false,notifications:true,integrations:false}};
const id='11111111-1111-4111-8111-111111111111';
const demand={operation_id:id,food_id:id,area_id:'test-area-a',area_confirmed:true,quantity:'3',unit:'kg',cadence:'weekly',expires_at:'2026-09-20T12:00:00Z'};
test('runtime revision, hash, project, readiness and all 56 capabilities bind the client',async()=>{
 for(const patch of [{},{document_revision:'other'},{contract_sha256:'0'.repeat(64)},{project_ref:'wrong'},{integration_ready:false},{capabilities:identity.capabilities.slice(1)}]){
  const api=new IntegrityApi(config,{fetcher:async()=>Response.json(wrap({...identity,...patch}))});
  if(Object.keys(patch).length){await assert.rejects(api.rpc('integrity_contract_identity_v1',{}),/UPDATE_REQUIRED/);assert.equal(api.identity,null);assert.equal(api.incompatible,true);}
  else {await api.rpc('integrity_contract_identity_v1',{});assert.equal(api.identity.capabilities.length,56);}
 }
});
test('a public directory cannot run before runtime identity is verified',async()=>{
 let fetched=false;const api=new IntegrityApi(config,{fetcher:async()=>{fetched=true;}});
 await assert.rejects(api.page('integrity_foods_v1',{search:null}),/RUNTIME_NOT_VERIFIED/);assert.equal(fetched,false);
});
test('degraded mode permits enabled demand; disabled feature or write mode blocks sending',async()=>{
 let fetched=0;const api=new IntegrityApi(config,{session:()=>({access_token:'test'}),fetcher:async()=>{fetched++;throw Error('Expected mock network failure');}});
 api.identity=identity;api.health=structuredClone(health);
 await assert.rejects(api.rpc('integrity_save_demand_v1',demand),/CONNECTION_UNCONFIRMED/);assert.equal(fetched,1);
 api.health.capabilities.demand_capture=false;await assert.rejects(api.rpc('integrity_save_demand_v1',demand),/CAPABILITY_DISABLED/);assert.equal(fetched,1);
 api.health.write_mode='disabled';await assert.rejects(api.rpc('integrity_save_demand_v1',demand),/READ_ONLY/);assert.equal(fetched,1);
});
test('publish v2 accepts omitted, cleared and replaced note without changing v1',()=>{
 const api=new IntegrityApi(config),contract=JSON.parse(readFileSync('contract/provision-integrity-api-v1.json'));
 const v2=contract.operations.find(o=>o.name==='integrity_publish_v2').request_schema;
 assert.equal(v2.required.includes('note'),false);assert.ok(v2.properties.note);
 const p={operation_id:id,source_id:id,lot_id:id,expected_revision:0,physical_quantity:'3',price:{status:'unknown',amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null},lifecycle:'ready',pressure:'normal',visibility:'public',reservable:true,listing_expires_at:'2026-09-20T12:00:00Z',collection_start:null,collection_end:null};
 for(const extra of [{},{note:null},{note:'Revised'}])api.validate('integrity_publish_v2','request',{...p,...extra});
 assert.throws(()=>api.validate('integrity_publish_v1','request',p),/INVALID_REQUEST/);
 api.validate('integrity_publish_v1','request',{...p,note:null});
});
test('merge keeps nonconflicting edits and requires explicit conflicting stock and note choices',()=>{
 const base={quantity:'20',note:'Original',visibility:'public',lifecycle:'ready'},local={...base,quantity:'17',note:'Local'},server={...base,quantity:'20',note:'Server',visibility:'private'};
 const rows=Object.fromEntries(mergePlan(base,local,server).map(r=>[r.key,r]));
 assert.equal(rows.quantity.choice,null);assert.equal(rows.note.choice,null);assert.equal(rows.visibility.choice,'server');
 assert.equal(mergePlan(base,{...base,note:'Local'},base).find(r=>r.key==='note').choice,'local');
 assert.equal(mergePlan(null,local,server).find(r=>r.key==='note').choice,null);
});
