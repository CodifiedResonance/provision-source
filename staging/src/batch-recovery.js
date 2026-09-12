// A draft's two operation IDs are durable. Recovery never invents either ID.
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
export async function recoverBatchDraft(store,outbox,d,{user,source,guard=()=>true,checkServer=true}={}){
  check(outbox,user,guard);d=await store.get('drafts',user,source,d.id);if(!d)return {draft:null};
  for(const [id,name] of [[d.createId,'integrity_create_lot_v1'],[d.publishId,'integrity_publish_v2']]){
    let row=await store.get('outbox',user,source,id);if(!row)continue;
    if(row.name!==name&&!(id===d.publishId&&row.name==='integrity_publish_v1'))throw Error('Saved operation does not belong to this batch.');
    if(checkServer&&row.status!=='published'&&(row.attempted||['attention','sending'].includes(row.status)))row=await outbox.reconcile(row);
    check(outbox,user,guard);
    if(row.status!=='published')continue;
    if(id===d.createId)d=await adoptCreated(store,d,row,user,source);
    else {assertAcknowledgedForm(d,row,source);await store.acknowledgeDraft(user,source,d.id,d.publishId,d.localVersion);return {draft:null,result:row.result};}
  }
  return {draft:d};
}
export async function continueBatchPublication(store,outbox,d,{user,source,guard=()=>true,onCreated=()=>{}}={}){
  const recovered=await recoverBatchDraft(store,outbox,d,{user,source,guard});
  d=recovered.draft;if(!d)return recovered.result;
  if(!d.lotId){
    const f=d.form;
    let row=await store.get('outbox',user,source,d.createId);
    if(!row)row=await outbox.prepare(user,source,'integrity_create_lot_v1',{source_id:source,food_id:f.foodId,unit:f.unit,physical_dates:f.dates},d.createId);
    const result=await outbox.send(row,{reviewed:true});check(outbox,user,guard);
    d=await adoptCreated(store,d,{...row,result},user,source);
  }
  check(outbox,user,guard);await onCreated(d);
  let publish=await store.get('outbox',user,source,d.publishId);
  if(!publish)publish=await outbox.prepare(user,source,'integrity_publish_v2',publicationPayload(d,source),d.publishId);
  const result=await outbox.send(publish,{reviewed:true});check(outbox,user,guard);
  await store.acknowledgeDraft(user,source,d.id,d.publishId,d.localVersion);
  return result;
}
