const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Rate limiting ativo em producao ou quando RATE_LIMIT_ENABLED=true (para testar em dev)
const isRateLimitActive =
  process.env.NODE_ENV === 'production' || process.env.RATE_LIMIT_ENABLED === 'true';


const onRateLimitReached = (req, res, options) => {
  logger.warn('Rate limit atingido', {
    ip: req.ip,
    method: req.method,
    path: req.path,
    limit: options.limit ?? options.max,
    windowMs: options.windowMs,
  });
};

// Limite estrito para endpoints de autenticacao (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  limit: 5,
  skip: () => !isRateLimitActive,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 5 minutos e tente novamente.' },
  handler: (req, res, next, options) => {
    onRateLimitReached(req, res, options);
    res.status(429).json(options.message);
  },
});

// Limite geral para demais rotas da API
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  skip: () => !isRateLimitActive,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisicoes. Aguarde um momento e tente novamente.' },
  handler: (req, res, next, options) => {
    onRateLimitReached(req, res, options);
    res.status(429).json(options.message);
  },
});

// Limite para agendamentos publicos (anti-bot / criacao em massa)
const publicBookingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5,
  skip: () => !isRateLimitActive,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de agendamento. Aguarde 10 minutos e tente novamente.' },
  handler: (req, res, next, options) => {
    onRateLimitReached(req, res, options);
    res.status(429).json(options.message);
  },
});

module.exports = { authLimiter, generalLimiter, publicBookingLimiter };
