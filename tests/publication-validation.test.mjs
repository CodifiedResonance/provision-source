import test from 'node:test';
import assert from 'node:assert/strict';
import {formPrice,firstPublicationIssue,serverPublicationIssue} from '../staging/src/publication-validation.js';
const now=Date.parse('2026-09-12T12:00:00Z');
const form=()=>({foodId:'potatoes',unit:'kg',quantity:'20',price:formPrice({status:'free',basis:'per_unit'}),listingExpiresAt:'2026-09-13T12:00:00Z',collectionStart:null,collectionEnd:null,reservable:false,note:''});
test('free includes its required basis and unknown clears all stale price fields',()=>{
 assert.equal(form().price.basis,'per_unit');assert.equal(firstPublicationIssue(form(),now),null);
 const price=formPrice({status:'unknown',amount:'2.50',basis:'bundle',bundle:'2',packageUnit:'kg',packageQuantity:''});
 assert.deepEqual(price,{status:'unknown',amount:null,currency:'GBP',basis:null,bundle_quantity:null,package_quantity:null,package_unit:null});assert.equal(firstPublicationIssue({...form(),price},now),null);
});
test('publication routes to the first invalid field in form order',()=>{
 const f=form();f.foodId='';f.quantity='bad';f.price=formPrice({status:'priced',amount:'0',basis:'per_kg'});f.listingExpiresAt=null;
 assert.equal(firstPublicationIssue(f,now).field,'food');f.foodId='potatoes';assert.equal(firstPublicationIssue(f,now).field,'qty');f.quantity='20';assert.equal(firstPublicationIssue(f,now).field,'amount');f.price.amount='2.50';assert.equal(firstPublicationIssue(f,now).field,'expires');f.listingExpiresAt='2026-09-13T12:00:00Z';assert.equal(firstPublicationIssue(f,now),null);
});
test('invalid price amount, basis and package pairing are directed to editable fields',()=>{
 for(const amount of ['0','-1','1.234','bad'])assert.equal(firstPublicationIssue({...form(),price:formPrice({status:'priced',amount,basis:'per_kg'})},now).field,'amount');
 assert.equal(firstPublicationIssue({...form(),unit:'each',price:formPrice({status:'priced',amount:'2.50',basis:'per_kg'})},now).field,'basis');
 assert.equal(firstPublicationIssue({...form(),price:formPrice({status:'free',basis:'per_unit',packageUnit:'kg'})},now).field,'pack');
 assert.equal(firstPublicationIssue({...form(),price:formPrice({status:'free',basis:'per_unit',packageQuantity:'2'})},now).field,'packUnit');
 assert.equal(serverPublicationIssue('INVALID_PRICE').field,'status');
});
