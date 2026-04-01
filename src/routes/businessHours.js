const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// GET /api/business-hours — PROTECTED: scoped to token's barbershop
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM business_hours WHERE barbershop_id = ? ORDER BY weekday',
      [req.barbershop.id]
    );
    const result = rows.map(r => ({ ...r, weekday_name: WEEKDAYS[r.weekday] }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/business-hours/:id — PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM business_hours WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Horário não encontrado' });
    res.json({ ...rows[0], weekday_name: WEEKDAYS[rows[0].weekday] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/business-hours — PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { weekday, open_time, close_time } = req.body;
  if (weekday === undefined || !open_time || !close_time) {
    return res.status(400).json({
      error: 'Campos obrigatórios: weekday (0–6), open_time, close_time',
    });
  }
  if (weekday < 0 || weekday > 6) {
    return res.status(400).json({ error: 'weekday deve ser entre 0 (Domingo) e 6 (Sábado)' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO business_hours (barbershop_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)',
      [req.barbershop.id, weekday, open_time, close_time]
    );
    res.status(201).json({
      id: result.insertId, barbershop_id: req.barbershop.id, weekday,
      weekday_name: WEEKDAYS[weekday], open_time, close_time,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/business-hours/:id — PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { weekday, open_time, close_time } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE business_hours SET weekday = ?, open_time = ?, close_time = ? WHERE id = ?',
      [weekday, open_time, close_time, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Horário não encontrado' });
    res.json({ message: 'Horário atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/business-hours/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM business_hours WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Horário não encontrado' });
    res.json({ message: 'Horário removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
