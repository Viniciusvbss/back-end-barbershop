const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const barberService = require('../services/barberService');
const {
  cleanupUploadedRequestFile,
  createImageUpload,
  getUploadErrorMessage,
  runUpload,
} = require('../utils/uploads');

const uploadBarberImage = createImageUpload('barbers', 'image');
const cache = require('../utils/cache');

router.get('/public/:slug', async (req, res, next) => {
  try {
    const key = `barbers:slug:${req.params.slug}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const result = await barberService.listPublic(db, req.params.slug);
    cache.set(key, result);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    res.json(await barberService.list(db, req.barbershop.id));
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    res.json(await barberService.getById(db, req.barbershop.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    await runUpload(uploadBarberImage, req, res);
    const result = await barberService.create(db, req.barbershop.id, req.body, req.file);
    cache.delByPrefix('barbers:slug:');
    res.status(201).json(result);
  } catch (err) {
    await cleanupUploadedRequestFile(req);
    next(new Error(getUploadErrorMessage(err)));
  }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    await runUpload(uploadBarberImage, req, res);
    const result = await barberService.update(db, req.barbershop.id, req.params.id, req.body, req.file);
    cache.delByPrefix('barbers:slug:');
    res.json(result);
  } catch (err) {
    await cleanupUploadedRequestFile(req);
    next(new Error(getUploadErrorMessage(err)));
  }
});

router.put('/:id/credentials', authenticateToken, async (req, res, next) => {
  try {
    await barberService.updateCredentials(db, req.barbershop.id, req.params.id, req.body);
    res.json({ message: 'Credenciais atualizadas com sucesso' });
  } catch (err) { next(err); }
});

router.delete('/:id/image', authenticateToken, async (req, res, next) => {
  try {
    const result = await barberService.removeBarberImage(db, req.barbershop.id, req.params.id);
    cache.delByPrefix('barbers:slug:');
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await barberService.removeBarber(db, req.barbershop.id, req.params.id);
    cache.delByPrefix('barbers:slug:');
    res.json({ message: 'Barbeiro removido com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
