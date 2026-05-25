const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const barbershopService = require('../services/barbershopService');
const { ForbiddenError } = require('../errors/AppError');
const {
  cleanupUploadedRequestFile,
  createImageUpload,
  getUploadErrorMessage,
  runUpload,
} = require('../utils/uploads');

const uploadLogo = createImageUpload('barbershops', 'logo');

const ensureOwnBarbershop = (req) => {
  const requestedId = Number(req.params.id);
  const authenticatedId = Number(req.barbershop?.id);
  if (!requestedId || requestedId !== authenticatedId) {
    throw new ForbiddenError('Voce so pode acessar as configuracoes da sua propria barbearia.');
  }
  return requestedId;
};

router.get('/', async (req, res, next) => {
  try {
    res.json(await barbershopService.list(db));
  } catch (err) { next(err); }
});

router.get('/slug/:slug', async (req, res, next) => {
  try {
    res.json(await barbershopService.getBySlug(db, req.params.slug));
  } catch (err) { next(err); }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    ensureOwnBarbershop(req);
    res.json(await barbershopService.getById(db, Number(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await barbershopService.register(db, req, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const barbershopId = ensureOwnBarbershop(req);
    const current = await barbershopService.getById(db, barbershopId);
    const result = await barbershopService.update(db, barbershopId, req.body, current);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/logo', authenticateToken, async (req, res, next) => {
  try {
    ensureOwnBarbershop(req);
    await runUpload(uploadLogo, req, res);
    if (!req.file) {
      return next(new Error('Envie uma imagem para a logo.'));
    }
    const result = await barbershopService.uploadLogo(db, Number(req.params.id), req.file);
    res.json(result);
  } catch (err) {
    await cleanupUploadedRequestFile(req);
    next(new Error(getUploadErrorMessage(err)));
  }
});

router.delete('/:id/logo', authenticateToken, async (req, res, next) => {
  try {
    ensureOwnBarbershop(req);
    res.json(await barbershopService.removeLogo(db, Number(req.params.id)));
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    ensureOwnBarbershop(req);
    await barbershopService.removeBarbershop(db, Number(req.params.id));
    res.json({ message: 'Barbearia removida com sucesso' });
  } catch (err) { next(err); }
});

module.exports = router;
