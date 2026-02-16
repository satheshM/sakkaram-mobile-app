const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkTable() {
  console.log('🔍 Checking Notifications Table...\n');
  
  try {
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connected\n');
    
    // Check structure
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 NOTIFICATIONS TABLE:\n');
    columns.rows.forEach((col, i) => {
      console.log(`${i + 1}. ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '- NOT NULL' : ''}`);
    });
    console.log('');
    
    // Check constraints
    const constraints = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'notifications'::regclass
      ORDER BY conname
    `);
    
    console.log('🔒 CONSTRAINTS:\n');
    constraints.rows.forEach(c => {
      console.log(`✅ ${c.conname}`);
    });
    console.log('');
    
    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'notifications'
      ORDER BY indexname
    `);
    
    console.log('📇 INDEXES:\n');
    indexes.rows.forEach(idx => {
      console.log(`✅ ${idx.indexname}`);
    });
    console.log('');
    
    // Check data
    const count = await pool.query('SELECT COUNT(*) FROM notifications');
    console.log(`📈 Current Notifications: ${count.rows[0].count}\n`);
    
    console.log('✅ Notifications table ready!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkTable();