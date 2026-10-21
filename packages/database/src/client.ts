import type { PrismaClient } from "@prisma/client";
import { readClient } from "./d1.js";
export const prisma = readClient as unknown as PrismaClient;
export async function disconnectDatabase(): Promise<void> {}
