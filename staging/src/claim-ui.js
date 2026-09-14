import {el,button,field,modal,closeModal,facts,fieldError} from './dom.js';
import {priceText} from './domain.js';
import {claimDetails} from './integration-views.js';
import {claimTime as time,holdBounds,holdError,localDate,stockText,rejectionReason,acceptanceContext,currentClaim} from './claim-journey.js';
const windowText=c=>`${time(c.terms.collection_start)} → ${time(c.terms.collection_end)}`;
export async function acceptanceModal(input,ctx,{failed=null,replace=false,accept=true}={}){
 const {state,api,store,outbox}=ctx,user=state.session?.user.id,g=state.generation;
 const check=()=>{if(!ctx.guard(g)||state.session?.user.id!==user)throw Error('Account changed. Reopen the request.');};
 const current=await acceptanceContext(api,input.id);check();const {claim,offer,detail}=current,t=claim.terms;
 if(!failed){failed=(await store.list('outbox',user,claim.source_id)).find(r=>r.name==='integrity_respond_claim_v1'&&!['closed','committed'].includes(r.status)&&JSON.parse(r.payload).claim_id===claim.id);}
 if(failed&&replace){await outbox.close(failed);check();failed=null;}
 const box=el('div'),hold=field('Hold until',localDate(t.collection_end),'datetime-local'),reason=field('Reason (optional)'),status=el('p','Nothing changes until you confirm.',{role:'status'}),problem=el('div'),actions=el('div',null,{class:'actions'});
 const bounds=holdBounds(claim,api.now());hold.input.min=localDate(new Date(Math.floor(bounds.start/1000)*1000+1000).toISOString());hold.input.max=localDate(t.collection_end);hold.input.step='1';
 box.append(el('p',`Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`),el('h3',`${t.quantity}${t.unit} ${detail.food_name}`),facts([['Requested collection',windowText(claim)],['Frozen price',priceText(t.price,t.unit)]]));if(accept)box.append(hold.label);box.append(reason.label,status,problem,actions);
 let attempt=failed;
 const submit=button(accept?`Accept & hold ${t.quantity}${t.unit}`:'Decline request',async()=>{
  check();problem.replaceChildren();
  if(accept){const error=holdError(hold.input.value,claim,api.now());if(error)fieldError(hold,error);}
  const payload={source_id:claim.source_id,claim_id:claim.id,expected_offer_revision:offer.revision,expected_claim_revision:claim.revision,accept,hold_until:accept?new Date(hold.input.value).toISOString():null,reason:reason.input.value||null};
  state.mutating++;status.textContent=accept?'Accepting and waiting for acknowledgement…':'Declining and waiting for acknowledgement…';
  try{
   if(attempt){const original=JSON.parse(attempt.payload),proposed={...payload,operation_id:attempt.id};if(JSON.stringify(original)!==JSON.stringify(proposed))throw Error('Close the earlier failed attempt with Edit acceptance before changing its values.');}
   else attempt=await outbox.prepare(user,claim.source_id,'integrity_respond_claim_v1',payload);
   const response=await outbox.send(attempt,{reviewed:true});check();
   await showAcknowledged(response.data);
  }catch(e){
   if(attempt)attempt=await store.get('outbox',user,claim.source_id,attempt.id);
   if(e.code==='INVALID_COLLECTION_WINDOW')fieldError(hold,'Choose a hold time within the requested collection window.',{throwError:false});
   status.textContent=!attempt||attempt.status==='draft'?'This attempt was not sent. Review the details and try again.':attempt?.status==='rejected'?'Acceptance was not completed. Nothing changed on the network.':'Acceptance is not confirmed. Check its server status before changing this attempt.';
   const error=el('p',rejectionReason(e.code||e.message),{class:'error',role:'alert',tabindex:'-1'});problem.append(error);error.focus();
   if(attempt)recoveryActions();
  }finally{state.mutating--;if(box.querySelector('h3')?.textContent==='ACCEPTED')Promise.resolve(ctx.refresh()).catch(()=>{});}
 },'primary');
 async function showAcknowledged(acknowledged){
  check();
  box.replaceChildren(el('h3',acknowledged.status==='accepted'?'ACCEPTED':acknowledged.status.toUpperCase()),el('p',`${t.quantity}${t.unit} ${detail.food_name}${acknowledged.status==='accepted'?' held':''}`),facts([['Hold until',time(acknowledged.terms.hold_until)],['Collection',windowText(acknowledged)],['Collection reference',acknowledged.collection_reference]]));
  const stock=el('p','Refreshing authoritative stock…');box.append(stock,button('View hold',()=>claimDetails(acknowledged,ctx)),button('Done',closeModal,'primary'));
  try{const fresh=await api.rpc('integrity_member_offer_v1',{source_id:claim.source_id,offer_id:t.offer_id,lot_id:null});check();stock.textContent=stockText(fresh.data);}catch{stock.textContent='Acceptance acknowledged. Stock could not refresh; reopen the hold when connected.';}
  state.inboxFilter=acknowledged.status;
  try{await ctx.refresh();}catch{/* The acknowledged result remains visible even if refresh fails. */}
 }
 function recoveryActions(){actions.replaceChildren();if(attempt.status==='rejected'||attempt.status==='draft')actions.append(button('Edit acceptance',()=>acceptanceModal(claim,ctx,{failed:attempt,replace:true,accept}),'primary'),button('Discard failed attempt',async()=>{await outbox.close(attempt,{discard:true});closeModal();await ctx.refresh();}));else actions.append(button('Check server status',async()=>{attempt=await outbox.reconcile(attempt);if(attempt.status==='committed'){await showAcknowledged(attempt.result.data);}else if(attempt.status==='draft'){status.textContent='The exact attempt was not committed. Retry unchanged, or close it before editing.';actions.replaceChildren(button('Retry identical acceptance',()=>retryExact()),button('Close attempt & edit',()=>acceptanceModal(claim,ctx,{failed:attempt,replace:true,accept})));}else recoveryActions();}));}
 async function retryExact(){state.mutating++;try{const response=await outbox.send(attempt,{reviewed:true});await showAcknowledged(response.data);}finally{state.mutating--;await ctx.refresh();}}
 if(attempt){status.textContent=attempt.status==='rejected'?'Acceptance was not completed. Nothing changed on the network.':'An earlier acceptance needs a server check.';problem.append(el('p',rejectionReason(attempt.error),{class:'error'}));recoveryActions();}else actions.append(submit);
 modal(`${accept?'Accept':'Decline'} ${t.quantity}${t.unit} ${detail.food_name}`,box);
}
export async function collectionModal(input,ctx){
 const {claim,offer,detail}=await currentClaim(ctx.api,input.id),g=ctx.state.generation;
 if(claim.status!=='accepted')throw Error('This claim is now '+claim.status+'. Refresh its current record.');
 const box=el('div'),status=el('p',`Confirm physical collection of all ${claim.terms.quantity}${claim.terms.unit} ${detail.food_name}. Partial collection is unavailable.`,{role:'status'});box.append(status,button('Confirm full collection',async()=>{
  const result=await ctx.command('integrity_collect_claim_v1',{source_id:claim.source_id,claim_id:claim.id,expected_offer_revision:offer.revision,expected_claim_revision:claim.revision,quantity:claim.terms.quantity},claim.source_id);
  if(result&&ctx.guard(g)){box.replaceChildren(el('h3','COLLECTED'),el('p',stockText(result.offer)),button('View record',()=>claimDetails(result.claim,ctx)),button('Done',closeModal,'primary'));ctx.state.inboxFilter='collected';await ctx.refresh();}
 },'primary'));modal('Mark fully collected',box);
}
export async function failedAcceptanceCard(row,ctx){
 const p=JSON.parse(row.payload),card=el('article',null,{class:'card'});card.append(el('h3','Acceptance was not completed'),el('p','Why: '+rejectionReason(row.error)),el('p','Nothing changed on the network.'));
 try{const d=(await ctx.api.rpc('integrity_claim_detail_v1',{claim_id:p.claim_id})).data;card.insertBefore(el('p',`${d.claim.terms.quantity}${d.claim.terms.unit} ${d.food_name}`),card.children[1]);card.append(facts([['Collection window',windowText(d.claim)],['Current claim status',d.claim.status]]));if(d.claim.status==='requested')card.append(button('Edit acceptance',()=>acceptanceModal(d.claim,ctx,{failed:row,replace:true,accept:p.accept}),'primary'));else card.append(button('View current claim',()=>claimDetails(d.claim,ctx)));}catch{card.append(el('p','Current claim details could not be loaded. Reconnect to edit.'));}
 card.append(button('Discard failed attempt',async()=>{await ctx.outbox.close(row,{discard:true});await ctx.refresh();}));return card;
}
export function personalClaimSection(c,ctx){
 const t=c.terms,box=el('section',null,{class:'personal-claim'});
 box.append(el('h3',`${t.quantity}${t.unit} ${c.status==='accepted'?'held for you':'requested · awaiting Source'}`),facts([['Collection',windowText(c)],['Hold until',time(t.hold_until)],['Collection reference',c.collection_reference],['Frozen price',priceText(t.price,t.unit)]]),button(c.status==='requested'?'View request':'View hold',()=>claimDetails(c,ctx)),button(c.status==='requested'?'Cancel request':'Cancel hold',async()=>{await ctx.command('integrity_cancel_claim_v1',{claim_id:c.id,expected_claim_revision:c.revision,reason:null},c.source_id);closeModal();await ctx.refresh();}));return box;
}
export function sourceAttention(claims,names,ctx){
 const attention=el('section',null,{class:'card'});attention.append(el('h2',`${claims.length} request${claims.length===1?'':'s'} waiting`));for(const c of claims)attention.append(el('p',`${names[c.id]||'Food'} · ${c.terms.quantity}${c.terms.unit}`),button('Review request',()=>ctx.state.memberships?.some(m=>m.source_id===c.source_id&&m.role!=='viewer')?acceptanceModal(c,ctx):claimDetails(c,ctx)));return attention;
}
