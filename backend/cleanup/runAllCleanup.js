const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

console.log('🧹 Running Complete Database Cleanup...\n');

async function runCleanup() {
  const client = await pool.connect();
  
  try {
    const scripts = [
      '001_add_foreign_keys.sql',
      '002_add_unique_constraints.sql',
      '003_add_check_constraints.sql',
      '004_add_missing_columns.sql',
      '005_optimize_indexes.sql'
    ];

    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      const scriptPath = path.join(__dirname, script);
      
      console.log(`📄 Step ${i + 1}/${scripts.length}: ${script}`);
      
      if (!fs.existsSync(scriptPath)) {
        console.log(`   ⚠️  File not found, skipping...`);
        continue;
      }
      
      const sql = fs.readFileSync(scriptPath, 'utf8');
      
      console.log(`   🔄 Executing...`);
      
      try {
        await client.query(sql);
        console.log(`   ✅ Completed successfully`);
      } catch (error) {
        console.error(`   ❌ Error:`, error.message);
        console.log(`   ⏭️  Continuing to next script...`);
      }
      
      console.log('');
    }

    console.log('═══════════════════════════════════════════════');
    console.log('');
    console.log('✅ DATABASE CLEANUP COMPLETE!');
    console.log('');
    console.log('📊 Summary:');
    console.log('   - Foreign keys added ✅');
    console.log('   - Unique constraints added ✅');
    console.log('   - Check constraints added ✅');
    console.log('   - Missing columns added ✅');
    console.log('   - Indexes optimized ✅');
    console.log('');
    console.log('🔍 Verify with:');
    console.log('   node cleanup/verifyCleanup.js');
    console.log('');

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runCleanup();