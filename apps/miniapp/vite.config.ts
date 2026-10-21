import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
export default defineConfig({base:'/',resolve:{alias:{'next/navigation':fileURLToPath(new URL('../miniapp/src/spa/navigation.ts',root)),'next/link':fileURLToPath(new URL('../miniapp/src/spa/link.tsx',root)),'next/image':fileURLToPath(new URL('../miniapp/src/spa/image.tsx',root))}},build:{outDir:'dist',emptyOutDir:true},esbuild:{jsx:'automatic'}});
