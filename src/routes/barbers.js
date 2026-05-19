const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const {
  cleanupUploadedRequestFile,
  createImageUpload,
  deleteUploadedFile,
  getPublicUploadUrl,
  getUploadErrorMessage,
  runUpload,
} = require('../utils/uploads');

const uploadBarberImage = createImageUpload('barbers', 'image');

let schemaReadyPromise = null;

const ensureBarberImageColumn = async () => {
  if (schemaReadyPromise) return schemaReadyPromise;

  schemaReadyPromise = (async () => {
    const [rows] = await db.query('SHOW COLUMNS FROM barbers LIKE ?', ['image_url']);
    if (!rows.length) {
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
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  return schemaReadyPromise;
};

// GET /api/barbers/public/:slug - PUBLIC
router.get('/public/:slug', async (req, res) => {
  try {
    await ensureBarberImageColumn();
    const [rows] = await db.query(
      `SELECT br.* FROM barbers br
       INNER JOIN barbershops b ON b.id = br.barbershop_id
       WHERE b.slug = ?
       ORDER BY br.id`,
      [req.params.slug],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barbers - PROTECTED: scoped to token's barbershop
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureBarberImageColumn();
    const [rows] = await db.query(
      'SELECT * FROM barbers WHERE barbershop_id = ?',
      [req.barbershop.id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barbers/:id - PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    await ensureBarberImageColumn();
    const [rows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/barbers - PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  try {
    await runUpload(uploadBarberImage, req, res);

    const { name, phone } = req.body;
    if (!name) {
      await cleanupUploadedRequestFile(req);
      return res.status(400).json({ error: 'Campos obrigatorios: name' });
    }

    await ensureBarberImageColumn();
    const imageUrl = req.file ? getPublicUploadUrl('barbers', req.file) : null;
    const [result] = await db.query(
      'INSERT INTO barbers (barbershop_id, name, phone, image_url) VALUES (?, ?, ?, ?)',
      [req.barbershop.id, name, phone || null, imageUrl],
    );

    const [rows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [result.insertId, req.barbershop.id],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    await cleanupUploadedRequestFile(req);
    res.status(400).json({ error: getUploadErrorMessage(err) });
  }
});

// PUT /api/barbers/:id - PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    await runUpload(uploadBarberImage, req, res);
    await ensureBarberImageColumn();

    const [currentRows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!currentRows.length) {
      await cleanupUploadedRequestFile(req);
      return res.status(404).json({ error: 'Barbeiro nao encontrado' });
    }

    const { name, phone } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }

    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone || null);
    }

    if (req.file) {
      updates.push('image_url = ?');
      values.push(getPublicUploadUrl('barbers', req.file));
    }

    if (updates.length) {
      values.push(req.params.id, req.barbershop.id);
      await db.query(
        `UPDATE barbers SET ${updates.join(', ')} WHERE id = ? AND barbershop_id = ?`,
        values,
      );
    }

    if (req.file) await deleteUploadedFile(currentRows[0].image_url);

    const [updatedRows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    res.json(updatedRows[0]);
  } catch (err) {
    await cleanupUploadedRequestFile(req);
    res.status(400).json({ error: getUploadErrorMessage(err) });
  }
});

// PUT /api/barbers/:id/credentials - PROTECTED: admin define email e senha do barbeiro
router.put('/:id/credentials', authenticateToken, async (req, res) => {
  try {
    await ensureBarberImageColumn();

    const [rows] = await db.query(
      'SELECT id FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro nao encontrado' });

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha sao obrigatorios' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE barbers SET email = ?, password = ? WHERE id = ? AND barbershop_id = ?',
      [email.trim().toLowerCase(), hashedPassword, req.params.id, req.barbershop.id],
    );

    res.json({ message: 'Credenciais atualizadas com sucesso' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Este e-mail ja esta em uso por outro barbeiro' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/barbers/:id/image - PROTECTED: remove apenas a foto, mantendo o barbeiro
router.delete('/:id/image', authenticateToken, async (req, res) => {
  try {
    await ensureBarberImageColumn();

    const [rows] = await db.query(
      'SELECT image_url FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro nao encontrado' });

    await db.query(
      'UPDATE barbers SET image_url = NULL WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );

    await deleteUploadedFile(rows[0].image_url);

    const [updatedRows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    res.json(updatedRows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/barbers/:id - PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await ensureBarberImageColumn();
    const [rows] = await db.query(
      'SELECT image_url FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro nao encontrado' });

    const [result] = await db.query(
      'DELETE FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbeiro nao encontrado' });

    await deleteUploadedFile(rows[0].image_url);
    res.json({ message: 'Barbeiro removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
