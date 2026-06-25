import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'ISO' }),
    winston.format.errors({ stack: true }),
    // Structured JSON — ingested cleanly by CloudWatch / Datadog
    winston.format.json(),
  ),
  defaultMeta: {
    service:     'ecommerce-backend',
    environment: process.env.NODE_ENV ?? 'development',
  },
  transports: [
    new winston.transports.Console(),
  ],
});

export default logger;
