const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const PUBLIC_UPLOAD_PREFIX = '/uploads';
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

const EXTENSIONS_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const ensureDirectory = async (directory) => {
  await fs.promises.mkdir(directory, { recursive: true });
};

const createImageUpload = (folder, fieldName = 'image') => {
  const destination = path.join(UPLOAD_ROOT, folder);

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await ensureDirectory(destination);
        cb(null, destination);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const extension = EXTENSIONS_BY_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${extension}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      if (!EXTENSIONS_BY_MIME[file.mimetype]) {
        cb(new Error('Envie uma imagem valida em PNG, JPG, JPEG, WEBP ou SVG.'));
        return;
      }

      cb(null, true);
    },
  }).single(fieldName);
};

const runUpload = (upload, req, res) =>
  new Promise((resolve, reject) => {
    upload(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const getPublicUploadUrl = (folder, filename) => `${PUBLIC_UPLOAD_PREFIX}/${folder}/${filename}`;

const deleteUploadedFile = async (publicUrl) => {
  if (typeof publicUrl !== 'string' || !publicUrl.trim()) return;

  let pathname = publicUrl.trim();

  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // Relative paths are the normal case.
  }

  if (!pathname.startsWith(`${PUBLIC_UPLOAD_PREFIX}/`)) return;

  const relativePath = pathname.slice(PUBLIC_UPLOAD_PREFIX.length + 1);
  const targetPath = path.resolve(UPLOAD_ROOT, relativePath);

  if (!targetPath.startsWith(`${UPLOAD_ROOT}${path.sep}`)) return;

  try {
    await fs.promises.unlink(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const getUploadErrorMessage = (error) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return 'A imagem deve ter no maximo 2 MB.';
  }

  return error?.message || 'Nao foi possivel enviar a imagem.';
};

module.exports = {
  PUBLIC_UPLOAD_PREFIX,
  UPLOAD_ROOT,
  createImageUpload,
  deleteUploadedFile,
  getPublicUploadUrl,
  getUploadErrorMessage,
  runUpload,
};
