import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const write=(p,s)=>{mkdirSync(new URL('./',new URL(p,root)),{recursive:true});writeFileSync(new URL(p,root),s);};
// Keep PostgreSQL source as historical reference; Workers never call its writes.
for(const p of ['apps/api/src/modules/cart/repository.ts','apps/api/src/modules/orders/repository.ts','apps/api/src/modules/payments/repository.ts'])write(p,read(p).replaceAll('Prisma.TransactionIsolationLevel.Serializable','"Serializable"'));
const original=read('apps/api/src/config/env.ts');
if(!original.includes('export function parseLegacyEnvironment')) {
  let legacy=original.replace('config({ path: resolve(process.cwd(), "../../.env"), quiet: true });','').replace('import { config } from "dotenv";','');
  const at=legacy.indexOf('const parsedEnv =');
  legacy=legacy.slice(0,at)+'export function parseLegacyEnvironment() {\n'+legacy.slice(at).replace('export const env =','const env =').replace('export const trustProxy =','const trustProxy =').replace('export const adminTelegramIds =','const adminTelegramIds =')+'\nreturn {env,trustProxy,adminTelegramIds};\n}\n';
  write('apps/api/src/config/env.legacy.ts',legacy);
  write('apps/api/src/config/env.ts',`import { AsyncLocalStorage } from 'node:async_hooks';
import { parseLegacyEnvironment } from './env.legacy.js';
type Settings = ReturnType<typeof parseLegacyEnvironment>['env'];
const storage=new AsyncLocalStorage<Settings>();
let local:ReturnType<typeof parseLegacyEnvironment>|undefined;
const settings=()=>storage.getStore()??(local??=parseLegacyEnvironment()).env;
export const env = new Proxy({} as Settings,{get:(_t,key)=>Reflect.get(settings(),key)});
export function withSettings<T>(value:Settings,fn:()=>T):T{return storage.run(value,fn);}
export type {Settings};
export const trustProxy=false;
export const adminTelegramIds=new Proxy(new Set<string>(),{get:(_t,key)=>{const set=new Set(env.ADMIN_TELEGRAM_IDS.split(',').map(x=>x.trim()).filter(Boolean));const value=Reflect.get(set,key,set);return typeof value==='function'?value.bind(set):value;}});
`);
}
for(const app of ['miniapp','admin']) {
  const manifest=JSON.parse(read(`apps/${app}/package.json`));
  manifest.scripts['build:next']='next build';manifest.scripts.build='vite build';manifest.scripts['dev:next']=manifest.scripts.dev;manifest.scripts.dev='vite --host 127.0.0.1';
  write(`apps/${app}/package.json`,JSON.stringify(manifest,null,2)+'\n');
  write(`apps/${app}/vite.config.ts`,`import {defineConfig} from 'vite';\nimport {fileURLToPath} from 'node:url';\nconst root=new URL('./',import.meta.url);\nexport default defineConfig({base:'${app==='admin'?'/admin/':'/'}',resolve:{alias:{'next/navigation':fileURLToPath(new URL('../miniapp/src/spa/navigation.ts',root)),'next/link':fileURLToPath(new URL('../miniapp/src/spa/link.tsx',root)),'next/image':fileURLToPath(new URL('../miniapp/src/spa/image.tsx',root))}},build:{outDir:'dist',emptyOutDir:true},esbuild:{jsx:'automatic'}});\n`);
  write(`apps/${app}/index.html`,`<!doctype html><html lang="ru" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>STENZO ${app==='admin'?'Admin':'Wear'}</title>${app==='admin'?'<meta name="robots" content="noindex,nofollow">':'<script src="https://telegram.org/js/telegram-web-app.js"></script>'}</head><body><div id="root"></div><script type="module" src="/src/spa.tsx"></script></body></html>\n`);
}
// Place the new Admin SPA under /admin; business components retain their layout.
function walk(dir){return readdirSync(new URL(dir,root),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);}
for(const p of walk('apps/admin/src/components'))if(/\.tsx$/.test(p)){let s=read(p);s=s.replaceAll('href="/','href="/admin/').replace(/href=\{`\/(products|orders)/g,'href={`/admin/$1').replace(/window\.location\.replace\("\/login"\)/g,'window.location.replace("/admin/login")');write(p,s);}
write('apps/admin/src/lib/api.ts',read('apps/admin/src/lib/api.ts').replaceAll('window.location.replace("/login")','window.location.replace("/admin/login")'));
const ignore=read('.gitignore');write('.gitignore',ignore+'\n!apps/worker/migrations/*.sql\napps/worker/public/\n');
const database=JSON.parse(read('packages/database/package.json'));database.scripts['db:migrate']='node -e "throw new Error(\'Use the dedicated D1 migration command, never PostgreSQL migration commands\')"';database.scripts['db:migrate:deploy']=database.scripts['db:migrate'];write('packages/database/package.json',JSON.stringify(database,null,2)+'\n');
