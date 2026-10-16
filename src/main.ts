import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestApplication } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// Origins allowed to call the API with credentials. We dynamically allow ANY
// *.vercel.app host so that both production aliases (https://malique.vercel.app,
// https://malique-secretary.vercel.app, ...) AND auto-generated preview
// deployments (https://<project>-abc123.vercel.app) work without a code change
// per deploy. Local dev origins are always allowed, plus anything listed in the
// CORS_ORIGINS env var (comma-separated). The real request origin is echoed
// back (mandatory when credentials: true), so we must NOT return a wildcard.
function isAllowedOrigin(origin?: string): boolean {
  // No Origin header => same-origin / non-browser (curl, health checks).
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  const extra = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

// API bootstrap entry point. This single file both creates the Nest app
// (NestFactory.create) AND binds it (app.listen), which is exactly what
// Vercel's zero-configuration NestJS support looks for: it detects this
// file as the server entrypoint, intercepts app.listen(), and transparently
// turns the whole Nest router into a single Vercel Function serving every
// route. The same file drives local / long-running servers via
// `pnpm --filter @malique/api dev`.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Keep the untouched JSON bytes for webhook signature verification
  // (Paystack signs the raw body with HMAC-SHA512). `useBodyParser` lives on
  // the concrete NestApplication class, not the INestApplication interface.
  (app as NestApplication).useBodyParser('json', {
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  });

  // CORS: echo the caller origin when it is allowed (credentials-compatible).
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      cb(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });

  // Cookie parser
  app.use(cookieParser());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Malique Oil & Gas API running on http://localhost:${port}`);
}
bootstrap();
