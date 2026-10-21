import type { PublicUser } from "@stenzo/shared";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: PublicUser | null;
  }
}
