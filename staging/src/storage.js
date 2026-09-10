export class PrivateStore {
  constructor(app,dbFactory=indexedDB){this.name=`provision:${app}:staging:1`;this.factory=dbFactory;}
  async open(){if(this.db)return this.db;this.db=await new Promise((resolve,reject)=>{const r=this.factory.open(this.name,1);r.onupgradeneeded=()=>{for(const n of ['server','drafts','outbox','files'])r.result.createObjectStore(n,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not save safely on this device.'));r.onblocked=()=>reject(Error('Close another Provision tab to update device storage.'));});this.db.onversionchange=()=>{this.db.close();this.db=null;};return this.db;}
  key(user,source,id){if(!user)throw Error('Sign in before saving private work.');return JSON.stringify([user,source||null,id]);}
  async transaction(store,mode,action){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let value;const request=action(tx.objectStore(store));request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('Could not save safely on this device. Your work has not been queued.'));});}
  get(store,user,source,id){return this.transaction(store,'readonly',s=>s.get(this.key(user,source,id)));}
  put(store,user,source,id,value){return this.transaction(store,'readwrite',s=>s.put({...value,key:this.key(user,source,id),user,source:source||null,id}));}
  remove(store,user,source,id){return this.transaction(store,'readwrite',s=>s.delete(this.key(user,source,id)));}
  async list(store,user,source){if(!user)return [];const rows=await this.transaction(store,'readonly',s=>s.getAll());return rows.filter(r=>r.user===user&&(source===undefined||r.source===(source||null)));}
  async clearServer(user,source){for(const row of await this.list('server',user,source))await this.remove('server',user,row.source,row.id);}
  async saveDraft(user,source,id,value,expectedLocalVersion){
    const db=await this.open(),key=this.key(user,source,id);
    return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),s=tx.objectStore('drafts');let saved;const r=s.get(key);
      r.onsuccess=()=>{if((r.result?.localVersion||0)!==expectedLocalVersion){tx.abort();return;}saved={...value,key,user,source:source||null,id,localVersion:expectedLocalVersion+1,updatedAt:Date.now()};s.put(saved);};
      tx.oncomplete=()=>resolve(saved);tx.onerror=tx.onabort=()=>reject(Error('Draft changed in another tab, or device storage failed. Reopen the saved draft before editing.'));
    });
  }
}
export class Outbox {
  constructor(store,api,{identity,lock=globalThis.navigator?.locks}={}){this.store=store;this.api=api;this.identity=identity;this.lock=lock;}
  async prepare(user,source,name,payload,explicitId=null){
    if(!this.lock)throw Error('This browser cannot safely coordinate outbound work across tabs.');
    return this.lock.request(`${this.store.name}:${user}:${source}:prepare`,async()=>{
      if(this.identity()!==user)throw Error('Account changed before saving the operation.');
      if(explicitId)return this.enqueue(user,source,explicitId,name,{...payload,operation_id:explicitId});
      const encode=value=>JSON.stringify(Object.fromEntries(
        Object.entries(value).filter(([k])=>k!=='operation_id').sort(([a],[b])=>a.localeCompare(b))
      ));
      const rows=await this.store.list('outbox',user,source),same=rows.find(r=>r.name===name&&encode(JSON.parse(r.payload))===encode(payload)&&(r.status!=='published'||Date.now()-r.createdAt<900000));
      if(same)return same;
      const target=p=>p.offer_id||p.claim_id||p.lot_id||p.attachment_id||p.source_id||p.food_id||null;
      if(rows.some(r=>r.name===name&&r.attempted&&['saved','sending'].includes(r.status)&&target(JSON.parse(r.payload))===target(payload)))throw Error('An earlier operation for this item has an unresolved acknowledgement. Resolve it in Saved work before changing the request.');
      const id=crypto.randomUUID();return this.enqueue(user,source,id,name,{...payload,operation_id:id});
    });
  }
  async enqueue(user,source,id,name,payload){
    this.api.validate(name,'request',payload);
    const existing=await this.store.get('outbox',user,source,id);
    if(existing){if(existing.name!==name||existing.payload!==JSON.stringify(payload))throw Error('Existing operation must retain its exact payload.');return existing;}
    const row={name,payload:JSON.stringify(payload),status:'saved',createdAt:Date.now(),attempted:false};
    await this.store.put('outbox',user,source,id,row);return this.store.get('outbox',user,source,id);
  }
  async send(row,{reviewed=false}={}){
    if(!this.lock)throw Error('This browser cannot safely coordinate publication across tabs. Use a supported browser.');
    return this.lock.request(`${this.store.name}:${row.key}`,async()=>{
      row=await this.store.get('outbox',row.user,row.source,row.id);
      if(this.identity()!==row.user)throw Error('Sign back in to the account that saved this operation.');
      if(row.status==='published')return row.result;
      if(row.status==='attention')throw Error('This operation needs reconciliation. Review current server state before creating a replacement.');
      if(!row.attempted&&!reviewed&&Date.now()-row.createdAt>15*60*1000)throw Error('Review this saved operation against current stock before sending.');
      const save=()=>this.store.put('outbox',row.user,row.source,row.id,row);
      row.status='sending';row.attempted=true;await save();
      try{
        if(this.identity()!==row.user)throw Error('Account changed before sending. Sign back in to the original account.');
        // Exact authorised replay is the backend replay contract. Never mint another ID.
        const result=await this.api.rpc(row.name,JSON.parse(row.payload));
        row.status='published';row.result=result;await save();return result;
      }catch(e){row.status=[400,403,409].includes(e.status)||e.code==='INVALID_REQUEST'?'attention':'saved';row.error=e.code||e.message;await save();throw e;}
    });
  }
}
