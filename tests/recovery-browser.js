// Internal HTTP preview lacks secure-context UUID/locks; this fixture uses deterministic IDs and an injected serial lock. Hosted HTTPS uses native APIs.
if(!crypto.randomUUID)crypto.randomUUID=()=>`99999999-9999-4999-8999-${Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join('')}`;
import {PrivateStore,Outbox} from '../staging/src/storage.js';
import {publicationPayload} from '../staging/src/batch-recovery.js';
import {resumeSourceDraft} from '../staging/src/source.js';
import {el,button,message,initDialog} from '../staging/src/dom.js';
import {emptyDates} from '../staging/src/domain.js';
const user='fixture-owner',source='11111111-1111-4111-8111-111111111111',foodId='22222222-2222-4222-8222-222222222222',lotId='33333333-3333-4333-8333-333333333333';
const wrap=data=>({contract_version:'1.0.0-draft.1',server_time:new Date().toISOString(),data});
let store,outbox,draft,ctx,lots,pubs,lookups,commands,failFirst,results;
initDialog();
function proof(){document.querySelector('#proof').textContent=`Batches: ${lots} · Publications: ${pubs} · Operation checks: ${lookups}`;}
async function setup(partial){
 store=new PrivateStore('browser-fixture-'+crypto.randomUUID());lots=partial?1:0;pubs=0;lookups=0;commands=[];results=new Map();failFirst=partial;
 const state={session:{user:{id:user}},sourceId:source,generation:0,mutating:0,memberships:[{source_id:source,role:'owner',active:true}],foods:[{id:foodId,name:'Potatoes',default_unit:'kg',units:[{unit:'kg',increment:'0.001'}]}]};
 const api={now:()=>Date.now(),validate(){},async rpc(n,p){
  if(n==='integrity_member_offer_v1'){const e=Error('NOT_FOUND');e.code='NOT_FOUND';throw e;}
  if(n==='integrity_operation_v1'){lookups++;proof();const r=results.get(p.operation_id);return wrap(r?{operation_id:p.operation_id,action:p.action,status:'committed'}:null);}
  if(results.has(p.operation_id))return results.get(p.operation_id);
  if(n==='integrity_create_lot_v1'){lots++;const r=wrap({lot_id:lotId,revision:0});results.set(p.operation_id,r);proof();return r;}
  if(n==='integrity_publish_v2'){commands.push(p.operation_id);if(failFirst){failFirst=false;throw Error('Simulated connection loss. Continue publication to retry the original operation.');}pubs++;const r=wrap({id:'44444444-4444-4444-8444-444444444444',lot_id:lotId,revision:1});results.set(p.operation_id,r);proof();return r;}
 }};
 outbox=new Outbox(store,api,{identity:()=>user,lock:{request:async(_key,fn)=>fn()}});
 draft=await store.saveDraft(user,source,'draft',{createId:crypto.randomUUID(),publishId:crypto.randomUUID(),lotId:partial?lotId:null,baseRevision:0,foodName:'Potatoes',form:{foodId,unit:'kg',quantity:'20',price:{status:'free',amount:'0',currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null},lifecycle:'ready',pressure:'normal',visibility:'public',reservable:false,listingExpiresAt:partial?new Date(Date.now()+86400000).toISOString():null,collectionStart:null,collectionEnd:null,note:'',noteTouched:false,dates:emptyDates()}},0);
 if(partial){const row=await outbox.prepare(user,source,'integrity_publish_v2',publicationPayload(draft,source),draft.publishId);await store.put('outbox',user,source,row.id,{...row,status:'attention',attempted:true,error:'INVALID_REQUEST'});}
 ctx={state,store,outbox,api,CONFIG:{},guard:g=>g===state.generation,refresh:async()=>{const d=await store.get('drafts',user,source,draft.id);const root=document.querySelector('#workspace');root.replaceChildren();if(d)root.append(el('h3',d.lotId?'Batch created · publication not completed':'Unpublished draft'),el('p','Your draft is safe.'),button(d.lotId?'Continue publication':'Resume draft',()=>resumeSourceDraft(d,ctx)));else root.append(el('h3','Consumer offer: Potatoes'),el('p',`20 kg · ${pubs} publication · ${new Set(commands).size} publication operation ID · draft cleared after acknowledgement`));proof();}};
 await ctx.refresh();
}
document.querySelector('#partial').onclick=()=>setup(true);document.querySelector('#validation').onclick=()=>setup(false);
await setup(true);
