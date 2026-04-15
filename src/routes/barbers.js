const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/barbers — PROTECTED: scoped to token's barbershop
router.get('/public/:slug', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT br.* FROM barbers br
       INNER JOIN barbershops b ON b.id = br.barbershop_id
       WHERE b.slug = ?
       ORDER BY br.id`,
      [req.params.slug]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM barbers WHERE barbershop_id = ?',
      [req.barbershop.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barbers/:id — PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM barbers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbeiro não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/barbers — PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Campos obrigatórios: name' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO barbers (barbershop_id, name, phone) VALUES (?, ?, ?)',
      [req.barbershop.id, name, phone || null]
    );
    res.status(201).json({ id: result.insertId, barbershop_id: req.barbershop.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/barbers/:id — PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE barbers SET name = ?, phone = ? WHERE id = ?',
      [name, phone, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbeiro não encontrado' });
    res.json({ message: 'Barbeiro atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/barbers/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM barbers WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbeiro não encontrado' });
    res.json({ message: 'Barbeiro removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
