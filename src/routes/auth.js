const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authService = require('../services/authService');

const GENERIC_MESSAGE = 'Se esse email estiver cadastrado, enviaremos um link de recuperacao.';

router.post('/login', async (req, res, next) => {
  try {
    const result = await authService.login(db, req.body);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const result = await authService.forgotPassword(db, req, req.body.email);
    res.json({ message: GENERIC_MESSAGE, resetLink: result.resetLink });
  } catch (err) { next(err); }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    await authService.resetPassword(db, req.body);
    res.json({ message: 'Senha redefinida com sucesso.' });
  } catch (err) { next(err); }
});

module.exports = router;
