# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev      # nodemon src/index.js (reload em mudanças)
npm start        # node src/index.js
node scripts/route-smoke-test.js  # smoke test end-to-end via fetch (ver abaixo)
```

Não há suíte de testes formal (`npm test` apenas falha com mensagem). [scripts/route-smoke-test.js](scripts/route-smoke-test.js) é um script standalone que sobe o ciclo completo (cria barbearia → faz login → CRUD → upload de logo/imagem → privacy → cleanup) imprimindo `PASS`/`FAIL`. Default aponta para `http://localhost:3001` via `API_BASE_URL`, mas o servidor sobe em `PORT=3000` por padrão (ajuste um dos dois antes de rodar — ver [scripts/route-smoke-test.js:1](scripts/route-smoke-test.js#L1) e [src/index.js:46](src/index.js#L46)).

Variáveis de ambiente em [.env.example](.env.example): DB MySQL, JWT, SMTP (nodemailer), Cloudinary e `CORS_ORIGIN`/`FRONTEND_URL` para o front Vite em `:5173`.

## Arquitetura

CommonJS puro, Node + Express 5, MySQL via `mysql2/promise`. Bootstrap em [src/index.js](src/index.js): carrega `.env` via `config/env.js`, monta CORS manual (não usa o middleware `cors` apesar de importado — ver [src/index.js:11-27](src/index.js#L11-L27)), serve `/uploads` como estático, registra `/api/<recurso>` e dá `SELECT 1` no DB na inicialização.

### Multi-tenant por JWT

Toda rota protegida passa por [middleware/auth.js](src/middleware/auth.js), que decodifica o Bearer token e coloca `req.barbershop = { id, email, name }`. Queries protegidas **sempre** filtram por `req.barbershop.id` (não confie em `barbershop_id` vindo do body). Rotas públicas seguem o padrão `/api/<recurso>/public/:slug` e fazem `JOIN` com `barbershops` pelo slug — ver [routes/appointments.js:7](src/routes/appointments.js#L7), [routes/barbers.js:35](src/routes/barbers.js#L35), [routes/services.js:7](src/routes/services.js#L7), [routes/businessHours.js](src/routes/businessHours.js). Em rotas protegidas com `:id`, use `ensureOwnBarbershop()` ([routes/barbershops.js:103](src/routes/barbershops.js#L103)) para garantir que o ID da URL bate com o do token.

### Schema migrations sob demanda

**Não há sistema de migrations.** As tabelas base seguem o schema do [README.md](README.md), mas qualquer coluna/tabela nova é criada em runtime por funções `ensure*`:

- `ensureBarbershopSettingsColumns(db)` em [utils/barbershopSettings.js](src/utils/barbershopSettings.js) — adiciona colunas de branding, notificações, privacy, password_updated_at via `SHOW COLUMNS LIKE` + `ALTER TABLE ADD COLUMN`.
- `ensurePrivacySchema(db)` em [utils/privacy.js](src/utils/privacy.js) — cria `consent_logs`, `privacy_requests` e adiciona colunas LGPD em `barbershops`/`customers`.
- `ensurePasswordResetTables()` em [routes/auth.js:28](src/routes/auth.js#L28) — cria `password_resets` e `password_recovery_logs`.
- `ensureBarberImageColumn()` em [routes/barbers.js:18](src/routes/barbers.js#L18) — adiciona `image_url` em `barbers`.

Cada uma usa um `schemaReadyPromise` módulo-level para idempotência por processo. **Ao adicionar campo novo:** estenda o array `SETTINGS_COLUMNS` correspondente ou crie uma nova `ensureX()` e chame-a no topo do handler antes da query — não edite o schema em arquivo de bootstrap.

### Uploads de imagem (logo, barbeiro) — o ponto que está sendo migrado

[utils/uploads.js](src/utils/uploads.js) implementa storage **híbrido** com chave de roteamento `hasCloudinaryConfig()`:

- **Com Cloudinary configurado** (`CLOUDINARY_CLOUD_NAME` + `API_KEY` + `API_SECRET` presentes): `multer.memoryStorage()` + `cloudinary.uploader.upload_stream()`. `req.file.publicUrl` recebe `secure_url` absoluto (`https://res.cloudinary.com/...`). Folder = `${CLOUDINARY_FOLDER || 'barber-saas'}/<subfolder>`.
- **Sem Cloudinary**: `multer.diskStorage()` em `./uploads/<folder>/<uuid>.<ext>`, servido por `app.use(PUBLIC_UPLOAD_PREFIX, express.static(UPLOAD_ROOT))`. `req.file.publicUrl` recebe path relativo `/uploads/barbers/uuid.jpg`.

Fluxo padrão num handler de upload (ver [routes/barbershops.js:533](src/routes/barbershops.js#L533) e [routes/barbers.js:81](src/routes/barbers.js#L81)):

1. `const uploadX = createImageUpload('folder', 'fieldName')` no topo do arquivo (singleton por rota).
2. `await runUpload(uploadX, req, res)` — roda multer, valida MIME/tamanho (max 2 MB, PNG/JPG/JPEG/WEBP/SVG), faz upload Cloudinary se aplicável, e anexa `req.file.publicUrl`.
3. `getPublicUploadUrl('folder', req.file)` para persistir no DB.
4. `await deleteUploadedFile(currentRow.image_url)` para limpar o anterior — detecta provider pela presença de `res.cloudinary.com` na URL.
5. `await cleanupUploadedRequestFile(req)` no `catch` para rollback se algo der errado depois do upload.
6. `getUploadErrorMessage(err)` traduz erros do multer (em pt-BR).

`streamUploadedFile()` existe ([utils/uploads.js:211](src/utils/uploads.js#L211)) para servir imagens via proxy (fetch para URLs http, sendFile para path local) — útil se a aplicação migrar para URLs assinadas/privadas e precisar de ponte autenticada. Atualmente sem caller direto.

### Auth e LGPD

[routes/auth.js](src/routes/auth.js) faz login com **upgrade transparente de senha**: se a senha no DB é plaintext (legado), compara raw e re-hasha com bcrypt(12) na mesma request ([routes/auth.js:99-110](src/routes/auth.js#L99-L110)). Mesma lógica em `PUT /api/barbershops/:id` para troca de senha.

Reset de senha gera token em `crypto.randomBytes(32).toString('hex')`, persiste só o `sha256`, expira em 30 min, invalida tokens anteriores. Se SMTP não está configurado, devolve o link no response como `resetLink` (modo dev — ver [utils/mailer.js:11](src/utils/mailer.js#L11)).

Versões de política em [utils/privacy.js:1-2](src/utils/privacy.js#L1-L2) (`PRIVACY_POLICY_VERSION` / `TERMS_VERSION = '2026-05-10'`) — bump manual quando o texto mudar. Todo registro de barbearia e agendamento público exige `privacy_policy_accepted` no body e dispara `recordConsentLog()`.

### Transações no DELETE de barbershop

`DELETE /api/barbershops/:id` ([routes/barbershops.js:596](src/routes/barbershops.js#L596)) faz **cascade manual** numa transação: appointments → business_hours → services → barbers → customers → password_resets/privacy_requests/consent_logs (com `tableExists` para tabelas opcionais) → barbershop. Imagens (logo e fotos de barbeiros) só são deletadas **após o commit**, em best-effort com `Promise.all` — falha de delete de arquivo não derruba a operação.

## Convenções

- **Não há TypeScript / build step.** `node src/index.js` roda direto. `nodemon` em dev observa `src/`.
- **CORS manual**: não introduza o middleware `cors`; mantenha o padrão atual ou faça uma refatoração consciente.
- **Rotas protegidas** usam `req.barbershop.id` — nunca aceite `barbershop_id` do body em rota autenticada.
- **Ao adicionar coluna ao DB**: estenda a `ensure*` correspondente, não crie scripts SQL soltos.
- **Erros**: padrão `{ error: 'mensagem em pt-BR (sem acentos no código)' }`. Validações de input retornam 400; conflitos retornam 409 (ex.: slug/email duplicado via `ER_DUP_ENTRY`, horário já ocupado).
- A função `getBarbershopSelectFields()` faz alias `create_at AS created_at` — a coluna no DB chama-se mesmo `create_at` (sem `d`); preserve quando construir queries novas sobre `barbershops`.
- A coleção Insomnia em [insomnia-collection.json](insomnia-collection.json) é fonte viva dos contratos REST e cobre mais que o [README.md](README.md) (que está desatualizado — não menciona `/api/auth/*`, uploads, privacy, ou os campos novos de branding/notificação).
