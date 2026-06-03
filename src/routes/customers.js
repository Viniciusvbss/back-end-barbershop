const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const authenticateCustomer = require('../middleware/customerAuth');
const customerService = require('../services/customerService');
const customerAuthService = require('../services/customerAuthService');
const appointmentRepo = require('../repositories/appointmentRepository');

// ---- Auth do cliente ----

router.post('/auth/register', async (req, res, next) => {
  try {
    const result = await customerAuthService.register(db, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const result = await customerAuthService.login(db, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// ---- Rotas /me (cliente autenticado) ----

router.get('/me', authenticateCustomer, async (req, res, next) => {
  try {
    res.json(await customerService.getMyProfile(db, req.customer.id));
  } catch (err) { next(err); }
});

router.put('/me', authenticateCustomer, async (req, res, next) => {
  try {
    res.json(await customerService.updateMyProfile(db, req.customer.id, req.body));
  } catch (err) { next(err); }
});

router.get('/me/appointments', authenticateCustomer, async (req, res, next) => {
  try {
    const { page, limit, sort } = req.query;
    const appointments = await appointmentRepo.listByCustomer(db, req.customer.id, { page, limit, sort });
    res.json(appointments);
  } catch (err) { next(err); }
});

router.get('/me/favorites', authenticateCustomer, async (req, res, next) => {
  try {
    res.json(await customerService.getFavorites(db, req.customer.id));
  } catch (err) { next(err); }
});

router.post('/me/favorites/:shopId', authenticateCustomer, async (req, res, next) => {
  try {
    await customerService.addFavorite(db, req.customer.id, Number(req.params.shopId));
    res.status(201).json({ message: 'Barbearia adicionada aos favoritos' });
  } catch (err) { next(err); }
});

router.delete('/me/favorites/:shopId', authenticateCustomer, async (req, res, next) => {
  try {
    await customerService.removeFavorite(db, req.customer.id, Number(req.params.shopId));
    res.json({ message: 'Barbearia removida dos favoritos' });
  } catch (err) { next(err); }
});

// ---- Rotas admin (barbearia autenticada) ----

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    res.json(await customerService.list(db, req.barbershop.id, { page, limit }));
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await customerService.getById(db, req.barbershop.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const result = await customerService.create(db, req.barbershop.id, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await customerService.update(db, req.barbershop.id, req.params.id, req.body));
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await customerService.remove(db, req.barbershop.id, req.params.id);
    res.json({ message: 'Cliente desvinculado com sucesso' });
  } catch (err) { next(err); }
});

router.get('/:id/export', authenticateToken, async (req, res, next) => {
  try {
    res.json(await customerService.exportData(db, req.barbershop.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/:id/anonymize', authenticateToken, async (req, res, next) => {
  try {
    await customerService.anonymize(db, req, req.barbershop.id, req.params.id);
    res.json({ message: 'Cliente anonimizado com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
