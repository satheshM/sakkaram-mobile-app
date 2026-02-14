const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

const runMigration = async () => {
  try {
    console.log('📦 Starting database migration...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute SQL
    await pool.query(sql);
    
    console.log('✅ Database migration completed successfully!');
    console.log('📊 All tables created!');
    
    // List all tables
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('\n📋 Created Tables:');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
};

runMigration();