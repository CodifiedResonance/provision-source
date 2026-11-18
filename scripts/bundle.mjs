import fs from 'node:fs';
import path from 'node:path';
import {build,context} from 'esbuild';

// Serve only a generated preview directory, never the repository or environment files.
const serve=process.argv.includes('--serve'),outdir=serve?'.preview':'dist';
if(fs.existsSync('.env.local'))process.loadEnvFile('.env.local');
const key=process.env.VITE_STAGING_PUBLISHABLE_KEY||'';
if(key&&!key.startsWith('sb_publishable_'))throw Error('Only the staging publishable key is allowed in browser builds.');
const qa=serve&&fs.existsSync('.recovery-qa.local.json')?JSON.parse(fs.readFileSync('.recovery-qa.local.json','utf8')).journey:null;
if(qa&&!['claim','publication','pilot'].includes(qa))throw Error('Unknown local QA journey.');
const entry=qa==='pilot'?'tests/pilot-browser.js':qa==='claim'?'tests/claim-browser.js':qa==='publication'?'tests/recovery-browser.js':'staging/src/main.js';
fs.mkdirSync(outdir,{recursive:true});
fs.cpSync('staging/public',outdir,{recursive:true});
let html=fs.readFileSync(qa&&qa!=='pilot'?`tests/${qa==='claim'?'claim':'recovery'}-browser.html`:'staging/index.html','utf8');
const options={entryPoints:{app:entry,style:'staging/src/style.css'},outdir,entryNames:serve?'[name]':'assets/[name]-[hash]',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:!serve,metafile:true,
  define:{'import.meta.env.DEV':JSON.stringify(serve),'import.meta.env.VITE_STAGING_PUBLISHABLE_KEY':JSON.stringify(qa?'':key)},
  plugins:[{name:'preview-html',setup(b){
    if(qa==='pilot')b.onLoad({filter:/\/staging\/src\/main\.js$/},async args=>({contents:fs.readFileSync(args.path,'utf8').replace('boot().catch(e=>message(e.message,true));',`export async function mountForTest(data,fixture){Object.assign(state,data);api.rpc=fixture.api.rpc.bind(fixture.api);api.now=fixture.api.now.bind(fixture.api);api.health=fixture.api.health;api.identity=fixture.api.identity;reconciler.run=async()=>render();await render();document.body.prepend(el('p','LOCAL UI FIXTURE · simulated claims · no staging writes'));}`),loader:'js'}));
    b.onEnd(result=>{if(result.errors.length)return;const outputs=Object.entries(result.metafile.outputs);const script=outputs.find(([,v])=>v.entryPoint===entry)?.[0],style=outputs.find(([,v])=>v.entryPoint==='staging/src/style.css')?.[0];if(!script||!style)throw Error('Missing app assets');
      const relative=p=>'./'+path.relative(outdir,p).split(path.sep).join('/');
      fs.writeFileSync(path.join(outdir,'index.html'),html.replace(/src="(?:\.\/src\/main\.js|\/@fs\/__REPO__\/tests\/[^" ]+)"/,`src="${relative(script)}"`).replace(/href="\.?\/src\/style\.css"/,`href="${relative(style)}"`));
    });
  }}]};
if(serve){const ctx=await context(options);await ctx.rebuild();const portArg=process.argv.indexOf('--port');const port=Number(portArg>=0?process.argv[portArg+1]:process.env.PORT||4173);await ctx.watch();const server=await ctx.serve({servedir:outdir,host:'127.0.0.1',port});console.log(`Preview http://127.0.0.1:${server.port}/`);}else await build(options);
