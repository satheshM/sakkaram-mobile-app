const { query } = require('./src/config/db');

const checkSchema = async () => {
  try {
    console.log('🔍 Checking bookings table schema...\n');
    
    const result = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'bookings'
      ORDER BY ordinal_position;
    `);
    
    console.log('📋 BOOKINGS TABLE COLUMNS:');
    console.log('='.repeat(80));
    result.rows.forEach((col, i) => {
      console.log(`${i + 1}. ${col.column_name}`);
      console.log(`   Type: ${col.data_type}`);
      console.log(`   Nullable: ${col.is_nullable}`);
      console.log(`   Default: ${col.column_default || 'none'}`);
      console.log('');
    });
    
    console.log('Total columns:', result.rows.length);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

checkSchema();