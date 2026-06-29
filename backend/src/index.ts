import { createApp } from './app';
import { connectWithRetry } from './config/database';
import { setDbPool, getDbPool } from './routes/health';
import logger from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
let dbReady = false;

async function main(): Promise<void> {
  logger.info('Starting ecommerce backend…', { port: PORT });

  // ── HTTP server (start immediately) ────────────────────────────────────────
  // This allows K8s probes to succeed and the pod to become ready while the
  // database connection is being established. The health endpoint returns 503
  // until dbReady is true.
  const app    = createApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`HTTP server listening on 0.0.0.0:${PORT}`);
  });

  // ── Database (connect in background) ───────────────────────────────────────
  // Connects with exponential back-off. This runs asynchronously while the
  // HTTP server is already accepting requests. The health endpoint will return
  // 503 until the DB is ready.
  connectWithRetry()
    .then((pool) => {
      setDbPool(pool);
      dbReady = true;
      logger.info('Database connection established');
    })
    .catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Fatal error: Failed to connect to database after retries.', {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Kubernetes sends SIGTERM before terminating a pod. We stop accepting new
  // connections, let in-flight requests drain, then close the DB pool cleanly.
  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal} — starting graceful shutdown…`);

    server.close(async () => {
      logger.info('HTTP server closed. Waiting for DB pool…');
      
      // Wait up to 10 seconds for DB connection to establish (if still connecting)
      let attempts = 0;
      while (!dbReady && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }

      const pool = getDbPool();
      if (pool) {
        try {
          await pool.end();
          logger.info('DB pool closed. Exiting cleanly.');
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error('Error closing DB pool.', { error: error.message });
        }
      } else {
        logger.info('DB connection never established; skipping pool close.');
      }

      process.exit(0);
    });

    // Force-kill after 30 s if connections do not drain
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit.');
      process.exit(1);
    }, 30_000).unref();
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error('Fatal startup error.', { error: error.message, stack: error.stack });
  process.exit(1);
});
