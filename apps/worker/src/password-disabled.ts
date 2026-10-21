// Native password verification must never silently downgrade on Workers Free.
// This build keeps password sign-in disabled until a compatible secure method is configured.
export async function verify(): Promise<boolean> {
  throw new Error("Password sign-in is unavailable in the Workers build");
}
