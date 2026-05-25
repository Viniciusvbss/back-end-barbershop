const crypto = require('crypto');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

let tablesReadyPromise = null;

const ensureTables = async (db) => {
  if (tablesReadyPromise) return tablesReadyPromise;

  tablesReadyPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barbershop_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_resets_token_hash (token_hash),
        INDEX idx_password_resets_barbershop_id (barbershop_id),
        CONSTRAINT fk_password_resets_barbershop
          FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_recovery_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        barbershop_id INT NULL,
        success TINYINT(1) NOT NULL DEFAULT 0,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_recovery_logs_email (email),
        INDEX idx_password_recovery_logs_created_at (created_at)
      )
    `);
  })().catch((err) => { tablesReadyPromise = null; throw err; });

  return tablesReadyPromise;
};

const invalidatePreviousResets = async (db, barbershopId) => {
  await db.query(
    'UPDATE password_resets SET used_at = NOW() WHERE barbershop_id = ? AND used_at IS NULL',
    [barbershopId],
  );
};

const createReset = async (db, barbershopId, rawToken, minutes) => {
  const tokenHash = hashToken(rawToken);
  await db.query(
    `INSERT INTO password_resets (barbershop_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [barbershopId, tokenHash, minutes],
  );
};

const findValidReset = async (db, rawToken) => {
  const [rows] = await db.query(
    `SELECT id, barbershop_id FROM password_resets
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [hashToken(rawToken)],
  );
  return rows.length ? rows[0] : null;
};

const markResetUsed = async (db, id) => {
  await db.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [id]);
};

const logRecoveryAttempt = async (db, { email, barbershopId, success, ipAddress, userAgent }) => {
  await db.query(
    `INSERT INTO password_recovery_logs
     (email, barbershop_id, success, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [email, barbershopId || null, success ? 1 : 0, ipAddress, userAgent],
  );
};

module.exports = {
  ensureTables,
  invalidatePreviousResets,
  createReset,
  findValidReset,
  markResetUsed,
  logRecoveryAttempt,
};
