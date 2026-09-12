import {batchIncomplete,recoverBatchDraft} from './batch-recovery.js';
import {createClient} from '@supabase/supabase-js';
import {CONFIG} from './config.js';
import {IntegrityApi} from './api.js';
import {PrivateStore,Outbox} from './storage.js';
import {Reconciler} from './reconcile.js';
import {el,$,button,message,field,select,check,modal,closeModal,initDialog,empty,facts} from './dom.js';
import {time,priceText,locationText,eligible,claimable,quantity,exportOffers} from './domain.js';
import {sourceScreen,resumeSourceDraft} from './source.js';
import {readPages} from './member-data.js';
import {interestScreen,demandDialog,reviewScreen,claimDetails} from './integration-views.js';
import {installLifecycle} from './pwa.js';

const source=CONFIG.app==='source';
document.body.classList.toggle('source',source);
$('#brand').textContent=source?'PROVISION SOURCE':'PROVISION';
document.title=(source?'Provision Source':'Provision')+' · Staging';
$('#question').textContent=source?'What can you provide today?':'What do you need?';
$('#introText').textContent=source?'Remember yesterday; ask only what changed.':'What a place can provide, with its source and uncertainty in view.';
const state={memberships:[],foods:[],areas:[],demand:[],reviews:[],inboxFilter:'actionable',offerClass:'test',session:null,view:source?'Today':'Offers',generation:0,offers:[],claims:[],notices:[],cursor:null,search:'',sourceId:null,loading:true,error:null,authError:null,mutating:0};
const intentKey=`provision:${CONFIG.app}:staging:${location.pathname}:intent`;
function rememberIntent(type,o){try{sessionStorage.setItem(intentKey,JSON.stringify({type,offerId:o.id,createdAt:Date.now()}));}catch{message('This browser could not retain the intended action. Sign in, then reopen the offer.');}}
const store=new PrivateStore(CONFIG.app),api=new IntegrityApi(CONFIG,{session:()=>state.session});
const outbox=new Outbox(store,api,{identity:()=>state.session?.user.id});
const sb=CONFIG.publishableKey?createClient(CONFIG.url,CONFIG.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,storageKey:`provision-${CONFIG.app}-staging-auth`}}):null;
const ctx={CONFIG,state,store,api,outbox,el,button,message,field,select,check,modal,closeModal,empty,facts,refresh:()=>reconciler.run(),command,requireAuth,guard,authDialog};
api.onPermissionDenied=async(_name,request)=>{if(_name==='integrity_review_queue_v1')return;const user=state.session?.user.id;if(!['integrity_create_lot_v1','integrity_publish_v2','integrity_operation_v1'].includes(_name))closeModal();if(request.source_id&&request.source_id===state.sourceId){state.sourceId=null;state.claims=[];state.memberships=[];if(user)await store.clearServer(user,request.source_id);}$('#workspace').replaceChildren(empty('Access could not be confirmed','Refresh to recheck your current permissions. Your drafts remain on this device.'));};
let channel=null,sourceCleanup=()=>{};
initDialog();
const tabs=source?['Today','Claims','Saved work','Notices','Reviews','Support']:['Offers','My holds','My interest','Saved work','Notices','Reviews','Support'];
for(const tab of tabs)$('#nav').append(button(tab,async()=>{state.view=tab;message('');await reconciler.run();}));
function guard(generation){return generation===state.generation;}
function connection(){
  $('#connection').textContent=!navigator.onLine?'Offline':api.lastSynced?`${state.error?'Last synced':'Connected · synced'} ${time(api.lastSynced)}`:CONFIG.publishableKey?'Not yet synced':'Staging setup pending';
  $('#account').textContent=state.session?'Account':'Sign in';
}
function requireAuth(){if(state.session)return true;authDialog();return false;}
async function command(name,payload,sourceId=null,{operationId=null}={}){
  if(!state.session){authDialog();throw Error('Sign in, then review and submit your action.');}
  const user=state.session.user.id,g=state.generation;
  const row=await outbox.prepare(user,sourceId,name,payload,operationId||payload.operation_id||null);state.mutating++;
  try{const result=await outbox.send(row);if(!guard(g))return null;await revalidateAfterWrite(row);if(!guard(g))return null;await reconciler.run();return result.data;}
  finally{state.mutating--;}
}
async function revalidateAfterWrite(row){
  if(row.name.includes('_claim_')){const payload=JSON.parse(row.payload);if(payload.claim_id)await api.rpc('integrity_claim_detail_v1',{claim_id:payload.claim_id});if(row.source&&source)await api.page('integrity_source_claims_inbox_v1',{source_id:row.source,filter:'actionable'});else await api.page('integrity_my_claims_v1',{});}
  await api.page('integrity_offers_v1',{food_id:null,source_id:row.source||null});
}
async function refresh(){
  if(state.mutating)return null;
  const g=state.generation;connection();
  if(!CONFIG.publishableKey){state.loading=false;state.error='STAGING_SETUP_REQUIRED';await render();return null;}
  try{
    api.identity=null;api.health=null;await api.rpc('integrity_contract_identity_v1',{});
    await api.rpc('integrity_health_v1',{});if(!guard(g))return null;
    const dirs=await Promise.all([readPages(api,'integrity_foods_v1',{search:null},{guard:()=>guard(g)}),readPages(api,'integrity_demand_areas_v1',{search:null},{guard:()=>guard(g)})]);
    if(!guard(g))return null;state.foods=dirs[0].items;state.areas=dirs[1].items;
    if(source&&state.session){const memberships=await readPages(api,'integrity_my_sources_v1',{},{guard:()=>guard(g),key:'source_id'});if(!guard(g))return null;state.memberships=memberships.items;if(state.sourceId&&!state.memberships.some(m=>m.source_id===state.sourceId)){await store.clearServer(state.session.user.id,state.sourceId);state.sourceId=null;state.claims=[];closeModal();}if(!state.sourceId&&state.memberships.length===1)state.sourceId=state.memberships[0].source_id;}
    state.error=null;let next=null;
    if(!source&&state.view==='Offers'){
      const id=new URL(location.href).searchParams.get('source');
      const response=await api.page('integrity_offers_v1',{food_id:null,source_id:id&&/^[0-9a-f-]{36}$/i.test(id)?id:null});
      if(!guard(g))return null;state.offers=response.data.items;state.cursor=response.data.next_cursor;next=response.data.next_expiry_at;
    }
    if(state.session&&['My holds','Claims'].includes(state.view)){
      if(!source||state.sourceId){const response=await api.page(source?'integrity_source_claims_inbox_v1':'integrity_my_claims_v1',source?{source_id:state.sourceId,filter:state.inboxFilter}:{});
      if(!guard(g))return null;state.claims=response.data.items;state.cursor=response.data.next_cursor;next=response.data.next_expiry_at;}
    }
    if(state.session&&state.view==='My interest'){const r=await api.page('integrity_my_demand_v1',{});if(!guard(g))return null;state.demand=r.data.items;state.cursor=r.data.next_cursor;next=r.data.next_expiry_at;}
    if(state.session&&state.view==='Notices'){
      const r=await api.page('integrity_notifications_v1',{});if(!guard(g))return null;state.notices=r.data.items;state.cursor=r.data.next_cursor;next=r.data.next_expiry_at;
    }
    if(!guard(g))return null;state.loading=false;await render();connection();return next||(source&&state.view==='Today'?state.sourceExpiry:null);
  }catch(e){
    if(!guard(g))return null;state.error=e.code||e.message;state.loading=false;
    // No retained private display after a current permission denial.
    if([401,403].includes(e.status)){state.claims=[];state.notices=[];state.demand=[];state.reviews=[];state.memberships=[];sourceCleanup();}
    await render();connection();return null;
  }
}
const reconciler=new Reconciler(refresh,()=>api.now());
async function render(){
  for(const b of $('#nav').children)b.setAttribute('aria-current',b.textContent===state.view?'page':'false');
  const root=$('#workspace');sourceCleanup();sourceCleanup=()=>{};root.replaceChildren();
  if(state.error==='STAGING_SETUP_REQUIRED'){
    root.append(empty('Staging connection is not configured','This preview needs the staging project’s own publishable key. No offers have been loaded and no writes are available.'));
    if(state.view==='Support')support(root);return;
  }
  if(api.incompatible){root.append(empty('Update required','This client could not validate the server contract. Writes are disabled. Your saved work remains on this device.'));return;}
  if(state.error)root.append(empty('Current state could not be confirmed',state.error==='CONNECTION_UNCONFIRMED'?'Check your connection, then refresh. Saved work has been retained.':`Request could not complete (${state.error}). Refresh before trying again.`));
  if(!state.error)message(state.authError||(!['enabled','degraded'].includes(api.health?.write_mode)?'The network is read-only. Your device drafts can still be saved.':api.health?.write_mode==='degraded'?'Staging has limited services. Enabled actions remain available; external delivery is not active.':''),!!state.authError);
  if(source&&state.view==='Today'){sourceCleanup=await sourceScreen(root,ctx);return;}
  if(state.view==='Offers'){renderOffers(root);return;}
  if(state.view==='Support'){support(root);return;}
  if(!state.session){root.append(empty('Your private space','Sign in to see your holds, notices and saved work.'),button('Sign in',authDialog,'primary'));return;}
  if(state.view==='Saved work')return savedWork(root);
  if(state.view==='My interest')return interestScreen(root,ctx);
  if(state.view==='Reviews')return reviewScreen(root,ctx);
  if(['My holds','Claims'].includes(state.view))return renderClaims(root);
  if(state.view==='Notices')return notices(root);
}
function renderOffers(root){
  const bar=el('div',null,{class:'toolbar'}),search=field('Find a food or Source',state.search,'search');
  search.input.addEventListener('input',()=>{state.search=search.input.value;list();});
  bar.append(search.label,el('p','Synthetic test offers · no real collection arrangements',{class:'badge'}),button('Export this page',()=>download('provision-staging-offers.json',exportOffers(state.offers,api.lastSynced,CONFIG.checksum))));
  const cards=el('div',null,{class:'cards'});root.append(bar,cards);
  if(state.session){try{const intent=JSON.parse(sessionStorage.getItem(intentKey));if(intent&&Date.now()-intent.createdAt<1800000){const o=state.offers.find(x=>x.id===intent.offerId);if(o&&eligible(o,api.now(),state.offerClass))root.prepend(button('Continue your '+(intent.type==='claim'?'hold request':'interest'),()=>{sessionStorage.removeItem(intentKey);return intent.type==='claim'?claimForm(o):demandForm(o);}));else root.prepend(el('p','Your earlier offer is not on the current page. Find and review it again before submitting.'));}else sessionStorage.removeItem(intentKey);}catch{/* no automatic action if recovery data is invalid */}}
  function list(){cards.replaceChildren();const offers=state.offers.filter(o=>eligible(o,api.now(),state.offerClass)&&(o.food_name+' '+o.source_name).toLowerCase().includes(state.search.toLowerCase()));
    if(!offers.length){cards.append(empty('No current confirmed offers','Coverage is incomplete. This does not mean the food does not exist locally. This view shows synthetic test offers only. It does not recommend real food or mix test records with live recommendations.'));return;}
    for(const o of offers){const card=el('article',null,{class:'card'}),actions=el('div',null,{class:'actions'});
      card.append(el('p','TEST DATA',{class:'badge'}),el('p',o.source_name,{class:'eyebrow'}),el('h2',o.food_name),el('p',priceText(o.price,o.unit),{class:'price'}),el('p',`${o.pressure.replaceAll('_',' ')} · declared ${time(o.availability_confirmed_at)}`),el('p',o.lifecycle==='ready'?'Ready':`Forthcoming · ${o.lifecycle.replaceAll('_',' ')}`,{class:'badge'}),facts([['Physical stock',`${o.physical_quantity??'Unknown'} ${o.unit}`],['Held',`${o.held_quantity} ${o.unit}`],['Available to claim',`${o.claimable_quantity} ${o.unit}`],['Location',locationText(o)]]));
      actions.append(button('Details & evidence',()=>offerDetails(o)));
      if(claimable(o,api.now(),state.offerClass)&&!state.error&&api.health?.capabilities.claims)actions.append(button('Request a hold',()=>claimForm(o),'primary'));
      actions.append(button('I want this',()=>demandForm(o)));card.append(actions);cards.append(card);
    }
  }list();
  if(state.cursor)root.append(button('Next 50 offers',async()=>{const g=state.generation,r=await api.page('integrity_offers_v1',{food_id:null,source_id:new URL(location.href).searchParams.get('source')||null},state.cursor);if(!guard(g))return;state.offers=r.data.items;state.cursor=r.data.next_cursor;render();}));
}
async function offerDetails(o){
  const content=el('div'),dates=o.physical_dates;
  content.append(facts([['Source',o.source_name],['Data class',o.classification],['Harvested',time(dates.harvested_at)],['Landed',time(dates.landed_at)],['Baked',time(dates.baked_at)],['Packed',time(dates.packed_at)],['Date label',dates.date_type&&dates.date_value?`${dates.date_type.replace('_',' ')} ${dates.date_value} (${dates.date_timezone??'timezone unknown'})`:'Not supplied'],['Handling',dates.handling],['Allergen information',dates.allergen_information],['Collection from',time(o.collection_start)],['Collection until',time(o.collection_end)],['Declaration expires',time(o.listing_expires_at)],['Provenance',o.provenance.label],['Business review',o.provenance.business_control],['Corroboration',o.provenance.corroboration],['Event',o.latest_event_id],['Batch',o.lot_id],['Revision',o.revision]]));
  content.append(button('Copy Source link',()=>navigator.clipboard.writeText(sourceLink(o.source_id))),button('Report a problem',()=>reportForm('offer',o.id)));
  const evidence=el('div');content.append(evidence);const urls=new Set();modal(o.food_name,content,()=>{for(const u of urls)URL.revokeObjectURL(u);});
  if(!api.health?.capabilities.public_evidence){evidence.append(el('p','Public evidence is unavailable.'));return;}
  try{const r=await api.page('integrity_public_evidence_v1',{event_id:o.latest_event_id});if(!content.isConnected)return;
    if(!r.data.items.length)evidence.append(el('p','No public evidence supplied.'));
    for(const item of r.data.items){const e=el('section');e.append(el('h3',item.caption||'Evidence'),facts([['Observed',time(item.declared_observed_at)],['Uploaded',time(item.uploaded_at)],['Status',item.status],['Public sharing',item.public?'Shared':'Private'],['Event',item.event_id]]));
      if(item.public&&item.status==='linked'&&item.media_type!=='application/pdf')e.append(button('Load current image',async()=>{const b=await api.evidence(item.attachment_id);if(!content.isConnected)return;const url=URL.createObjectURL(b);urls.add(url);e.querySelector('img')?.remove();e.append(el('img',null,{src:url,alt:item.caption||'Source evidence',class:'evidence-image'}));}));
      evidence.append(e);
    }
    if(r.data.next_cursor)evidence.append(el('p','Additional evidence exists beyond this page.'));
  }catch{if(content.isConnected)evidence.append(el('p','Evidence access could not be confirmed. It may have been withdrawn.'));}
}
function sourceLink(id){const u=new URL('./',location.href);u.searchParams.set('source',id);u.hash='';return u.href;}
function claimForm(o){
  if(!state.session)rememberIntent('claim',o);if(!requireAuth())return;const content=el('div'),qty=field(`Quantity (${o.unit})`,'1'),start=field('Collection from (your local time)','', 'datetime-local'),end=field('Collection until (your local time)','','datetime-local'),expires=field('Request expires (your local time)','','datetime-local');
  qty.input.inputMode='decimal';
  content.append(el('p',`${o.food_name} · ${priceText(o.price,o.unit)}`),el('p','A request is not a reservation. Wait for an accepted hold before travelling.'),qty.label,start.label,end.label,expires.label,button('Send request',async()=>{
    quantity(qty.input.value,o.unit);const fresh=await api.page('integrity_offers_v1',{food_id:o.food_id,source_id:o.source_id});const current=fresh.data.items.find(x=>x.id===o.id);
    if(!current||current.revision!==o.revision||!claimable(current,api.now(),state.offerClass))throw Error('This offer changed. Close this form and review its current terms.');
    const result=await command('integrity_request_claim_v1',{offer_id:o.id,expected_revision:o.revision,quantity:qty.input.value,collection_start:iso(start.input.value),collection_end:iso(end.input.value),request_expires_at:iso(expires.input.value)},o.source_id);
    if(result){closeModal();state.view='My holds';await reconciler.run();message('Request acknowledged · awaiting Source acceptance.');}
  },'primary'));modal('Request a hold',content);
}
function demandForm(o){if(!state.session)rememberIntent('demand',o);if(!requireAuth())return;return demandDialog(o,ctx);}
async function renderClaims(root){
  root.append(el('h2',source?'Claims inbox':'My holds'));
  if(source&&!state.sourceId){root.append(empty('Select a Source first','Open Today to select an available Source.'));return;}
  if(source){const filter=select('Claims to show',['actionable','all','requested','accepted','declined','cancelled','expired','collected','source_unfulfillable'],state.inboxFilter);filter.input.addEventListener('change',()=>{state.inboxFilter=filter.input.value;state.cursor=null;reconciler.run();});root.append(filter.label);}
  if(!state.claims.length)root.append(empty('No claims on this page','Holds are queried independently of public listings, including expired or fully held offers.'));
  for(const c of state.claims){const card=el('article',null,{class:'card'}),t=c.terms,active=['accepted','requested'].includes(c.status);
    card.append(el('h3',`${t.quantity} ${t.unit} · ${c.status.replaceAll('_',' ')}`),el('p',priceText(t.price,t.unit)),facts([['Collection reference',c.collection_reference],['Collection from',time(t.collection_start)],['Collection until',time(t.collection_end)],['Hold until',time(t.hold_until)],['Request expires',time(t.requested_until)],['Source reference',c.source_id]]));
    if(c.status==='requested')card.append(el('p','Awaiting acceptance. Do not travel on this request.'));
    card.append(button('Food, Source & collection details',()=>claimDetails(c,ctx)));
    if(!source&&active)card.append(button('Cancel',()=>command('integrity_cancel_claim_v1',{claim_id:c.id,expected_claim_revision:c.revision,reason:null},c.source_id)));
    if(source&&active&&state.memberships.some(m=>m.source_id===c.source_id&&m.role!=='viewer')){const actions=el('div',null,{class:'actions'});
      if(c.status==='requested')actions.append(button('Accept',()=>claimAction(c,true)),button('Decline',()=>claimAction(c,false)));
      if(c.status==='accepted')actions.append(button('Mark fully collected',()=>collect(c)));
      actions.append(button('Cannot fulfil',()=>reasonForm('Cannot fulfil this hold',reason=>command('integrity_source_cancel_claim_v1',{source_id:c.source_id,claim_id:c.id,expected_claim_revision:c.revision,reason},c.source_id))));card.append(actions);
    }root.append(card);
  }
  if(state.cursor)root.append(button('Next claims',async()=>{const g=state.generation;let r;try{r=await api.page(source?'integrity_source_claims_inbox_v1':'integrity_my_claims_v1',source?{source_id:state.sourceId,filter:state.inboxFilter}:{},state.cursor);}catch(e){if(e.code==='INVALID_CURSOR'){state.cursor=null;await reconciler.run();message('The inbox changed. Showing the first page again.');return;}throw e;}if(!guard(g))return;state.claims=r.data.items;state.cursor=r.data.next_cursor;render();}));
}
async function currentOfferForClaim(c){return (await api.rpc('integrity_member_offer_v1',{source_id:c.source_id,offer_id:c.terms.offer_id,lot_id:null})).data;}
async function claimAction(c,accept){const o=await currentOfferForClaim(c);const content=el('div'),hold=field('Hold until (your local time)','','datetime-local'),reason=field('Reason (optional)');content.append(el('p',`${accept?'Accept':'Decline'} ${c.terms.quantity} ${c.terms.unit}. Current offer revision ${o.revision}.`));if(accept)content.append(hold.label);content.append(reason.label,button('Confirm',async()=>{const d=await command('integrity_respond_claim_v1',{source_id:c.source_id,claim_id:c.id,expected_offer_revision:o.revision,expected_claim_revision:c.revision,accept,hold_until:accept?iso(hold.input.value):null,reason:reason.input.value||null},c.source_id);if(d)closeModal();},'primary'));modal(accept?'Accept request':'Decline request',content);}
async function collect(c){const o=await currentOfferForClaim(c),content=el('div');content.append(el('p',`Confirm physical collection of all ${c.terms.quantity} ${c.terms.unit}. Partial collection is unavailable.`),button('Confirm collection',async()=>{const d=await command('integrity_collect_claim_v1',{source_id:c.source_id,claim_id:c.id,expected_offer_revision:o.revision,expected_claim_revision:c.revision,quantity:c.terms.quantity},c.source_id);if(d){closeModal();message(`Collection acknowledged. Server physical stock: ${d.offer.physical_quantity} ${d.offer.unit}.`);}},'primary'));modal('Complete collection',content);}
async function notices(root){
  root.append(el('h2','Notices'),el('p','In-app history is separate from email delivery. External delivery is not configured in staging.'));
  for(const n of state.notices){const c=el('article',null,{class:'card'});c.append(el('h3',n.kind.replaceAll('_',' ')),el('p',time(n.created_at)),el('p',`Email status: ${n.delivery.replaceAll('_',' ')}`));if(!n.read_at)c.append(button('Mark read',()=>command('integrity_mark_notification_v1',{notification_id:n.id})));root.append(c);}
  if(!state.notices.length)root.append(empty('No notices on this page','Check again after an acknowledged claim action.'));
  if(state.cursor)root.append(button('Next notices',async()=>{const g=state.generation,r=await api.page('integrity_notifications_v1',{},state.cursor);if(!guard(g))return;state.notices=r.data.items;state.cursor=r.data.next_cursor;render();}));
}
async function savedWork(root){
  const g=state.generation,rows=await store.list('outbox',state.session.user.id);if(!guard(g))return;
  root.append(el('h2','Saved work'),el('p','Nothing publishes automatically after reconnecting. Retry keeps the original operation and payload.'));
  const drafts=await store.list('drafts',state.session.user.id);if(!guard(g))return;
  for(const d of drafts){const c=el('article',null,{class:'card'});c.append(el('h3',d.foodName||'Saved batch'),el('p',batchIncomplete(d)?'Batch created · publication not completed':'Saved on this device · unpublished draft'),el('p','Your draft is safe.'));if(source)c.append(button(batchIncomplete(d)?'Continue publication':'Resume saved draft',()=>resumeSourceDraft(d,ctx)));root.append(c);}
  for(const row of rows){const c=el('article',null,{class:'card'}),labels={saved:'Saved on this device',sending:'Sending / acknowledgement unresolved',published:'Published',attention:'Needs attention'};
    c.append(el('h3',row.name.replace('integrity_','').replace('_v1','').replaceAll('_',' ')),el('p',row.safeToRetry?'Server check: not committed · safe to retry the same operation':labels[row.status]||row.status),el('p',row.error||'',{class:'muted'}));
    const detail=el('details'),summary=el('summary','Review exact saved operation');detail.append(summary,el('pre',row.payload));c.append(detail);
    if(row.status!=='published')c.append(button('Check server acknowledgement',async()=>{
      state.mutating++;
      try{const checked=await outbox.reconcile(row);if(!guard(g))return;
        for(const d of drafts.filter(d=>d.source===row.source&&[d.createId,d.publishId].includes(row.id)))await recoverBatchDraft(store,outbox,d,{user:row.user,source:row.source,guard:()=>guard(g),checkServer:false});
        message(checked.status==='published'?'Server acknowledgement recovered.':checked.safeToRetry?'No committed operation found. The same saved operation is safe to retry.':'The server has not confirmed this operation. Your draft is safe.');
      }finally{state.mutating--;await reconciler.run();}
    }));
    if(['saved','sending','attention'].includes(row.status))c.append(button('Review & retry',async()=>{const box=el('div');box.append(el('p','Check the current stock and terms before sending an operation that has not previously been attempted. An attempted operation is replayed exactly to resolve its acknowledgement.'),el('pre',row.payload),button('Send this exact operation',async()=>{state.mutating++;try{await outbox.send(row,{reviewed:true});if(!guard(g))return;for(const d of drafts.filter(d=>d.source===row.source&&[d.createId,d.publishId].includes(row.id)))await recoverBatchDraft(store,outbox,d,{user:row.user,source:row.source,guard:()=>guard(g),checkServer:false});await revalidateAfterWrite(row);if(!guard(g))return;closeModal();await reconciler.run();message('Operation acknowledged. Current state has been revalidated.');}finally{state.mutating--;await reconciler.run();}},'primary'));modal('Review saved work',box);}));
    root.append(c);
  }
  if(!rows.length)root.append(empty('No outbound operations on this device','Source drafts are retained separately from acknowledged server state.'));
}
function reportForm(targetType,targetId){if(!requireAuth())return;const content=el('div'),category=select('Problem',['safety','identity','accuracy','privacy','other']),reason=field('What happened?','','textarea');content.append(el('p','A submitted report is an allegation awaiting review.'),category.label,reason.label,button('Submit report',async()=>{if(!reason.input.value.trim())throw Error('Describe the problem.');const d=await command('integrity_report_v1',{target_type:targetType,target_id:targetId,category:category.input.value,reason:reason.input.value});if(d){closeModal();message('Report submitted for review.');}},'primary'));modal('Report a problem',content);}
function reasonForm(title,action){const box=el('div'),reason=field('Reason','','textarea');box.append(reason.label,button('Confirm',async()=>{if(!reason.input.value.trim())throw Error('Add a reason.');await action(reason.input.value);closeModal();},'primary'));modal(title,box);}
function support(root){root.append(el('h2','Help & support'),el('p','Use “Report a problem” on an offer to submit a concern. A review decision and an appeal are separate steps.'),el('p','No external support contact has been supplied for this staging preview. No real email or push notification is promised.'),el('p','Installation: Android Chrome may offer Install app. On iPhone, open in Safari, choose Share, then Add to Home Screen. This staging installation is separate from the live app.'));
  if(state.session)root.append(button('Check protected operator health',async()=>{const r=await api.rpc('integrity_operator_health_v1',{});modal('Operator health',el('pre',JSON.stringify(r.data,null,2)));}));
}
function iso(value){const d=new Date(value);if(!value||Number.isNaN(+d))throw Error('Provide each requested date and time.');return d.toISOString();}
function download(name,data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a',null,{href:u,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function authDialog(){
  if(!sb){message('Staging authentication is awaiting project configuration.');return;}
  if(state.session){const content=el('div');content.append(el('p',state.session.user.email||'Signed in'),el('p','Unsent private drafts and files remain on this device, scoped to this account. They are not submitted under another account. Signing out clears the current private display.'),button('Sign out and keep my unsent work',async()=>{if(state.mutating)throw Error('Wait for the current send to settle before signing out.');const {error}=await sb.auth.signOut();if(error)throw Error('Sign-out could not be confirmed. Try again.');closeModal();}));modal('Your account',content);return;}
  const content=el('div'),email=field('Approved synthetic account email','','email'),password=field('Password','','password');email.input.autocomplete='username';password.input.autocomplete='current-password';
  content.append(el('p','Controlled staging test access only. Public signup and external email delivery are not enabled.'),email.label,password.label,button('Sign in',async()=>{const {error}=await sb.auth.signInWithPassword({email:email.input.value,password:password.input.value});password.input.value='';if(error)throw Error('Sign-in failed. Check the approved test account.');closeModal();},'primary'));modal('Staging sign-in',content);
}
function sessionChanged(session){
  const changed=state.session?.user.id!==session?.user.id;state.session=session;if(session)state.authError=null;
  if(changed){state.generation++;state.claims=[];state.notices=[];state.demand=[];state.reviews=[];state.memberships=[];state.sourceId=null;state.cursor=null;closeModal();sourceCleanup();$('#workspace').replaceChildren();}
  if(changed&&!session){try{sessionStorage.removeItem(intentKey);}catch{}}
  connection();setTimeout(()=>reconciler.run(),0);
}
async function boot(){
  $('#account').addEventListener('click',authDialog);$('#refresh').addEventListener('click',()=>reconciler.run());
  window.addEventListener('online',()=>reconciler.hint());window.addEventListener('offline',()=>{state.error='CONNECTION_UNCONFIRMED';connection();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){reconciler.hint();}else{for(const img of document.querySelectorAll('.evidence-image')){URL.revokeObjectURL(img.src);img.remove();}reconciler.schedule();}});
  window.addEventListener('pageshow',event=>{if(event.persisted){reconciler.stopped=false;reconciler.hint();}});
  installLifecycle({busy:()=>state.mutating>0});
  if(sb){
    // Synchronous callback: no nested Supabase calls and no awaited promise.
    sb.auth.onAuthStateChange((_event,session)=>sessionChanged(session));
    const url=new URL(location.href),code=url.searchParams.get('code'),authError=url.searchParams.get('error_description');
    if(code||url.hash.includes('access_token')||authError){
      const clean=new URL('./',location.href);if(url.searchParams.has('source'))clean.searchParams.set('source',url.searchParams.get('source'));history.replaceState(null,'',clean);
      if(code){const {error}=await sb.auth.exchangeCodeForSession(code);if(error)state.authError='This sign-in link expired or was opened in another browser. Return to the initiating browser or sign in again.';}
      else state.authError='This authentication link cannot be used here. Sign in again in this browser.';
    }
    const {data:{session}}=await sb.auth.getSession();sessionChanged(session);
    channel=sb.channel(`integrity-${CONFIG.app}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'integrity_change'},()=>reconciler.hint()).subscribe();
  }
  await reconciler.run();
}
window.addEventListener('pagehide',()=>{reconciler.stop();if(channel)sb.removeChannel(channel);});
boot().catch(e=>message(e.message,true));
