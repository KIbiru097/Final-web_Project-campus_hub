const { pool, testConnection } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

const runMigration = async () => {
  console.log('Starting database migration...');
  
  await testConnection();
  
  const sqlFile = path.join(__dirname, '..', 'database.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  
  try {
    await pool.query(sql);
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

runMigration();