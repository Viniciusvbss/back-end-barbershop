const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const customerService = require('../services/customerService');

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
    res.json({ message: 'Cliente removido com sucesso' });
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
