const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

const runMigration = async () => {
  try {
    console.log('📦 Running Phase 1 – Missing DB Indexes migration...');

    // Point to your new SQL file
    const sqlPath = path.join(__dirname, 'phase1_indexes.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Phase 1 indexes created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

runMigration();