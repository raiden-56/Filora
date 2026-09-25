import { createApp } from './app.js';
import { config } from './config/index.js';
import { detectTools } from './config/tools.js';
import { ensureTmpDirs, purgeOlderThan, UPLOAD_DIR, WORK_DIR } from './utils/tmp.js';
import { purgeExpiredFiles, restoreIndex } from './services/fileStore.js';

async function main() {
  await ensureTmpDirs();
  await restoreIndex();
  const tools = await detectTools();
  console.log('PDFly server starting');
  console.log(`  env=${config.env} port=${config.port} tmp=${config.tmpDir} maxFile=${config.maxFileSizeMb}MB ttl=${config.fileTtlMinutes}min`);
  console.log('  external tools:', {
    libreoffice: Boolean(tools.soffice),
    ghostscript: Boolean(tools.ghostscript),
    qpdf: Boolean(tools.qpdf),
    tesseract: Boolean(tools.tesseract),
    pdftoppm: Boolean(tools.pdftoppm),
    ocrmypdf: Boolean(tools.ocrmypdf),
    puppeteer: tools.puppeteer,
  });
  if (!tools.soffice) console.log('  note: LibreOffice not found - Office conversions use pure-JS fallbacks (reduced fidelity).');
  if (!tools.ghostscript) console.log('  note: Ghostscript not found - compression/PDF-A use pure-JS fallbacks.');

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`  listening on http://localhost:${config.port}`);
  });
  server.requestTimeout = config.processTimeoutMs + 60_000;
  server.headersTimeout = config.processTimeoutMs + 65_000;

  // Periodic cleanup of expired outputs, stale uploads and work dirs.
  const interval = setInterval(async () => {
    try {
      const removed = await purgeExpiredFiles();
      const stale = await purgeOlderThan(UPLOAD_DIR, 30 * 60 * 1000);
      const work = await purgeOlderThan(WORK_DIR, 60 * 60 * 1000);
      if (removed + stale + work > 0) console.log(`cleanup: removed ${removed} outputs, ${stale} uploads, ${work} work dirs`);
    } catch (err) {
      console.error('cleanup failed', err);
    }
  }, config.cleanupIntervalMinutes * 60 * 1000);
  interval.unref();

  const shutdown = () => {
    console.log('shutting down');
    clearInterval(interval);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
