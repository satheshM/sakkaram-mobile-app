const { pool } = require('./db');

const verifyDatabase = async () => {
  try {
    console.log('🔍 Verifying database setup...\n');
    
    // Check tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log(`✅ Total Tables: ${tables.rows.length}\n`);
    
    // Check each table's row count
    for (const table of tables.rows) {
      const count = await pool.query(`SELECT COUNT(*) FROM ${table.table_name}`);
      console.log(`📊 ${table.table_name}: ${count.rows[0].count} rows`);
    }
    
    console.log('\n✅ Database verification complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
};

verifyDatabase();