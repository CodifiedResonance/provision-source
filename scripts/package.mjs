import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const pkg=JSON.parse(fs.readFileSync('package.json'));
const app=pkg.name.includes('source')?'source':'consumer';
const key=process.env.VITE_STAGING_PUBLISHABLE_KEY||'';
if(key.startsWith('sb_secret_'))throw Error('Privileged key rejected');
if(key.startsWith('eyJ')){let token;try{token=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));}catch{throw Error('Invalid staging key');}if(token.role!=='anon'||token.ref!=='qaaskvbhssonbktdjdki')throw Error('Only this staging project anon key is permitted');}
if(key&&!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))throw Error('Expected a staging publishable key');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const manifest=JSON.parse(fs.readFileSync('dist/manifest.webmanifest'));
manifest.name=(app==='source'?'PROVISION SOURCE':'PROVISION')+' · STAGING';manifest.short_name=app==='source'?'SOURCE TEST':'PROVISION TEST';
manifest.description='Isolated Provision staging preview. No real collection arrangements.';
fs.writeFileSync('dist/manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' https://qaaskvbhssonbktdjdki.supabase.co wss://qaaskvbhssonbktdjdki.supabase.co; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
fs.writeFileSync('dist/_headers',`/*\n  Content-Security-Policy: ${csp}\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
const shell=files('dist').filter(p=>!['_headers','service-worker.js','release.json'].includes(path.basename(p))).map(p=>'./'+path.relative('dist',p));
const hash=createHash('sha256');hash.update(fs.readFileSync('scripts/service-worker.template.js'));for(const p of [...shell].sort())hash.update(fs.readFileSync(path.join('dist',p)));
const revision=hash.digest('hex').slice(0,20);
let sw=fs.readFileSync('scripts/service-worker.template.js','utf8').replace('__APP__',app).replace('__REVISION__',revision).replace('__SHELL__',JSON.stringify(shell));
fs.writeFileSync('dist/service-worker.js',sw);
fs.writeFileSync('dist/release.json',JSON.stringify({app,version:pkg.version,revision,environment:'staging',production_ready:false,contract_revision:'staging-20260910.1',contract_sha256:'f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad',assets:shell},null,2)+'\n');
console.log(`Built ${app} staging shell ${revision}; ${shell.length} complete pinned assets.`);
