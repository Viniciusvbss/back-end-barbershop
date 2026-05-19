# Correção de drift de timezone em Node + MySQL

## O problema

Stacks Node + MySQL2 + Railway (ou qualquer host fora do BRT) sofrem de
**double-conversion**: o driver lê o `DATETIME` do banco como string sem
indicação de fuso, constrói um `Date` interpretando na TZ do processo, e ao
serializar para JSON com `.toISOString()` o ponto absoluto fica deslocado.

Resultado prático: `created_at` aparecia **3h adiantado** no front ao formatar
em `America/Sao_Paulo`.

---

## A correção (duas linhas)

### 1 — Primeira linha de `src/index.js`

```js
process.env.TZ = 'UTC'; // deve vir ANTES de qualquer require

const { loadEnv } = require('./config/env');
loadEnv();
// ...
```

Força o processo Node a interpretar todas as datas em UTC desde o início.
Precisa ser a **primeira linha absoluta** — depois do primeiro `require` já
pode ser tarde demais se algum módulo cachear Date internamente.

### 2 — Pool do MySQL2 (`src/config/db.js`)

```js
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00', // força a sessão MySQL a UTC
});
```

Garante que a **sessão** aberta pelo driver com o banco também negocia em UTC,
independente da configuração global do servidor MySQL.

---

## Por que essa abordagem e não as alternativas

| Abordagem | Prós | Contras |
|---|---|---|
| `process.env.TZ = 'UTC'` + `timezone: '+00:00'` | Fecha os dois vetores; código auto-documentado; funciona em qualquer host | Nenhum |
| Env var `TZ=UTC` no Railway | Equivalente ao código | Configuração fora do repo; dev local pode esquecer |
| `dateStrings: true` no pool | Elimina ambiguidade no driver | Todo código que recebe Date do banco passa a receber string — quebra comparações/aritmética existentes |
| Trocar `DATETIME` por `TIMESTAMP` | MySQL converte automaticamente | Requer migration de schema |

---

## Ajuste necessário no front

Com o back corrigido, **remover** qualquer workaround de compensação manual.

Antes (workaround):
```ts
const BACKEND_DRIFT_MS = 3 * 60 * 60 * 1000
const formatBookingDateTime = (raw) => {
  const parsed = new Date(raw)
  return formatter.format(new Date(parsed.getTime() - BACKEND_DRIFT_MS)) // subtração manual
}
```

Depois (correto):
```ts
const formatBookingDateTime = (raw) => {
  const parsed = new Date(raw)
  return formatter.format(parsed) // Intl.DateTimeFormat com timeZone converte sozinho
}
```

O `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'` converte
corretamente qualquer ISO UTC para BRT — não precisa de aritmética manual.

---

## Como verificar em um novo projeto

1. Crie um registro e anote a hora local exata (ex.: `00:52 BRT`).
2. No banco: `SELECT created_at FROM tabela ORDER BY id DESC LIMIT 1`
   → esperado: hora local + 3h em UTC (ex.: `03:52 UTC`).
3. No JSON da API: campo deve vir como `"...T03:52:00.000Z"`.
4. No front com `timeZone: 'America/Sao_Paulo'`: deve exibir `00:52`.

Se o passo 4 bater com a hora real, está correto.
