const { query } = require('../src/config/db');

async function createAdmin() {
  console.log('👑 Creating Admin User...\n');
  
  try {
    const ADMIN_PHONE = '9999999999';
    
    // Check if admin exists
    const existing = await query(
      'SELECT * FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    if (existing.rows.length > 0) {
      // Update existing user to admin
      await query(
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
      await query(
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
    
    // Create wallet for admin
    const userResult = await query(
      'SELECT id FROM users WHERE phone_number = $1',
      [ADMIN_PHONE]
    );
    
    const userId = userResult.rows[0].id;
    
    const walletCheck = await query(
      'SELECT id FROM wallets WHERE user_id = $1',
      [userId]
    );
    
    if (walletCheck.rows.length === 0) {
      await query(
        'INSERT INTO wallets (user_id, balance, created_at) VALUES ($1, 0, NOW())',
        [userId]
      );
      console.log('✅ Wallet created for admin');
    }
    
    console.log('\n👑 Admin Credentials:');
    console.log(`   Phone: ${ADMIN_PHONE}`);
    console.log(`   OTP: 123456 (in development mode)`);
    console.log('\n🎯 Use these credentials to login and test admin APIs!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdmin();