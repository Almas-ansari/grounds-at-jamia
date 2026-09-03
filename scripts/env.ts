/**
 * Load the local environment for a node script.
 *
 * `import 'dotenv/config'` reads .env and nothing else, which is the wrong file:
 * .env.local is the one that is git-ignored and therefore the one people put
 * real credentials in. This loads both, with .env.local winning.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env', '.env.local']) {
  const path = resolve(ROOT, file);
  if (existsSync(path)) config({ path, override: true, quiet: true });
}
