const path = require('path');
const fs = require('fs');
const logger = require('../src/utils/logger');

const runMigrations = async (db) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    )
  `);

  const files = fs.readdirSync(__dirname)
    .filter((f) => /^\d{3}_.*\.js$/.test(f))
    .sort();

  for (const file of files) {
    const name = file.replace('.js', '');

    const [rows] = await db.query(
      'SELECT name FROM schema_migrations WHERE name = ?',
      [name],
    );
    if (rows.length) continue;

    logger.info(`Migration: running ${name}`);
    const migration = require(path.join(__dirname, file));
    await migration.up(db);
    await db.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    logger.info(`Migration: applied ${name}`);
  }
};

module.exports = { runMigrations };
