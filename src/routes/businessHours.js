const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const businessHoursService = require('../services/businessHoursService');

router.get('/public/:slug', async (req, res, next) => {
  try {
    res.json(await businessHoursService.listPublic(db, req.params.slug));
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    res.json(await businessHoursService.list(db, req.barbershop.id));
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await businessHoursService.getById(db, req.barbershop.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const result = await businessHoursService.create(db, req.barbershop.id, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    await businessHoursService.update(db, req.barbershop.id, req.params.id, req.body);
    res.json({ message: 'Horario atualizado com sucesso' });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await businessHoursService.remove(db, req.barbershop.id, req.params.id);
    res.json({ message: 'Horario removido com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
