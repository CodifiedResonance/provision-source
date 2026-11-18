import {quantity,decimal} from './domain.js';
export function formPrice({status,amount,basis,bundle,packageQuantity,packageUnit}){
  if(status==='unknown')return {status,amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null};
  return {status,amount:status==='free'?'0':amount,currency:'GBP',basis,bundle_quantity:basis==='bundle'?bundle:null,package_quantity:packageQuantity||null,package_unit:packageUnit||null};
}
export function firstPublicationIssue(f,now){
 const issue=(field,message)=>({field,message});
 if(!f.foodId)return issue('food','Choose a food.');
 try{quantity(f.quantity,f.unit);}catch(e){return issue('qty',e.message);}
 const p=f.price;
 if(!['unknown','free','priced'].includes(p.status))return issue('status','Choose Price not supplied, Free or Set price.');
 if(p.status==='unknown'&&p.amount!==null)return issue('status','Choose how you want to describe the price.');
 if(p.status==='free'&&p.amount!=='0')return issue('status','Select Free to record a zero price.');
 if(p.status==='priced'){
  try{if(decimal(p.amount)<=0n||decimal(p.amount)%10n)throw Error();}catch{return issue('amount','Enter a price above £0 with no more than two decimal places, or choose Free.');}
 }
 if(p.status!=='unknown'&&!p.basis)return issue('basis','Choose what the price covers.');
 if((p.basis==='per_kg'&&f.unit!=='kg')||(p.basis==='per_litre'&&f.unit!=='litre'))return issue('basis','Choose a price basis that matches how this batch is counted.');
 if(p.basis==='bundle'){try{quantity(p.bundle_quantity,f.unit);if(decimal(p.bundle_quantity)<=0n)throw Error();}catch{return issue('bundle','Enter how many counted units are in the bundle.');}}
 if(p.basis!=='bundle'&&p.bundle_quantity!==null)return issue('bundle','Bundle quantity only applies to a bundle price.');
 if(p.package_unit&&!p.package_quantity)return issue('pack','Enter the package quantity, or clear the package unit.');
 if(p.package_quantity&&!p.package_unit)return issue('packUnit','Choose a package unit, or clear the package quantity.');
 if(p.package_quantity){try{if(decimal(p.package_quantity)<=0n)throw Error();}catch{return issue('pack','Enter a package quantity above zero.');}}
 if(f.reservable&&f.lifecycle!=='ready')return issue('lifecycle','Choose Ready before allowing hold requests.');
 if(!f.listingExpiresAt||Date.parse(f.listingExpiresAt)<=now||!Number.isFinite(Date.parse(f.listingExpiresAt)))return issue('expires','Choose a future declaration expiry.');
 if(Date.parse(f.listingExpiresAt)>now+30*86400000)return issue('expires','Choose a declaration expiry within the next 30 days.');
 if(f.collectionStart&&f.collectionEnd&&Date.parse(f.collectionEnd)<=Date.parse(f.collectionStart))return issue('end','Collection must end after it starts.');
 if(f.reservable&&(!f.collectionStart||!f.collectionEnd))return issue(!f.collectionStart?'start':'end','Add a collection window to allow hold requests.');
 if(f.reservable&&Date.parse(f.collectionEnd)<=now)return issue('end','Choose a collection end time in the future.');
 if(f.note.length>2000)return issue('note','Keep the note to 2,000 characters or fewer.');
 return null;
}
export function serverPublicationIssue(code){
 if(['INVALID_PRICE','INVALID_PRICE_BASIS'].includes(code))return {field:code==='INVALID_PRICE_BASIS'?'basis':'status',message:'Review the price details below. Choose Price not supplied, Free, or a valid amount and basis.'};
 if(/EXPIR/.test(code))return {field:'expires',message:'Choose a future declaration expiry.'};
 if(code==='NOT_RESERVABLE'||/COLLECTION/.test(code))return {field:'start',message:'Review the collection start and end times.'};
 return null;
}
