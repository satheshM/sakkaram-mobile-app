const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createTable() {
  console.log('📊 Creating Favorites Table...\n');
  
  try {
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connected\n');
    
    const sql = fs.readFileSync(path.join(__dirname, 'createFavoritesTable.sql'), 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Favorites table created');
    console.log('✅ Indexes created');
    console.log('✅ Unique constraint added\n');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'favorites'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Table structure:');
    result.rows.forEach((col, i) => {
      console.log(`   ${i + 1}. ${col.column_name} (${col.data_type})`);
    });
    
    // Check constraints
    const constraints = await pool.query(`
      SELECT conname 
      FROM pg_constraint
      WHERE conrelid = 'favorites'::regclass
      ORDER BY conname
    `);
    
    console.log('\n🔒 Constraints:');
    constraints.rows.forEach(c => {
      console.log(`   ✅ ${c.conname}`);
    });
    
    console.log('\n🎉 Favorites table ready!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

createTable();