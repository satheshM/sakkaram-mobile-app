const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function makeAdmin() {
  console.log('👑 Making User Admin...\n');
  
  try {
    console.log('📡 Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connected\n');
    
    const PHONE = '9876543212'; // Use existing farmer
    
    // Update to admin
    const result = await pool.query(
      `UPDATE users 
       SET role = 'admin', 
           full_name = 'Admin User',
           is_verified = true,
           phone_verified = true,
           is_active = true
       WHERE phone_number = $1
       RETURNING id, phone_number, role, full_name`,
      [PHONE]
    );
    
    if (result.rows.length > 0) {
      console.log('✅ User updated to admin');
      console.log(`   ID: ${result.rows[0].id}`);
      console.log(`   Phone: ${result.rows[0].phone_number}`);
      console.log(`   Role: ${result.rows[0].role}`);
      console.log(`   Name: ${result.rows[0].full_name}`);
    } else {
      console.log('❌ User not found');
    }
    
    console.log('\n👑 Admin Credentials:');
    console.log(`   Phone: ${PHONE}`);
    console.log(`   OTP: 123456 (in development mode)`);
    console.log('\n🎯 Use these credentials to login and test admin APIs!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

makeAdmin();