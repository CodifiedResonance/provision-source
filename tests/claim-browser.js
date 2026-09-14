// Only this HTTP test harness supplies UUIDs and serial locks; deployed HTTPS uses native APIs.
if(!crypto.randomUUID)crypto.randomUUID=()=>`99999999-9999-4999-8999-${Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join('')}`;
const queues=new Map(),locks={request(key,fn){const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,next);return next;}};
import {claimFixture,ids} from './claim-fixture.js';
import {el,button,initDialog} from '../staging/src/dom.js';
import {acceptanceModal,collectionModal,failedAcceptanceCard,personalClaimSection,sourceAttention} from '../staging/src/claim-ui.js';
import {stockText,claimIntent} from '../staging/src/claim-journey.js';
initDialog();let f,ctx;
async function render(){const c=f.claim(),root=document.querySelector('#workspace');root.replaceChildren();if(c.status==='requested')root.append(sourceAttention([c],{[c.id]:'Potatoes'},ctx));root.append(el('h2','Consumer offer · Potatoes'),el('p',stockText(f.offer)),...(['requested','accepted'].includes(c.status)?[personalClaimSection(c,ctx)]:[]),el('h2','My holds'),el('p',`${c.terms.quantity}kg Potatoes · ${c.status}`),button(claimIntent.demand.label,()=>{}),el('p',claimIntent.demand.help));if(c.status==='accepted')root.append(button('Mark fully collected',()=>collectionModal(c,ctx)));await proof();}
async function proof(){const rows=await f.store.list('outbox',ids.user);document.querySelector('#proof').textContent=JSON.stringify({claim:f.claim().status,stock:stockText(f.offer),states:rows.map(r=>r.status),acceptDispatches:f.calls.filter(c=>c.name==='integrity_respond_claim_v1').length,collectionDispatches:f.calls.filter(c=>c.name==='integrity_collect_claim_v1').length});}
async function start(){f=await claimFixture(indexedDB,locks);await f.request();ctx={api:f.api,store:f.store,outbox:f.outbox,state:{session:{user:{id:ids.user}},generation:0,mutating:0,memberships:[{source_id:ids.source,role:'owner'}]},guard:()=>true,refresh:render,command:async(n,p)=>{const r=await f.outbox.send(await f.prepare(n,p));await proof();return r.data;}};await render();}
document.querySelector('#reset').onclick=start;
document.querySelector('#reject').onclick=()=>{f.reject('INVALID_COLLECTION_WINDOW');document.querySelector('#proof').textContent='Next acceptance will receive a deterministic rejection';};
document.querySelector('#lose').onclick=()=>{f.loss('after');document.querySelector('#proof').textContent='Next response will be lost after commitment';};
document.querySelector('#saved').onclick=async()=>{const root=document.querySelector('#workspace');root.replaceChildren();for(const row of await f.store.list('outbox',ids.user))if(row.status==='rejected')root.append(await failedAcceptanceCard(row,ctx));await proof();};
await start();
