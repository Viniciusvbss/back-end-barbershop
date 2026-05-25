const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const appointmentService = require('../services/appointmentService');

router.get('/public/:slug', async (req, res, next) => {
  try {
    const { barber_id, date, status } = req.query;
    const result = await appointmentService.listPublic(db, req.params.slug, { barberId: barber_id, date, status });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/public/:slug/lookup', async (req, res, next) => {
  try {
    const result = await appointmentService.lookupByPhone(db, req.params.slug, req.body.phone ?? '');
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/public/:slug', async (req, res, next) => {
  try {
    const result = await appointmentService.createPublic(db, req, req.params.slug, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { barber_id, date, status, page, limit } = req.query;
    const result = await appointmentService.listPrivate(db, req.barbershop.id, {
      barberId: barber_id, date, status, page, limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await appointmentService.getById(db, req.barbershop.id, req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const result = await appointmentService.createPrivate(db, req.barbershop.id, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await appointmentService.updateAppointment(db, req.barbershop.id, req.params.id, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

router.patch('/:id/status', authenticateToken, async (req, res, next) => {
  try {
    const result = await appointmentService.updateStatus(db, req.barbershop.id, req.params.id, req.body.status);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await appointmentService.removeAppointment(db, req.barbershop.id, req.params.id);
    res.json({ message: 'Agendamento removido com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
