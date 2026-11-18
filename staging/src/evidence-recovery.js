// Always retain the saved attachment and operation IDs across interrupted attempts.
export async function continueEvidence({record,source,api,command,upload,current,valid,report=()=>{}}){
  const guard=()=>{if(!valid())throw Error('Account or Source changed. Reopen your saved photo.');};
  guard();
  if(!api.health?.capabilities.evidence_upload)throw Error('Uploads are currently unavailable. Your photo is saved.');
  report('Registering saved photo…');
  await command('integrity_begin_evidence_v1',{source_id:source,event_id:record.eventId,attachment_id:record.id,media_type:record.blob.type,bytes:record.blob.size,checksum_sha256:record.checksum,caption:record.caption,declared_observed_at:record.observedAt},source,{operationId:record.beginId});
  guard();let d=await current();guard();
  const usable=()=>{if(['failed','withdrawn','quarantined'].includes(d.status))throw Error(`Photo is ${d.status}. No automatic replacement was made.`);};
  usable();
  if(d.status==='pending'){
    report('Uploading photo · keep this page open…');
    await upload();guard();d=await current();guard();usable();
  }
  if(d.status!=='linked'){
    report('Finalising and sanitising photo…');
    await command('integrity_finalize_evidence_v1',{source_id:source,attachment_id:record.id},source,{operationId:record.finalizeId});
    guard();d=await current();guard();usable();
  }
  if(d.status!=='linked')throw Error(`Server reports ${d.status}. Keep this saved photo and check again.`);
  report(`Photo linked · ${d.public?'publicly shared':'private'}. Preview the sanitised photo before sharing.`);
  return d;
}
