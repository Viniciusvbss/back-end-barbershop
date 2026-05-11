const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const {
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  ensurePrivacySchema,
  getRequestIp,
} = require('../utils/privacy');

const VALID_REQUEST_TYPES = ['access', 'correction', 'deletion', 'anonymization', 'consent_revoke', 'other'];
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'rejected'];

router.get('/metadata', async (req, res) => {
  res.json({
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    terms_version: TERMS_VERSION,
  });
});

router.post('/requests', async (req, res) => {
  const {
    barbershop_id,
    request_type,
    requester_name,
    requester_email,
    requester_phone,
    description,
  } = req.body;

  if (!VALID_REQUEST_TYPES.includes(request_type)) {
    return res.status(400).json({ error: 'Tipo de solicitacao invalido.' });
  }

  if (!requester_email && !requester_phone) {
    return res.status(400).json({ error: 'Informe e-mail ou telefone para retorno.' });
  }

  try {
    await ensurePrivacySchema(db);

    const [result] = await db.query(
      `INSERT INTO privacy_requests
       (barbershop_id, request_type, requester_name, requester_email, requester_phone,
        description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        barbershop_id || null,
        request_type,
        requester_name || null,
        requester_email || null,
        requester_phone || null,
        description || null,
        getRequestIp(req),
        req.headers['user-agent'] || null,
      ],
    );

    res.status(201).json({ id: result.insertId, status: 'open' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/requests', authenticateToken, async (req, res) => {
  try {
    await ensurePrivacySchema(db);

    const [rows] = await db.query(
      `SELECT id, request_type, requester_name, requester_email, requester_phone,
        description, status, resolution_note, resolved_at, created_at, updated_at
       FROM privacy_requests
       WHERE barbershop_id = ?
       ORDER BY created_at DESC`,
      [req.barbershop.id],
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/requests/:id/status', authenticateToken, async (req, res) => {
  const { status, resolution_note } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Status invalido.' });
  }

  try {
    await ensurePrivacySchema(db);

    const [result] = await db.query(
      `UPDATE privacy_requests
       SET status = ?, resolution_note = ?, resolved_at = ?
       WHERE id = ? AND barbershop_id = ?`,
      [
        status,
        resolution_note || null,
        status === 'resolved' || status === 'rejected' ? new Date() : null,
        req.params.id,
        req.barbershop.id,
      ],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Solicitacao nao encontrada.' });
    }

    res.json({ message: 'Solicitacao atualizada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
