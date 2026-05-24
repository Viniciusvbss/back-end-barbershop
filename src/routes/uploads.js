const express = require('express');
const router = express.Router();
const { PUBLIC_UPLOAD_PREFIX, resolveStorageUrl } = require('../utils/uploads');

const ALLOWED_FOLDERS = new Set(['barbers', 'barbershops']);
const FILENAME_PATTERN = /^[a-f0-9-]{36}\.[a-z0-9]+$/i;

router.get('/:folder/:filename', async (req, res) => {
  const { folder, filename } = req.params;

  if (!ALLOWED_FOLDERS.has(folder) || !FILENAME_PATTERN.test(filename)) {
    return res.status(404).end();
  }

  try {
    const url = await resolveStorageUrl(`${PUBLIC_UPLOAD_PREFIX}/${folder}/${filename}`);
    if (!url) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=2700');
    res.redirect(302, url);
  } catch {
    res.status(404).end();
  }
});

module.exports = router;
