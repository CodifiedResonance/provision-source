import fs from 'node:fs';
import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import {loadEnv} from 'vite';
const key=loadEnv('production',process.cwd(),'VITE_').VITE_STAGING_PUBLISHABLE_KEY||'';
if(key.startsWith('sb_secret_'))throw Error('Privileged key rejected before build');
if(key.startsWith('eyJ')){let token;try{token=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));}catch{throw Error('Invalid staging key');}if(token.role!=='anon'||token.ref!=='qaaskvbhssonbktdjdki')throw Error('Only this staging project anon key is permitted');}
if(key&&!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))throw Error('Expected a staging publishable key');
const bytes=fs.readFileSync('contract/provision-integrity-api-v1.json');
const expected='f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad';
if(createHash('sha256').update(bytes).digest('hex')!==expected) throw Error('Contract checksum changed: explicit backend revision required');
const c=JSON.parse(bytes),ajv=new Ajv({strict:false,inlineRefs:false,code:{source:true,esm:true},allErrors:false});
addFormats(ajv);const names={};
ajv.addSchema({$id:'integrity-definitions',$defs:c.$defs});
for(const op of c.operations) for(const side of ['request','response']) {
  const id=op.name+'_'+side;
  const schema=JSON.parse(JSON.stringify(op[side+'_schema']).replaceAll('"#/$defs/','"integrity-definitions#/$defs/'));
  ajv.addSchema(schema,id);names[id]=id;
}
const generated=standalone(ajv,names)
  .replaceAll('require("ajv-formats/dist/formats").fullFormats','fullFormats')
  .replaceAll('require("ajv/dist/runtime/ucs2length").default','ucs2length');
fs.writeFileSync('staging/src/validators.js',`import formats from 'ajv-formats/dist/formats.js';\nimport ucs2 from 'ajv/dist/runtime/ucs2length.js';\nconst {fullFormats}=formats; const ucs2length=ucs2.default||ucs2;\n`+generated);
fs.writeFileSync('staging/src/operations.json',JSON.stringify(Object.fromEntries(c.operations.map(o=>[o.name,{mutation:o.mutation,auth:o.auth}]))));
console.log('Pinned contract verified; generated 112 CSP-safe request/response validators.');
