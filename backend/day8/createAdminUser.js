require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
  console.log('👑 Creating Admin User...\n');
  
  try {
    const ADMIN_PHONE = '9999999999';
    
    // Check if admin exists
    const existing = await pool.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    if (existing.rows.length > 0) {
      // Update existing user to admin
      await pool.query(
        `UPDATE users 
         SET role = 'admin', 
             full_name = 'Admin User',
             is_verified = true,
             phone_verified = true
         WHERE phone_number = $1`,
        [ADMIN_PHONE]
      );
      
      console.log('✅ Existing user updated to admin');
    } else {
      // Create new admin user
      await pool.query(
        `INSERT INTO users (
          phone_number, 
          role, 
          full_name, 
          is_verified, 
          phone_verified,
          is_active,
          created_at
        ) VALUES ($1, 'admin', 'Admin User', true, true, true, NOW())`,
        [ADMIN_PHONE]
      );
      
      console.log('✅ New admin user created');
    }
    
    console.log('\n👑 Admin Credentials:');
    console.log(`   Phone: ${ADMIN_PHONE}`);
    console.log(`   OTP: 123456 (in development mode)`);
    console.log('\n🎯 Use these credentials to login and test admin APIs!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

createAdmin();