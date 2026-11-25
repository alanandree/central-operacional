import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { errorHandler } from './core.ts';
import { securityHeaders } from './security.ts';
import { authRoutes } from './routes/auth.ts';
import { occurrenceRoutes } from './routes/occurrences.ts';
import { driverRoutes } from './routes/drivers.ts';
import { documentRoutes } from './routes/documents.ts';
import { fileRoutes } from './routes/files.ts';
import { settingsRoutes } from './routes/settings.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { searchRoutes } from './routes/search.ts';
import { reportRoutes } from './routes/reports.ts';
import { whatsappRoutes, webhookRoutes } from './routes/whatsapp.ts';
import { aiRoutes } from './routes/ai.ts';

const app = express();
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: true }));
app.use(
  express.json({
    limit: '4mb',
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'central-operacional', time: new Date().toISOString() });
});

app.use('/api/webhooks/whatsapp', webhookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/occurrences', occurrenceRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', settingsRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado.' });
});

if (config.isProd) {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Central Operacional API rodando em http://localhost:${config.port}`);
});
