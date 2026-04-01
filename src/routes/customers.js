const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/customers — PROTECTED: scoped to token's barbershop
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, barbershop_id, name, phone, email, created_at FROM customers WHERE barbershop_id = ?',
      [req.barbershop.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id — PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, barbershop_id, name, phone, email, created_at FROM customers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers — PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { name, phone, email } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Campos obrigatórios: name' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO customers (barbershop_id, name, phone, email) VALUES (?, ?, ?, ?)',
      [req.barbershop.id, name, phone || null, email || null]
    );
    res.status(201).json({ id: result.insertId, barbershop_id: req.barbershop.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/:id — PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, phone, email } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE customers SET name = ?, phone = ?, email = ? WHERE id = ?',
      [name, phone, email, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ message: 'Cliente atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/customers/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ message: 'Cliente removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
