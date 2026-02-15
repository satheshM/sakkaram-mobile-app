const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

const runUpdate = async () => {
  try {
    console.log('📦 Updating booking schema...');
    
    const sqlPath = path.join(__dirname, 'updateBookingSchema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Booking schema updated!');
    console.log('📋 Added columns: scheduled_date, scheduled_time, cancelled_by, cancellation_reason');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Update failed:', error.message);
    process.exit(1);
  }
};

runUpdate();