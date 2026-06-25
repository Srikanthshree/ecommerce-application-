import { Pool, PoolConfig } from 'pg';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import logger from '../utils/logger';

interface DbCredentials {
  username: string;
  password: string;
  host:     string;
  port:     number;
  dbname:   string;
}

// ── Fetch credentials from AWS Secrets Manager ──────────────────────────────
// The pod's IAM Role (IRSA) grants read access to the specific secret ARN.
// No credentials are ever stored in environment variables or config files.
async function fetchDbCredentials(): Promise<DbCredentials> {
  const secretArn = process.env.DB_SECRET_ARN;
  const region    = process.env.AWS_REGION ?? 'us-east-1';

  if (!secretArn) {
    throw new Error(
      'DB_SECRET_ARN environment variable is not set. ' +
      'Ensure the K8s Deployment configures this from the Terraform output.',
    );
  }

  const client  = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error('Secrets Manager returned an empty SecretString.');
  }

  return JSON.parse(response.SecretString) as DbCredentials;
}

// ── Build the connection pool ────────────────────────────────────────────────
async function buildPool(): Promise<Pool> {
  const creds = await fetchDbCredentials();

  const config: PoolConfig = {
    host:     creds.host,
    port:     creds.port,
    database: creds.dbname,
    user:     creds.username,
    password: creds.password,
    max:                 20,
    idleTimeoutMillis:   30_000,
    connectionTimeoutMillis: 5_000,
    ssl: {
      // Enforce TLS — reject self-signed certs from the RDS endpoint
      rejectUnauthorized: true,
    },
  };

  return new Pool(config);
}

// ── Connect with exponential back-off ────────────────────────────────────────
const MAX_RETRIES      = 5;
const BASE_DELAY_MS    = 1_000;
const MAX_DELAY_MS     = 30_000;

export async function connectWithRetry(): Promise<Pool> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`DB connection attempt ${attempt}/${MAX_RETRIES}`);

      const pool   = await buildPool();
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();

      logger.info('Database connection pool established successfully.');
      return pool;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`DB connection attempt ${attempt} failed.`, {
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES) {
        // Jittered exponential back-off: delay = min(base * 2^(n-1) + jitter, max)
        const exponential = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter      = Math.random() * 500;
        const delay       = Math.min(exponential + jitter, MAX_DELAY_MS);

        logger.info(`Retrying in ${Math.round(delay)} ms…`);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to establish a DB connection after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}
