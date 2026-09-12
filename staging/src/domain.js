export const UNITS=['each','kg','g','litre','ml','dozen','box','bag','loaf','item'];
export function decimal(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/.test(value))throw Error('Use a quantity with up to three decimal places.');
  const [a,b='']=value.split('.');return BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));
}
export function quantity(value,unit){const n=decimal(value);if(['item','each','dozen','box','bag','loaf'].includes(unit)&&n%1000n)throw Error('This unit must be counted in whole numbers.');return value;}
export function defaultUnit(name){const n=name.toLowerCase();if(/potato/.test(n))return 'kg';if(/egg/.test(n))return 'dozen';if(/bread/.test(n))return 'loaf';return 'each';}
export function money(value,currency='GBP'){
  if(value===null)return 'Price not supplied';decimal(value);
  let [a,b='']=value.split('.');b=b.padEnd(2,'0');
  return `${currency==='GBP'?'£':currency+' '}${a.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${b}`;
}
export function priceText(p,unit){
  if(!p||p.status==='unknown')return 'Price not supplied';
  if(p.status==='free')return 'Free';
  const amount=money(p.amount,p.currency);
  if(p.basis==='bundle')return `${p.bundle_quantity} ${unit} for ${amount}`;
  return `${amount} ${p.basis==='per_kg'?'per kg':p.basis==='per_litre'?'per litre':p.basis==='per_lot'?'per batch':'per '+unit}`;
}
export function locationText(o){return o.latitude===null||o.longitude===null?'Location not yet resolved':`${o.latitude.toFixed(4)}, ${o.longitude.toFixed(4)}`;}
export function safeUrl(raw){try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function expired(o,now){return o.listing_expires_at!==null&&Date.parse(o.listing_expires_at)<=now;}
export function eligible(o,now,classification='live'){return ['live','test'].includes(classification)&&o.classification===classification&&o.source_active&&o.visibility==='public'&&o.withdrawal_state==='clear'&&!expired(o,now);}
export function claimable(o,now,classification='live'){return eligible(o,now,classification)&&o.lifecycle==='ready'&&o.reservable&&decimal(o.claimable_quantity)>0n&&(!o.collection_end||Date.parse(o.collection_end)>now);}
export function replaceRecords(records){return new Map(records.map(o=>[o.id,structuredClone(o)]));}
export function exportOffers(items,serverTime,checksum){return {schema:'provision-query/1.0.0-draft.1',contract_sha256:checksum,server_time:serverTime,scope:'One bounded RPC page; not complete network coverage',items:structuredClone(items)};}
export function combinationCandidates(items,now){return items.filter(o=>claimable(o,now)).slice(0,24);}
export function time(value){return value?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Unknown';}
export const emptyDates=()=>({harvested_at:null,landed_at:null,baked_at:null,packed_at:null,date_type:null,date_value:null,date_timezone:null,handling:null,allergen_information:null});
