const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/db');

console.log('📸 Creating Complete Project Snapshot...\n');

async function createSnapshot() {
  const snapshot = {
    timestamp: new Date().toISOString(),
    project: 'Sakkaram Backend',
    progress: 'Day 5 Complete - 20%',
    
    // Will be populated
    database: {},
    fileStructure: {},
    apiEndpoints: {},
    environment: {},
    statistics: {}
  };

  try {
    // ============================================
    // 1. DATABASE SCHEMA
    // ============================================
    console.log('📊 Step 1: Capturing Database Schema...');
    
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    snapshot.database.tables = {};
    
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      
      // Get columns for each table
      const columnsResult = await pool.query(`
        SELECT 
          column_name, 
          data_type, 
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);
      
      // Get row count
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      
      // Get indexes
      const indexesResult = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
      `, [tableName]);
      
      snapshot.database.tables[tableName] = {
        columns: columnsResult.rows,
        rowCount: parseInt(countResult.rows[0].count),
        indexes: indexesResult.rows
      };
    }
    
    console.log(`   ✅ Captured ${tablesResult.rows.length} tables`);
    console.log('');

    // ============================================
    // 2. FILE STRUCTURE
    // ============================================
    console.log('📁 Step 2: Scanning File Structure...');
    
    const scanDirectory = (dir, baseDir = dir) => {
      const items = fs.readdirSync(dir);
      const structure = {};
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.relative(baseDir, fullPath);
        
        // Skip node_modules, .git, etc.
        if (item === 'node_modules' || item === '.git' || item.startsWith('.')) {
          continue;
        }
        
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          structure[item] = {
            type: 'directory',
            children: scanDirectory(fullPath, baseDir)
          };
        } else if (stat.isFile()) {
          structure[item] = {
            type: 'file',
            size: stat.size,
            extension: path.extname(item),
            modified: stat.mtime
          };
          
          // Read content for important files
          if (item.endsWith('.js') || item.endsWith('.json') || item.endsWith('.env.example')) {
            try {
              structure[item].lines = fs.readFileSync(fullPath, 'utf8').split('\n').length;
            } catch (e) {
              structure[item].lines = 0;
            }
          }
        }
      }
      
      return structure;
    };
    
    snapshot.fileStructure = scanDirectory(path.join(__dirname));
    console.log('   ✅ File structure captured');
    console.log('');

    // ============================================
    // 3. API ENDPOINTS
    // ============================================
    console.log('🔗 Step 3: Documenting API Endpoints...');
    
    const extractRoutes = (routesPath) => {
      if (!fs.existsSync(routesPath)) return [];
      
      const content = fs.readFileSync(routesPath, 'utf8');
      const routes = [];
      
      // Simple regex to find route definitions
      const routeRegex = /router\.(get|post|put|delete|patch)\(['"`]([^'"`]+)['"`]/g;
      let match;
      
      while ((match = routeRegex.exec(content)) !== null) {
        routes.push({
          method: match[1].toUpperCase(),
          path: match[2]
        });
      }
      
      return routes;
    };
    
    snapshot.apiEndpoints = {
      auth: extractRoutes(path.join(__dirname, 'src/routes/authRoutes.js')),
      vehicles: extractRoutes(path.join(__dirname, 'src/routes/vehicleRoutes.js')),
      wallet: extractRoutes(path.join(__dirname, 'src/routes/walletRoutes.js')),
      bookings: extractRoutes(path.join(__dirname, 'src/routes/bookingRoutes.js')),
      payments: extractRoutes(path.join(__dirname, 'src/routes/paymentRoutes.js'))
    };
    
    const totalEndpoints = Object.values(snapshot.apiEndpoints)
      .reduce((sum, routes) => sum + routes.length, 0);
    
    console.log(`   ✅ Found ${totalEndpoints} API endpoints`);
    console.log('');

    // ============================================
    // 4. ENVIRONMENT CONFIG
    // ============================================
    console.log('⚙️  Step 4: Checking Environment...');
    
    snapshot.environment = {
      nodeVersion: process.version,
      platform: process.platform,
      hasEnvFile: fs.existsSync(path.join(__dirname, '.env')),
      hasEnvExample: fs.existsSync(path.join(__dirname, '.env.example')),
      packageJson: JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
    };
    
    console.log(`   ✅ Node version: ${process.version}`);
    console.log('');

    // ============================================
    // 5. STATISTICS
    // ============================================
    console.log('📈 Step 5: Calculating Statistics...');
    
    const countFiles = (structure, extension = null) => {
      let count = 0;
      for (const key in structure) {
        if (structure[key].type === 'file') {
          if (!extension || structure[key].extension === extension) {
            count++;
          }
        } else if (structure[key].children) {
          count += countFiles(structure[key].children, extension);
        }
      }
      return count;
    };
    
    const countLines = (structure) => {
      let lines = 0;
      for (const key in structure) {
        if (structure[key].type === 'file' && structure[key].lines) {
          lines += structure[key].lines;
        } else if (structure[key].children) {
          lines += countLines(structure[key].children);
        }
      }
      return lines;
    };
    
    snapshot.statistics = {
      totalFiles: countFiles(snapshot.fileStructure),
      jsFiles: countFiles(snapshot.fileStructure, '.js'),
      jsonFiles: countFiles(snapshot.fileStructure, '.json'),
      totalLines: countLines(snapshot.fileStructure),
      totalTables: Object.keys(snapshot.database.tables).length,
      totalEndpoints: totalEndpoints,
      totalRecords: Object.values(snapshot.database.tables)
        .reduce((sum, table) => sum + table.rowCount, 0)
    };
    
    console.log(`   ✅ Total files: ${snapshot.statistics.totalFiles}`);
    console.log(`   ✅ JS files: ${snapshot.statistics.jsFiles}`);
    console.log(`   ✅ Total lines: ${snapshot.statistics.totalLines}`);
    console.log('');

    // ============================================
    // 6. SAVE SNAPSHOT
    // ============================================
    console.log('💾 Step 6: Saving Snapshot...');
    
    const snapshotPath = path.join(__dirname, 'PROJECT_SNAPSHOT.json');
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    
    console.log(`   ✅ Saved to: ${snapshotPath}`);
    console.log('');

    // ============================================
    // 7. CREATE READABLE REPORT
    // ============================================
    console.log('📄 Step 7: Creating Readable Report...');
    
    let report = `# 🔍 SAKKARAM PROJECT SNAPSHOT
Generated: ${snapshot.timestamp}
Progress: Day 5 Complete (20%)

---

## 📊 DATABASE SCHEMA

Total Tables: ${snapshot.statistics.totalTables}
Total Records: ${snapshot.statistics.totalRecords}

### Tables Overview:

`;

    for (const [tableName, tableData] of Object.entries(snapshot.database.tables)) {
      report += `#### ${tableName}\n`;
      report += `- Columns: ${tableData.columns.length}\n`;
      report += `- Records: ${tableData.rowCount}\n`;
      report += `- Indexes: ${tableData.indexes.length}\n`;
      report += `\n**Columns:**\n`;
      tableData.columns.forEach(col => {
        report += `- \`${col.column_name}\` (${col.data_type}) ${col.is_nullable === 'NO' ? '- NOT NULL' : ''}\n`;
      });
      report += `\n`;
    }

    report += `---

## 🔗 API ENDPOINTS

Total Endpoints: ${snapshot.statistics.totalEndpoints}

`;

    for (const [module, routes] of Object.entries(snapshot.apiEndpoints)) {
      report += `### ${module.toUpperCase()} (${routes.length} endpoints)\n\n`;
      routes.forEach(route => {
        report += `- **${route.method}** \`/api/${module}${route.path}\`\n`;
      });
      report += `\n`;
    }

    report += `---

## 📁 FILE STRUCTURE

Total Files: ${snapshot.statistics.totalFiles}
JavaScript Files: ${snapshot.statistics.jsFiles}
Total Lines of Code: ${snapshot.statistics.totalLines}

### Key Directories:

\`\`\`
backend/
├── src/
│   ├── config/      (${Object.keys(snapshot.fileStructure.src?.children?.config?.children || {}).length} files)
│   ├── controllers/ (${Object.keys(snapshot.fileStructure.src?.children?.controllers?.children || {}).length} files)
│   ├── middlewares/ (${Object.keys(snapshot.fileStructure.src?.children?.middlewares?.children || {}).length} files)
│   ├── routes/      (${Object.keys(snapshot.fileStructure.src?.children?.routes?.children || {}).length} files)
│   ├── services/    (${Object.keys(snapshot.fileStructure.src?.children?.services?.children || {}).length} files)
│   ├── app.js
│   └── server.js
├── package.json
└── .env.example
\`\`\`

---

## ⚙️ ENVIRONMENT

- **Node.js:** ${snapshot.environment.nodeVersion}
- **Platform:** ${snapshot.environment.platform}
- **Has .env:** ${snapshot.environment.hasEnvFile ? '✅' : '❌'}
- **Has .env.example:** ${snapshot.environment.hasEnvExample ? '✅' : '❌'}

### Dependencies:

${Object.entries(snapshot.environment.packageJson.dependencies || {})
  .map(([pkg, ver]) => `- ${pkg}: ${ver}`)
  .join('\n')}

---

## 📈 PROJECT STATISTICS

| Metric | Count |
|--------|-------|
| Database Tables | ${snapshot.statistics.totalTables} |
| Total Records | ${snapshot.statistics.totalRecords} |
| API Endpoints | ${snapshot.statistics.totalEndpoints} |
| Total Files | ${snapshot.statistics.totalFiles} |
| JavaScript Files | ${snapshot.statistics.jsFiles} |
| Lines of Code | ${snapshot.statistics.totalLines} |

---

**END OF SNAPSHOT**
`;

    const reportPath = path.join(__dirname, 'PROJECT_SNAPSHOT_REPORT.md');
    fs.writeFileSync(reportPath, report);
    
    console.log(`   ✅ Saved to: ${reportPath}`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('✅ PROJECT SNAPSHOT COMPLETE!');
    console.log('');
    console.log('📦 Files Created:');
    console.log(`   1. PROJECT_SNAPSHOT.json (${Math.round(JSON.stringify(snapshot).length / 1024)}KB)`);
    console.log(`   2. PROJECT_SNAPSHOT_REPORT.md`);
    console.log('');
    console.log('📊 Summary:');
    console.log(`   - Database Tables: ${snapshot.statistics.totalTables}`);
    console.log(`   - API Endpoints: ${snapshot.statistics.totalEndpoints}`);
    console.log(`   - Total Files: ${snapshot.statistics.totalFiles}`);
    console.log(`   - Lines of Code: ${snapshot.statistics.totalLines}`);
    console.log('');
    console.log('📤 Next Step: Upload these files to share with AI');
    console.log('');

  } catch (error) {
    console.error('❌ Snapshot failed:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

createSnapshot();