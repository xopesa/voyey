import { AsyncLocalStorage } from 'node:async_hooks';
import { parseLegacyEnvironment } from './env.legacy.js';
type Settings = ReturnType<typeof parseLegacyEnvironment>['env'];
const storage=new AsyncLocalStorage<Settings>();
let local:ReturnType<typeof parseLegacyEnvironment>|undefined;
const settings=()=>storage.getStore()??(local??=parseLegacyEnvironment()).env;
export const env = new Proxy({} as Settings,{get:(_t,key)=>{const current=storage.getStore();if(current)return Reflect.get(current,key);if(key==='NODE_ENV')return process.env.NODE_ENV??'development';if(key==='ADMIN_PROXY_SECRET')return process.env.ADMIN_PROXY_SECRET;return Reflect.get(settings(),key);}});
export function withSettings<T>(value:Settings,fn:()=>T):T{return storage.run(value,fn);}
export type {Settings};
export const trustProxy=false;
export const adminTelegramIds=new Proxy(new Set<string>(),{get:(_t,key)=>{const set=new Set(env.ADMIN_TELEGRAM_IDS.split(',').map(x=>x.trim()).filter(Boolean));const value=Reflect.get(set,key,set);return typeof value==='function'?value.bind(set):value;}});
