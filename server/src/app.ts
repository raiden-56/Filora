import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config/index.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import filesRoutes from './routes/files.routes.js';
import pdfRoutes from './routes/pdf.routes.js';
import editRoutes from './routes/edit.routes.js';
import convertRoutes from './routes/convert.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: config.serveClient
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'blob:'],
              workerSrc: ["'self'", 'blob:'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'", 'blob:', 'data:'],
              objectSrc: ["'none'"],
              frameSrc: ["'self'", 'blob:'],
            },
          }
        : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
      exposedHeaders: ['Content-Disposition', 'Content-Length'],
    }),
  );
  if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.use('/api', apiRateLimiter);
  app.use('/api/health', healthRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/pdf', pdfRoutes);
  app.use('/api/edit', editRoutes);
  app.use('/api/convert', convertRoutes);
  app.use('/api', notFoundHandler);

  // Optionally serve the built client (single-server deployment).
  if (config.serveClient && existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
