const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  console.log('🎁 Setting up Referral & Coupons System...\n');
  
  try {
    // Referral codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(20) UNIQUE NOT NULL,
        total_referrals INTEGER DEFAULT 0,
        total_earnings NUMERIC(10,2) DEFAULT 0,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    console.log('✅ Referral codes table created');
    
    // Referral usage table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referral_code_id UUID NOT NULL REFERENCES referral_codes(id),
        referred_user_id UUID NOT NULL REFERENCES users(id),
        referrer_reward NUMERIC(10,2) DEFAULT 50,
        referred_reward NUMERIC(10,2) DEFAULT 50,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        UNIQUE(referred_user_id)
      )
    `);
    console.log('✅ Referral usage table created');
    
    // Discount coupons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(30) UNIQUE NOT NULL,
        description TEXT,
        discount_type VARCHAR(20) NOT NULL,
        discount_value NUMERIC(10,2) NOT NULL,
        min_booking_amount NUMERIC(10,2) DEFAULT 0,
        max_discount_amount NUMERIC(10,2),
        total_uses INTEGER DEFAULT 0,
        max_uses INTEGER,
        max_uses_per_user INTEGER DEFAULT 1,
        valid_from TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        valid_until TIMESTAMP WITHOUT TIME ZONE,
        is_active BOOLEAN DEFAULT true,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ Coupons table created');
    
    // Coupon usage table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coupon_id UUID NOT NULL REFERENCES coupons(id),
        user_id UUID NOT NULL REFERENCES users(id),
        booking_id UUID REFERENCES bookings(id),
        discount_applied NUMERIC(10,2) NOT NULL,
        used_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ Coupon usage table created');
    
    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
      CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);
      CREATE INDEX IF NOT EXISTS idx_referral_code ON referral_codes(code);
    `);
    console.log('✅ Indexes created');
    
    console.log('\n✅ Referral & Coupons system ready!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

setup();