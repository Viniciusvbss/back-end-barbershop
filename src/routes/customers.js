const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { ensurePrivacySchema, recordConsentLog } = require('../utils/privacy');

const CUSTOMER_SELECT = `
  id, barbershop_id, name, phone, email, marketing_consent,
  privacy_policy_accepted_at, privacy_policy_version, anonymized_at, created_at
`;

// GET /api/customers - PROTECTED: scoped to token's barbershop
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensurePrivacySchema(db);
    const [rows] = await db.query(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE barbershop_id = ?`,
      [req.barbershop.id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id - PROTECTED: scoped to token's barbershop
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    await ensurePrivacySchema(db);
    const [rows] = await db.query(
      `SELECT ${CUSTOMER_SELECT} FROM customers WHERE id = ? AND barbershop_id = ?`,
      [req.params.id, req.barbershop.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers - PROTECTED: barbershop_id from token
router.post('/', authenticateToken, async (req, res) => {
  const { name, phone, email, marketing_consent } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Campos obrigatorios: name' });
  }

  try {
    await ensurePrivacySchema(db);
    const [result] = await db.query(
      `INSERT INTO customers
       (barbershop_id, name, phone, email, marketing_consent, marketing_consent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.barbershop.id,
        name,
        phone || null,
        email || null,
        marketing_consent ? 1 : 0,
        marketing_consent ? new Date() : null,
      ],
    );
    res.status(201).json({ id: result.insertId, barbershop_id: req.barbershop.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/:id - PROTECTED
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, phone, email, marketing_consent } = req.body;

  try {
    await ensurePrivacySchema(db);

    const updates = ['name = ?', 'phone = ?', 'email = ?'];
    const values = [name, phone || null, email || null];

    if (marketing_consent !== undefined) {
      updates.push('marketing_consent = ?', 'marketing_consent_at = ?');
      values.push(marketing_consent ? 1 : 0, marketing_consent ? new Date() : null);
    }

    values.push(req.params.id, req.barbershop.id);

    const [result] = await db.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ? AND barbershop_id = ?`,
      values,
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json({ message: 'Cliente atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/customers/:id - PROTECTED
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM customers WHERE id = ? AND barbershop_id = ?',
      [req.params.id, req.barbershop.id],
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Cliente nao encontrado' });
    res.json({ message: 'Cliente removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/export', authenticateToken, async (req, res) => {
  try {
    await ensurePrivacySchema(db);

    const [customers] = await db.query(
      `SELECT id, name, phone, email, marketing_consent, privacy_policy_accepted_at,
        privacy_policy_version, created_at
       FROM customers
       WHERE id = ? AND barbershop_id = ?`,
      [req.params.id, req.barbershop.id],
    );

    if (!customers.length) return res.status(404).json({ error: 'Cliente nao encontrado' });

    const [appointments] = await db.query(
      `SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        b.name AS barber_name, s.name AS service_name, s.duration_minutes, s.price
       FROM appointments a
       JOIN barbers b ON a.barber_id = b.id
       JOIN services s ON a.service_id = s.id
       WHERE a.customer_id = ? AND a.barbershop_id = ?
       ORDER BY a.appointment_date, a.appointment_time`,
      [req.params.id, req.barbershop.id],
    );

    res.json({
      exported_at: new Date().toISOString(),
      customer: customers[0],
      appointments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/anonymize', authenticateToken, async (req, res) => {
  try {
    await ensurePrivacySchema(db);

    const [result] = await db.query(
      `UPDATE customers
       SET name = 'Cliente removido', phone = NULL, email = NULL,
        marketing_consent = 0, marketing_consent_at = NULL, anonymized_at = NOW()
       WHERE id = ? AND barbershop_id = ?`,
      [req.params.id, req.barbershop.id],
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Cliente nao encontrado' });

    await recordConsentLog(db, req, {
      barbershopId: req.barbershop.id,
      holderType: 'customer',
      holderId: Number(req.params.id),
      action: 'customer_anonymized',
      policyVersion: null,
    });

    res.json({ message: 'Cliente anonimizado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
