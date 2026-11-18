import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {claimFixture,ids,now,end} from './claim-fixture.js';
import {reviewSavedAcceptance,holdError,activeClaims,claimPersonalText,requestedClaims,stockText,claimIntent,claimFilters} from '../staging/src/claim-journey.js';
import {normaliseOperation,failureState} from '../staging/src/storage.js';
const locks={queues:new Map(),request(key,fn){const next=(this.queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);this.queues.set(key,next);return next;}};
const fixture=async t=>{const f=await claimFixture(indexedDB,locks);t.after(()=>f.store.db?.close());await f.request();return f;};
const rowFor=(f,id)=>f.store.get('outbox',ids.user,ids.source,id);
const writes=(f,name)=>f.calls.filter(c=>c.name===name);
test('known hold-window rejection is rejected, editable after explicit closure, never uncertain',async t=>{
 const f=await fixture(t),payload={...f.acceptPayload(),hold_until:'2026-09-16T00:00:00Z'},r=await f.prepare('integrity_respond_claim_v1',payload);
 await assert.rejects(f.outbox.send(r),/INVALID_COLLECTION_WINDOW/);assert.equal((await rowFor(f,r.id)).status,'rejected');assert.equal(f.claim().status,'requested');assert.equal(stockText(f.offer),'20kg physical · 0kg held · 20kg available');
 await assert.rejects(f.outbox.send(r),/rejected/);assert.equal(writes(f,r.name).length,1);
 await assert.rejects(f.prepare(r.name,f.acceptPayload()),/Edit or discard/);
 await f.outbox.close(r);const fixed=await f.prepare(r.name,f.acceptPayload());assert.notEqual(fixed.id,r.id);assert.equal((await rowFor(f,r.id)).payload,r.payload);assert.equal((await rowFor(f,r.id)).status,'closed');
 await f.outbox.send(fixed);assert.equal(f.claim().status,'accepted');
});
test('true lost acceptance response queries exact ID and adopts committed state with no redispatch',async t=>{
 const f=await fixture(t),r=await f.prepare('integrity_respond_claim_v1',f.acceptPayload());f.loss('after');await assert.rejects(f.outbox.send(r));assert.equal((await rowFor(f,r.id)).status,'uncertain');
 const result=await f.outbox.send(r);assert.equal(result.data.status,'accepted');assert.equal(writes(f,r.name).length,1);assert.ok(f.calls.some(c=>c.name==='integrity_operation_v1'&&c.p.operation_id===r.id));assert.equal(stockText(f.offer),'20kg physical · 1kg held · 19kg available');
});
test('absent exact operation permits identical retry; changed payload requires close then a new ID',async t=>{
 const f=await fixture(t),r=await f.prepare('integrity_respond_claim_v1',f.acceptPayload());f.loss('before');await assert.rejects(f.outbox.send(r));
 const checked=await f.outbox.reconcile(r);assert.equal(checked.status,'draft');assert.equal(checked.safeToRetry,true);
 await assert.rejects(f.outbox.enqueue(ids.user,ids.source,r.id,r.name,{...JSON.parse(r.payload),reason:'changed'}),/exact payload/);
 await assert.rejects(f.prepare(r.name,{...f.acceptPayload(),reason:'changed'}),/closed/);
 await f.outbox.send(checked);assert.deepEqual(writes(f,r.name)[0].p,writes(f,r.name)[1].p);assert.equal(f.claim().status,'accepted');
});
test('pending or failed lookup cannot be abandoned to generate a replacement',async t=>{
 const f=await fixture(t),r=await f.prepare('integrity_respond_claim_v1',f.acceptPayload());f.loss('before');await assert.rejects(f.outbox.send(r));
 for(const status of ['pending','error']){f.lookup(status);await assert.rejects(f.outbox.close(r));await assert.rejects(f.prepare(r.name,{...f.acceptPayload(),reason:'changed'}));}
 assert.equal(writes(f,r.name).length,1);assert.equal(f.claim().status,'requested');
});
test('discard rejected local acceptance does not cancel the consumer claim',async t=>{
 const f=await fixture(t),r=await f.prepare('integrity_respond_claim_v1',f.acceptPayload());f.reject('INVALID_COLLECTION_WINDOW');await assert.rejects(f.outbox.send(r));await f.outbox.close(r,{discard:true});assert.equal(await rowFor(f,r.id),undefined);assert.equal(f.claim().status,'requested');assert.equal(writes(f,'integrity_cancel_claim_v1').length,0);
});
test('20kg request/accept/collect lifecycle and acknowledged retries preserve exact quantities',async t=>{
 const f=await fixture(t);assert.equal(stockText(f.offer),'20kg physical · 0kg held · 20kg available');
 const accept=await f.prepare('integrity_respond_claim_v1',f.acceptPayload());await f.outbox.send(accept);await f.outbox.send(accept);assert.equal(stockText(f.offer),'20kg physical · 1kg held · 19kg available');assert.equal(writes(f,accept.name).length,1);
 const collect=await f.prepare('integrity_collect_claim_v1',f.collectPayload());await f.outbox.send(collect);await f.outbox.send(collect);assert.equal(stockText(f.offer),'19kg physical · 0kg held · 19kg available');assert.equal(writes(f,collect.name).length,1);
});
test('lost collection response adopts current authoritative claim and stock without another subtraction',async t=>{
 const f=await fixture(t);await f.outbox.send(await f.prepare('integrity_respond_claim_v1',f.acceptPayload()));const r=await f.prepare('integrity_collect_claim_v1',f.collectPayload());f.loss('after');await assert.rejects(f.outbox.send(r));const result=await f.outbox.send(r);assert.equal(result.data.claim.status,'collected');assert.equal(stockText(result.data.offer),'19kg physical · 0kg held · 19kg available');assert.equal(writes(f,r.name).length,1);assert.equal(result.data.movement_event_id,undefined,'never invent the original movement receipt');
});
test('personal offer state, independent My holds and Source attention reflect requested and accepted claims',async t=>{
 const f=await fixture(t);let mine=(await f.api.page('integrity_my_claims_v1',{})).data.items;assert.equal(claimPersonalText(activeClaims(mine,ids.offer)[0]),'1kg requested · awaiting Source');assert.equal(requestedClaims((await f.api.page('integrity_source_claims_inbox_v1',{source_id:ids.source,filter:'requested'})).data.items).length,1);
 await f.outbox.send(await f.prepare('integrity_respond_claim_v1',f.acceptPayload()));mine=(await f.api.page('integrity_my_claims_v1',{})).data.items;assert.equal(claimPersonalText(activeClaims(mine,ids.offer)[0]),'1kg held for you');assert.equal(requestedClaims(mine).length,0);assert.equal((await f.api.page('integrity_offers_v1',{source_id:null,food_id:null})).data.items.length,1);assert.equal((await f.api.page('integrity_source_claims_inbox_v1',{source_id:ids.source,filter:'accepted'})).data.items.length,1);
});
test('hold bounds exclude now/start, include collection end, and reject expired windows',async t=>{
 const f=await fixture(t);assert.equal(holdError(end,f.claim(),Date.parse(now)),null);for(const value of ['',now,'2026-09-16T00:00:00Z'])assert.match(holdError(value,f.claim(),Date.parse(now)),/within the requested collection window/);assert.ok(holdError(end,f.claim(),Date.parse(end)));
});
test('legacy validation attention migrates to rejected; ambiguous legacy work stays uncertain',()=>{
 assert.equal(normaliseOperation({status:'attention',attempted:true,error:'INVALID_COLLECTION_WINDOW'}).status,'rejected');assert.equal(normaliseOperation({status:'saved',attempted:true,error:'CONNECTION_UNCONFIRMED'}).status,'uncertain');assert.equal(failureState({status:400,deterministicRejection:true,code:'BOUNDED_VALUE_ERROR'}),'rejected');assert.equal(failureState({status:502,code:'INVALID_SERVER_RESPONSE'}),'uncertain');assert.equal(failureState({beforeDispatch:true,code:'AUTH_REQUIRED'}),'draft');
});
test('demand and batch claim have distinct visible intent and wire operations; durable status filters include terminal records',()=>{
 assert.notEqual(claimIntent.claim.operation,claimIntent.demand.operation);assert.match(claimIntent.claim.label,/this batch/);assert.match(claimIntent.claim.help,/hold a quantity/);assert.match(claimIntent.demand.label,/regularly/);assert.match(claimIntent.demand.help,/does not reserve/);assert.deepEqual(claimFilters.map(x=>x[1]),['Awaiting response','Accepted','Collected','Declined','Cancelled','Expired','Cannot fulfil','All']);
});

test('legacy absent saved acceptance with an invalid time offers correction, not an exact-send loop',async t=>{
 const f=await fixture(t),r=await f.prepare('integrity_respond_claim_v1',{...f.acceptPayload(),hold_until:'2026-09-16T00:00:00Z'});f.loss('before');await assert.rejects(f.outbox.send(r));
 const uncertain=await rowFor(f,r.id);assert.equal((await reviewSavedAcceptance(uncertain,f.api)).status,'uncertain');const absent=await f.outbox.reconcile(r);const reviewed=await reviewSavedAcceptance(absent,f.api);assert.equal(reviewed.status,'rejected');assert.equal(reviewed.payload,r.payload);assert.equal(reviewed.error,'INVALID_COLLECTION_WINDOW');assert.equal(writes(f,r.name).length,1);
});

test('reopening an acknowledged acceptance after the former dedupe interval still reuses its committed attempt',async t=>{
 const f=await fixture(t),payload=f.acceptPayload(),r=await f.prepare('integrity_respond_claim_v1',payload);await f.outbox.send(r);const committed=await rowFor(f,r.id);await f.store.put('outbox',ids.user,ids.source,r.id,{...committed,createdAt:0});const retry=await f.prepare(r.name,payload);assert.equal(retry.id,r.id);await f.outbox.send(retry);assert.equal(writes(f,r.name).length,1);
});
