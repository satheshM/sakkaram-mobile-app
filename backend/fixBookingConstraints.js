const { pool } = require('./src/config/db');

const fix = async () => {
  try {
    console.log('🔧 Fixing booking table constraints...\n');
    
    await pool.query(`
      -- Make old NOT NULL columns nullable
      ALTER TABLE bookings 
        ALTER COLUMN duration_hours DROP NOT NULL,
        ALTER COLUMN total_amount DROP NOT NULL,
        ALTER COLUMN service_location DROP NOT NULL;
      
      -- Add deleted_at if not exists
      ALTER TABLE bookings 
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    `);
    
    console.log('✅ Constraints fixed!');
    console.log('   - duration_hours: now nullable');
    console.log('   - total_amount: now nullable');
    console.log('   - service_location: now nullable');
    console.log('   - deleted_at: added\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

fix();