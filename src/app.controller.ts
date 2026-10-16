import { Controller, Get } from '@nestjs/common';

// Root + health endpoints. The API previously had no handler for `GET /`,
// so visiting the deployed base URL returned a 404. These give a live
// confirmation that the serverless function and routing are working.
@Controller()
export class AppController {
  @Get('/')
  root() {
    return {
      status: 'ok',
      service: 'Malique Oil & Gas API',
      endpoints: {
        health: '/health',
        branches: '/branches',
        announcements: '/announcements/active',
      },
      time: new Date().toISOString(),
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
