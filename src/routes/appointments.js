const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');

// GET /api/appointments?barber_id=2&date=2025-01-15&status=pending — PROTECTED
router.get('/', authenticateToken, async (req, res) => {
  const { barber_id, date, status } = req.query;
  try {
    let query = `
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        c.name AS customer_name, c.phone AS customer_phone,
        b.name AS barber_name,
        s.name AS service_name, s.duration_minutes, s.price
      FROM appointments a
      JOIN customers c ON a.customer_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.barbershop_id = ?
    `;
    const params = [req.barbershop.id];

    if (barber_id) { query += ' AND a.barber_id = ?'; params.push(barber_id); }
    if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
    if (status) { query += ' AND a.status = ?'; params.push(status); }

    query += ' ORDER BY a.appointment_date, a.appointment_time';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/appointments/:id — PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  console.log('barbershop:', req.barbershop) // ← adiciona isso
  console.log('query:', req.query)
  try {
    const [rows] = await db.query(
      `SELECT
        a.*, c.name AS customer_name, b.name AS barber_name,
        s.name AS service_name, s.duration_minutes, s.price
       FROM appointments a
       JOIN customers c ON a.customer_id = c.id
       JOIN barbers b ON a.barber_id = b.id
       JOIN services s ON a.service_id = s.id
       WHERE a.id = ? AND a.barbershop_id = ?`,
      [req.params.id, req.barbershop.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agendamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/appointments — PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { barber_id, customer_id, service_id, appointment_date, appointment_time } = req.body;

  if (!barber_id || !customer_id || !service_id || !appointment_date || !appointment_time) {
    return res.status(400).json({
      error: 'Campos obrigatórios: barber_id, customer_id, service_id, appointment_date, appointment_time',
    });
  }

  try {
    const [conflict] = await db.query(
      `SELECT id FROM appointments
       WHERE barber_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [barber_id, appointment_date, appointment_time]
    );
    if (conflict.length) {
      return res.status(409).json({ error: 'Horário já ocupado para este barbeiro' });
    }

    const [result] = await db.query(
      `INSERT INTO appointments
       (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.barbershop.id, barber_id, customer_id, service_id, appointment_date, appointment_time]
    );
    res.status(201).json({ id: result.insertId, appointment_date, appointment_time, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/appointments/:id/status — PROTECTED
router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Use: ${validStatuses.join(', ')}` });
  }

  try {
    const [result] = await db.query(
      'UPDATE appointments SET status = ? WHERE id = ?',
      [status, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento não encontrado' });
    res.json({ message: 'Status atualizado', status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/appointments/:id — PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento não encontrado' });
    res.json({ message: 'Agendamento removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
