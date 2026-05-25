const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const serviceService = require('../services/serviceService');
const cache = require('../utils/cache');

router.get('/public/:slug', async (req, res, next) => {
  try {
    const key = `services:slug:${req.params.slug}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const result = await serviceService.listPublic(db, req.params.slug);
    cache.set(key, result);
    res.json(result);
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
    cache.delByPrefix('services:slug:');
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await serviceService.update(db, req.barbershop.id, req.params.id, req.body);
    cache.delByPrefix('services:slug:');
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await serviceService.remove(db, req.barbershop.id, req.params.id);
    cache.delByPrefix('services:slug:');
    res.json({ message: 'Servico removido com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
