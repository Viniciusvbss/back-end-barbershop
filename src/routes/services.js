const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/services — PROTECTED: scoped to token's barbershop
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM services WHERE barbershop_id = ?',
      [req.barbershop.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/services/:id — PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM services WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Serviço não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services — PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { name, duration_minutes, price } = req.body;
  if (!name || !duration_minutes || price === undefined) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, duration_minutes, price',
    });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO services (barbershop_id, name, duration_minutes, price) VALUES (?, ?, ?, ?)',
      [req.barbershop.id, name, duration_minutes, price]
    );
    res.status(201).json({ id: result.insertId, barbershop_id: req.barbershop.id, name, duration_minutes, price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/services/:id — PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, duration_minutes, price } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE services SET name = ?, duration_minutes = ?, price = ? WHERE id = ?',
      [name, duration_minutes, price, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Serviço não encontrado' });
    res.json({ message: 'Serviço atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/services/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Serviço não encontrado' });
    res.json({ message: 'Serviço removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
