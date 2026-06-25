import { createApp } from './app';
import { connectWithRetry } from './config/database';
import { setDbPool } from './routes/health';
import logger from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  logger.info('Starting ecommerce backend…', { port: PORT });

  // ── Database ───────────────────────────────────────────────────────────────
  // Connects with exponential back-off so the pod survives transient DB
  // unavailability during rolling deployments or failovers.
  const pool = await connectWithRetry();
  setDbPool(pool);

  // ── HTTP server ────────────────────────────────────────────────────────────
  const app    = createApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`HTTP server listening on 0.0.0.0:${PORT}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Kubernetes sends SIGTERM before terminating a pod. We stop accepting new
  // connections, let in-flight requests drain, then close the DB pool cleanly.
  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal} — starting graceful shutdown…`);

    server.close(async () => {
      logger.info('HTTP server closed. Draining DB pool…');
      try {
        await pool.end();
        logger.info('DB pool closed. Exiting cleanly.');
        process.exit(0);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('Error closing DB pool.', { error: error.message });
        process.exit(1);
      }
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
