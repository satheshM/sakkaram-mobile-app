const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

console.log('🔧 Debug: DATABASE_URL =', process.env.DATABASE_URL ? 'SET ✅' : 'MISSING ❌');

// Create direct connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkReviewsTable() {
  console.log('🔍 Checking Reviews Table...\n');
  
  try {
    console.log('📡 Connecting to database...');
    
    // Test connection
    const testResult = await pool.query('SELECT NOW() as time');
    console.log('✅ Database connected');
    console.log(`   Server time: ${testResult.rows[0].time}\n`);
    
    // Check table structure
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'reviews'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 REVIEWS TABLE STRUCTURE:\n');
    columns.rows.forEach((col, i) => {
      console.log(`${i + 1}. ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '- NOT NULL' : ''}`);
    });
    console.log('');
    
    // Check constraints
    const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'reviews'::regclass
      ORDER BY conname
    `);
    
    console.log('🔒 CONSTRAINTS:\n');
    if (constraints.rows.length === 0) {
      console.log('   (No constraints found)\n');
    } else {
      constraints.rows.forEach(c => {
        console.log(`✅ ${c.conname}`);
      });
      console.log('');
    }
    
    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'reviews'
      ORDER BY indexname
    `);
    
    console.log('📇 INDEXES:\n');
    if (indexes.rows.length === 0) {
      console.log('   (No indexes found)\n');
    } else {
      indexes.rows.forEach(idx => {
        console.log(`✅ ${idx.indexname}`);
      });
      console.log('');
    }
    
    // Check current data
    const count = await pool.query('SELECT COUNT(*) FROM reviews');
    console.log(`📈 Current Reviews: ${count.rows[0].count}\n`);
    
    console.log('✅ Reviews table is ready for Day 6!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Troubleshooting:');
      console.error('   1. Check if DATABASE_URL is set in .env');
      console.error('   2. Verify Railway database is accessible');
      console.error('   3. Check if firewall is blocking connection\n');
    }
  } finally {
    await pool.end();
  }
}

checkReviewsTable();