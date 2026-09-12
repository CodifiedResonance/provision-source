import {batchIncomplete,recoverBatchDraft,continueBatchPublication,publicationPayload} from './batch-recovery.js';
import {offerForm,mergePlan} from './draft-merge.js';
import {memberExport} from './member-data.js';
import {profileForm,physicalDatesForm} from './member-forms.js';
import {time,priceText,quantity,emptyDates,UNITS,expired} from './domain.js';
import {el,button,field,select,check,modal,closeModal,message,empty,facts,fieldError} from './dom.js';
export function resumeSourceDraft(draft,ctx){if(!ctx.state.memberships.some(m=>m.source_id===draft.source&&m.role!=='viewer'))throw Error('Current editing membership is required to resume this Source draft.');ctx.state.sourceId=draft.source;ctx.state.generation++;return edit(null,ctx,false,draft);}
export async function sourceScreen(root,ctx){
  const {state,CONFIG,api,store}=ctx,g=state.generation,user=state.session?.user.id;
  if(!user){root.append(empty('Your Source day','Sign in to manage your catalogue and the work saved on this device.'),button('Sign in',ctx.requireAuth));return ()=>{};}
  if(!state.memberships.length){root.append(empty('No Source memberships','This account currently has no Source membership. Ask the staging operator to assign the approved synthetic role.'));return ()=>{};}
  const toolbar=el('div',null,{class:'toolbar'}),chooser=select('Your Source',[['','Select a Source'],...state.memberships.map(s=>[s.source_id,s.name+(s.active?'':' · paused')+' · '+s.role])],state.sourceId||'');
  chooser.input.addEventListener('change',()=>{state.sourceId=chooser.input.value||null;state.generation++;ctx.refresh();});toolbar.append(chooser.label);root.append(toolbar);
  if(!state.sourceId)return ()=>{};
  const sourceId=state.sourceId,membership=state.memberships.find(m=>m.source_id===sourceId);if(!membership)return ()=>{};const canEdit=membership.role!=='viewer',canManage=['owner','admin'].includes(membership.role);let profile,response;
  try{[profile,response]=await Promise.all([api.rpc('integrity_profile_v1',{source_id:sourceId}),api.page('integrity_catalogue_v1',{source_id:sourceId})]);}
  catch(e){if(ctx.guard(g))root.append(empty('Source access could not be confirmed','No private catalogue is displayed. Your saved drafts remain scoped to the original account and Source.'));return ()=>{};}
  if(!ctx.guard(g))return ()=>{};
  const p=profile.data,offers=response.data.items;state.sourceExpiry=response.data.next_expiry_at;
  await store.put('server',user,sourceId,'catalogue',{items:offers,serverTime:response.server_time});
  const drafts=await store.list('drafts',user,sourceId);if(!ctx.guard(g))return ()=>{};
  root.append(canManage?button(p.name,()=>profileForm(p,ctx)):el('h2',p.name),el('p',p.active?'Source active':'Source paused · your catalogue remains manageable'),el('p',`Your role: ${membership.role} · business control: ${membership.business_control}`,{class:'muted'}));
  if(canEdit)toolbar.append(button('Add a new batch',()=>edit(null,ctx),'primary'));toolbar.append(button('Export stock/history',()=>exportCatalogue(offers,p,ctx)),button('Print current stock',()=>printStock(offers,p)));
  const cards=el('div',null,{class:'cards'});root.append(cards);
  function renderCards(){cards.replaceChildren();
  for(const o of offers){const c=el('article',null,{class:'card'}),saved=drafts.find(d=>d.id===o.lot_id),actions=el('div',null,{class:'actions'});
    c.append(el('p',o.classification.toUpperCase(),{class:'eyebrow'}),el('h2',o.food_name),el('p',`${o.physical_quantity??'Unknown'} ${o.unit} · ${priceText(o.price,o.unit)}`),el('p',expired(o,api.now())||o.visibility!=='public'||!o.source_active?'Not currently published—confirm, change or retire':`Declared ${time(o.availability_confirmed_at)}`),el('p',`Held ${o.held_quantity} · available ${o.claimable_quantity} ${o.unit}`));
    if(saved)c.append(el('p','Saved on this device · unpublished changes',{class:'badge'}));
    if(saved&&saved.baseRevision!==o.revision)c.append(el('p','Server revision changed. Review both versions before publishing.',{class:'error'}));
    if(canEdit)actions.append(button(saved?'Resume draft':'Change',()=>edit(o,ctx)),button('Same batch · reconfirm',()=>reconfirm(o,ctx)),button('New batch',()=>edit(o,ctx,true)),button('Sold out',()=>countZero(o,ctx)),button('Retire',()=>reason('Retire this offer',async r=>ctx.command('integrity_withdraw_v1',{source_id:sourceId,offer_id:o.id,expected_revision:o.revision,reason:r},sourceId))),button('Correct physical dates',()=>physicalDatesForm(o,ctx)),button('Evidence',()=>evidenceForm(o,ctx)));c.append(actions);cards.append(c);
  }
  for(const d of drafts.filter(d=>!offers.some(o=>o.lot_id===d.id))){const c=el('article',null,{class:'card'});c.append(el('h2',d.foodName||'Unpublished batch'),el('p',batchIncomplete(d)?'Batch created · publication not completed':'Saved on this device'),el('p','Your draft is safe.'),canEdit?button(batchIncomplete(d)?'Continue publication':'Resume draft',()=>edit(null,ctx,false,d)):el('p','Editing requires an owner, admin or editor role'));cards.append(c);}
  if(!offers.length&&!drafts.length)cards.append(empty('No catalogue items on this page','Expired batches remain manageable when returned by the member catalogue.'));
  }
  renderCards();
  let cursor=response.data.next_cursor;const seen=new Set();
  const more=button('Load more catalogue items',async()=>{
    const r=await api.page('integrity_catalogue_v1',{source_id:sourceId},cursor);if(!ctx.guard(g)||!cards.isConnected)return;
    if(r.data.next_cursor&&(seen.has(r.data.next_cursor)||r.data.next_cursor===cursor))throw Error('Catalogue pagination did not advance. Refresh before continuing.');
    if(cursor)seen.add(cursor);cursor=r.data.next_cursor;
    for(const item of r.data.items){const i=offers.findIndex(o=>o.id===item.id);if(i<0)offers.push(item);else offers[i]=item;}
    await store.put('server',user,sourceId,'catalogue',{items:offers,serverTime:r.server_time,nextCursor:cursor});
    if(!ctx.guard(g))return;renderCards();more.hidden=!cursor;
  });more.hidden=!cursor;root.append(more);
  return ()=>{};
}
function dateField(label,value){const f=field(label,'','datetime-local');if(value){const d=new Date(value);f.input.value=new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}return f;}
function iso(value){if(!value)return null;const d=new Date(value);if(Number.isNaN(+d))throw Error('Invalid date.');return d.toISOString();}
async function edit(offer,ctx,newBatch=false,resume=null){
  const {state,store,api,CONFIG}=ctx,user=state.session.user.id,source=state.sourceId,g=state.generation;
  if(!state.memberships.some(m=>m.source_id===source&&m.role!=='viewer'))throw Error('Current editing membership is required.');
  if(resume){const recovered=await recoverBatchDraft(store,ctx.outbox,resume,{user,source,guard:()=>ctx.guard(g)});if(!recovered.draft){closeModal();await ctx.refresh();message('Published · server acknowledgement recovered.');return;}resume=recovered.draft;}
  if(!newBatch&&(offer||resume?.lotId)){try{offer=(await api.rpc('integrity_member_offer_v1',{source_id:source,offer_id:offer?.id||null,lot_id:offer?null:resume.lotId})).data;}catch(e){if(!(resume&&!offer&&e.code==='NOT_FOUND'&&resume.baseRevision===0))throw e;}}
  if(!ctx.guard(g))return;
  if(offer&&!offer.lot_id&&!newBatch){message('This legacy offer needs owner/admin activation and reviewed historical claims before publication.');return;}
  const id=resume?.id||(newBatch||!offer?crypto.randomUUID():offer.lot_id);
  let draft=resume||await store.get('drafts',user,source,id);
  if(!ctx.guard(g))return;
  const initial=draft?.form||{foodId:offer?.food_id||'',unit:offer?.unit||'each',quantity:offer?.physical_quantity||'',price:offer?.price||{status:'unknown',amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null},lifecycle:offer?.lifecycle==='retired'?'ready':offer?.lifecycle||'ready',pressure:offer?.pressure||'normal',visibility:offer?.visibility||'public',reservable:offer?.reservable||false,listingExpiresAt:null,collectionStart:offer?.collection_start||null,collectionEnd:offer?.collection_end||null,note:offer?.note||'',noteTouched:false,dates:newBatch?emptyDates():offer?.physical_dates||emptyDates()};
  draft=draft||{localVersion:0,baseRevision:offer&&!newBatch?offer.revision:0,lotId:offer&&!newBatch?offer.lot_id:null,foodName:offer?.food_name||'',createId:crypto.randomUUID(),publishId:crypto.randomUUID(),baseForm:offer&&!newBatch?offerForm(offer):null,form:initial};
  const pendingPublish=await store.get('outbox',user,source,draft.publishId);
  if(pendingPublish){const p=JSON.parse(pendingPublish.payload);Object.assign(initial,{quantity:p.physical_quantity,price:p.price,lifecycle:p.lifecycle,pressure:p.pressure,visibility:p.visibility,reservable:p.reservable,listingExpiresAt:p.listing_expires_at,collectionStart:p.collection_start,collectionEnd:p.collection_end,...('note' in p?{note:p.note||'',noteTouched:true}:{})});}
  const box=el('div'),form=el('div',null,{class:'form-grid'}),foods=[...state.foods];if(offer&&!foods.some(f=>f.id===offer.food_id))foods.push({id:offer.food_id,name:offer.food_name});
  const food=select('Food',[['','Choose a food'],...foods.map(f=>[f.id,f.name])],initial.foodId),unit=select('How is this counted?',foods.find(f=>f.id===initial.foodId)?.units?.map(u=>[u.unit,u.unit])||[[initial.unit,initial.unit]],initial.unit),qty=field('Physical quantity',initial.quantity),status=select('Price',['unknown','free','priced'].map(x=>[x,x==='unknown'?'Price not supplied':x==='free'?'Free':'Set price']),initial.price.status),amount=field('Amount (£)',initial.price.amount||''),basis=select('Price basis',[['per_unit','Per counted unit'],['per_kg','Per kg'],['per_litre','Per litre'],['per_lot','Per whole batch'],['bundle','Bundle']],initial.price.basis||'per_unit'),bundle=field('Units in the bundle',initial.price.bundle_quantity||''),pack=field('Package quantity (optional)',initial.price.package_quantity||''),packUnit=select('Package unit',[['','Unknown'],...UNITS],initial.price.package_unit||''),lifecycle=select('Physical stage',[['ready','Ready'],['growing','Growing'],['at_sea','At sea']],initial.lifecycle),pressure=select('Availability pressure',[['normal','Normal'],['surplus','Surplus'],['needs_moving','Needs moving']],initial.pressure),visibility=select('Visibility',[['public','Public'],['members','Source members']],initial.visibility),reservable=check('Allow hold requests',initial.reservable),expires=dateField('Declaration expires (your local time)',initial.listingExpiresAt),start=dateField('Collection from (your local time)',initial.collectionStart),end=dateField('Collection until (your local time)',initial.collectionEnd),note=field('Note',initial.note,'textarea');
  const saved=el('p','Changes have not yet been saved.'),preview=el('p',null,{class:'price'}),fields=[food,unit,qty,status,amount,basis,bundle,pack,packUnit,lifecycle,pressure,visibility,expires,start,end,note];
  for(const f of fields)form.append(f.label);form.append(reservable.label);box.append(el('p',draft.lotId?'Same batch · physical dates are preserved':'New batch · physical dates start unknown'),form);
  if(!draft.lotId&&!foods.length)box.append(el('p','The backend food directory has not been supplied. New food selection is unavailable.',{class:'error'}));
  food.input.disabled=Boolean(draft.lotId);unit.input.disabled=Boolean(draft.lotId);
  const dates=el('details'),dateInputs={};dates.append(el('summary','Physical dates, handling and allergens'));
  for(const [key,label]of [['harvested_at','Harvested'],['landed_at','Landed'],['baked_at','Baked'],['packed_at','Packed']]){const f=dateField(label+' (your local time)',initial.dates[key]);f.input.disabled=Boolean(draft.lotId);dates.append(f.label);dateInputs[key]=f;}
  const handling=field('Handling',initial.dates.handling,'textarea'),allergens=field('Allergen information',initial.dates.allergen_information,'textarea');handling.input.disabled=allergens.input.disabled=Boolean(draft.lotId);dates.append(handling.label,allergens.label);box.append(dates,preview,saved);
  let noteTouched=initial.noteTouched||false;note.input.addEventListener('input',()=>{noteTouched=true;});
  function snapshot(){return {foodId:food.input.value,unit:unit.input.value,quantity:qty.input.value,price:{status:status.input.value,amount:status.input.value==='priced'?amount.input.value:status.input.value==='free'?'0':null,currency:'GBP',basis:status.input.value==='priced'?basis.input.value:null,bundle_quantity:status.input.value==='priced'&&basis.input.value==='bundle'?bundle.input.value:null,package_quantity:pack.input.value||null,package_unit:packUnit.input.value||null},lifecycle:lifecycle.input.value,pressure:pressure.input.value,visibility:visibility.input.value,reservable:reservable.input.checked,listingExpiresAt:iso(expires.input.value),collectionStart:iso(start.input.value),collectionEnd:iso(end.input.value),note:note.input.value,noteTouched,dates:draft.lotId?initial.dates:{...initial.dates,...Object.fromEntries(Object.entries(dateInputs).map(([k,f])=>[k,iso(f.input.value)])),handling:handling.input.value||null,allergen_information:allergens.input.value||null}};}
  let saving=Promise.resolve(),closed=false,saveFailed=false;
  function save(){if(pendingPublish)return saving;const value=snapshot();saving=saving.then(async()=>{if(!ctx.guard(g))return;draft=await store.saveDraft(user,source,id,{...draft,form:value,foodName:foods.find(f=>f.id===value.foodId)?.name||draft.foodName},draft.localVersion);saveFailed=false;if(!closed)saved.textContent='Saved on this device';}).catch(e=>{saveFailed=true;if(!closed)saved.textContent=e.message;});return saving;}
  function change(){try{const f=snapshot();preview.textContent=`${f.quantity||'?'} ${draft.foodName||'food'} · ${priceText(f.price,f.unit)} · ${f.pressure}`;}catch{preview.textContent='Complete the price and quantity for a preview.';}saved.textContent='Saving on this device…';save();}
  form.addEventListener('input',change);dates.addEventListener('input',change);food.input.addEventListener('change',()=>{if(!draft.lotId){const selected=foods.find(f=>f.id===food.input.value);unit.input.replaceChildren(...(selected?.units||[]).map(u=>el('option',u.unit,{value:u.unit})));unit.input.value=selected?.default_unit||'';qty.input.step=selected?.units.find(u=>u.unit===unit.input.value)?.increment||'1';change();}});
  if(offer&&!newBatch&&draft.baseRevision!==offer.revision){box.append(el('p','Conflict: the Source changed after this draft was saved. Publishing is blocked until you review the new stock and terms.',{class:'error'}),button('Compare & merge with current record',async()=>{await save();await saving;if(saveFailed)return;await mergeDraft(draft,ctx);}));}
  const recovery=el('div',null,{class:'batch-recovery'});
  if(batchIncomplete(draft)){recovery.append(el('h3','Batch created · publication not completed'),el('p','Your draft is safe.'));box.prepend(recovery);}
  if(pendingPublish){for(const input of box.querySelectorAll('input,select,textarea'))input.disabled=true;box.append(el('p','Continuing uses the original saved publication terms. Check its acknowledgement before changing them.'));}
  box.append(button('Save on this device',save),button(batchIncomplete(draft)?'Continue publication':'Review & publish',async()=>{
    await save();await saving;if(saveFailed)throw Error('Device save failed. Publication was not started.');if(!ctx.guard(g))return;
    const f=draft.form;
    if(!pendingPublish){
      try{quantity(f.quantity,f.unit);}catch(e){fieldError(qty,e.message);}
      if(!f.foodId)fieldError(food,'Choose a food.');
      if(!f.listingExpiresAt)fieldError(expires,'Choose a declaration expiry.');
      if(Date.parse(f.listingExpiresAt)<=api.now())fieldError(expires,'Choose a future declaration expiry.');
      if(f.price.status==='priced'){try{quantity(f.price.amount,'kg');}catch{fieldError(amount,'Enter a valid price amount.');}}
      if(f.price.basis==='bundle'){try{quantity(f.price.bundle_quantity,f.unit);if(Number(f.price.bundle_quantity)<=0)throw Error();}catch{fieldError(bundle,'Enter the number of counted units in the bundle.');}}
      if(f.note.length>2000)fieldError(note,'Keep the note to 2,000 characters or fewer.');
      if(f.collectionStart&&f.collectionEnd&&Date.parse(f.collectionEnd)<=Date.parse(f.collectionStart))fieldError(end,'Collection must end after it starts.');
      api.validate('integrity_publish_v2','request',{...publicationPayload(draft,source),lot_id:draft.lotId||draft.createId,operation_id:draft.publishId});
    }
    if(offer&&!newBatch&&draft.baseRevision!==offer.revision)throw Error('Resolve the revision conflict before publishing.');
    if(!draft.lotId&&!foods.find(x=>x.id===f.foodId)?.units.some(u=>u.unit===f.unit))throw Error('Choose a unit from the current food directory.');
    const review=el('div'),partial=el('h3',batchIncomplete(draft)?'Batch created · publication not completed':''),safe=el('p','Your draft is safe.');review.append(partial,safe,el('p',`${f.quantity} ${f.unit} ${draft.foodName} · ${priceText(f.price,f.unit)} · ${f.pressure}`),el('p','Confirm your physical count and collection window now. Any server revision conflict will preserve this draft.'),button('Confirm publication',async()=>{
      if(!ctx.guard(g))return;
      state.mutating++;
      try{
        const result=await continueBatchPublication(store,ctx.outbox,draft,{user,source,guard:()=>ctx.guard(g),onCreated:created=>{draft=created;partial.textContent='Batch created · publication not completed';safe.textContent='Your draft is safe.';}});
        if(result){closeModal();message('Published · server acknowledgement received.');}
      }finally{state.mutating--;await ctx.refresh();}
    },'primary'));modal('Confirm your declaration',review);
  },'primary'));modal('Your batch',box,()=>{closed=true;});
}
function reconfirm(o,ctx){const box=el('div'),expiry=dateField('New declaration expiry (your local time)',null);box.append(el('p',`Reconfirm this same batch: ${o.physical_quantity} ${o.unit}. Harvest, landing and bake dates stay unchanged.`),expiry.label,button('Confirm unchanged stock',async()=>{const expires=iso(expiry.input.value);if(!expires)throw Error('Choose an expiry.');await ctx.command('integrity_reconfirm_v1',{source_id:o.source_id,offer_id:o.id,expected_revision:o.revision,listing_expires_at:expires},o.source_id);closeModal();},'primary'));modal('Same batch',box);}
function countZero(o,ctx){reason('Count physical stock as zero',r=>ctx.command('integrity_reconcile_stock_v1',{source_id:o.source_id,offer_id:o.id,expected_revision:o.revision,counted_quantity:'0',count_observed_at:new Date(ctx.api.now()).toISOString(),reason:r},o.source_id));}
function reason(title,action){const box=el('div'),f=field('Reason','','textarea');box.append(f.label,button('Confirm',async()=>{if(!f.input.value.trim())throw Error('Provide a reason.');await action(f.input.value);closeModal();},'primary'));modal(title,box);}
async function evidenceForm(o,ctx){
  if(!ctx.api.health?.capabilities.evidence_upload){message('Evidence uploads are currently unavailable.');return;}
  const {store,state,api,CONFIG}=ctx,user=state.session.user.id,source=o.source_id,box=el('div'),file=field('JPEG, PNG or WebP photo (up to 10 MB)','','file'),caption=field('Caption'),observed=dateField('When was it observed? (optional, your local time)',null),preview=el('div');file.input.accept='image/jpeg,image/png,image/webp';
  let url=null;file.input.addEventListener('change',()=>{if(url)URL.revokeObjectURL(url);preview.replaceChildren();const f=file.input.files[0];if(f&&['image/jpeg','image/png','image/webp'].includes(f.type)){url=URL.createObjectURL(f);preview.append(el('img',null,{src:url,alt:'Private evidence preview',class:'evidence-image'}));}});
  box.append(el('p','Preview for personal information before uploading. Sharing is a separate step after server sanitisation. HEIC: export a JPEG first. PDFs are not accepted by this photo flow.'),file.label,preview,caption.label,observed.label,button('Save file privately on this device',async()=>{
    const f=file.input.files[0];if(!f||f.size>10485760||!['image/jpeg','image/png','image/webp'].includes(f.type))throw Error('Choose a JPEG, PNG or WebP image under 10 MB.');
    const id=crypto.randomUUID(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    await store.put('files',user,source,id,{blob:f,eventId:o.latest_event_id,caption:caption.input.value||null,observedAt:iso(observed.input.value),checksum:hash,beginId:crypto.randomUUID(),finalizeId:crypto.randomUUID(),publishId:crypto.randomUUID(),status:'pending'});
    closeModal();message('File saved on this device · evidence pending. Reopen Evidence to send.');
  },'primary'));
  const saved=await store.list('files',user,source);
  for(const record of saved.filter(r=>r.eventId===o.latest_event_id)){const c=el('article',null,{class:'card'});c.append(el('h3',record.caption||'Saved photo'),el('p',record.status==='linked'?'Private evidence linked':'Evidence pending'),button('Upload / retry exact attachment',async()=>{
    if(state.session?.user.id!==user)throw Error('Account changed.');
    const begin=await ctx.command('integrity_begin_evidence_v1',{source_id:source,event_id:record.eventId,attachment_id:record.id,media_type:record.blob.type,bytes:record.blob.size,checksum_sha256:record.checksum,caption:record.caption,declared_observed_at:record.observedAt},source,{operationId:record.beginId});if(!begin)return;
    const current=await api.rpc('integrity_evidence_status_v1',{source_id:source,attachment_id:record.id});
    if(current.data.status==='pending'){
      const r=await fetch(`${CONFIG.url}/functions/v1/integrity-evidence/upload/${record.id}`,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(95000),headers:{apikey:CONFIG.publishableKey,Authorization:'Bearer '+state.session.access_token,'x-source-id':source,'Content-Type':record.blob.type},body:record.blob});
      if(!r.ok)throw Error('Upload not confirmed. Saved file retained for retry.');
    }
    const result=await ctx.command('integrity_finalize_evidence_v1',{source_id:source,attachment_id:record.id},source,{operationId:record.finalizeId});if(!result)return;
    record.status=result.status;await store.put('files',user,source,record.id,record);closeModal();message('Evidence linked privately. Reopen Evidence to preview the sanitised image before sharing.');
  }));
    if(record.status==='linked')c.append(button('Preview sanitised photo & choose sharing',async()=>{
      const blob=await api.evidence(record.id),imageUrl=URL.createObjectURL(blob),confirm=el('div');confirm.append(el('img',null,{src:imageUrl,alt:record.caption||'Sanitised evidence',class:'evidence-image'}),el('p','Check this image for personal information. Sharing does not verify its contents. Downloaded copies cannot be recalled.'),button('Share this photo publicly',async()=>{await ctx.command('integrity_publish_evidence_v1',{source_id:source,attachment_id:record.id},source,{operationId:record.publishId});closeModal();},'primary'),button('Withdraw public sharing',()=>reason('Withdraw evidence',r=>ctx.command('integrity_withdraw_evidence_v1',{source_id:source,attachment_id:record.id,reason:r},source))));modal('Review public sharing',confirm,()=>URL.revokeObjectURL(imageUrl));
    }));box.append(c);
  }
  modal('Evidence for '+o.food_name,box,()=>{if(url)URL.revokeObjectURL(url);});
}
async function exportCatalogue(_offers,p,ctx){
  const g=ctx.state.generation,guard=()=>ctx.guard(g)&&ctx.state.sourceId===p.source_id;
  message('Reading the full catalogue and batch histories…');
  const records=await memberExport(ctx.api,p.source_id,guard);if(!guard())return;
  const data={schema:'provision-member-history/1.0.0-draft.1',contract_sha256:ctx.CONFIG.checksum,source:p,...records};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a',null,{href:url,download:'provision-source-history.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Catalogue and histories exported. Pages were read at different times; this is not a backup.');
}
function printStock(offers,p){const box=el('div');box.append(el('h2',p.name),el('p','STAGING / TEST DATA · not a real stock sign'));for(const o of offers)box.append(el('p',`${o.food_name} · ${o.physical_quantity??'Unknown'} ${o.unit} · ${priceText(o.price,o.unit)}`));box.append(button('Print',()=>window.print()));modal('Current stock',box);}

async function mergeDraft(draft,ctx){
  const {state,store,api}=ctx,user=state.session.user.id,source=state.sourceId,g=state.generation;
  const operation=await store.get('outbox',user,source,draft.publishId);
  if(operation&&(operation.status!=='attention'||operation.error!=='REVISION_CONFLICT'))throw Error('Reconcile the original publication in Saved work before rebasing this draft. Its exact payload is retained.');
  const current=(await api.rpc('integrity_member_offer_v1',{source_id:source,offer_id:null,lot_id:draft.lotId})).data;
  if(!ctx.guard(g))return;const server=offerForm(current),plan=mergePlan(draft.baseForm,draft.form,server),box=el('div'),choices={};
  box.append(el('p','Review differences against the latest Source record. Confirm the physical count explicitly. Both versions will remain in this draft’s merge history.'));
  for(const row of plan){const detail=el('details');detail.append(el('summary',row.key),facts([['Your draft',JSON.stringify(row.local)],['Current Source',JSON.stringify(row.server)]]));const choice=select('Use value for '+row.key,[['','Choose after review'],['local','Your draft'],['server','Current Source']],row.choice||'');choices[row.key]=choice;box.append(detail,choice.label);}
  box.append(button('Save merged draft for review',async()=>{
    if(!ctx.guard(g))throw Error('Account or Source changed.');
    const latest=(await api.rpc('integrity_member_offer_v1',{source_id:source,offer_id:null,lot_id:draft.lotId})).data;
    if(!ctx.guard(g))return;if(latest.revision!==current.revision)throw Error('The Source changed again. Reopen comparison; both versions are retained.');
    const form={...draft.form,dates:server.dates,foodId:server.foodId,unit:server.unit};
    for(const row of plan){const choice=choices[row.key].input.value;if(!choice)throw Error('Choose a value for every unresolved difference.');form[row.key]=row[choice];}
    form.noteTouched=form.note!==server.note;
    const saved=await store.saveDraft(user,source,draft.id,{...draft,form,baseForm:server,baseRevision:current.revision,publishId:crypto.randomUUID(),mergeHistory:[...(draft.mergeHistory||[]),{local:draft.form,server,previousRevision:draft.baseRevision,serverRevision:current.revision,previousPublishId:draft.publishId}]},draft.localVersion);
    if(ctx.guard(g))await edit(current,ctx,false,saved);
  },'primary'));modal('Merge saved work',box);
}
