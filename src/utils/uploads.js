const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const PUBLIC_UPLOAD_PREFIX = '/uploads';
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const PRESIGNED_GET_TTL_SECONDS = 3600;
const URL_CACHE_TTL_MS = 50 * 60 * 1000; // 50 min (inside the 1h TTL)

const _urlCache = new Map();
const _cacheCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _urlCache) {
    if (now >= v.expiresAt) _urlCache.delete(k);
  }
}, 10 * 60 * 1000);
if (_cacheCleanupInterval.unref) _cacheCleanupInterval.unref();

const EXTENSIONS_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

let cachedS3Client = null;

const getBucketName = () => {
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) {
    throw new Error('AWS_BUCKET_NAME nao configurado.');
  }
  return bucket;
};

const getS3Client = () => {
  if (cachedS3Client) return cachedS3Client;

  cachedS3Client = new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.AWS_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  return cachedS3Client;
};

const validateImageFile = (file) => {
  if (!EXTENSIONS_BY_MIME[file.mimetype]) {
    throw new Error('Envie uma imagem valida em PNG, JPG, JPEG, WEBP ou SVG.');
  }
};

const createImageUpload = (folder, fieldName = 'image') => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      try {
        validateImageFile(file);
        cb(null, true);
      } catch (error) {
        cb(error);
      }
    },
  }).single(fieldName);

  upload.storageFolder = folder;
  return upload;
};

const buildObjectKey = (folder, file) => {
  const extension = EXTENSIONS_BY_MIME[file.mimetype] || path.extname(file.originalname).toLowerCase();
  return `${folder}/${crypto.randomUUID()}${extension}`;
};

// Path armazenado no DB. Mantém o mesmo contrato do sistema anterior, então o front
// continua resolvendo via VITE_API_URL sem mudanças.
const getRelativePublicPath = (key) => `${PUBLIC_UPLOAD_PREFIX}/${key}`;

const uploadBufferToBucket = async (file, folder) => {
  const key = buildObjectKey(folder, file);

  await getS3Client().send(new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return key;
};

const compressForUpload = async (file) => {
  if (!sharp || file.mimetype === 'image/svg+xml') return file;
  const compressed = await sharp(file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { ...file, buffer: compressed, mimetype: 'image/webp' };
};

const attachUploadedImageUrl = async (req, upload) => {
  if (!req.file) return;

  const fileToUpload = await compressForUpload(req.file);
  const key = await uploadBufferToBucket(fileToUpload, upload.storageFolder);
  req.file.objectKey = key;
  req.file.publicUrl = getRelativePublicPath(key);
};

const runUpload = (upload, req, res) =>
  new Promise((resolve, reject) => {
    upload(req, res, async (error) => {
      if (error) {
        reject(error);
        return;
      }

      try {
        await attachUploadedImageUrl(req, upload);
        resolve();
      } catch (uploadError) {
        reject(uploadError);
      }
    });
  });

const getPublicUploadUrl = (folder, filenameOrFile) => {
  if (typeof filenameOrFile === 'object' && filenameOrFile?.publicUrl) {
    return filenameOrFile.publicUrl;
  }

  return `${PUBLIC_UPLOAD_PREFIX}/${folder}/${filenameOrFile}`;
};

// Converte qualquer formato conhecido em `<folder>/<filename>` (Key do bucket).
// Suporta:
//   - path relativo do contrato atual: `/uploads/barbers/uuid.jpg`
//   - URL absoluta path-style do Tigris: `https://t3.storage.dev/<bucket>/<folder>/<filename>`
//   - URL absoluta virtual-hosted: `https://<bucket>.t3.storage.dev/<folder>/<filename>`
// Retorna null para qualquer outra coisa (ex.: URL legada do Cloudinary).
const getTigrisObjectKey = (publicUrl) => {
  if (typeof publicUrl !== 'string' || !publicUrl.trim()) return null;

  const trimmed = publicUrl.trim();

  if (trimmed.startsWith(`${PUBLIC_UPLOAD_PREFIX}/`)) {
    return trimmed.slice(PUBLIC_UPLOAD_PREFIX.length + 1);
  }

  if (!/^https?:\/\//i.test(trimmed)) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const bucket = process.env.AWS_BUCKET_NAME;
  const pathname = parsed.pathname.replace(/^\/+/, '');

  if (bucket && parsed.hostname.startsWith(`${bucket}.`)) {
    return pathname || null;
  }

  if (bucket && pathname.startsWith(`${bucket}/`)) {
    return pathname.slice(bucket.length + 1) || null;
  }

  return null;
};

const signTigrisGetUrl = async (key, expiresIn = PRESIGNED_GET_TTL_SECONDS) => {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  return getSignedUrl(getS3Client(), command, { expiresIn });
};

const deleteUploadedFile = async (publicUrl) => {
  const key = getTigrisObjectKey(publicUrl);
  if (!key) {
    if (publicUrl) {
      console.warn('[uploads] deleteUploadedFile: chave nao extraida', { publicUrl });
    }
    return;
  }

  try {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }));
    console.log('[uploads] deleteUploadedFile: ok', { key });
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return;
    console.error('[uploads] deleteUploadedFile: erro', { key, error: error?.message });
    throw error;
  }
};

const cleanupUploadedRequestFile = async (req) => {
  if (!req.file?.publicUrl) return;
  await deleteUploadedFile(req.file.publicUrl);
};

const getUploadErrorMessage = (error) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return 'A imagem deve ter no maximo 20 MB.';
  }

  return error?.message || 'Nao foi possivel enviar a imagem.';
};

// Returns a direct Tigris pre-signed URL for any stored image value.
// If the value is already an absolute HTTP URL (e.g. Cloudinary), returns it as-is.
// Results are cached for 50 min to avoid repeated HMAC computation.
const resolveStorageUrl = async (value) => {
  if (!value?.trim()) return value ?? null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (!v.startsWith(`${PUBLIC_UPLOAD_PREFIX}/`)) return v;
  const key = v.slice(PUBLIC_UPLOAD_PREFIX.length + 1);
  const now = Date.now();
  const cached = _urlCache.get(key);
  if (cached && now < cached.expiresAt) return cached.url;
  const url = await signTigrisGetUrl(key);
  _urlCache.set(key, { url, expiresAt: now + URL_CACHE_TTL_MS });
  return url;
};

module.exports = {
  PUBLIC_UPLOAD_PREFIX,
  cleanupUploadedRequestFile,
  createImageUpload,
  deleteUploadedFile,
  getPublicUploadUrl,
  getTigrisObjectKey,
  getUploadErrorMessage,
  resolveStorageUrl,
  runUpload,
  signTigrisGetUrl,
};
