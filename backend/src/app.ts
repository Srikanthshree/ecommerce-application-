import express, {
  Application,
  Request,
  Response,
  NextFunction,
} from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import rateLimit from 'express-rate-limit';
import { healthRouter } from './routes/health';
import logger from './utils/logger';

// ── CORS ─────────────────────────────────────────────────────────────────────
function buildCorsOptions(): CorsOptions {
  const rawOrigins = process.env.ALLOWED_ORIGINS ?? '';
  const allowed    = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header) and explicitly listed origins
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('CORS request blocked.', { origin });
        callback(new Error('Not allowed by CORS policy.'));
      }
    },
    methods:          ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders:   ['Content-Type', 'Authorization'],
    exposedHeaders:   ['X-Request-Id'],
    credentials:      true,
    maxAge:           86_400,
  };
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Global limiter — applied to every route
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1_000,  // 15 minutes
  max:             200,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please try again later.' },
});

// Tight limiter for authentication endpoints (brute-force protection)
export const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1_000,
  max:             10,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many authentication attempts — please try again later.' },
});

// ── Application factory ──────────────────────────────────────────────────────
export function createApp(): Application {
  const app = express();

  // Trust the load balancer / ALB one hop in front of us
  app.set('trust proxy', 1);

  // Remove fingerprinting header
  app.disable('x-powered-by');

  // ── Security headers (Helmet) ──────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'"],
          styleSrc:    ["'self'", "'unsafe-inline'"],
          imgSrc:      ["'self'", 'data:', 'https:'],
          connectSrc:  ["'self'"],
          fontSrc:     ["'self'"],
          objectSrc:   ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge:            31_536_000,
        includeSubDomains: true,
        preload:           true,
      },
      noSniff:        true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  app.use(cors(buildCorsOptions()));

  // ── Rate limiting ──────────────────────────────────────────────────────────
  app.use(globalLimiter);

  // ── Body parsing (size-limited to prevent DoS) ─────────────────────────────
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.use('/health', healthRouter);

  // Auth routes get an additional tight rate limiter
  app.use('/api/auth', authLimiter);

  // ── 404 handler ────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: 'Not Found' });
  });

  // ── Global error handler ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
    logger.error('Unhandled error', {
      error:  err.message,
      stack:  err.stack,
      method: req.method,
      path:   req.path,
    });

    // Never expose internal error details to the client
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
