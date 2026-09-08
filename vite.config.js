import {defineConfig} from 'vite';
export default defineConfig({root:'staging',envDir:'..',base:'./',server:{host:'0.0.0.0',allowedHosts:['terminal.local']},build:{outDir:'../dist',emptyOutDir:true,commonjsOptions:{include:[/node_modules/,/validators\.cjs$/]}}});
