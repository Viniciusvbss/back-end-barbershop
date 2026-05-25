# Refatoração do back-end — 2026-05-24

Refatoração estrutural completa focada em manutenibilidade e escalabilidade, sem alterar nenhum comportamento de API.

---

## O que foi feito

### Antes

- Todo o código de SQL, validação e lógica de negócio estava misturado diretamente nos arquivos de rota (`routes/*.js`).
- Não havia nenhuma camada de separação — um arquivo de rota tinha query SQL, bcrypt, validação de campo e lógica de conflito de horário tudo junto.
- Erros eram tratados de forma inconsistente: cada handler tinha seu próprio `try/catch` com `res.status(500).json({ error: err.message })`.

### Depois

Arquitetura em três camadas:

```
routes/       → controllers finos: recebem HTTP, chamam service, devolvem JSON
services/     → lógica de negócio e orquestração
repositories/ → único lugar com SQL
```

---

## Estrutura criada

### `src/errors/AppError.js`

Hierarquia de erros operacionais:

| Classe | Status |
|---|---|
| `AppError` | base |
| `NotFoundError` | 404 |
| `ValidationError` | 400 |
| `ConflictError` | 409 |
| `ForbiddenError` | 403 |
| `UnauthorizedError` | 401 |

### `src/middleware/errorHandler.js`

Handler global registrado no final do `index.js`. Converte qualquer `AppError` para JSON automaticamente. `ER_DUP_ENTRY` do MySQL vira 409. Erros inesperados em produção ocultam a mensagem real.

### `src/repositories/` — 7 arquivos

Cada repository expõe funções puras `(db, params) → data`. Nenhuma lógica de negócio aqui — só SQL.

| Arquivo | Responsabilidade |
|---|---|
| `appointmentRepository.js` | Agendamentos com GROUP_CONCAT de serviços |
| `barberRepository.js` | Barbeiros + credenciais de acesso |
| `barbershopRepository.js` | Barbearias + cascade delete em transação |
| `serviceRepository.js` | Serviços + validação de items |
| `customerRepository.js` | Clientes + LGPD (anonimização, export) |
| `businessHoursRepository.js` | Horários de funcionamento |
| `authRepository.js` | Tokens de reset de senha e logs |

### `src/services/` — 7 arquivos

Orquestram repositories. É aqui que vivem: checagem de conflito de horário, upsert de cliente, verificação de permissão, envio de e-mail, registro de consentimento LGPD.

### `src/validators/index.js`

Dois helpers de middleware reutilizáveis:
- `required(...fields)` — valida campos obrigatórios no body
- `paramId` — valida que `req.params.id` é inteiro positivo

---

## Performance (Fase 3)

### Cache em memória — `src/utils/cache.js`

TTL de 2 minutos para endpoints públicos de dados estáticos. As rotas `GET /api/services/public/:slug` e `GET /api/barbers/public/:slug` servem do cache na segunda requisição em diante. Operações de escrita (POST/PUT/DELETE) invalidam o cache por prefixo.

### Paginação server-side

`GET /api/appointments` e `GET /api/customers` aceitam `?page=N&limit=N`. Quando os parâmetros estão presentes, retornam `{ data, total, page, limit }`. Sem os parâmetros, comportamento anterior (array) é preservado.

### E-mail assíncrono

`forgotPassword` não bloqueia mais a resposta HTTP esperando o SMTP. Em produção: fire-and-forget com erro logado. Em dev (sem SMTP): devolve `resetLink` no response.

### Índices compostos — `migrations/001_indexes.js`

| Tabela | Índice | Para que serve |
|---|---|---|
| appointments | `(barbershop_id, appointment_date)` | Agenda diária |
| appointments | `(barber_id, appointment_date)` | Filtro por barbeiro |
| appointments | `(barbershop_id, status)` | Relatórios por status |
| customers | `(barbershop_id, name)` | Busca de clientes |
| business_hours | `(barbershop_id, weekday)` | Abertura do booking público |
| consent_logs | `(barbershop_id, action)` | Auditoria LGPD |

---

## Testes (Fase 2)

### Integração — Jest + Supertest

```bash
npm test
```

Requer `.env.test` com banco separado (use `.env.test.example` como base).

Suítes criadas:
- `src/__tests__/auth.test.js` — criar barbearia, login, autenticação
- `src/__tests__/appointments.test.js` — CRUD completo, conflito de horário, paginação, cancelamento

### `@ts-check`

Adicionado nos arquivos mais críticos:
- `src/services/appointmentService.js`
- `src/services/authService.js`
- `src/repositories/appointmentRepository.js`

---

## Sistema de migrations — `migrations/runner.js`

Executa na inicialização (após o `SELECT 1`). Cria a tabela `schema_migrations` e aplica arquivos `NNN_*.js` ainda não registrados.

**Para adicionar um campo novo ao banco:**
1. Crie `migrations/NNN_nome.js` com `module.exports = { async up(db) { ... } }`
2. Use `CREATE TABLE IF NOT EXISTS` ou `SHOW COLUMNS LIKE` + `ALTER TABLE ADD COLUMN` para idempotência
3. O runner aplica no próximo startup

O schema completo está documentado em [schema.md](schema.md).

---

## O que NÃO mudou

- Nenhum contrato de API foi alterado — todos os endpoints têm o mesmo path, método e formato de resposta
- A lógica de negócio é idêntica — só foi movida para a camada correta
- As funções `ensure*()` continuam no código como fallback de compatibilidade (são no-ops rápidos quando as colunas já existem)
