# 📦 Integração de Armazenamento Object Storage (S3 / Tigris)

Este documento descreve a arquitetura, os fluxos de integração e fornece exemplos práticos para gerenciar arquivos de mídia utilizando uma API em **Node.js (Express)** conectada a um serviço de armazenamento compatível com S3 (**Tigris**), consumida por uma interface em **Vue.js 3**.

---

## ⚙️ Variáveis de Ambiente Necessárias (.env)

O ambiente de execução do servidor precisa expor as seguintes variáveis de ambiente para se autenticar com o storage do Tigris:

```env
AWS_ACCESS_KEY_ID=tid_MlLMfRCkAlyZSLzLTXtLLWwUJdrtiBGBFpQBIFiKhlNDkmSQhv
AWS_SECRET_ACCESS_KEY=tsec_mB_MX+cLXxzkuFPI6__zSZNp92cleB2O2HZKIJ51YyKlxspOqEnnYfRv+sl5tSFtW8KKCX
AWS_REGION=auto
AWS_ENDPOINT_URL=storageapi.dev
AWS_BUCKET_NAME=functional-briefcase-y2vstd
```

---

## 🟢 Exemplo Prático: Backend em Node.js (`server.js`)

Instale as dependências necessárias rodando:
```bash
npm install express cors multer dotenv @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Código completo da API REST:

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { 
    S3Client, 
    ListObjectsV2Command, 
    PutObjectCommand, 
    DeleteObjectsCommand, 
    GetObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

// 1. LISTAR ARQUIVOS (Gera URLs assinadas válidas por 15 minutos)
app.get('/files', async (req, res) => {
    try {
        const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
        const response = await s3Client.send(command);
        
        if (!response.Contents || response.Contents.length === 0) {
            return res.json([]);
        }

        const filesPromises = response.Contents.map(async (file) => {
            const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: file.Key });
            const signedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 900 });
            return { name: file.Key, url: signedUrl };
        });

        const files = await Promise.all(filesPromises);
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: "Erro ao listar", details: err.message });
    }
});

// 2. UPLOAD DE IMAGEM
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${Date.now()}-${req.file.originalname}`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        });
        await s3Client.send(command);
        res.json({ message: "Upload concluído!" });
    } catch (err) {
        res.status(500).json({ error: "Erro no upload", details: err.message });
    }
});

// 3. EXCLUIR ARQUIVO INDIVIDUAL
app.delete('/files/single', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: "Parâmetro key obrigatório." });
    try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        res.json({ message: "Excluído com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: "Erro ao excluir", details: err.message });
    }
});

// 4. RENOMEAR ARQUIVO (Copy + Delete)
app.put('/files/rename', async (req, res) => {
    const { oldKey, newKey } = req.body;
    try {
        await s3Client.send(new CopyObjectCommand({
            Bucket: BUCKET_NAME,
            CopySource: encodeURIComponent(`${BUCKET_NAME}/${oldKey}`),
            Key: newKey
        }));
        await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: oldKey }));
        res.json({ message: "Renomeado com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: "Erro ao renomear", details: err.message });
    }
});

// 5. LIMPAR BUCKET INTEGRAL (Lote)
app.delete('/files/clear-all', async (req, res) => {
    try {
        const listResponse = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME }));
        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            return res.json({ message: "Bucket já está vazio." });
        }
        const objectsToDelete = listResponse.Contents.map(item => ({ Key: item.Key }));
        await s3Client.send(new DeleteObjectsCommand({ Bucket: BUCKET_NAME, Delete: { Objects: objectsToDelete } }));
        res.json({ message: "Bucket limpo com sucesso!" });
    } catch (err) {
        res.status(500).json({ error: "Erro ao limpar", details: err.message });
    }
});

app.listen(3000, () => console.log('API ativa na porta 3000'));
```

---

## 🟢 Exemplo Prático: Frontend em Vue.js 3 (`App.vue`)

Implementação utilizando **Vue 3 com Composition API (`<script setup>`)** e gerenciamento de estados reativos para renderizar o painel e gerenciar os arquivos:

```vue
<template>
  <div class="container">
    <h1>Gerenciador de Imagens (Vue 3)</h1>

    <!-- Formulário de Upload -->
    <div class="card">
      <h2>Enviar Nova Imagem</h2>
      <div class="dropzone" @click="\$refs.fileInput.click()">
        <p style="font-weight: 600;">Clique para selecionar a imagem</p>
        <p v-if="selectedFile">Selecionado: {{ selectedFile.name }}</p>
        <p v-else>Formatos: PNG, JPG, JPEG, WEBP</p>
        <input 
          type="file" 
          ref="fileInput" 
          accept="image/*" 
          style="display: none;" 
          @change="onFileSelect"
        />
      </div>
      <button class="btn-submit" @click="handleUpload" :disabled="!selectedFile">
        Enviar para o Bucket Tigris
      </button>
    </div>

    <!-- Seção da Galeria -->
    <div class="card">
      <div class="header-galeria">
        <h2>Imagens no Bucket</h2>
        <div class="btn-group">
          <button class="btn-danger" @click="clearBucket">Limpar Bucket</button>
          <button class="btn-secondary" @click="fetchFiles">Atualizar Lista</button>
        </div>
      </div>

      <div v-if="loading" class="status-text">Carregando arquivos do bucket...</div>
      
      <div v-else class="grid-galeria">
        <div v-for="file in files" :key="file.name" class="card-imagem">
          <div class="container-img">
            <img :src="file.url" :alt="file.name" />
          </div>
          <div class="info-img">
            <p :title="file.name">{{ file.name }}</p>
            <a :href="file.url" target="_blank">Abrir link original</a>
            <div class="actions-container">
              <button class="btn-action-rename" @click="renameFile(file.name)">Renomear</button>
              <button class="btn-action-delete" @click="deleteFile(file.name)">Excluir</button>
            </div>
          </div>
        </div>
        <p v-if="files.length === 0" class="status-text">Nenhum arquivo encontrado.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const API_URL = 'http://localhost:3000';
const files = ref([]);
const selectedFile = ref(null);
const loading = ref(false);

// Buscar arquivos da API
const fetchFiles = async () => {
  loading.value = true;
  try {
    const response = await fetch(`${API_URL}/files`);
    files.value = await response.json();
  } catch (error) {
    alert('Erro ao buscar arquivos da API.');
  } finally {
    loading.value = false;
  }
};

// Selecionar arquivo do input
const onFileSelect = (event) => {
  const file = event.target.files[0];
  if (file) selectedFile.value = file;
};

// Enviar arquivo para a API
const handleUpload = async () => {
  if (!selectedFile.value) return;
  const formData = new FormData();
  formData.append('image', selectedFile.value);

  try {
    const response = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
    if (response.ok) {
      alert('Upload concluído com sucesso!');
      selectedFile.value = null;
      await fetchFiles();
    }
  } catch (error) {
    alert('Erro ao realizar upload.');
  }
};

// Excluir arquivo individualmente
const deleteFile = async (key) => {
  if (!confirm(`Deseja excluir o arquivo "${key}"?`)) return;
  try {
    const response = await fetch(`${API_URL}/files/single?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (response.ok) {
      await fetchFiles();
    }
  } catch (error) {
    alert('Erro ao deletar o arquivo.');
  }
};

// Renomear arquivo
const renameFile = async (oldKey) => {
  const newKey = prompt('Digite o novo nome (mantenha a extensão):', oldKey);
  if (!newKey || newKey === oldKey) return;

  try {
    const response = await fetch(`${API_URL}/files/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldKey, newKey })
    });
    if (response.ok) {
      await fetchFiles();
    }
  } catch (error) {
    alert('Erro ao renomear arquivo.');
  }
};

// Limpar todo o bucket
const clearBucket = async () => {
  if (!confirm('Deseja apagar TODOS os arquivos do bucket?')) return;
  try {
    const response = await fetch(`${API_URL}/files/clear-all`, { method: 'DELETE' });
    const data = await response.json();
    alert(data.message);
    await fetchFiles();
  } catch (error) {
    alert('Erro ao limpar o bucket.');
  }
};

onMounted(fetchFiles);
</script>

<style scoped>
.container { max-width: 896px; margin: 40px auto; padding: 0 16px; font-family: sans-serif; }
h1 { text-align: center; color: #1f2937; margin-bottom: 32px; }
.card { background: white; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 40px; }
h2 { font-size: 20px; color: #374151; margin-top: 0; margin-bottom: 16px; }
.dropzone { width: 100%; height: 120px; border: 2px dashed #d1d5db; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f9fafb; cursor: pointer; }
.btn-submit { width: 100%; background: #2563eb; color: white; border: none; padding: 12px; border-radius: 8px; margin-top: 16px; cursor: pointer; font-size: 16px; }
.btn-submit:disabled { background: #9ca3af; cursor: not-allowed; }
.header-galeria { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
.btn-group { display: flex; gap: 8px; }
.btn-danger { background: #fef2f2; color: #dc2626; border: 1px solid #fee2e2; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; }
.btn-secondary { background: #eff6ff; color: #2563eb; border: 1px solid #dbeafe; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; }
.grid-galeria { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 24px; }
.card-imagem { background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; display: flex; flex-direction: column; justify-content: space-between; }
.container-img { width: 100%; aspect-ratio: 1/1; background: #f3f4f6; }
.container-img img { width: 100%; height: 100%; object-fit: cover; }
.info-img { padding: 12px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
.info-img p { margin: 0 0 4px 0; font-size: 12px; font-weight: bold; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info-img a { font-size: 11px; color: #2563eb; text-decoration: none; }
.actions-container { display: flex; justify-content: space-between; margin-top: 10px; gap: 6px; }
.btn-action-delete { background: #dc2626; color: white; border: none; padding: 6px; font-size: 11px; border-radius: 4px; cursor: pointer; flex: 1; }
.btn-action-rename { background: #eab308; color: white; border: none; padding: 6px; font-size: 11px; border-radius: 4px; cursor: pointer; flex: 1; }
.status-text { text-align: center; color: #6b7280; padding: 20px 0; grid-column: 1/-1; }
</style>
```
