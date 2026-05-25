let schemaReadyPromise = null;

const ensureSchema = async (db) => {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    const [imageRows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['image_url']);
    if (!imageRows.length) {
      await db.query('ALTER TABLE barbers ADD COLUMN image_url VARCHAR(500) NULL');
    }
    const [emailRows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['email']);
    if (!emailRows.length) {
      await db.query('ALTER TABLE barbers ADD COLUMN email VARCHAR(255) NULL');
      await db.query('ALTER TABLE barbers ADD UNIQUE INDEX idx_barbers_email (email)');
    }
    const [passRows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['password']);
    if (!passRows.length) {
      await db.query('ALTER TABLE barbers ADD COLUMN password VARCHAR(255) NULL');
    }
  })().catch((err) => { schemaReadyPromise = null; throw err; });

  return schemaReadyPromise;
};

const findById = async (db, id, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return rows.length ? rows[0] : null;
};

const findBySlug = async (db, slug) => {
  const [rows] = await db.query(
    `SELECT br.* FROM barbers br
     INNER JOIN barbershops b ON b.id = br.barbershop_id
     WHERE b.slug = ? ORDER BY br.id`,
    [slug],
  );
  return rows;
};

const list = async (db, barbershopId) => {
  const [rows] = await db.query(
    'SELECT * FROM barbers WHERE barbershop_id = ?',
    [barbershopId],
  );
  return rows;
};

const create = async (db, { barbershopId, name, phone, imageUrl }) => {
  const [result] = await db.query(
    'INSERT INTO barbers (barbershop_id, name, phone, image_url) VALUES (?, ?, ?, ?)',
    [barbershopId, name, phone || null, imageUrl || null],
  );
  const [rows] = await db.query(
    'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
    [result.insertId, barbershopId],
  );
  return rows[0];
};

const update = async (db, id, barbershopId, { name, phone, imageUrl }) => {
  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (phone !== undefined) { updates.push('phone = ?'); values.push(phone || null); }
  if (imageUrl !== undefined) { updates.push('image_url = ?'); values.push(imageUrl); }
  if (!updates.length) return findById(db, id, barbershopId);
  values.push(id, barbershopId);
  await db.query(
    `UPDATE barbers SET ${updates.join(', ')} WHERE id = ? AND barbershop_id = ?`,
    values,
  );
  return findById(db, id, barbershopId);
};

const updateCredentials = async (db, id, barbershopId, email, hashedPassword) => {
  await db.query(
    'UPDATE barbers SET email = ?, password = ? WHERE id = ? AND barbershop_id = ?',
    [email, hashedPassword, id, barbershopId],
  );
};

const removeImage = async (db, id, barbershopId) => {
  await db.query(
    'UPDATE barbers SET image_url = NULL WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return findById(db, id, barbershopId);
};

const remove = async (db, id, barbershopId) => {
  const [result] = await db.query(
    'DELETE FROM barbers WHERE id = ? AND barbershop_id = ?',
    [id, barbershopId],
  );
  return result.affectedRows > 0;
};

module.exports = {
  ensureSchema,
  findById,
  findBySlug,
  list,
  create,
  update,
  updateCredentials,
  removeImage,
  remove,
};
