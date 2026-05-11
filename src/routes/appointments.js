const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { PRIVACY_POLICY_VERSION, ensurePrivacySchema, recordConsentLog } = require('../utils/privacy');

router.get('/public/:slug', async (req, res) => {
  const { barber_id, date, status } = req.query;
  try {
    let query = `
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        b.name AS barber_name,
        s.name AS service_name, s.duration_minutes, s.price
      FROM appointments a
      JOIN barbershops bs ON a.barbershop_id = bs.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE bs.slug = ?
    `;
    const params = [req.params.slug];

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

router.post('/public/:slug', async (req, res) => {
  const {
    barber_id,
    service_id,
    appointment_date,
    appointment_time,
    customer_name,
    customer_phone,
    customer_email,
    privacy_policy_accepted,
    marketing_consent,
  } = req.body;

  if (!barber_id || !service_id || !appointment_date || !appointment_time || !customer_name || !customer_phone) {
    return res.status(400).json({
      error: 'Campos obrigatorios: barber_id, service_id, appointment_date, appointment_time, customer_name, customer_phone',
    });
  }

  if (!privacy_policy_accepted) {
    return res.status(400).json({ error: 'Aceite a Politica de Privacidade para continuar.' });
  }

  try {
    await ensurePrivacySchema(db);
    const [shopRows] = await db.query(
      'SELECT id FROM barbershops WHERE slug = ? LIMIT 1',
      [req.params.slug],
    );
    if (!shopRows.length) {
      return res.status(404).json({ error: 'Barbearia nao encontrada' });
    }

    const barbershopId = shopRows[0].id;

    const [barberRows] = await db.query(
      'SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1',
      [barber_id, barbershopId],
    );
    if (!barberRows.length) {
      return res.status(400).json({ error: 'Barbeiro invalido para esta barbearia' });
    }

    const [serviceRows] = await db.query(
      'SELECT id FROM services WHERE id = ? AND barbershop_id = ? LIMIT 1',
      [service_id, barbershopId],
    );
    if (!serviceRows.length) {
      return res.status(400).json({ error: 'Servico invalido para esta barbearia' });
    }

    let customerId;
    const [customerRows] = await db.query(
      'SELECT id FROM customers WHERE barbershop_id = ? AND phone = ? LIMIT 1',
      [barbershopId, customer_phone],
    );

    if (customerRows.length) {
      customerId = customerRows[0].id;
      await db.query(
        `UPDATE customers
         SET privacy_policy_accepted_at = NOW(), privacy_policy_version = ?,
          marketing_consent = ?, marketing_consent_at = ?
         WHERE id = ? AND barbershop_id = ?`,
        [
          PRIVACY_POLICY_VERSION,
          marketing_consent ? 1 : 0,
          marketing_consent ? new Date() : null,
          customerId,
          barbershopId,
        ],
      );
    } else {
      const [customerResult] = await db.query(
        `INSERT INTO customers
         (barbershop_id, name, phone, email, privacy_policy_accepted_at,
          privacy_policy_version, marketing_consent, marketing_consent_at)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [
          barbershopId,
          customer_name,
          customer_phone,
          customer_email || null,
          PRIVACY_POLICY_VERSION,
          marketing_consent ? 1 : 0,
          marketing_consent ? new Date() : null,
        ],
      );
      customerId = customerResult.insertId;
    }

    await recordConsentLog(db, req, {
      barbershopId,
      holderType: 'customer',
      holderId: customerId,
      action: 'privacy_policy_accepted',
      policyVersion: PRIVACY_POLICY_VERSION,
    });

    const [conflict] = await db.query(
      `SELECT id FROM appointments
       WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [barbershopId, barber_id, appointment_date, appointment_time],
    );
    if (conflict.length) {
      return res.status(409).json({ error: 'Horario ja ocupado para este barbeiro' });
    }

    const [result] = await db.query(
      `INSERT INTO appointments
       (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [barbershopId, barber_id, customerId, service_id, appointment_date, appointment_time],
    );
    res.status(201).json({ id: result.insertId, appointment_date, appointment_time, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.get('/:id', authenticateToken, async (req, res) => {
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
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { barber_id, customer_id, service_id, appointment_date, appointment_time } = req.body;

  if (!barber_id || !customer_id || !service_id || !appointment_date || !appointment_time) {
    return res.status(400).json({
      error: 'Campos obrigatorios: barber_id, customer_id, service_id, appointment_date, appointment_time',
    });
  }

  try {
    const [[barberRows], [customerRows], [serviceRows]] = await Promise.all([
      db.query('SELECT id FROM barbers WHERE id = ? AND barbershop_id = ? LIMIT 1', [barber_id, req.barbershop.id]),
      db.query('SELECT id FROM customers WHERE id = ? AND barbershop_id = ? LIMIT 1', [customer_id, req.barbershop.id]),
      db.query('SELECT id FROM services WHERE id = ? AND barbershop_id = ? LIMIT 1', [service_id, req.barbershop.id]),
    ]);

    if (!barberRows.length || !customerRows.length || !serviceRows.length) {
      return res.status(400).json({ error: 'Barbeiro, cliente ou servico invalido para esta barbearia' });
    }

    const [conflict] = await db.query(
      `SELECT id FROM appointments
       WHERE barbershop_id = ? AND barber_id = ? AND appointment_date = ? AND appointment_time = ? AND status != 'cancelled'`,
      [req.barbershop.id, barber_id, appointment_date, appointment_time],
    );
    if (conflict.length) {
      return res.status(409).json({ error: 'Horario ja ocupado para este barbeiro' });
    }

    const [result] = await db.query(
      `INSERT INTO appointments
       (barbershop_id, barber_id, customer_id, service_id, appointment_date, appointment_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.barbershop.id, barber_id, customer_id, service_id, appointment_date, appointment_time],
    );
    res.status(201).json({ id: result.insertId, appointment_date, appointment_time, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status invalido. Use: ${validStatuses.join(', ')}` });
  }

  try {
    const [result] = await db.query(
      'UPDATE appointments SET status = ? WHERE id = ? AND barbershop_id = ?',
      [status, req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    res.json({ message: 'Status atualizado', status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM appointments WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Agendamento nao encontrado' });
    res.json({ message: 'Agendamento removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
