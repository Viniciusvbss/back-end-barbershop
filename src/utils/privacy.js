const PRIVACY_POLICY_VERSION = '2026-05-10';
const TERMS_VERSION = '2026-05-10';

const BARBERSHOP_PRIVACY_COLUMNS = [
  { name: 'privacy_policy_accepted_at', definition: 'DATETIME NULL' },
  { name: 'privacy_policy_version', definition: 'VARCHAR(32) NULL' },
  { name: 'terms_accepted_at', definition: 'DATETIME NULL' },
  { name: 'terms_version', definition: 'VARCHAR(32) NULL' },
];

const CUSTOMER_PRIVACY_COLUMNS = [
  { name: 'privacy_policy_accepted_at', definition: 'DATETIME NULL' },
  { name: 'privacy_policy_version', definition: 'VARCHAR(32) NULL' },
  { name: 'marketing_consent', definition: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'marketing_consent_at', definition: 'DATETIME NULL' },
  { name: 'anonymized_at', definition: 'DATETIME NULL' },
];

let schemaReadyPromise = null;

const getRequestIp = (req) => (
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null
);

const addMissingColumns = async (db, table, columns) => {
  for (const column of columns) {
    const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column.name]);
    if (!rows.length) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`);
    }
  }
};

const ensurePrivacySchema = async (db) => {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    await addMissingColumns(db, 'barbershops', BARBERSHOP_PRIVACY_COLUMNS);
    await addMissingColumns(db, 'customers', CUSTOMER_PRIVACY_COLUMNS);

    await db.query(`
      CREATE TABLE IF NOT EXISTS consent_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barbershop_id INT NULL,
        holder_type VARCHAR(32) NOT NULL,
        holder_id INT NULL,
        action VARCHAR(64) NOT NULL,
        policy_version VARCHAR(32) NULL,
        terms_version VARCHAR(32) NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_consent_logs_barbershop_id (barbershop_id),
        INDEX idx_consent_logs_holder (holder_type, holder_id),
        INDEX idx_consent_logs_created_at (created_at)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS privacy_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        barbershop_id INT NULL,
        request_type VARCHAR(32) NOT NULL,
        requester_name VARCHAR(255) NULL,
        requester_email VARCHAR(255) NULL,
        requester_phone VARCHAR(50) NULL,
        description TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        resolution_note TEXT NULL,
        resolved_at DATETIME NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_privacy_requests_barbershop_id (barbershop_id),
        INDEX idx_privacy_requests_status (status),
        INDEX idx_privacy_requests_created_at (created_at)
      )
    `);
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
};

const recordConsentLog = async (db, req, {
  barbershopId = null,
  holderType,
  holderId = null,
  action,
  policyVersion = PRIVACY_POLICY_VERSION,
  termsVersion = null,
}) => {
  await ensurePrivacySchema(db);

  await db.query(
    `INSERT INTO consent_logs
     (barbershop_id, holder_type, holder_id, action, policy_version, terms_version, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      barbershopId,
      holderType,
      holderId,
      action,
      policyVersion,
      termsVersion,
      getRequestIp(req),
      req.headers['user-agent'] || null,
    ],
  );
};

module.exports = {
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  ensurePrivacySchema,
  getRequestIp,
  recordConsentLog,
};
