# Uploads — Arquitetura atual

Storage: **Railway Storage Bucket (Tigris S3-compatible)**, bucket privado, AWS SDK v3.

## Pastas e arquivos relevantes

```
back/
├── src/
│   ├── utils/
│   │   └── uploads.js          # Núcleo do storage (S3Client, multer, presign)
│   ├── routes/
│   │   ├── uploads.js          # GET /uploads/:folder/:filename → 302 presigned
│   │   ├── barbers.js          # POST / PUT / DELETE imagem do barbeiro
│   │   └── barbershops.js      # POST / DELETE logo da barbearia
│   └── index.js                # Monta /uploads na rota proxy
└── .env                        # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
                                # AWS_REGION, AWS_ENDPOINT_URL, AWS_BUCKET_NAME
```

O bucket é **plano** — Tigris não tem "diretórios" físicos, apenas prefixos na key:

```
<bucket>/
├── barbers/<uuid>.<ext>        # Foto de barbeiro
└── barbershops/<uuid>.<ext>    # Logo da barbearia
```

O DB armazena o **path relativo** `/uploads/<folder>/<uuid>.<ext>` em `barbers.image_url` e `barbershops.logo_url`. A key Tigris é o mesmo path **sem** o prefixo `/uploads/`.

## Fluxo de upload (POST/PUT)

```
[Front: FormData + arquivo]
        ↓
[Rota protegida: POST /api/barbers ou /api/barbershops/:id/logo]
        ↓
[runUpload() em utils/uploads.js]
   1. multer.memoryStorage() valida MIME (PNG/JPG/WEBP/SVG) + tamanho (20 MB)
   2. buildObjectKey(folder, file) → "barbers/uuid.jpg"
   3. PutObjectCommand no S3Client com ContentType
   4. anexa req.file.publicUrl = "/uploads/barbers/uuid.jpg"
        ↓
[Rota persiste publicUrl em image_url/logo_url no DB]
        ↓
[Se já havia imagem anterior: deleteUploadedFile(old_url) apaga do bucket]
```

## Fluxo de GET (exibir imagem)

```
[Front: <img src="${VITE_API_URL}/uploads/barbers/uuid.jpg">]
        ↓
[Backend: GET /uploads/:folder/:filename em routes/uploads.js]
   1. valida folder ∈ {barbers, barbershops}
   2. valida filename (regex UUID + extensão)
   3. signTigrisGetUrl("barbers/uuid.jpg", 300s) com getSignedUrl()
   4. res.redirect(302, presignedUrl)
        ↓
[Navegador segue 302 → baixa direto do Tigris]
```

Vantagens:
- Bucket permanece **privado** (Railway recomenda).
- **Sem egress pelo backend** — bytes não passam pela API.
- **Sem CORS no bucket** — tag `<img>` segue redirect sem disparar preflight.
- **Sem URL stale no DB** — cada exibição gera URL fresca de 5 min.
- Front não precisa conhecer endpoint/bucket; usa apenas `VITE_API_URL`.

## Fluxo de DELETE

```
[deleteUploadedFile(publicUrl)]
        ↓
[getTigrisObjectKey(publicUrl) extrai key]
   - "/uploads/barbers/uuid.jpg"               → "barbers/uuid.jpg"
   - "https://t3.storage.dev/<bucket>/barbers/uuid.jpg" → "barbers/uuid.jpg"
   - "https://<bucket>.t3.storage.dev/barbers/uuid.jpg" → "barbers/uuid.jpg"
   - URL absoluta de outro provider (ex.: Cloudinary legado) → null (no-op)
        ↓
[DeleteObjectCommand no S3Client; 404 é silenciado, demais erros propagam e logam]
```

Endpoints de delete:
- `DELETE /api/barbers/:id/image` — zera só a foto, mantém o barbeiro.
- `DELETE /api/barbers/:id` — exclui o barbeiro e a foto.
- `DELETE /api/barbershops/:id/logo` — zera só a logo.
- `DELETE /api/barbershops/:id` — exclui a barbearia (cascade manual) e todas as imagens.

## API pública de `utils/uploads.js`

| Export | O que faz |
| --- | --- |
| `createImageUpload(folder, fieldName)` | Middleware multer com memoryStorage + filtros MIME/tamanho. |
| `runUpload(upload, req, res)` | Executa multer + faz `PutObject`. Anexa `req.file.publicUrl` e `req.file.objectKey`. |
| `getPublicUploadUrl(folder, fileOrFilename)` | Retorna o path relativo a salvar no DB. |
| `deleteUploadedFile(publicUrl)` | Apaga o objeto no bucket (resiliente a formato de URL). |
| `cleanupUploadedRequestFile(req)` | Rollback: apaga o objeto recém-subido se o handler falhou depois. |
| `signTigrisGetUrl(key, expiresIn=300)` | Gera URL presigned de GET. Usado pela rota proxy. |
| `getTigrisObjectKey(publicUrl)` | Extrai a key do bucket de qualquer formato suportado. |
| `getUploadErrorMessage(err)` | Traduz erros do multer para pt-BR. |
| `PUBLIC_UPLOAD_PREFIX` | Constante `/uploads`. |

## Variáveis de ambiente

```
AWS_ACCESS_KEY_ID=<credencial Tigris>
AWS_SECRET_ACCESS_KEY=<credencial Tigris>
AWS_REGION=auto
AWS_ENDPOINT_URL=https://t3.storage.dev
AWS_BUCKET_NAME=<nome do bucket>
```

S3Client é instanciado com `forcePathStyle: true` (Tigris funciona melhor com path-style).

---

## Como era antes (resumo curto)

Storage **híbrido condicional** em `utils/uploads.js`: se `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` estavam setadas, usava Cloudinary (memory storage + `cloudinary.uploader.upload_stream`), retornando URL absoluta `https://res.cloudinary.com/...`. Caso contrário, caía pra disco local em `back/uploads/<folder>/<uuid>.<ext>` servido por `app.use('/uploads', express.static(UPLOAD_ROOT))`. Sem rota proxy, sem presigned URLs. `deleteUploadedFile` precisava detectar o provider pela substring `res.cloudinary.com` na URL.
