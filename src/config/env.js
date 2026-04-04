const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv() {
  const mode = process.env.NODE_ENV || 'development';
  const rootDir = path.resolve(__dirname, '..', '..');
  const envFiles = [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env'];

  for (const file of envFiles) {
    const filePath = path.join(rootDir, file);

    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, quiet: true });
    }
  }

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = mode;
  }
}

module.exports = { loadEnv };
