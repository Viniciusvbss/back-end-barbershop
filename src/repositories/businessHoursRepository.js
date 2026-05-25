const WEEKDAYS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];

const withWeekdayName = (row) => ({ ...row, weekday_name: WEEKDAYS[row.weekday] });

const findById = async (db, id, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM business_hours WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return rows.length ? withWeekdayName(rows[0]) : null;
};

const findBySlug = async (db, slug) => {
  const [rows] = await db.query(
    `SELECT bh.* FROM business_hours bh
     INNER JOIN barbershops b ON b.id = bh.barbershop_id
     WHERE b.slug = ? ORDER BY bh.weekday`,
    [slug],
  );
  return rows.map(withWeekdayName);
};

const list = async (db, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM business_hours WHERE barbershop_id = ? ORDER BY weekday',
    [barbershopId],
  );
  return rows.map(withWeekdayName);
};

const create = async (db, { barbershopId, weekday, openTime, closeTime }) => {
  const [result] = await db.query(
    'INSERT INTO business_hours (barbershop_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)',
    [barbershopId, weekday, openTime, closeTime],
  );
  return withWeekdayName({
    id: result.insertId, barbershop_id: barbershopId, weekday,
    open_time: openTime, close_time: closeTime,
  });
};

const update = async (db, id, barbershopId, { weekday, openTime, closeTime }) => {
  const [result] = await db.query(
    'UPDATE business_hours SET weekday = ?, open_time = ?, close_time = ? WHERE id = ? AND barbershop_id = ?',
    [weekday, openTime, closeTime, id, barbershopId],
  );
  return result.affectedRows > 0;
};

const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM business_hours WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

module.exports = { findById, findBySlug, list, create, update, remove };
