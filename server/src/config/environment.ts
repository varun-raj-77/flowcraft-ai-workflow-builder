import dotenv from 'dotenv';

dotenv.config();

interface Environment {
  PORT: number;
  NODE_ENV: string;
  MONGODB_URI: string;
  CLIENT_URL: string;
  JWT_SECRET: string;
  ANTHROPIC_API_KEY?: string;
}

function loadEnv(): Environment {
  const { PORT, NODE_ENV, MONGODB_URI, CLIENT_URL, JWT_SECRET, ANTHROPIC_API_KEY } = process.env;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required in environment variables');
  }

  return {
    PORT: parseInt(PORT || '3001', 10),
    NODE_ENV: NODE_ENV || 'development',
    MONGODB_URI,
    CLIENT_URL: CLIENT_URL || 'http://localhost:3000',
    JWT_SECRET: JWT_SECRET || 'dev-secret-change-in-production',
    ANTHROPIC_API_KEY,
  };
}

export const env = loadEnv();
