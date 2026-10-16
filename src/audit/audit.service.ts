import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditDto } from './dto/query-audit.dto';

export interface AuditEntry {
  actorId?: string;
  actorEmail?: string;
  actorName?: string;
  actorRole?: string;
  actionType?: string;
  action: string;
  resource?: string;
  method?: string;
  path?: string;
  payload?: unknown;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
  success?: boolean;
}

const VALID_ACTION_TYPES = new Set([
  'login',
  'logout',
  'create',
  'update',
  'delete',
  'read',
  'other',
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Fire-and-forget write. Never throws so it can't break the request it is
   * documenting. super_admin (dev) activity is deliberately never persisted.
   */
  async log(entry: AuditEntry): Promise<void> {
    if (entry.actorRole === 'super_admin') {
      return;
    }

    const actionType = VALID_ACTION_TYPES.has(entry.actionType ?? '')
      ? entry.actionType
      : 'other';

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorName: entry.actorName ?? null,
          actorRole: entry.actorRole ?? null,
          actionType: actionType as any,
          action: entry.action,
          resource: entry.resource ?? null,
          method: entry.method ?? null,
          path: entry.path ?? null,
          payload: (this.sanitize(entry.payload) as any) ?? undefined,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          statusCode: entry.statusCode ?? null,
          success: entry.success ?? true,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: ${(err as Error).message}`,
      );
    }
  }

  async findAll(query: QueryAuditDto) {
    const where: any = {};

    if (query.actionType && VALID_ACTION_TYPES.has(query.actionType)) {
      where.actionType = query.actionType;
    }

    if (query.actor) {
      where.OR = [
        { actorEmail: { contains: query.actor, mode: 'insensitive' } },
        { actorName: { contains: query.actor, mode: 'insensitive' } },
      ];
    }

    if (query.search) {
      const term = query.search;
      where.AND = [
        {
          OR: [
            { action: { contains: term, mode: 'insensitive' } },
            { resource: { contains: term, mode: 'insensitive' } },
            { path: { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Remove credential-like fields before persisting a request snapshot. */
  private sanitize(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (Array.isArray(payload)) {
      return payload.map((item) => this.sanitize(item));
    }

    const sensitive = new Set([
      'password',
      'currentPassword',
      'newPassword',
      'confirmPassword',
      'token',
      'secret',
      'accessToken',
      'refreshToken',
    ]);

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as object)) {
      if (sensitive.has(key)) {
        out[key] = '[redacted]';
      } else if (value && typeof value === 'object') {
        out[key] = this.sanitize(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
}
