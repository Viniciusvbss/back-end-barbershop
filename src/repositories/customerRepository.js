const { ensurePrivacySchema } = require('../utils/privacy');

const CUSTOMER_SELECT = `
  id, barbershop_id, name, phone, email, marketing_consent,
  privacy_policy_accepted_at, privacy_policy_version, anonymized_at, created_at
`;

const ensureSchema = async (db) => ensurePrivacySchema(db);

const findById = async (db, id, barbershopId) => {
  await ensurePrivacySchema(db);
  const [rows] = await db.query(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ? AND barbershop_id = ?`,
    [id, barbershopId],
  );
  return rows.length ? rows[0] : null;
};

const findByPhone = async (db, barbershopId, phone) => {
  const [rows] = await db.query(
    'SELECT id FROM customers WHERE barbershop_id = ? AND phone = ? LIMIT 1',
    [barbershopId, phone],
  );
  return rows.length ? rows[0] : null;
};

const list = async (db, barbershopId, { page, limit } = {}) => {
  await ensurePrivacySchema(db);

  const p = page != null ? Math.max(1, Number(page)) : null;
  const l = limit != null ? Math.min(200, Math.max(1, Number(limit))) : null;

  if (p !== null && l !== null) {
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM customers WHERE barbershop_id = ?',
      [barbershopId],
    );
    const offset = (p - 1) * l;
    const [rows] = await db.query(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE barbershop_id = ?
       ORDER BY name LIMIT ? OFFSET ?`,
      [barbershopId, l, offset],
    );
    return { data: rows, total, page: p, limit: l };
  }

  const [rows] = await db.query(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE barbershop_id = ? ORDER BY name`,
    [barbershopId],
  );
  return rows;
};

const create = async (db, { barbershopId, name, phone, email, marketingConsent, privacyVersion }) => {
  const [result] = await db.query(
    `INSERT INTO customers
     (barbershop_id, name, phone, email, privacy_policy_accepted_at,
      privacy_policy_version, marketing_consent, marketing_consent_at)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
    [
      barbershopId, name, phone || null, email || null,
      privacyVersion,
      marketingConsent ? 1 : 0,
      marketingConsent ? new Date() : null,
    ],
  );
  return result.insertId;
};

const updatePrivacyConsent = async (db, id, barbershopId, { privacyVersion, marketingConsent }) => {
  await db.query(
    `UPDATE customers
     SET privacy_policy_accepted_at = NOW(), privacy_policy_version = ?,
         marketing_consent = ?, marketing_consent_at = ?
     WHERE id = ? AND barbershop_id = ?`,
    [
      privacyVersion,
      marketingConsent ? 1 : 0,
      marketingConsent ? new Date() : null,
      id, barbershopId,
    ],
  );
};

const update = async (db, id, barbershopId, { name, phone, email, marketingConsent }) => {
  const updates = ['name = ?', 'phone = ?', 'email = ?'];
  const values = [name, phone || null, email || null];
  if (marketingConsent !== undefined) {
    updates.push('marketing_consent = ?', 'marketing_consent_at = ?');
    values.push(marketingConsent ? 1 : 0, marketingConsent ? new Date() : null);
  }
  values.push(id, barbershopId);
  const [result] = await db.query(
    `UPDATE customers SET ${updates.join(', ')} WHERE id = ? AND barbershop_id = ?`,
    values,
  );
  if (!result.affectedRows) return null;
  return findById(db, id, barbershopId);
};

const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM customers WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

const anonymize = async (db, id, barbershopId) => {
  const [result] = await db.query(
    `UPDATE customers
     SET name = 'Cliente removido', phone = NULL, email = NULL,
         marketing_consent = 0, marketing_consent_at = NULL, anonymized_at = NOW()
     WHERE id = ? AND barbershop_id = ?`,
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

const exportData = async (db, id, barbershopId) => {
  const [customers] = await db.query(
    `SELECT id, name, phone, email, marketing_consent, privacy_policy_accepted_at,
             privacy_policy_version, created_at
     FROM customers WHERE id = ? AND barbershop_id = ?`,
    [id, barbershopId],
  );
  if (!customers.length) return null;

  const [appointments] = await db.query(
    `SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
             b.name AS barber_name, s.name AS service_name, s.duration_minutes, s.price
     FROM appointments a
     JOIN barbers b ON a.barber_id = b.id
     JOIN services s ON a.service_id = s.id
     WHERE a.customer_id = ? AND a.barbershop_id = ?
     ORDER BY a.appointment_date, a.appointment_time`,
    [id, barbershopId],
  );

  return { exported_at: new Date().toISOString(), customer: customers[0], appointments };
};

module.exports = {
  ensureSchema,
  findById,
  findByPhone,
  list,
  create,
  updatePrivacyConsent,
  update,
  remove,
  anonymize,
  exportData,
};
