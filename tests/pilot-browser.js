// Local-only UI harness. The preview bundler exposes mountForTest only when the ignored QA configuration selects pilot.
import {mountForTest} from '../staging/src/main.js';
import {claimFixture,ids,now,end} from './claim-fixture.js';
const f=await claimFixture(indexedDB);const requested=await f.request();
const collected={...structuredClone(requested),id:'10000000-0000-4000-8000-000000000099',status:'collected',collected_at:now};
const accepted={...structuredClone(requested),id:'10000000-0000-4000-8000-000000000098',status:'accepted',terms:{...requested.terms,hold_until:end}};
await mountForTest({session:{user:{id:ids.user,email:'synthetic@example.invalid'},access_token:'local-only'},view:'My holds',claims:[requested,accepted,collected],claimNames:{[requested.id]:'Potatoes',[accepted.id]:'Potatoes',[collected.id]:'Potatoes'},claimSources:{[requested.id]:'Controlled Source',[accepted.id]:'Controlled Source',[collected.id]:'Controlled Source'},personalClaims:[requested,accepted],personalReady:true,notices:[{id:ids.event,kind:'claim_accepted',claim_id:ids.claim,source_id:ids.source,created_at:now,read_at:now,delivery:'provider_accepted'}]},f);
