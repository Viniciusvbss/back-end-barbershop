const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const PUBLIC_UPLOAD_PREFIX = '/uploads';
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

const EXTENSIONS_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const hasCloudinaryConfig = () => (
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET
);

const configureCloudinary = () => {
  if (!hasCloudinaryConfig()) return false;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return true;
};

const ensureDirectory = async (directory) => {
  await fs.promises.mkdir(directory, { recursive: true });
};

const getLocalPublicUrl = (folder, filename) => `${PUBLIC_UPLOAD_PREFIX}/${folder}/${filename}`;

const getCloudinaryFolder = (folder) => {
  const root = process.env.CLOUDINARY_FOLDER || 'barber-saas';
  return `${root.replace(/\/$/, '')}/${folder}`;
};

const validateImageFile = (file) => {
  if (!EXTENSIONS_BY_MIME[file.mimetype]) {
    throw new Error('Envie uma imagem valida em PNG, JPG, JPEG, WEBP ou SVG.');
  }
};

const createMemoryUpload = (fieldName) => multer({
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

const createDiskUpload = (folder, fieldName) => {
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
      try {
        validateImageFile(file);
        cb(null, true);
      } catch (error) {
        cb(error);
      }
    },
  }).single(fieldName);
};

const createImageUpload = (folder, fieldName = 'image') => {
  const upload = hasCloudinaryConfig()
    ? createMemoryUpload(fieldName)
    : createDiskUpload(folder, fieldName);

  upload.storageFolder = folder;

  return upload;
};

const uploadBufferToCloudinary = (file, folder) =>
  new Promise((resolve, reject) => {
    const resourceType = file.mimetype === 'image/svg+xml' ? 'image' : 'auto';
    const publicId = crypto.randomUUID();

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: getCloudinaryFolder(folder),
        public_id: publicId,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );

    stream.end(file.buffer);
  });

const attachUploadedImageUrl = async (req, upload) => {
  if (!req.file) return;

  if (hasCloudinaryConfig()) {
    configureCloudinary();
    const result = await uploadBufferToCloudinary(req.file, upload.storageFolder);
    req.file.publicUrl = result.secure_url;
    req.file.storageProvider = 'cloudinary';
    req.file.publicId = result.public_id;
    return;
  }

  req.file.publicUrl = getLocalPublicUrl(upload.storageFolder, req.file.filename);
  req.file.storageProvider = 'local';
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

  return getLocalPublicUrl(folder, filenameOrFile);
};

const getCloudinaryPublicId = (publicUrl) => {
  if (typeof publicUrl !== 'string' || !publicUrl.includes('res.cloudinary.com')) return null;

  try {
    const pathname = new URL(publicUrl).pathname;
    const uploadMarker = '/upload/';
    const uploadIndex = pathname.indexOf(uploadMarker);
    if (uploadIndex === -1) return null;

    let publicIdWithExtension = pathname.slice(uploadIndex + uploadMarker.length);
    publicIdWithExtension = publicIdWithExtension.replace(/^v\d+\//, '');

    return publicIdWithExtension.replace(/\.[a-z0-9]+$/i, '');
  } catch {
    return null;
  }
};

const getLocalUploadPath = (publicUrl) => {
  let pathname = publicUrl.trim();

  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // Relative paths are the normal case for local development.
  }

  if (!pathname.startsWith(`${PUBLIC_UPLOAD_PREFIX}/`)) return null;

  const relativePath = pathname.slice(PUBLIC_UPLOAD_PREFIX.length + 1);
  const targetPath = path.resolve(UPLOAD_ROOT, relativePath);

  if (!targetPath.startsWith(`${UPLOAD_ROOT}${path.sep}`)) return null;

  return targetPath;
};

const streamUploadedFile = async (publicUrl, res) => {
  if (typeof publicUrl !== 'string' || !publicUrl.trim()) {
    res.status(404).json({ error: 'Imagem nao encontrada' });
    return;
  }

  if (/^https?:\/\//i.test(publicUrl)) {
    const response = await fetch(publicUrl);

    if (!response.ok) {
      res.status(404).json({ error: 'Imagem nao encontrada' });
      return;
    }

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
    return;
  }

  const targetPath = getLocalUploadPath(publicUrl);
  if (!targetPath) {
    res.status(404).json({ error: 'Imagem nao encontrada' });
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=60');
  res.sendFile(targetPath);
};

const deleteUploadedFile = async (publicUrl) => {
  if (typeof publicUrl !== 'string' || !publicUrl.trim()) return;

  const cloudinaryPublicId = getCloudinaryPublicId(publicUrl);
  if (cloudinaryPublicId && configureCloudinary()) {
    await cloudinary.uploader.destroy(cloudinaryPublicId, { resource_type: 'image' });
    return;
  }

  const targetPath = getLocalUploadPath(publicUrl);
  if (!targetPath) return;

  try {
    await fs.promises.unlink(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const cleanupUploadedRequestFile = async (req) => {
  if (!req.file) return;

  if (req.file.publicUrl) {
    await deleteUploadedFile(req.file.publicUrl);
    return;
  }

  if (req.file.path) {
    try {
      await fs.promises.unlink(req.file.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
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
  cleanupUploadedRequestFile,
  createImageUpload,
  deleteUploadedFile,
  getPublicUploadUrl,
  getUploadErrorMessage,
  runUpload,
  streamUploadedFile,
};
