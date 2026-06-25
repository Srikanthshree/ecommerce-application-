import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import logger from '../utils/logger';

export const healthRouter = Router();

// Singleton pool reference injected by src/index.ts after startup
let dbPool: Pool | null = null;

export function setDbPool(pool: Pool): void {
  dbPool = pool;
}

// ── GET /health ──────────────────────────────────────────────────────────────
// Returns 200 when the service and its DB connection are healthy,
// or 503 when degraded — used by K8s liveness and readiness probes.
healthRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const payload = {
    status:    'ok' as 'ok' | 'degraded',
    timestamp: new Date().toISOString(),
    version:   process.env.APP_VERSION ?? '1.0.0',
    checks: {
      database: 'unknown' as 'healthy' | 'unhealthy' | 'not_initialized' | 'unknown',
    },
  };

  if (!dbPool) {
    payload.status          = 'degraded';
    payload.checks.database = 'not_initialized';
    res.status(503).json(payload);
    return;
  }

  try {
    const client = await dbPool.connect();
    await client.query('SELECT 1');
    client.release();
    payload.checks.database = 'healthy';
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn('Health check: database probe failed.', { error: error.message });
    payload.status          = 'degraded';
    payload.checks.database = 'unhealthy';
  }

  res.status(payload.status === 'ok' ? 200 : 503).json(payload);
});
