const {
  ensureBarbershopSettingsColumns,
  getBarbershopSelectFields,
  getPublicBarbershopSelectFields,
  normalizeBarbershopRow,
} = require('../utils/barbershopSettings');

const findById = async (db, id) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getBarbershopSelectFields()} FROM barbershops WHERE id = ?`,
    [id],
  );
  return rows.length ? normalizeBarbershopRow(rows[0]) : null;
};

const findBySlug = async (db, slug) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops WHERE slug = ?`,
    [slug],
  );
  return rows.length ? normalizeBarbershopRow(rows[0]) : null;
};

const findByEmail = async (db, email) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getBarbershopSelectFields()}, password FROM barbershops WHERE email = ?`,
    [email],
  );
  return rows.length ? rows[0] : null;
};

const list = async (db) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops`,
  );
  return rows.map(normalizeBarbershopRow);
};

/**
 * Busca por nome (LIKE %q%) — retorna todas as barbearias cujo nome contenha o termo.
 */
const listByName = async (db, q) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops WHERE name LIKE ?`,
    [`%${q}%`],
  );
  return rows.map(normalizeBarbershopRow);
};

/**
 * Busca por cidade (LIKE %city%) — case-insensitive via collation padrão do MySQL.
 */
const listByCity = async (db, city) => {
  await ensureBarbershopSettingsColumns(db);
  const [rows] = await db.query(
    `SELECT ${getPublicBarbershopSelectFields()} FROM barbershops WHERE city LIKE ?`,
    [`%${city}%`],
  );
  return rows.map(normalizeBarbershopRow);
};

/**
 * Busca por proximidade usando a fórmula de Haversine.
 *
 * A fórmula calcula a distância em km entre dois pontos na superfície esférica
 * da Terra a partir de suas coordenadas decimais (WGS-84).
 *
 * LEAST(1.0, ...) evita erros de domínio em acos() causados por imprecisão
 * de ponto flutuante que poderia produzir valores ligeiramente acima de 1.
 *
 * @param {object} db      - Pool de conexões mysql2
 * @param {number} lat     - Latitude do usuário em graus decimais
 * @param {number} lng     - Longitude do usuário em graus decimais
 * @param {number} radius  - Raio máximo de busca em km (padrão 50)
 */
const listNearby = async (db, { lat, lng, radius = 50 }) => {
  await ensureBarbershopSettingsColumns(db);

  const [rows] = await db.query(
    `SELECT ${getPublicBarbershopSelectFields()},
       ROUND(
         6371 * acos(
           LEAST(1.0,
             sin(radians(?)) * sin(radians(latitude)) +
             cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
           )
         ),
       1) AS distance_km
     FROM barbershops
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL
     HAVING distance_km <= ?
     ORDER BY distance_km ASC`,
    [lat, lat, lng, radius],
  );

  return rows.map((row) => ({
    ...normalizeBarbershopRow(row),
    distance_km: row.distance_km != null ? Number(row.distance_km) : null,
  }));
};

const create = async (db, data) => {
  const [result] = await db.query(
    `INSERT INTO barbershops (
      name, uuid, slug, phone, email, password, logo_url,
      brand_primary_color, brand_secondary_color, brand_public_title,
      brand_public_description, notifications_whatsapp_enabled,
      notifications_email_enabled, notifications_reminder_enabled,
      notifications_reminder_hours, notifications_daily_summary_enabled,
      notifications_daily_summary_time, privacy_policy_accepted_at,
      privacy_policy_version, terms_accepted_at, terms_version, password_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, NOW())`,
    [
      data.name, data.uuid, data.slug, data.phone, data.email, data.password,
      null,
      data.primaryColor, data.secondaryColor,
      null, null,
      1, 1, 1,
      data.reminderHours,
      0, data.dailySummaryTime,
      data.privacyVersion, data.termsVersion,
    ],
  );
  return result.insertId;
};

const update = async (db, id, assignments, values) => {
  await db.query(
    `UPDATE barbershops SET ${assignments.join(', ')} WHERE id = ?`,
    [...values, id],
  );
};

const updateLogo = async (db, id, logoUrl) => {
  await db.query('UPDATE barbershops SET logo_url = ? WHERE id = ?', [logoUrl, id]);
};

const removeLogo = async (db, id) => {
  await db.query('UPDATE barbershops SET logo_url = NULL WHERE id = ?', [id]);
};

const getLogo = async (db, id) => {
  const [rows] = await db.query('SELECT logo_url FROM barbershops WHERE id = ?', [id]);
  return rows.length ? rows[0].logo_url : null;
};

const getBarberImages = async (db, id) => {
  const [rows] = await db.query(
    'SELECT image_url FROM barbers WHERE barbershop_id = ? AND image_url IS NOT NULL',
    [id],
  );
  return rows.map((r) => r.image_url);
};

const tableExists = async (connection, tableName) => {
  const [rows] = await connection.query('SHOW TABLES LIKE ?', [tableName]);
  return rows.length > 0;
};

const remove = async (db, connection, id) => {
  await connection.query('DELETE FROM appointments WHERE barbershop_id = ?', [id]);
  await connection.query('DELETE FROM business_hours WHERE barbershop_id = ?', [id]);
  await connection.query('DELETE FROM services WHERE barbershop_id = ?', [id]);
  await connection.query('DELETE FROM barbers WHERE barbershop_id = ?', [id]);
  // customer_barbershops e customer_favorites: ON DELETE CASCADE cuida disso ao deletar a barbearia,
  // mas fazemos explícito para consistência dentro da transação
  if (await tableExists(connection, 'customer_barbershops')) {
    await connection.query('DELETE FROM customer_barbershops WHERE barbershop_id = ?', [id]);
  }
  if (await tableExists(connection, 'customer_favorites')) {
    await connection.query('DELETE FROM customer_favorites WHERE barbershop_id = ?', [id]);
  }
  if (await tableExists(connection, 'password_resets')) {
    await connection.query('DELETE FROM password_resets WHERE barbershop_id = ?', [id]);
  }
  if (await tableExists(connection, 'privacy_requests')) {
    await connection.query('DELETE FROM privacy_requests WHERE barbershop_id = ?', [id]);
  }
  if (await tableExists(connection, 'consent_logs')) {
    await connection.query('DELETE FROM consent_logs WHERE barbershop_id = ?', [id]);
  }
  const [result] = await connection.query('DELETE FROM barbershops WHERE id = ?', [id]);
  return result.affectedRows > 0;
};

const updatePassword = async (db, id, hashedPassword) => {
  await db.query(
    'UPDATE barbershops SET password = ?, password_updated_at = NOW() WHERE id = ?',
    [hashedPassword, id],
  );
};

module.exports = {
  findById,
  findBySlug,
  findByEmail,
  list,
  listByName,
  listByCity,
  listNearby,
  create,
  update,
  updateLogo,
  removeLogo,
  getLogo,
  getBarberImages,
  remove,
  updatePassword,
};
