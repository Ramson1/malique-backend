import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

/**
 * Accepts EITHER a staff token ('jwt' strategy, JWT_SECRET + user table)
 * or a customer token ('jwt-customer' strategy, JWT_CUSTOMER_SECRET +
 * customer table). Passport tries the strategies in order and succeeds on
 * the first one that validates, so website customers and portal staff can
 * hit the same endpoints. The resolved request.user carries `role:
 * 'customer'` for customer tokens (set by JwtCustomerStrategy).
 */
@Injectable()
export class JwtAnyAuthGuard extends AuthGuard(['jwt', 'jwt-customer'] as never) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Honour the @Public() metadata the same way JwtAuthGuard does.
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
