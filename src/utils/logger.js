const { createLogger, format, transports } = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const base = `[${timestamp}] ${level}: ${stack || message}`;
  const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return base + extra;
});

const isDev = process.env.NODE_ENV !== 'production';

const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: isDev
    ? [new transports.Console({ format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat) })]
    : [
        new transports.Console(),
        new transports.File({ filename: path.join('logs', 'error.log'), level: 'error' }),
        new transports.File({ filename: path.join('logs', 'app.log') }),
      ],
});

module.exports = logger;
