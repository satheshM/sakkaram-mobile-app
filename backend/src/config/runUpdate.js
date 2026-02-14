const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

const runUpdate = async () => {
  try {
    console.log('📦 Updating database schema for Phone + OTP...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, 'updateSchema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute SQL
    await pool.query(sql);
    
    console.log('✅ Database schema updated successfully!');
    console.log('📱 Phone + OTP authentication ready!');
    
    // Verify new columns
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('phone_verified', 'otp_code', 'otp_expires_at', 'otp_attempts')
      ORDER BY column_name;
    `);
    
    console.log('\n📋 New Columns Added:');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.column_name} (${row.data_type})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Update failed:', error.message);
    console.error(error);
    process.exit(1);
  }
};

runUpdate();