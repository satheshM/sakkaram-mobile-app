const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
  console.log('👑 Creating Separate Admin User...\n');
  
  try {
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connected\n');
    
    const ADMIN_PHONE = '9999999999';
    
    // Check if exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    if (existing.rows.length > 0) {
      // Update to admin
      await pool.query(
        `UPDATE users 
         SET role = 'admin', 
             full_name = 'Platform Admin',
             is_verified = true,
             phone_verified = true,
             is_active = true
         WHERE phone_number = $1`,
        [ADMIN_PHONE]
      );
      console.log('✅ Existing user updated to admin');
    } else {
      // Create new
      const result = await pool.query(
        `INSERT INTO users (
          phone_number, 
          role, 
          full_name, 
          is_verified, 
          phone_verified,
          is_active,
          created_at
        ) VALUES ($1, 'admin', 'Platform Admin', true, true, true, NOW())
        RETURNING id`,
        [ADMIN_PHONE]
      );
      
      const userId = result.rows[0].id;
      
      // Create wallet
      await pool.query(
        'INSERT INTO wallets (user_id, balance, created_at) VALUES ($1, 0, NOW())',
        [userId]
      );
      
      console.log('✅ New admin user created with wallet');
    }
    
    console.log('\n👑 Admin Credentials:');
    console.log(`   Phone: ${ADMIN_PHONE}`);
    console.log(`   OTP: 123456 (in development mode)`);
    console.log('\n🎯 Ready to test!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

createAdmin();