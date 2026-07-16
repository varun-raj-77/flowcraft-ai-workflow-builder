import dotenv from 'dotenv';

dotenv.config();

interface Environment {
  PORT: number;
  NODE_ENV: string;
  MONGODB_URI: string;
  CLIENT_URL: string;
  TRUSTED_ORIGINS: string[];
  JWT_SECRET: string;
  ANTHROPIC_API_KEY?: string;
}

function loadEnv(): Environment {
  const { PORT, NODE_ENV, MONGODB_URI, CLIENT_URL, TRUSTED_ORIGINS, JWT_SECRET, ANTHROPIC_API_KEY } = process.env;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required in environment variables');
  }

  const clientUrl = CLIENT_URL || 'http://localhost:3000';
  const trustedOrigins = (TRUSTED_ORIGINS || clientUrl)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    PORT: parseInt(PORT || '3001', 10),
    NODE_ENV: NODE_ENV || 'development',
    MONGODB_URI,
    CLIENT_URL: clientUrl,
    TRUSTED_ORIGINS: trustedOrigins,
    JWT_SECRET: JWT_SECRET || 'dev-secret-change-in-production',
    ANTHROPIC_API_KEY,
  };
}

export const env = loadEnv();
