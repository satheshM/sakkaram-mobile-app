const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  console.log('🔧 Fixing Notifications Table...\n');
  
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'fixNotificationsTable.sql'), 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Added updated_at column');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'notifications' AND column_name = 'updated_at'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verification: updated_at column exists\n');
    }
    
    console.log('🎉 Fix complete! Restart server and test again.\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fix();