import type { AuditRepository } from "./repository.js";
import type { AuditEventInput, AuditEventRecord } from "./types.js";

export class AuditService {
  public constructor(private readonly repository: AuditRepository) {}

  public record(input: AuditEventInput): Promise<AuditEventRecord> {
    return this.repository.create(input);
  }
}
