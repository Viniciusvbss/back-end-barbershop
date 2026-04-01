const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/barbershops — PUBLIC: List all barbershops
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, slug, phone, email, create_at FROM barbershops'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barbershops/slug/:slug — PUBLIC: Get a barbershop by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, slug, phone, email, create_at FROM barbershops WHERE slug = ?',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbearia não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/barbershops/:id — PROTECTED
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, slug, phone, email, create_at FROM barbershops WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Barbearia não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/barbershops — PUBLIC: Register a new barbershop
router.post('/', async (req, res) => {
  const { name, slug, phone, email, password } = req.body;
  if (!name || !slug || !email || !password) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, slug, email, password' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      'INSERT INTO barbershops (name, slug, phone, email, password) VALUES (?, ?, ?, ?, ?)',
      [name, slug, phone || null, email, hashedPassword]
    );
    res.status(201).json({ id: result.insertId, name, slug, email });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Slug ou email já cadastrado' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/barbershops/:id — PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, slug, phone, email } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE barbershops SET name = ?, slug = ?, phone = ?, email = ? WHERE id = ?',
      [name, slug, phone, email, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbearia não encontrada' });
    res.json({ message: 'Barbearia atualizada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/barbershops/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM barbershops WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Barbearia não encontrada' });
    res.json({ message: 'Barbearia removida com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
