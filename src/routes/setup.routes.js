/**
 * ============================================================
 * CephasGM GameZone — Setup Routes (one-time bootstrap)
 * ============================================================
 * Runs the seed script over HTTP — used on Render free tier
 * where Shell access isn't available.
 *
 * Protected by SETUP_SECRET env var.
 * DELETE THIS FILE after the seed has run successfully.
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../config/logger');

router.post('/seed', async (req, res) => {
  const secret = req.headers['x-setup-secret'] || req.query.secret;

  if (!process.env.SETUP_SECRET || secret !== process.env.SETUP_SECRET) {
    logger.warn({ ip: req.ip }, '🚫 Setup endpoint: unauthorized attempt');
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  try {
    logger.info('🌱 Running seed via /setup/seed endpoint');

    /* Require the seed file as a child process to isolate failures */
    const { exec } = require('child_process');

    const result = await new Promise((resolve) => {
      exec('node prisma/seed.js', { timeout: 60000 }, (err, stdout, stderr) => {
        resolve({ err, stdout, stderr });
      });
    });

    if (result.err) {
      logger.error({ err: result.err.message, stderr: result.stderr }, '❌ Seed failed');
      return res.status(500).json({
        success: false,
        message: 'Seed failed',
        error: result.err.message,
        stderr: result.stderr,
      });
    }

    logger.info('✅ Seed completed via setup endpoint');
    return res.status(200).json({
      success: true,
      message: 'Seed complete',
      output: result.stdout,
    });
  } catch (err) {
    logger.error({ err: err.message }, '❌ Setup endpoint error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* Health check just to confirm the file is deployed */
router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'Setup endpoint is live' });
});

module.exports = router;