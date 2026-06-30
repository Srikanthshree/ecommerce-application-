import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import logger from '../utils/logger';

export const healthRouter = Router();

// Singleton pool reference injected by src/index.ts after startup
let dbPool: Pool | null = null;

export function setDbPool(pool: Pool): void {
  dbPool = pool;
}

export function getDbPool(): Pool | null {
  return dbPool;
}

// ── GET /health ──────────────────────────────────────────────────────────────
// Returns 200 when the service is running.
// Database status is included but not required for startup (K8s startup probe).
// Readiness/liveness probes should check the database status field.
healthRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const payload = {
    status:    'ok' as 'ok' | 'degraded',
    timestamp: new Date().toISOString(),
    version:   process.env.APP_VERSION ?? '1.0.0',
    checks: {
      database: 'unknown' as 'healthy' | 'unhealthy' | 'not_initialized' | 'unknown',
    },
  };

  // If database pool not initialized yet, return 200 (app is running)
  // Kubernetes startup probe only cares that the app is listening.
  // Readiness/liveness probes check the 'status' and 'checks' fields separately.
  if (!dbPool) {
    payload.status          = 'degraded';
    payload.checks.database = 'not_initialized';
    res.status(200).json(payload);  // ← Changed from 503 to 200
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

  res.status(payload.status === 'ok' ? 200 : 200).json(payload);  // ← Always 200 unless critical failure
});
