const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const serviceService = require('../services/serviceService');

router.get('/public/:slug', async (req, res, next) => {
  try {
    res.json(await serviceService.listPublic(db, req.params.slug));
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    res.json(await serviceService.list(db, req.barbershop.id));
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await serviceService.getById(db, req.barbershop.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const result = await serviceService.create(db, req.barbershop.id, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await serviceService.update(db, req.barbershop.id, req.params.id, req.body));
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await serviceService.remove(db, req.barbershop.id, req.params.id);
    res.json({ message: 'Servico removido com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
