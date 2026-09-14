// Controlled transport only: never contacts Supabase or creates staging records.
import {IntegrityApi} from '../staging/src/api.js';
import {PrivateStore,Outbox} from '../staging/src/storage.js';
import operations from '../staging/src/operations.json' with {type:'json'};
export const ids=Object.fromEntries(['user','source','food','lot','offer','claim','event'].map((k,i)=>[k,`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
export const now='2026-09-14T16:00:00.000Z',start='2026-09-14T15:57:00.000Z',end='2026-09-15T14:57:00.000Z';
export const config={url:'https://qaaskvbhssonbktdjdki.supabase.co',project:'qaaskvbhssonbktdjdki',publishableKey:'controlled-test-key',contractVersion:'1.0.0-draft.1',revision:'staging-20260910.1',checksum:'f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad'};
const envelope=data=>({contract_version:config.contractVersion,server_time:now,data:structuredClone(data)});
const price={status:'unknown',amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null};
export async function claimFixture(dbFactory,lock=globalThis.navigator?.locks){
 const store=new PrivateStore('claim-fixture-'+crypto.randomUUID(),dbFactory),calls=[],committed=new Map();let claim=null,loss=null,forcedError=null,lookup='normal';
 const offer={id:ids.offer,source_id:ids.source,source_slug:'controlled-fixture',source_name:'Controlled Source',food_id:ids.food,food_name:'Potatoes',lot_id:ids.lot,legacy_identity:null,latest_event_id:ids.event,revision:1,classification:'test',lifecycle:'ready',pressure:'normal',visibility:'public',reservable:true,withdrawal_state:'clear',source_active:true,physical_quantity:'20',held_quantity:'0',claimable_quantity:'20',shortfall_quantity:'0',unit:'kg',price,availability_confirmed_at:now,received_at:now,listing_expires_at:'2026-09-16T19:50:00.000Z',collection_start:start,collection_end:end,next_expiry_at:end,physical_dates:{harvested_at:null,landed_at:null,baked_at:null,packed_at:null,date_type:null,date_value:null,date_timezone:null,handling:null,allergen_information:null},provenance:{truth_class:'declared',channel:'source_direct',business_control:'approved',corroboration:'none',label:'Declared by source'},latitude:null,longitude:null};
 const error=code=>Response.json({code:['REVISION_CONFLICT','INSUFFICIENT_STOCK','INVALID_TRANSITION'].includes(code)?'PT409':'PT400',message:code,details:null,hint:null},{status:['REVISION_CONFLICT','INSUFFICIENT_STOCK','INVALID_TRANSITION'].includes(code)?409:400});
 const page=items=>Response.json(envelope({items,next_cursor:null,next_expiry_at:end}));
 const fetcher=async(url,init)=>{
  const name=new URL(url).pathname.split('/').at(-1),p=JSON.parse(init.body).p_request;calls.push({name,p:structuredClone(p)});
  if(name==='integrity_contract_identity_v1')return Response.json(envelope({project_ref:config.project,document_revision:config.revision,contract_sha256:config.checksum,integration_ready:true,capabilities:Object.keys(operations)}));
  if(name==='integrity_health_v1')return Response.json(envelope({contract_version:config.contractVersion,server_time:now,write_mode:'degraded',capabilities:{claims:true,evidence_upload:true,public_evidence:true,demand_capture:true,demand_summary:false,notifications:true,integrations:false}}));
  if(name==='integrity_operation_v1'){if(lookup==='error')throw Error('Lost lookup response');const r=committed.get(p.operation_id);return Response.json(envelope(lookup==='pending'?{operation_id:p.operation_id,action:p.action,status:'pending',record_id:null,revision:null,committed_at:null,error_code:null}:r?{operation_id:p.operation_id,action:r.name,status:'committed',record_id:ids.claim,revision:r.result.data.claim?.revision??r.result.data.revision,committed_at:now,error_code:null}:null));}
  if(name==='integrity_member_offer_v1')return Response.json(envelope({...offer,note:null}));
  if(name==='integrity_offers_v1')return page([offer]);
  if(name==='integrity_my_claims_v1')return page(claim?[claim]:[]);
  if(name==='integrity_source_claims_inbox_v1')return page(claim&&(p.filter==='all'||p.filter===claim.status||p.filter==='actionable'&&['requested','accepted'].includes(claim.status))?[claim]:[]);
  if(name==='integrity_claim_detail_v1')return Response.json(envelope({claim,food_name:'Potatoes',source_name:'Controlled Source',source_active:true,contact:{public_email:null,public_phone:null,contact_url:null,collection_notes:'Synthetic only',address_line:null,locality:null,postcode:null}}));
  if(loss==='before'){loss=null;throw Error('Request did not reach the server');}
  if(forcedError){const code=forcedError;forcedError=null;return error(code);}
  if(committed.has(p.operation_id)){const r=committed.get(p.operation_id);if(JSON.stringify(r.p)!==JSON.stringify(p))return error('OPERATION_PAYLOAD_MISMATCH');return Response.json(r.result);}
  let data;
  if(name==='integrity_request_claim_v1'){
   claim={id:ids.claim,source_id:ids.source,revision:0,status:'requested',terms:{offer_id:ids.offer,lot_id:ids.lot,offer_revision:p.expected_revision,quantity:p.quantity,unit:'kg',price,collection_start:p.collection_start,collection_end:p.collection_end,requested_until:p.request_expires_at,hold_until:null},collection_reference:'TEST-COLLECT-001',created_at:now,responded_at:null,collected_at:null,reason_code:null,next_expiry_at:end};data=claim;
  }else if(name==='integrity_respond_claim_v1'){
   if(p.accept&&(Date.parse(p.hold_until)<=Math.max(Date.parse(now),Date.parse(claim.terms.collection_start))||Date.parse(p.hold_until)>Date.parse(claim.terms.collection_end)))return error('INVALID_COLLECTION_WINDOW');
   if(claim.status!=='requested')return error('INVALID_TRANSITION');
   if(p.expected_claim_revision!==claim.revision||p.expected_offer_revision!==offer.revision)return error('REVISION_CONFLICT');
   claim.status=p.accept?'accepted':'declined';claim.revision++;claim.responded_at=now;claim.terms.hold_until=p.hold_until;
   if(p.accept){offer.held_quantity='1';offer.claimable_quantity='19';offer.revision++;}data=claim;
  }else if(name==='integrity_collect_claim_v1'){
   if(claim.status!=='accepted')return error('INVALID_TRANSITION');
   if(p.expected_claim_revision!==claim.revision||p.expected_offer_revision!==offer.revision)return error('REVISION_CONFLICT');
   claim.status='collected';claim.revision++;claim.collected_at=now;offer.physical_quantity='19';offer.held_quantity='0';offer.claimable_quantity='19';offer.revision++;data={claim,offer,movement_event_id:ids.event};
  }else if(name==='integrity_cancel_claim_v1'){claim.status='cancelled';claim.revision++;data=claim;}
  else throw Error('Unexpected controlled operation: '+name);
  const result=envelope(data);committed.set(p.operation_id,{name,p:structuredClone(p),result});if(loss==='after'){loss=null;throw Error('Response lost after commit');}return Response.json(result);
 };
 const api=new IntegrityApi(config,{fetcher,session:()=>({access_token:'controlled-fixture-session'}),clock:()=>Date.parse(now)});
 await api.rpc('integrity_contract_identity_v1',{});await api.rpc('integrity_health_v1',{});
 const outbox=new Outbox(store,api,{identity:()=>ids.user,lock});
 const prepare=(name,p)=>outbox.prepare(ids.user,ids.source,name,p);
 return {api,store,outbox,prepare,calls,committed,offer,claim:()=>claim,loss:value=>{loss=value;},reject:code=>{forcedError=code;},lookup:value=>{lookup=value;},request:async()=>{const row=await prepare('integrity_request_claim_v1',{offer_id:ids.offer,expected_revision:offer.revision,quantity:'1',collection_start:start,collection_end:end,request_expires_at:end});return (await outbox.send(row)).data;},acceptPayload:()=>({source_id:ids.source,claim_id:ids.claim,expected_offer_revision:offer.revision,expected_claim_revision:claim.revision,accept:true,hold_until:end,reason:null}),collectPayload:()=>({source_id:ids.source,claim_id:ids.claim,expected_offer_revision:offer.revision,expected_claim_revision:claim.revision,quantity:'1'})};
}
