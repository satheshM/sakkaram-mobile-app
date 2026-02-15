const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

const runUpdate = async () => {
  try {
    console.log('📦 Updating vehicle schema...');
    
    const sqlPath = path.join(__dirname, 'updateVehicleSchema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Vehicle schema updated!');
    console.log('📋 New columns added for service bookings');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Update failed:', error.message);
    process.exit(1);
  }
};

runUpdate();