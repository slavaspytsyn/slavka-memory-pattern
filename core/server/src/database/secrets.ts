/**
 * SMP Database Secrets Provider
 * 
 * Simple environment variable-based secret management.
 * In development and local Docker, read from DATABASE_URL.
 */

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return url;
}
