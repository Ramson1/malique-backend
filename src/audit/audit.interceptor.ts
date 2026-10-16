import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method: string = request.method;

    // Only document authenticated portal staff performing state changes.
    // Unauthenticated, customer, read-only and super_admin (dev) traffic is skipped.
    const skip =
      !user ||
      user.role === 'super_admin' ||
      user.role === 'customer' ||
      !WRITE_METHODS.has(method);

    if (skip) {
      return next.handle();
    }

    const path = this.resolvePath(request);
    const resource = this.resolveResource(request, context);
    const actionType = this.actionTypeFor(method);

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.log({
            actorId: user.id,
            actorEmail: user.email,
            actorRole: user.role,
            actionType,
            action: `${actionType} ${resource}`,
            resource,
            method,
            path,
            payload: request.body,
            ip: request.ip,
            userAgent: request.headers?.['user-agent'],
            success: true,
          });
        },
        error: (err: any) => {
          void this.audit.log({
            actorId: user.id,
            actorEmail: user.email,
            actorRole: user.role,
            actionType,
            action: `${actionType} ${resource}`,
            resource,
            method,
            path,
            payload: request.body,
            ip: request.ip,
            userAgent: request.headers?.['user-agent'],
            statusCode: err?.status || err?.response?.statusCode || 500,
            success: false,
          });
        },
      }),
    );
  }

  private actionTypeFor(method: string): string {
    switch (method) {
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'other';
    }
  }

  private resolvePath(request: any): string {
    const base = request.baseUrl ?? '';
    const url = request.path ?? request.originalUrl ?? '';
    return `${base}${url}`;
  }

  private resolveResource(request: any, context: ExecutionContext): string {
    // Prefer the controller class name (e.g. "OrdersController" -> "orders")
    const className = context.getClass()?.name ?? '';
    const fromClass = className.replace(/Controller$/, '').toLowerCase();
    if (fromClass) {
      return fromClass;
    }
    // Fall back to the first meaningful path segment
    const segments = String(request.path ?? '')
      .split('/')
      .filter(Boolean);
    return segments[0] ?? 'unknown';
  }
}
