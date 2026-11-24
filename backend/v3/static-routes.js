'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const SCREEN_KEY = /^[a-z0-9-]+$/;
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg)$/i;

/** @param {any} rootDir */
function readEnabledScreens(rootDir) {
  const manifestPath = path.join(rootDir, 'screens.json');
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some(screen => typeof screen !== 'string' || !SCREEN_KEY.test(screen))) {
    throw new Error('Invalid v3 screen manifest');
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('Duplicate keys in v3 screen manifest');
  }
  return parsed;
}

/** @param {any} rootDir */
function buildIndex(rootDir) {
  const indexPath = path.join(rootDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const screens = readEnabledScreens(rootDir);
  const meta = `<meta name="v3-screens" content="${screens.join(',')}">`;
  if (!/<\/head>/i.test(html)) {
    throw new Error('v3 index.html is missing its closing head tag');
  }
  return html.replace(/<\/head>/i, `${meta}</head>`);
}

/** @param {any} res @param {any} filePath */
function setV3CacheHeaders(res, filePath) {
  const file = path.basename(filePath);
  if (file === 'index.html' || file === 'screens.json' || file === 'rollout.json') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return;
  }
  if (HASHED_ASSET.test(file)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  if (/\.(?:js|css)$/i.test(file)) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Accept-Encoding');
  }
}

function createV3StaticRouter({
  rootDir = path.join(__dirname, '..', '..', 'frontend', 'v3'),
} = {}) {
  const router = express.Router();

  router.use(express.static(rootDir, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
    etag: true,
    lastModified: true,
    setHeaders: setV3CacheHeaders,
  }));

  router.get('/', /** @param {any} _req @param {any} res @param {any} next */ (_req, res, next) => {
    try {
      res.status(200).type('html').set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      }).send(buildIndex(rootDir));
    } catch (error) {
      next(error);
    }
  });

  router.get('*', /** @param {any} req @param {any} res @param {any} next */ (req, res, next) => {
    if (path.extname(req.path)) {
      return next();
    }
    try {
      res.status(200).type('html').set({
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      }).send(buildIndex(rootDir));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createV3StaticRouter, readEnabledScreens, buildIndex, setV3CacheHeaders };
