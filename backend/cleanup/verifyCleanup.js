const { pool } = require('../src/config/db');

console.log('🔍 Verifying Database Cleanup...\n');

async function verify() {
  try {
    console.log('═══════════════════════════════════════════════\n');
    
    // 1. Check Foreign Keys
    console.log('📌 1. FOREIGN KEY CONSTRAINTS:\n');
    const fkResult = await pool.query(`
      SELECT 
        conname AS constraint_name,
        conrelid::regclass AS table_name,
        confrelid::regclass AS referenced_table
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text
    `);
    
    console.log(`   Found ${fkResult.rows.length} foreign key constraints:\n`);
    fkResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name} → ${row.referenced_table} (${row.constraint_name})`);
    });
    console.log('');

    // 2. Check Unique Constraints
    console.log('🔑 2. UNIQUE CONSTRAINTS:\n');
    const uqResult = await pool.query(`
      SELECT 
        conname AS constraint_name,
        conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE contype = 'u'
        AND connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text
    `);
    
    console.log(`   Found ${uqResult.rows.length} unique constraints:\n`);
    uqResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}: ${row.constraint_name}`);
    });
    console.log('');

    // 3. Check Check Constraints
    console.log('✓ 3. CHECK CONSTRAINTS:\n');
    const checkResult = await pool.query(`
      SELECT 
        conname AS constraint_name,
        conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE contype = 'c'
        AND connamespace = 'public'::regnamespace
        AND conname LIKE 'chk_%'
      ORDER BY conrelid::regclass::text
    `);
    
    console.log(`   Found ${checkResult.rows.length} check constraints:\n`);
    checkResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}: ${row.constraint_name}`);
    });
    console.log('');

    // 4. Check Missing Columns Added
    console.log('📊 4. NEW COLUMNS IN WALLET_TRANSACTIONS:\n');
    const columnsResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'wallet_transactions'
        AND column_name IN ('balance_before', 'booking_id')
      ORDER BY column_name
    `);
    
    columnsResult.rows.forEach(row => {
      console.log(`   ✅ ${row.column_name} (${row.data_type})`);
    });
    console.log('');

    // 5. Check Indexes
    console.log('📇 5. OPTIMIZED INDEXES:\n');
    const indexResult = await pool.query(`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND (indexname LIKE 'idx_%status%' 
          OR indexname LIKE 'idx_%transaction%'
          OR indexname LIKE 'idx_active%'
          OR indexname LIKE 'idx_pending%')
      ORDER BY tablename, indexname
    `);
    
    console.log(`   Found ${indexResult.rows.length} optimized indexes:\n`);
    indexResult.rows.forEach(row => {
      console.log(`   ✅ ${row.tablename}: ${row.indexname}`);
    });
    console.log('');

    // Summary
    console.log('═══════════════════════════════════════════════\n');
    console.log('✅ VERIFICATION COMPLETE!\n');
    console.log('📊 Summary:');
    console.log(`   - Foreign Keys: ${fkResult.rows.length}`);
    console.log(`   - Unique Constraints: ${uqResult.rows.length}`);
    console.log(`   - Check Constraints: ${checkResult.rows.length}`);
    console.log(`   - New Columns: ${columnsResult.rows.length}/2`);
    console.log(`   - Optimized Indexes: ${indexResult.rows.length}`);
    console.log('');
    
    if (fkResult.rows.length >= 10 && 
        uqResult.rows.length >= 3 && 
        checkResult.rows.length >= 5) {
      console.log('🎉 DATABASE IS FULLY OPTIMIZED!\n');
    } else {
      console.log('⚠️  Some constraints may be missing. Review output above.\n');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    await pool.end();
  }
}

verify();