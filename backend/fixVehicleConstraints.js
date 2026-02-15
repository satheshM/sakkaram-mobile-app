const { pool } = require('./src/config/db');

const fix = async () => {
  try {
    console.log('🔧 Fixing vehicle table constraints...\n');
    
    await pool.query(`
      ALTER TABLE vehicles 
      ALTER COLUMN hourly_rate DROP NOT NULL,
      ALTER COLUMN location DROP NOT NULL;
    `);
    
    console.log('✅ Constraints fixed!');
    console.log('   hourly_rate is now nullable');
    console.log('   location is now nullable\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

fix();