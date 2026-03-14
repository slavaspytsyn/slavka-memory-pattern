/**
 * Migration runner for smp-server
 */

import { initDb } from './pg-driver.js';
import { runMigrations, getCurrentVersion } from './schema.js';

async function main() {
  console.error('[smp-server] Starting migration...');

  const db = await initDb();

  try {
    const beforeVersion = await getCurrentVersion(db);
    console.error(`[smp-server] Current schema version: ${beforeVersion}`);

    await runMigrations(db);

    const afterVersion = await getCurrentVersion(db);
    console.error(`[smp-server] Schema version after migration: ${afterVersion}`);

    if (afterVersion > beforeVersion) {
      console.error(`[smp-server] Applied ${afterVersion - beforeVersion} migration(s)`);
    } else {
      console.error('[smp-server] No migrations needed');
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('[smp-server] Migration failed:', error);
  process.exit(1);
});
