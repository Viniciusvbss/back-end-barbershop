const findById = async (db, id, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM services WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return rows.length ? rows[0] : null;
};

const findBySlug = async (db, slug) => {
  const [rows] = await db.query(
    `SELECT s.* FROM services s
     INNER JOIN barbershops b ON b.id = s.barbershop_id
     WHERE b.slug = ? ORDER BY s.id`,
    [slug],
  );
  return rows;
};

const list = async (db, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM services WHERE barbershop_id = ?',
    [barbershopId],
  );
  return rows;
};

const validateItems = async (db, items, barbershopId) => {
  if (!items.length) return false;
  const ids = items.map((item) => item.service_id);
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id FROM services WHERE id IN (${placeholders}) AND barbershop_id = ?`,
    [...ids, barbershopId],
  );
  return rows.length === ids.length;
};

const create = async (db, { barbershopId, name, durationMinutes, price }) => {
  const [result] = await db.query(
    'INSERT INTO services (barbershop_id, name, duration_minutes, price) VALUES (?, ?, ?, ?)',
    [barbershopId, name, durationMinutes, price],
  );
  return { id: result.insertId, barbershop_id: barbershopId, name, duration_minutes: durationMinutes, price };
};

const update = async (db, id, barbershopId, { name, durationMinutes, price }) => {
  const [result] = await db.query(
    'UPDATE services SET name = ?, duration_minutes = ?, price = ? WHERE id = ? AND barbershop_id = ?',
    [name, durationMinutes, price, id, barbershopId],
  );
  if (!result.affectedRows) return null;
  return findById(db, id, barbershopId);
};

const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM services WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

module.exports = { findById, findBySlug, list, validateItems, create, update, remove };
