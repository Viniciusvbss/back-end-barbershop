const APPOINTMENT_SELECT = `
  a.id, a.barbershop_id, a.barber_id, a.customer_id, a.service_id,
  a.appointment_date, a.appointment_time, a.status, a.created_at,
  c.name AS customer_name, c.phone AS customer_phone,
  b.name AS barber_name, b.image_url AS barber_image_url,
  GROUP_CONCAT(
    CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
    ORDER BY aps.position, s.id SEPARATOR ' + '
  ) AS service_name,
  COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
  COALESCE(SUM(s.price * aps.quantity), 0) AS price,
  CONCAT('[',
    GROUP_CONCAT(
      JSON_OBJECT(
        'id', s.id,
        'name', s.name,
        'duration_minutes', s.duration_minutes,
        'price', s.price,
        'quantity', aps.quantity
      )
      ORDER BY aps.position, s.id
      SEPARATOR ','
    ),
    ']'
  ) AS services
`;

const APPOINTMENT_JOINS = `
  FROM appointments a
  JOIN customers c ON a.customer_id = c.id
  JOIN barbers b ON a.barber_id = b.id
  LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
  LEFT JOIN services s ON s.id = aps.service_id
`;

const APPOINTMENT_GROUP_BY = `
  GROUP BY a.id, a.barbershop_id, a.barber_id, a.customer_id, a.service_id,
           a.appointment_date, a.appointment_time, a.status, a.created_at,
           c.name, c.phone, b.name, b.image_url
`;

const normalizeRow = (row) => {
  if (!row) return row;
  let services = row.services;
  if (typeof services === 'string') {
    try { services = JSON.parse(services); } catch { services = []; }
  }
  return {
    ...row,
    services: Array.isArray(services) ? services.filter((s) => s && s.id) : [],
    duration_minutes: Number(row.duration_minutes ?? 0),
    price: row.price != null ? String(row.price) : null,
  };
};

let schemaReadyPromise = null;

const ensureSchema = async (db) => {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS appointment_services (
        appointment_id INT NOT NULL,
        service_id INT NOT NULL,
        position INT NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 1,
        PRIMARY KEY (appointment_id, service_id),
        INDEX idx_aps_appointment (appointment_id),
        CONSTRAINT fk_aps_appointment
          FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
        CONSTRAINT fk_aps_service
          FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
      )
    `);

    const [columns] = await db.query('SHOW COLUMNS FROM appointment_services LIKE ?', ['quantity']);
    if (!columns.length) {
      await db.query('ALTER TABLE appointment_services ADD COLUMN quantity INT NOT NULL DEFAULT 1');
    }

    await db.query(`
      INSERT IGNORE INTO appointment_services (appointment_id, service_id, position, quantity)
      SELECT id, service_id, 0, 1 FROM appointments WHERE service_id IS NOT NULL
    `);
  })().catch((err) => { schemaReadyPromise = null; throw err; });

  return schemaReadyPromise;
};

const findById = async (db, id, barbershopId) => {
  const [rows] = await db.query(
    `SELECT ${APPOINTMENT_SELECT} ${APPOINTMENT_JOINS}
     WHERE a.id = ? AND a.barbershop_id = ? ${APPOINTMENT_GROUP_BY}`,
    [id, barbershopId],
  );
  return rows.length ? normalizeRow(rows[0]) : null;
};

const list = async (db, barbershopId, { barberId, date, status } = {}) => {
  let query = `SELECT ${APPOINTMENT_SELECT} ${APPOINTMENT_JOINS} WHERE a.barbershop_id = ?`;
  const params = [barbershopId];
  if (barberId) { query += ' AND a.barber_id = ?'; params.push(barberId); }
  if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
  if (status) { query += ' AND a.status = ?'; params.push(status); }
  query += ` ${APPOINTMENT_GROUP_BY} ORDER BY a.appointment_date, a.appointment_time`;
  const [rows] = await db.query(query, params);
  return rows.map(normalizeRow);
};

const listPublicBySlug = async (db, slug, { barberId, date, status } = {}) => {
  let query = `
    SELECT
      a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
      b.name AS barber_name, b.image_url AS barber_image_url,
      GROUP_CONCAT(
        CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
        ORDER BY aps.position, s.id SEPARATOR ' + '
      ) AS service_name,
      COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
      COALESCE(SUM(s.price * aps.quantity), 0) AS price,
      CONCAT('[',
        GROUP_CONCAT(
          JSON_OBJECT('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes, 'price', s.price, 'quantity', aps.quantity)
          ORDER BY aps.position, s.id SEPARATOR ','
        ),
      ']') AS services
    FROM appointments a
    JOIN barbershops bs ON a.barbershop_id = bs.id
    JOIN barbers b ON a.barber_id = b.id
    LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
    LEFT JOIN services s ON s.id = aps.service_id
    WHERE bs.slug = ?
  `;
  const params = [slug];
  if (barberId) { query += ' AND a.barber_id = ?'; params.push(barberId); }
  if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
  if (status) { query += ' AND a.status = ?'; params.push(status); }
  query += `
    GROUP BY a.id, a.appointment_date, a.appointment_time, a.status, a.created_at, b.name, b.image_url
    ORDER BY a.appointment_date, a.appointment_time
  `;
  const [rows] = await db.query(query, params);
  return rows.map(normalizeRow);
};

const lookupByPhone = async (db, slug, digits) => {
  const [rows] = await db.query(
    `SELECT
       a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
       c.name AS customer_name,
       b.name AS barber_name, b.image_url AS barber_image_url,
       GROUP_CONCAT(
         CASE WHEN aps.quantity > 1 THEN CONCAT(s.name, ' ×', aps.quantity) ELSE s.name END
         ORDER BY aps.position, s.id SEPARATOR ' + '
       ) AS service_name,
       COALESCE(SUM(s.duration_minutes * aps.quantity), 0) AS duration_minutes,
       COALESCE(SUM(s.price * aps.quantity), 0) AS price,
       CONCAT('[',
         GROUP_CONCAT(
           JSON_OBJECT('id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes, 'price', s.price, 'quantity', aps.quantity)
           ORDER BY aps.position, s.id SEPARATOR ','
         ),
       ']') AS services
     FROM appointments a
     JOIN barbershops bs ON a.barbershop_id = bs.id
     JOIN customers c ON a.customer_id = c.id
     JOIN barbers b ON a.barber_id = b.id
     LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
     LEFT JOIN services s ON s.id = aps.service_id
     WHERE bs.slug = ?
       AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') = ?
     GROUP BY a.id, a.appointment_date, a.appointment_time, a.status, a.created_at, c.name, b.name, b.image_url
     ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
    [slug, digits],
  );
  return rows.map(normalizeRow);
};

const checkConflict = async (db, barbershopId, barberId, date, time, excludeId = null) => {
  let query = `SELECT id FROM appointments
    WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ?
      AND appointment_time = ? AND status != 'cancelled'`;
  const params = [barbershopId, barberId, date, time];
  if (excludeId) { query += ' AND id != ?'; params.push(excludeId); }
  const [rows] = await db.query(query, params);
  return rows.length > 0;
};

const create = async (db, { barbershopId, barberId, customerId, principalServiceId, date, time }) => {
  const [result] = await db.query(
    `INSERT INTO appointments
     (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [barbershopId, barberId, customerId, principalServiceId, date, time],
  );
  return result.insertId;
};

const update = async (db, id, barbershopId, { barberId, principalServiceId, date, time }) => {
  await db.query(
    `UPDATE appointments
     SET barber_id = ?, service_id = ?, appointment_date = ?, appointment_time = ?
     WHERE id = ? AND barbershop_id = ?`,
    [barberId, principalServiceId, date, time, id, barbershopId],
  );
};

const updateStatus = async (db, id, barbershopId, status) => {
  const [result] = await db.query(
    'UPDATE appointments SET status = ? WHERE id = ? AND barbershop_id = ?',
    [status, id, barbershopId],
  );
  return result.affectedRows > 0;
};

const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM appointments WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

const replaceServices = async (db, appointmentId, items) => {
  await db.query('DELETE FROM appointment_services WHERE appointment_id = ?', [appointmentId]);
  if (!items.length) return;
  const values = items.map((item, idx) => [appointmentId, item.service_id, idx, item.quantity]);
  await db.query(
    'INSERT INTO appointment_services (appointment_id, service_id, position, quantity) VALUES ?',
    [values],
  );
};

const getRaw = async (db, id, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM appointments WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return rows.length ? rows[0] : null;
};

module.exports = {
  ensureSchema,
  findById,
  list,
  listPublicBySlug,
  lookupByPhone,
  checkConflict,
  create,
  update,
  updateStatus,
  remove,
  replaceServices,
  getRaw,
};
