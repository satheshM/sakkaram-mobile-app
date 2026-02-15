const { query } = require('./src/config/db');

const check = async () => {
  try {
    console.log('🔍 Checking bookings constraints...\n');
    
    const result = await query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'bookings'::regclass;
    `);
    
    console.log('📋 CONSTRAINTS ON BOOKINGS TABLE:');
    console.log('='.repeat(80));
    result.rows.forEach((con, i) => {
      console.log(`${i + 1}. ${con.conname}`);
      console.log(`   ${con.definition}\n`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

check();