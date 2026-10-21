import { useSyncExternalStore } from 'react';
const subscribe=(callback:()=>void)=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback);};
export function useLocation(){return useSyncExternalStore(subscribe,()=>location.href,()=>'/');}
export function usePathname(){return new URL(useLocation(),location.origin).pathname.replace(/^\/admin(?=\/|$)/,'')||'/';}
export function useSearchParams(){return new URL(useLocation(),location.origin).searchParams;}
export function navigate(href:string,replace=false){const admin=location.pathname==='/admin'||location.pathname.startsWith('/admin/');const target=admin&&href.startsWith('/')&&!href.startsWith('/admin')?'/admin'+href:href;history[replace?'replaceState':'pushState'](null,'',target);window.dispatchEvent(new PopStateEvent('popstate'));}
export function useRouter(){return {push:(href:string)=>navigate(href),replace:(href:string)=>navigate(href,true),back:()=>history.back(),refresh:()=>location.reload(),prefetch:()=>Promise.resolve()};}
