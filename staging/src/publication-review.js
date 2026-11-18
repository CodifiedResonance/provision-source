import {continueBatchPublication,batchIncomplete} from './batch-recovery.js';
import {serverPublicationIssue} from './publication-validation.js';
import {el,button,modal,closeModal,facts} from './dom.js';
import {priceText,time} from './domain.js';

function failureText(error){
 const code=error.code||error.message;
 if(code==='CONNECTION_UNCONFIRMED'||code==='INVALID_SERVER_RESPONSE')return 'The server has not confirmed publication. Your draft is safe. Check publication status before trying again.';
 if(code==='RUNTIME_NOT_VERIFIED')return 'The connection is being checked. Your draft is safe. Try publication again when the check finishes.';
 if(code==='AUTH_REQUIRED'||error.status===401)return 'Sign in again with the account that saved this draft, then continue publication.';
 if(error.status===403)return 'Publication access could not be confirmed. Your draft is safe. Refresh and check your Source membership.';
 return error.message||'Publication could not be confirmed. Your draft is safe.';
}
export function publicationReview(draft,ctx,{user,source,guard,allowCorrection,onEdit}){
 const f=draft.form,review=el('div'),partial=el('h3',batchIncomplete(draft)?'Batch created · publication not completed':'Ready to publish'),safe=el('p','Your draft is safe.'),status=el('p','Nothing has been sent from this confirmation yet.',{role:'status','aria-live':'polite',tabindex:'-1',class:'publication-status'}),problem=el('div'),actions=el('div',null,{class:'actions'});
 const guidance=el('p','Your quantity is already entered. Publishing corrected details closes any failed local attempt and starts a new attempt for this same batch.');
 let sending=false,acknowledged=false;
 const dialog=document.querySelector('#dialog'),close=document.querySelector('#closeDialog');
 const cancel=event=>{if(sending)event.preventDefault();};dialog.addEventListener('cancel',cancel);
 const edit=button('Edit details',()=>onEdit());
 const confirm=button('Publish this batch',async()=>{
  problem.replaceChildren();
  if(!guard()){problem.append(el('p','Your account or Source changed. Reopen this draft from Saved work to continue.',{role:'alert',class:'error'}));status.textContent='Publication was not started.';return;}
  sending=true;ctx.state.mutating++;close.disabled=true;edit.disabled=true;review.setAttribute('aria-busy','true');
  const progress=stage=>{
   confirm.textContent=stage==='creating'?'Creating batch…':stage==='publishing'?'Publishing…':'Checking publication…';
   status.textContent=stage==='creating'?'Saving this batch. Your draft stays on this device.':stage==='publishing'?'Sending the publication and waiting for server acknowledgement. Keep this window open.':'Checking whether the saved publication already reached the server. This can take a moment.';
  };
  progress('checking');status.focus();
  try{
   const result=await continueBatchPublication(ctx.store,ctx.outbox,draft,{user,source,guard,allowCorrection,onProgress:progress,onCreated:created=>{draft=created;partial.textContent='Batch created · publication not completed';}});
   if(!result)throw Error('Publication has no server acknowledgement. Reopen this draft from Saved work to check its status.');
   acknowledged=true;guidance.hidden=true;document.querySelector('#dialogTitle').textContent='Publication complete';review.querySelector('dt').textContent='Published quantity';partial.textContent='Published';safe.textContent='Server acknowledgement received. This publication is complete.';
   status.textContent=`${f.quantity} ${f.unit} ${draft.foodName} published${f.visibility==='public'?'. The consumer offer can now be refreshed.': ' for Source members.'}`;
   actions.replaceChildren(button('Done',closeModal,'primary'));
  }catch(error){
   const issue=serverPublicationIssue(error.code||error.message);
   status.textContent='Publication not completed. Your draft is safe.';
   const explanation=el('p',issue?.message||failureText(error),{class:'error',role:'alert',tabindex:'-1'});problem.append(explanation);
   if(issue)problem.append(button(issue.field==='status'||issue.field==='basis'?'Fix price':'Complete next field',()=>onEdit(issue),'primary'));
   explanation.focus();
  }finally{
   sending=false;ctx.state.mutating--;close.disabled=false;edit.disabled=false;review.removeAttribute('aria-busy');
   if(!acknowledged)confirm.textContent='Check & publish';
   // The visible result must not wait for a potentially slow catalogue refresh.
   if(acknowledged)Promise.resolve().then(()=>ctx.refresh()).catch(()=>{if(acknowledged&&status.isConnected)status.textContent+=' Current listings could not refresh; refresh them when connected.';});
  }
 },'primary');
 actions.append(confirm,edit);
 review.append(partial,safe,el('h3',draft.foodName),facts([['Quantity to publish',`${f.quantity} ${f.unit}`],['Price',priceText(f.price,f.unit)],['Visibility',f.visibility==='public'?'Public':'Source members'],['Declaration expires',time(f.listingExpiresAt)],['Collection from',time(f.collectionStart)],['Collection until',time(f.collectionEnd)]]),guidance,status,problem,actions);
 modal('Review publication',review,()=>{dialog.removeEventListener('cancel',cancel);close.disabled=false;});
}
