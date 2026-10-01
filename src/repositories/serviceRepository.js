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

// Valida que todos os itens pertencem a barbearia e devolve a duracao total em
// minutos, ja multiplicada pela quantidade. Retorna null (e nao 0) quando algum
// servico nao e da loja, porque 0 e um total valido.
const totalDurationForItems = async (db, items, barbershopId) => {
  if (!items.length) return null;
  const ids = items.map((item) => item.service_id);
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT id, duration_minutes FROM services WHERE id IN (${placeholders}) AND barbershop_id = ?`,
    [...ids, barbershopId],
  );
  if (rows.length !== ids.length) return null;

  const durationById = new Map(rows.map((row) => [row.id, Number(row.duration_minutes) || 0]));
  return items.reduce((total, item) => total + (durationById.get(item.service_id) * item.quantity), 0);
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

module.exports = { findById, findBySlug, list, totalDurationForItems, create, update, remove };
