import 'dotenv/config';
import { drizzle } from 'drizzle-orm/bun-sql';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

export const db = drizzle(databaseUrl);
