import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if(!['provision-consumer-integrity','provision-source-integrity'].includes(pkg.name))throw Error('Wrong build root');
const output=path.join(root,'dist');
if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Refusing linked build directory');
fs.rmSync(output,{recursive:true,force:true});
