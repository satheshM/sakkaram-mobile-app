const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixAdmin() {
  console.log('🔧 Fixing Admin User...\n');
  
  try {
    const ADMIN_PHONE = '9999999999';
    
    // Delete if exists
    await pool.query(
      'DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_number = $1)',
      [ADMIN_PHONE]
    );
    
    await pool.query(
      'DELETE FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    console.log('✅ Cleaned up existing admin user\n');
    
    // Create fresh admin
    const result = await pool.query(
      `INSERT INTO users (
        phone_number, 
        role, 
        full_name, 
        is_verified, 
        phone_verified,
        is_active,
        otp_code,
        otp_expires_at,
        created_at
      ) VALUES ($1, 'admin', 'Platform Admin', true, true, true, '123456', NOW() + INTERVAL '10 minutes', NOW())
      RETURNING id`,
      [ADMIN_PHONE]
    );
    
    const userId = result.rows[0].id;
    
    // Create wallet
    await pool.query(
      'INSERT INTO wallets (user_id, balance, created_at) VALUES ($1, 0, NOW())',
      [userId]
    );
    
    console.log('✅ Admin user created fresh');
    console.log(`   User ID: ${userId}`);
    console.log(`   Phone: ${ADMIN_PHONE}`);
    console.log(`   OTP: 123456`);
    console.log(`   Role: admin`);
    console.log(`   Full Name: Platform Admin\n`);
    
    // Verify
    const check = await pool.query(
      'SELECT id, phone_number, role, full_name, is_verified FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    console.log('✅ Verification:');
    console.log('   ', check.rows[0]);
    console.log('\n🎯 Ready to test!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixAdmin();