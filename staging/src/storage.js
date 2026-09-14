const rejectedCodes=new Set(['RATE_LIMITED','CAPABILITY_DISABLED','UNSUPPORTED_FOOD_UNIT','INVALID_CURSOR','INVALID_PRICE','INVALID_PRICE_BASIS','INVALID_REQUEST','INVALID_EXPIRY','INVALID_COLLECTION_WINDOW','NOT_RESERVABLE','REVISION_CONFLICT','INSUFFICIENT_STOCK','INVALID_TRANSITION','SHORTFALL','VALIDATION_ERROR','FORBIDDEN','AUTH_REQUIRED','NOT_FOUND','OPERATION_PAYLOAD_MISMATCH','PARTIAL_COLLECTION_UNSUPPORTED','SOURCE_PAUSED','SAFETY_BLOCK']);
export function normaliseOperation(row){
 if(!row)return row;
 const r={...row};
 if(r.status==='published')r.status='committed';
 else if(['saved','attention'].includes(r.status))r.status=rejectedCodes.has(r.error)||r.rejection?.code?'rejected':r.attempted?(r.safeToRetry?'draft':'uncertain'):'draft';
 if(r.status==='rejected'&&!r.error)r.error=r.rejection?.code||'REQUEST_REJECTED';
 return r;
}
export const publicationEditable=row=>!row||['draft','rejected','closed'].includes(normaliseOperation(row).status);
export function failureState(error){return error.beforeDispatch?'draft':(error.deterministicRejection||[400,401,403,409,422].includes(error.status)&&rejectedCodes.has(error.code))?'rejected':'uncertain';}
export class PrivateStore {
  constructor(app,dbFactory=indexedDB){this.name=`provision:${app}:staging:1`;this.factory=dbFactory;}
  async open(){if(this.db)return this.db;this.db=await new Promise((resolve,reject)=>{const r=this.factory.open(this.name,1);r.onupgradeneeded=()=>{for(const n of ['server','drafts','outbox','files'])r.result.createObjectStore(n,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not save safely on this device.'));r.onblocked=()=>reject(Error('Close another Provision tab to update device storage.'));});this.db.onversionchange=()=>{this.db.close();this.db=null;};return this.db;}
  key(user,source,id){if(!user)throw Error('Sign in before saving private work.');return JSON.stringify([user,source||null,id]);}
  async transaction(store,mode,action){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let value;const request=action(tx.objectStore(store));request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('Could not save safely on this device. Your work has not been queued.'));});}
  async get(store,user,source,id){const row=await this.transaction(store,'readonly',s=>s.get(this.key(user,source,id)));return store==='outbox'?normaliseOperation(row):row;}
  put(store,user,source,id,value){return this.transaction(store,'readwrite',s=>s.put({...value,key:this.key(user,source,id),user,source:source||null,id}));}
  remove(store,user,source,id){return this.transaction(store,'readwrite',s=>s.delete(this.key(user,source,id)));}
  async list(store,user,source){if(!user)return [];const rows=await this.transaction(store,'readonly',s=>s.getAll());return rows.filter(r=>r.user===user&&(source===undefined||r.source===(source||null))).map(r=>store==='outbox'?normaliseOperation(r):r);}
  async clearServer(user,source){for(const row of await this.list('server',user,source))await this.remove('server',user,row.source,row.id);}
  async saveDraft(user,source,id,value,expectedLocalVersion){
    const db=await this.open(),key=this.key(user,source,id);
    return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts');let saved;const r=s.get(key);
      r.onsuccess=()=>{if((r.result?.localVersion||0)!==expectedLocalVersion){tx.abort();return;}saved={...value,key,user,source:source||null,id,localVersion:expectedLocalVersion+1,updatedAt:Date.now()};s.put(saved);};
      tx.oncomplete=()=>resolve(saved);tx.onerror=tx.onabort=()=>reject(Error('Draft changed in another tab, or device storage failed. Reopen the saved draft before editing.'));
    });
  }
  async acknowledgeDraft(user,source,id,publishId,localVersion){
    const db=await this.open(),key=this.key(user,source,id);
    return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts'),r=s.get(key);
      r.onsuccess=()=>{if(!r.result)return;if(r.result.publishId!==publishId||r.result.localVersion!==localVersion){tx.abort();return;}s.delete(key);};
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('Publication acknowledged, but this draft changed in another tab. Your newer edits were retained.'));
    });
  }

}
export class Outbox {
 constructor(store,api,{identity,lock=globalThis.navigator?.locks}={}){this.store=store;this.api=api;this.identity=identity;this.lock=lock;}
 checkIdentity(row){if(!row)throw Error('This local attempt has been discarded. Reopen the current record.');if(this.identity()!==row.user)throw Error('Account changed. Sign back in to the account that saved this operation.');}
 locked(row,fn){if(!this.lock)throw Error('This browser cannot safely coordinate saved work across tabs.');return this.lock.request(`${this.store.name}:${row.key}`,async()=>{const current=await this.store.get('outbox',row.user,row.source,row.id);this.checkIdentity(current);return fn(current);});}
 async prepare(user,source,name,payload,explicitId=null){
  if(!this.lock)throw Error('This browser cannot safely coordinate outbound work across tabs.');
  return this.lock.request(`${this.store.name}:${user}:${source}:prepare`,async()=>{
   if(this.identity()!==user)throw Error('Account changed before saving the operation.');
   if(explicitId)return this.enqueue(user,source,explicitId,name,{...payload,operation_id:explicitId});
   const encode=p=>JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='operation_id').sort(([a],[b])=>a.localeCompare(b))));
   const rows=(await this.store.list('outbox',user,source)).filter(r=>r.status!=='closed');
   const same=rows.find(r=>r.name===name&&encode(JSON.parse(r.payload))===encode(payload)&&(r.status!=='committed'||['integrity_respond_claim_v1','integrity_collect_claim_v1'].includes(name)||Date.now()-r.createdAt<900000));if(same)return same;
   const target=p=>p.claim_id||p.offer_id||p.lot_id||p.attachment_id||p.source_id||p.food_id||null;
   const earlier=rows.find(r=>r.name===name&&r.status!=='committed'&&target(JSON.parse(r.payload))===target(payload));
   if(earlier)throw Error(earlier.status==='rejected'?'The previous attempt was rejected. Edit or discard it in Saved work before submitting changed terms.':'An earlier attempt must be checked and closed in Saved work before submitting changed terms.');
   return this.enqueue(user,source,crypto.randomUUID(),name,payload);
  });
 }
 async enqueue(user,source,id,name,payload){
  payload={...payload,operation_id:id};this.api.validate(name,'request',payload);
  const existing=await this.store.get('outbox',user,source,id);
  if(existing){if(existing.name!==name||existing.payload!==JSON.stringify(payload))throw Error('Existing operation must retain its exact payload.');if(existing.status==='closed')throw Error('This attempt was closed. A changed action needs a new operation ID.');return existing;}
  await this.store.put('outbox',user,source,id,{name,payload:JSON.stringify(payload),status:'draft',createdAt:Date.now(),attempted:false});return this.store.get('outbox',user,source,id);
 }
 async committedResult(row,operation){
  if(row.result)return row.result;
  const p=JSON.parse(row.payload);
  // Lookup proves commitment. Read authoritative state; never dispatch the mutation again.
  if(row.name==='integrity_create_lot_v1'&&(!operation.record_id||!Number.isInteger(operation.revision)))throw Error('Committed batch identity is incomplete. Keep the draft and check again.');
  if(row.name==='integrity_create_lot_v1')return {contract_version:this.api.config?.contractVersion||'1.0.0-draft.1',server_time:operation.committed_at,data:{lot_id:operation.record_id,revision:operation.revision}};
  if(['integrity_publish_v1','integrity_publish_v2'].includes(row.name))return this.api.rpc('integrity_member_offer_v1',{source_id:row.source,offer_id:null,lot_id:p.lot_id});
  if(row.name.includes('_claim_')){
   const detail=await this.api.rpc('integrity_claim_detail_v1',{claim_id:p.claim_id||operation.record_id});
   if(row.name==='integrity_collect_claim_v1'){
    const offer=await this.api.rpc('integrity_member_offer_v1',{source_id:row.source,offer_id:detail.data.claim.terms.offer_id,lot_id:null});
    return {data:{claim:detail.data.claim,offer:offer.data},recovered:true,receipt:operation};
   }
   return {...detail,data:detail.data.claim};
  }
  return {data:null,recovered:true,receipt:operation};
 }
 async review(row,reviewer){return this.locked(row,async current=>{const reviewed=await reviewer(current,this.api);this.checkIdentity(current);if(reviewed.status!==current.status)await this.store.put('outbox',current.user,current.source,current.id,reviewed);return reviewed;});}
 async reconcile(row){return this.locked(row,r=>this.reconcileLocked(r));}
 async reconcileLocked(row){
  this.checkIdentity(row);if(['committed','closed'].includes(row.status))return row;
  try{
   const response=await this.api.rpc('integrity_operation_v1',{operation_id:row.id,action:row.name,source_id:row.source});this.checkIdentity(row);
   const operation=response.data;
   if(operation===null){row.status=row.status==='rejected'?'rejected':'draft';row.safeToRetry=true;row.reconciliation='not_committed';}
   else{
    if(operation.operation_id!==row.id||operation.action!==row.name)throw Error('Operation check returned a different operation. Your saved request was retained.');
    row.serverOperation=operation;row.safeToRetry=false;
    if(operation.status==='committed'){
     row.result=await this.committedResult(row,operation);this.checkIdentity(row);row.status='committed';row.error=null;row.reconciliation='committed';
    }else{row.status=operation.status==='failed'?'rejected':'uncertain';row.reconciliation=operation.status;row.error=operation.error_code||null;}
   }
   row.reconciledAt=Date.now();row.reconciliationError=null;
   await this.store.put('outbox',row.user,row.source,row.id,row);return row;
  }catch(e){row.safeToRetry=false;row.reconciliationError=e.code||e.message;await this.store.put('outbox',row.user,row.source,row.id,row);throw e;}
 }
 async close(row,{discard=false}={}){
  return this.locked(row,async r=>{
   if(['sending','uncertain'].includes(r.status))r=await this.reconcileLocked(r);
   if(r.status==='committed')throw Error('This operation committed. View the authoritative record; it cannot be discarded as a failed attempt.');
   if(!['draft','rejected','closed'].includes(r.status))throw Error('The server outcome is still uncertain. Check again before closing this attempt.');
   r.status='closed';r.closedAt=Date.now();
   if(discard)await this.store.remove('outbox',r.user,r.source,r.id);else await this.store.put('outbox',r.user,r.source,r.id,r);
   return r;
  });
 }
 async send(row,{reviewed=false}={}){
  return this.locked(row,async row=>{
   if(row.status==='committed')return row.result||{data:null,recovered:true,receipt:row.serverOperation};
   if(['uncertain','sending'].includes(row.status))row=await this.reconcileLocked(row);
   if(row.status==='committed')return row.result;
   if(row.status==='rejected')throw Error('This attempt was rejected. Edit or discard the failed attempt; sending the same invalid values will not help.');
   if(row.status!=='draft')throw Error('The server outcome must be checked before this attempt can continue.');
   if(!row.attempted&&!reviewed&&Date.now()-row.createdAt>900000)throw Error('Review this saved operation against current stock before sending.');
   const save=()=>this.store.put('outbox',row.user,row.source,row.id,row);
   row.status='sending';row.attempted=true;row.safeToRetry=false;await save();
   try{
    this.checkIdentity(row);const result=await this.api.rpc(row.name,JSON.parse(row.payload));this.checkIdentity(row);
    row.status='committed';row.result=result;row.error=null;await save();return result;
   }catch(e){row.status=failureState(e);row.error=e.code||e.message;row.rejectedAt=row.status==='rejected'?Date.now():null;await save();throw e;}
  });
 }
}
