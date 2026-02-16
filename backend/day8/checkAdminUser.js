const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE phone_number = $1',
      ['9999999999']
    );
    
    console.log('👤 Admin User Status:\n');
    
    if (result.rows.length === 0) {
      console.log('❌ User does NOT exist in database!');
    } else {
      const user = result.rows[0];
      console.log('✅ User exists:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Phone: ${user.phone_number}`);
      console.log(`   Full Name: ${user.full_name}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Phone Verified: ${user.phone_verified}`);
      console.log(`   Is Verified: ${user.is_verified}`);
      console.log(`   Is Active: ${user.is_active}`);
      console.log(`   Created: ${user.created_at}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

check();