const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  console.log('⭐ Setting up Favorites System...\n');
  
  try {
    // Create favorites table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, vehicle_id)
      )
    `);
    console.log('✅ Favorites table created');
    
    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_favorites_user 
      ON favorites(user_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_favorites_vehicle 
      ON favorites(vehicle_id)
    `);
    console.log('✅ Indexes created');
    
    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'favorites'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Favorites table:');
    result.rows.forEach((col, i) => {
      console.log(`   ${i + 1}. ${col.column_name} (${col.data_type})`);
    });
    
    console.log('\n✅ Favorites system ready!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

setup();