import { AsyncLocalStorage } from "node:async_hooks";
const principal = new AsyncLocalStorage<string>();
export const withAdminPrincipal = <T>(hash: string, fn: () => T): T =>
  principal.run(hash, fn);
export const adminPrincipalHash = () => principal.getStore() ?? null;
