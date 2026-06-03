const CUSTOMER_SELECT = 'id, name, phone, email, anonymized_at, created_at';

// Campos adicionados via JOIN com customer_barbershops (uso admin)
const CUSTOMER_WITH_CONSENT = `
  c.id, c.name, c.phone, c.email, c.anonymized_at, c.created_at,
  cb.privacy_policy_accepted_at, cb.privacy_policy_version,
  cb.marketing_consent, cb.marketing_consent_at
`;

const findById = async (db, id, barbershopId) => {
  const [rows] = await db.query(`
    SELECT ${CUSTOMER_WITH_CONSENT}
    FROM customers c
    JOIN customer_barbershops cb ON c.id = cb.customer_id
    WHERE c.id = ? AND cb.barbershop_id = ?
  `, [id, barbershopId]);
  return rows.length ? rows[0] : null;
};

const findByIdGlobal = async (db, id) => {
  const [rows] = await db.query(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ?`,
    [id],
  );
  return rows.length ? rows[0] : null;
};

const findByPhone = async (db, phone) => {
  const [rows] = await db.query(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE phone = ? LIMIT 1`,
    [phone],
  );
  return rows.length ? rows[0] : null;
};

const findByEmail = async (db, email) => {
  const [rows] = await db.query(
    `SELECT id, name, phone, email, password_hash, anonymized_at FROM customers WHERE email = ? LIMIT 1`,
    [email],
  );
  return rows.length ? rows[0] : null;
};

const list = async (db, barbershopId, { page, limit } = {}) => {
  const p = page != null ? Math.max(1, Number(page)) : null;
  const l = limit != null ? Math.min(200, Math.max(1, Number(limit))) : null;

  const baseWhere = 'cb.barbershop_id = ?';

  if (p !== null && l !== null) {
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM customers c JOIN customer_barbershops cb ON c.id = cb.customer_id WHERE ${baseWhere}`,
      [barbershopId],
    );
    const offset = (p - 1) * l;
    const [rows] = await db.query(`
      SELECT ${CUSTOMER_WITH_CONSENT}
      FROM customers c
      JOIN customer_barbershops cb ON c.id = cb.customer_id
      WHERE ${baseWhere}
      ORDER BY c.name LIMIT ? OFFSET ?
    `, [barbershopId, l, offset]);
    return { data: rows, total, page: p, limit: l };
  }

  const [rows] = await db.query(`
    SELECT ${CUSTOMER_WITH_CONSENT}
    FROM customers c
    JOIN customer_barbershops cb ON c.id = cb.customer_id
    WHERE ${baseWhere}
    ORDER BY c.name
  `, [barbershopId]);
  return rows;
};

const create = async (db, { name, phone, email }) => {
  const [result] = await db.query(
    'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
    [name, phone || null, email || null],
  );
  return result.insertId;
};

const update = async (db, id, barbershopId, { name, phone, email, marketingConsent }) => {
  const [linkRows] = await db.query(
    'SELECT 1 FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ? LIMIT 1',
    [id, barbershopId],
  );
  if (!linkRows.length) return null;

  const [result] = await db.query(
    'UPDATE customers SET name = ?, phone = ?, email = ?, updated_at = NOW() WHERE id = ?',
    [name, phone || null, email || null, id],
  );
  if (!result.affectedRows) return null;

  if (marketingConsent !== undefined) {
    await db.query(`
      UPDATE customer_barbershops
      SET marketing_consent = ?, marketing_consent_at = ?
      WHERE customer_id = ? AND barbershop_id = ?
    `, [marketingConsent ? 1 : 0, marketingConsent ? new Date() : null, id, barbershopId]);
  }

  return findById(db, id, barbershopId);
};

// Remove o vínculo do cliente com a barbearia (não deleta o cliente global)
const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

const anonymize = async (db, id, barbershopId) => {
  const [linkRows] = await db.query(
    'SELECT 1 FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ? LIMIT 1',
    [id, barbershopId],
  );
  if (!linkRows.length) return false;

  await db.query(`
    UPDATE customers
    SET name = 'Cliente removido', phone = NULL, email = NULL,
        password_hash = NULL, anonymized_at = NOW()
    WHERE id = ?
  `, [id]);

  await db.query('DELETE FROM customer_barbershops WHERE customer_id = ?', [id]);
  await db.query('DELETE FROM customer_favorites WHERE customer_id = ?', [id]);

  return true;
};

const exportData = async (db, id, barbershopId) => {
  const [linkRows] = await db.query(
    'SELECT 1 FROM customer_barbershops WHERE customer_id = ? AND barbershop_id = ? LIMIT 1',
    [id, barbershopId],
  );
  if (!linkRows.length) return null;

  const [customers] = await db.query(
    `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ?`,
    [id],
  );
  if (!customers.length) return null;

  const [appointments] = await db.query(`
    SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
           bs.name AS barbershop_name,
           b.name  AS barber_name,
           GROUP_CONCAT(s.name ORDER BY aps.position SEPARATOR ', ') AS services
    FROM appointments a
    JOIN barbershops bs ON a.barbershop_id = bs.id
    JOIN barbers b ON a.barber_id = b.id
    LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN services s ON s.id = aps.service_id
    WHERE a.customer_id = ?
    GROUP BY a.id
    ORDER BY a.appointment_date, a.appointment_time
  `, [id]);

  return { exported_at: new Date().toISOString(), customer: customers[0], appointments };
};

module.exports = {
  findById,
  findByIdGlobal,
  findByPhone,
  findByEmail,
  list,
  create,
  update,
  remove,
  anonymize,
  exportData,
};
