import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function validateSchema() {
  console.log('=== CodeXY Database Schema Validation ===');
  
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error('ERROR: db/schema.sql not found at', schemaPath);
    process.exit(1);
  }
  
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  console.log(`[PASS] Read db/schema.sql successfully (${schemaSql.length} bytes)`);

  const requiredTables = [
    'users',
    'sessions',
    'auth_tokens',
    'oauth_accounts',
    'projects',
    'project_collaborators',
    'project_files',
    'file_versions',
    'invitations',
    'share_links',
    'user_activity'
  ];

  let missingTables = [];
  for (const table of requiredTables) {
    if (!schemaSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
      missingTables.push(table);
    }
  }

  if (missingTables.length > 0) {
    console.error('[FAIL] Missing table definitions in schema.sql:', missingTables);
    process.exit(1);
  }
  console.log(`[PASS] All ${requiredTables.length} required tables are present in schema.sql:`);
  requiredTables.forEach(t => console.log(`  - ${t}`));

  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    console.log('\n[INFO] DATABASE_URL not set in environment. Skipping live Neon DB execution test.');
    console.log('[SUCCESS] Schema SQL structure validation PASSED.');
    return;
  }

  console.log('\n[INFO] DATABASE_URL found. Connecting to Neon PostgreSQL...');
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    console.log('Executing db/schema.sql against database...');
    await pool.query(schemaSql);
    console.log('[PASS] Applied schema.sql to database successfully!');

    for (const table of requiredTables) {
      const res = await pool.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`[PASS] Table '${table}' exists and accessible (rows: ${res.rows[0].count})`);
    }

    console.log('\n[SUCCESS] Live database schema verification PASSED!');
  } catch (err) {
    console.error('\n[FAIL] Live database schema verification failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

validateSchema();
