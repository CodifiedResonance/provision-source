export const claimFilters=[['requested','Awaiting response'],['accepted','Accepted'],['collected','Collected'],['declined','Declined'],['cancelled','Cancelled'],['expired','Expired'],['source_unfulfillable','Cannot fulfil'],['all','All']];
export const claimIntent={claim:{label:'Request some from this batch',help:'Ask the Source to hold a quantity for collection.',operation:'integrity_request_claim_v1'},demand:{label:'I regularly need this',help:'Privately signal ongoing local demand. This does not reserve this batch.',operation:'integrity_save_demand_v1'}};
export const activeClaims=(claims,offerId)=>claims.filter(c=>c.terms.offer_id===offerId&&['requested','accepted'].includes(c.status));
export const claimPersonalText=c=>`${c.terms.quantity}${c.terms.unit} ${c.status==='accepted'?'held for you':'requested · awaiting Source'}`;
export const requestedClaims=claims=>claims.filter(c=>c.status==='requested');
export function holdBounds(claim,now){const start=Math.max(now,Date.parse(claim.terms.collection_start)),end=Date.parse(claim.terms.collection_end);return {start,end,valid:Number.isFinite(start)&&Number.isFinite(end)&&end>start};}
export function holdError(value,claim,now){const b=holdBounds(claim,now),v=Date.parse(value);return !b.valid||!Number.isFinite(v)||v<=b.start||v>b.end?'Choose a hold time within the requested collection window.':null;}
export function localDate(value){if(!value)return '';const d=new Date(value);return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,19);}
export const stockText=o=>`${o.physical_quantity??'Unknown'}${o.unit} physical · ${o.held_quantity}${o.unit} held · ${o.claimable_quantity}${o.unit} available`;
export function rejectionReason(code){return {INVALID_COLLECTION_WINDOW:'Hold time was outside the collection window.',REVISION_CONFLICT:'The claim or stock changed. Review the current request before accepting.',INSUFFICIENT_STOCK:'There is not enough available stock for this request.',INVALID_TRANSITION:'This claim can no longer make that transition.',FORBIDDEN:'Your current role does not permit this action.',AUTH_REQUIRED:'Sign in again before continuing.'}[code]||code||'The server rejected this attempt.';}
export async function currentClaim(api,claimId){const detail=(await api.rpc('integrity_claim_detail_v1',{claim_id:claimId})).data;const offer=(await api.rpc('integrity_member_offer_v1',{source_id:detail.claim.source_id,offer_id:detail.claim.terms.offer_id,lot_id:null})).data;return {detail,claim:detail.claim,offer};}
export async function acceptanceContext(api,claimId){const current=await currentClaim(api,claimId);if(current.claim.status!=='requested')throw Error('This claim is now '+current.claim.status+'. Open its current record.');return current;}

export const claimTime=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Unknown';
export async function reviewSavedAcceptance(row,api){
 if(row.name!=='integrity_respond_claim_v1'||row.status!=='draft'||row.attempted&&!row.safeToRetry)return row;
 const p=JSON.parse(row.payload);if(!p.accept)return row;
 const detail=(await api.rpc('integrity_claim_detail_v1',{claim_id:p.claim_id})).data;
 if(holdError(p.hold_until,detail.claim,api.now()))return {...row,status:'rejected',error:'INVALID_COLLECTION_WINDOW',rejectionOrigin:'local_review'};
 return row;
}
