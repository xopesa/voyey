import { prisma } from "@stenzo/database";

import type { AuditEventInput, AuditEventRecord } from "./types.js";

export interface AuditRepository {
  create(input: AuditEventInput): Promise<AuditEventRecord>;
}

export class PrismaAuditRepository implements AuditRepository {
  public create(input: AuditEventInput): Promise<AuditEventRecord> {
    return prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? undefined) as never,
      },
    });
  }
}
