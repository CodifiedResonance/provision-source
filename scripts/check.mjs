import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const files=fs.readdirSync('staging/src').filter(x=>x.endsWith('.js'));
for(const f of files){const p='staging/src/'+f,s=fs.readFileSync(p,'utf8');execFileSync(process.execPath,['--check',p]);if(/\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/.test(s))throw Error('Executable text sink: '+p);if(/\.from\(['"](?:source|current_offer|claim|evidence|food|demand_signal)/.test(s))throw Error('Raw data access: '+p);}
for(const f of fs.readdirSync('staging/public'))if(/\.(png|jpg)$/.test(f)&&!fs.statSync('staging/public/'+f).size)throw Error('Empty identity asset');
const html=fs.readFileSync('staging/index.html','utf8');if(/on(?:click|load|error)\s*=|unsafe-inline|unsafe-eval|cdn\.jsdelivr/.test(html))throw Error('Unsafe HTML');
for(const p of ['staging/src/config.js','staging/index.html'])if(fs.readFileSync(p,'utf8').includes('aumcpvepxeytfiqhsmwf'))throw Error('Production target in staging');
const migration=fs.readFileSync('20260830_provision_network_expansion_04.sql');
if(createHash('sha256').update(migration).digest('hex')!=='4cd6d91f374a769d6a718007a786021b5e2a7ad90609e6020046acb9193da979')throw Error('Historical migration changed');
const manifest=JSON.parse(fs.readFileSync('staging/public/manifest.webmanifest'));
for(const i of manifest.icons){const b=fs.readFileSync('staging/public/'+i.src.replace('./',''));if(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`!==i.sizes)throw Error('Icon dimensions do not match manifest');}
if(manifest.start_url!=='./'||manifest.scope!=='./'||manifest.id!=='./')throw Error('Unexpected identity change');
for(const p of files){const text=fs.readFileSync('staging/src/'+p,'utf8');if(/sb_secret_[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))throw Error('Potential privileged secret');}
console.log(`Syntax and prohibited-sink checks passed for ${files.length} modules.`);
