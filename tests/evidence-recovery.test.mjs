import test from 'node:test';
import assert from 'node:assert/strict';
import {continueEvidence} from '../staging/src/evidence-recovery.js';
function fixture(status='pending'){
  const calls=[],record={id:'attachment',eventId:'event',blob:new Blob(['photo'],{type:'image/png'}),checksum:'digest',caption:null,observedAt:null,beginId:'begin',finalizeId:'finalize',publishId:'publish'};
  const f={record,source:'source',api:{health:{capabilities:{evidence_upload:true}}},calls,status,allowed:true,uploads:0,valid:()=>f.allowed,
    command:async(name,payload,source,options)=>{calls.push({name,payload,source,options});if(name==='integrity_finalize_evidence_v1')f.status='linked';return null;},
    current:async()=>({status:f.status,public:false}),upload:async()=>{f.uploads++;f.status='uploaded';}};return f;
}
test('evidence completion confirms authoritative status even with recovered null acknowledgements',async()=>{
  const f=fixture();assert.equal((await continueEvidence(f)).status,'linked');assert.equal(f.uploads,1);
  assert.deepEqual(f.calls.map(x=>x.options.operationId),['begin','finalize']);assert.ok(!f.calls.some(x=>x.name.includes('publish')));
});
test('lost upload acknowledgement retries the same attachment without uploading bytes twice',async()=>{
  const f=fixture();f.upload=async()=>{f.uploads++;f.status='uploaded';throw Error('lost response');};await assert.rejects(continueEvidence(f),/lost response/);
  await continueEvidence(f);assert.equal(f.uploads,1);assert.deepEqual(f.calls.map(x=>x.options.operationId),['begin','begin','finalize']);assert.ok(f.calls.every(x=>x.payload.attachment_id==='attachment'));
});
test('lost finalize acknowledgement resumes linked photo without finalizing again',async()=>{
  const f=fixture('uploaded'),original=f.command;f.command=async(...args)=>{await original(...args);if(args[0].includes('finalize'))throw Error('lost response');};
  await assert.rejects(continueEvidence(f),/lost response/);await continueEvidence(f);assert.equal(f.calls.filter(x=>x.name.includes('finalize')).length,1);assert.equal(f.uploads,0);
});
test('terminal evidence states stop without replacement or publication',async()=>{
  for(const status of ['failed','quarantined','withdrawn']){const f=fixture(status);await assert.rejects(continueEvidence(f),new RegExp(status));assert.equal(f.calls.length,1);assert.equal(f.uploads,0);}
});
test('account or Source switch during upload prevents finalization under another identity',async()=>{
  const f=fixture();f.upload=async()=>{f.allowed=false;};await assert.rejects(continueEvidence(f),/Account or Source changed/);assert.equal(f.calls.length,1);
});
test('failed status lookup is not absence and cannot trigger another write',async()=>{
  const f=fixture();f.current=async()=>{throw Error('status unavailable');};await assert.rejects(continueEvidence(f),/status unavailable/);assert.equal(f.calls.length,1);assert.equal(f.uploads,0);
});
test('disabled evidence capability prevents all network operations',async()=>{
  const f=fixture();f.api.health.capabilities.evidence_upload=false;await assert.rejects(continueEvidence(f),/unavailable/);assert.equal(f.calls.length,0);
});
