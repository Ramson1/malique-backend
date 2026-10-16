import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    // Serverless-safe bootstrap: a DB connect failure must NOT abort Nest
    // initialisation. On Vercel an unhandled throw here crashes the function
    // before it serves any request, surfacing as an opaque
    // "500 FUNCTION_INVOCATION_FAILED" with no request logs. Log the error and
    // let Prisma lazily reconnect on the first query, so non-DB routes like
    // "/" and "/health" still respond and the real cause (e.g. a missing or
    // unreachable DATABASE_URL) shows up in the runtime logs per request.
    try {
      await this.$connect();
    } catch (err) {
      console.error('Prisma $connect() failed at startup:', err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
