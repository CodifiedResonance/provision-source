const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const MERGE_FIELDS=['quantity','price','lifecycle','pressure','visibility','reservable','listingExpiresAt','collectionStart','collectionEnd','note'];
export function offerForm(o){return {foodId:o.food_id,unit:o.unit,quantity:o.physical_quantity??'',price:o.price,lifecycle:o.lifecycle==='retired'?'ready':o.lifecycle,pressure:o.pressure,visibility:o.visibility,reservable:o.reservable,listingExpiresAt:o.listing_expires_at,collectionStart:o.collection_start,collectionEnd:o.collection_end,note:o.note||'',noteTouched:false,dates:o.physical_dates};}
export function mergePlan(base,local,server){return MERGE_FIELDS.map(key=>{
  const a=local[key],b=server[key];
  if(same(a,b))return {key,choice:'server',local:a,server:b};
  if(key!=='quantity'&&base){if(same(a,base[key]))return {key,choice:'server',local:a,server:b};if(same(b,base[key]))return {key,choice:'local',local:a,server:b};}
  return {key,choice:null,local:a,server:b};
});}
