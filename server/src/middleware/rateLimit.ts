import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMinutes * 60 * 1000,
  limit: config.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  handler: (_req, res) => {
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
  },
});

/** Stricter limiter for heavy conversions. */
export const heavyRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMinutes * 60 * 1000,
  limit: Math.max(20, Math.floor(config.rateLimitMax / 5)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many conversions in a short time. Please wait a few minutes.' } });
  },
});
