// Exact recovery preserves IDs. Explicit correction closes the old immutable
// publication attempt before saving a new ID for the same physical batch.
export const batchIncomplete=d=>Boolean(d.lotId&&d.baseRevision===0);
export function publicationPayload(d,source){const f=d.form;return {source_id:source,lot_id:d.lotId,expected_revision:d.baseRevision,physical_quantity:f.quantity,price:f.price,lifecycle:f.lifecycle,pressure:f.pressure,visibility:f.visibility,reservable:f.reservable,listing_expires_at:f.listingExpiresAt,collection_start:f.collectionStart,collection_end:f.collectionEnd,...(f.noteTouched||d.baseRevision===0?{note:f.note||null}:{})};}
function check(outbox,user,guard){if(outbox.identity()!==user||!guard())throw Error('Account or Source changed. Your draft is safe; reopen it in the original account.');}
async function adoptCreated(store,d,row,user,source){
  const result=row.result.data;
  if(d.lotId&&d.lotId!==result.lot_id)throw Error('The saved batch ID does not match its acknowledgement. Your draft is retained.');
  if(d.lotId)return d;
  const original=JSON.parse(row.payload);
  return store.saveDraft(user,source,d.id,{...d,lotId:result.lot_id,baseRevision:result.revision,form:{...d.form,foodId:original.food_id,unit:original.unit,dates:original.physical_dates}},d.localVersion);
}
function sameValue(a,b){if(a&&b&&typeof a==='object'&&typeof b==='object'){const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>sameValue(a[k],b[k]));}return a===b;}
function assertAcknowledgedForm(d,row,source){
  const original=JSON.parse(row.payload),current=publicationPayload(d,source);
  if(Object.keys(original).filter(k=>k!=='operation_id').some(k=>!sameValue(original[k],current[k])))throw Error('Publication acknowledged, but this draft contains newer edits. Your newer draft was retained.');
}
async function recoverMissingDraft(store,outbox,d,{user,source,guard,checkServer}){
  const missing=()=>Error('This draft is no longer on this device, and publication has not been confirmed. Refresh Saved work to check the original operation.');
  let row=await store.get('outbox',user,source,d.publishId);check(outbox,user,guard);
  if(!row)throw missing();
  if(!['integrity_publish_v1','integrity_publish_v2'].includes(row.name))throw Error('Saved operation does not belong to this batch.');
  if(checkServer&&row.status!=='committed')row=await outbox.reconcile(row);
  check(outbox,user,guard);
  if(row.status!=='committed'||!row.result)throw missing();
  // The caller can predate the create acknowledgement in another tab. Its exact
  // publication ID still identifies the batch; no draft or operation is created.
  const original=JSON.parse(row.payload);
  assertAcknowledgedForm({...d,lotId:d.lotId||original.lot_id},row,source);
  return {draft:null,result:row.result};
}
export async function recoverBatchDraft(store,outbox,d,{user,source,guard=()=>true,checkServer=true}={}){
  check(outbox,user,guard);const current=await store.get('drafts',user,source,d.id);
  if(!current)return recoverMissingDraft(store,outbox,d,{user,source,guard,checkServer});
  d=current;
  for(const [id,name] of [[d.createId,'integrity_create_lot_v1'],[d.publishId,'integrity_publish_v2']]){
    let row=await store.get('outbox',user,source,id);if(!row)continue;
    if(row.name!==name&&!(id===d.publishId&&row.name==='integrity_publish_v1'))throw Error('Saved operation does not belong to this batch.');
    if(checkServer&&row.status!=='committed'&&(row.attempted||['uncertain','sending'].includes(row.status)))row=await outbox.reconcile(row);
    check(outbox,user,guard);
    if(row.status!=='committed')continue;
    if(id===d.createId)d=await adoptCreated(store,d,row,user,source);
    else {assertAcknowledgedForm(d,row,source);await store.acknowledgeDraft(user,source,d.id,d.publishId,d.localVersion);return {draft:null,result:row.result};}
  }
  return {draft:d};
}
export async function continueBatchPublication(store,outbox,d,{user,source,guard=()=>true,onCreated=()=>{},onProgress=()=>{},allowCorrection=false}={}){
  onProgress('checking');
  const recovered=await recoverBatchDraft(store,outbox,d,{user,source,guard});
  d=recovered.draft;if(!d)return recovered.result;
  if(!d.lotId){
    const f=d.form;
    let row=await store.get('outbox',user,source,d.createId);
    if(!row)row=await outbox.prepare(user,source,'integrity_create_lot_v1',{source_id:source,food_id:f.foodId,unit:f.unit,physical_dates:f.dates},d.createId);
    onProgress('creating');
    const result=await outbox.send(row,{reviewed:true});check(outbox,user,guard);
    d=await adoptCreated(store,d,{...row,result},user,source);
  }
  check(outbox,user,guard);await onCreated(d);
  let publish=await store.get('outbox',user,source,d.publishId);
  if(!publish)publish=await outbox.prepare(user,source,'integrity_publish_v2',publicationPayload(d,source),d.publishId);
  if(publish.status==='closed'||(allowCorrection&&!sameValue(JSON.parse(publish.payload),{...publicationPayload(d,source),operation_id:d.publishId}))){
    if(!allowCorrection)throw Error('Review the corrected draft before closing its earlier attempt.');
    await outbox.close(publish);check(outbox,user,guard);
    const previousId=d.publishId;
    d=await store.saveDraft(user,source,d.id,{...d,publishId:crypto.randomUUID(),closedPublicationIds:[...(d.closedPublicationIds||[]),previousId]},d.localVersion);
    publish=await outbox.prepare(user,source,'integrity_publish_v2',publicationPayload(d,source),d.publishId);
  }
  if(publish.status==='committed')assertAcknowledgedForm(d,publish,source);
  onProgress('publishing');
  const result=await outbox.send(publish,{reviewed:true});check(outbox,user,guard);
  assertAcknowledgedForm(d,await store.get('outbox',user,source,d.publishId),source);
  await store.acknowledgeDraft(user,source,d.id,d.publishId,d.localVersion);
  return result;
}
