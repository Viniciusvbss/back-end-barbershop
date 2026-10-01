# Sistema de Migrations

Este documento explica como o sistema de migrations do BarberSaaS funciona e como criar novas migrations corretamente.

---

## Como funciona

O runner (`migrations/runner.js`) executa automaticamente no startup da aplicação, após o `SELECT 1` de health-check do banco. Ele:

1. Cria a tabela `schema_migrations` se não existir
2. Lê todos os arquivos `NNN_nome.js` do diretório `migrations/` em ordem alfabética
3. Pula arquivos cujo `name` já esteja registrado em `schema_migrations`
4. Executa `migration.up(db)` nos arquivos restantes
5. Registra o nome do arquivo em `schema_migrations` após execução bem-sucedida

Se uma migration falhar, o startup da aplicação é abortado — o erro é lançado e o processo encerra.

---

## Estrutura de um arquivo de migration

```js
/**
 * Migração NNN — Descrição curta do que esta migration faz
 *
 * Explique aqui O QUE está sendo adicionado, POR QUE é necessário
 * e qualquer detalhe que um novo desenvolvedor precise saber para
 * entender a mudança no schema sem ter que pesquisar no histórico do Git.
 */
module.exports = {
  /**
   * @param {import('mysql2/promise').Pool} db — pool de conexões injetado pelo runner
   */
  async up(db) {
    // Toda migration DEVE ser idempotente:
    // - Para criar tabela: use CREATE TABLE IF NOT EXISTS
    // - Para adicionar coluna: verifique com SHOW COLUMNS LIKE antes de ALTER TABLE
    // - Para criar índice: verifique com SHOW INDEX WHERE Key_name = '...' antes de adicionar
  },
};
```

### Por que idempotência é obrigatória?

O runner não executa uma migration duas vezes (protegido por `schema_migrations`), mas o arquivo pode ser re-executado manualmente em ambiente de desenvolvimento ou em caso de rollback parcial. Migrations não-idempotentes causariam erros como `Duplicate column name` ou `Table already exists`.

---

## Migrations existentes

### `001_indexes.js` — Índices compostos de performance

Adiciona índices compostos nas tabelas de agendamentos, clientes, consent logs e horários de funcionamento para acelerar as queries mais frequentes da aplicação.

```js
// Exemplo de como verificar e criar um índice de forma idempotente:
const addIndex = async (table, indexName, columns) => {
  const [rows] = await db.query(
    'SHOW INDEX FROM ?? WHERE Key_name = ?',
    [table, indexName],
  );
  // Só cria se o índice ainda não existir
  if (!rows.length) {
    await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
  }
};

// Índice composto: busca de agendamentos por barbearia + data
await addIndex('appointments', 'idx_apt_shop_date', 'barbershop_id, appointment_date');
```

---

### `002_global_customers.js` — Cliente global (multi-barbearia)

Reestrutura o modelo de clientes: remove `barbershop_id` da tabela `customers` e cria a tabela `customer_barbershops` para modelar o vínculo N:N entre clientes e barbearias.

**Motivação:** Um cliente que usa a plataforma deve poder agendar em qualquer barbearia com uma única conta, sem duplicação de cadastro.

**Tabelas criadas:**

```sql
-- Vínculo cliente ↔ barbearia com consentimento LGPD por relação
CREATE TABLE IF NOT EXISTS customer_barbershops (
  customer_id             INT NOT NULL,
  barbershop_id           INT NOT NULL,
  privacy_policy_accepted_at DATETIME NULL,
  privacy_policy_version  VARCHAR(32) NULL,
  marketing_consent       TINYINT(1) NOT NULL DEFAULT 0,
  marketing_consent_at    DATETIME NULL,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, barbershop_id),
  CONSTRAINT fk_cb_customer  FOREIGN KEY (customer_id)  REFERENCES customers(id)  ON DELETE CASCADE,
  CONSTRAINT fk_cb_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
);

-- Favoritos: cliente marca barbearias que gosta
CREATE TABLE IF NOT EXISTS customer_favorites (
  customer_id   INT NOT NULL,
  barbershop_id INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, barbershop_id),
  CONSTRAINT fk_cf_customer  FOREIGN KEY (customer_id)  REFERENCES customers(id)  ON DELETE CASCADE,
  CONSTRAINT fk_cf_barbershop FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
);
```

**Lógica de migração de dados existentes:**

```js
// 1. Trata telefones duplicados (mesmo phone em barbearias diferentes)
//    Mantém o registro mais antigo (menor id), redireciona agendamentos
const [dups] = await db.query(`
  SELECT phone, MIN(id) AS keep_id, GROUP_CONCAT(id ORDER BY id) AS all_ids
  FROM customers
  WHERE phone IS NOT NULL
  GROUP BY phone
  HAVING COUNT(*) > 1
`);

for (const { keep_id, all_ids } of dups) {
  const otherIds = all_ids.split(',').map(Number).filter((id) => id !== keep_id);

  // Copia vínculos dos duplicados para o registro que será mantido
  await db.query(`
    INSERT IGNORE INTO customer_barbershops (customer_id, barbershop_id, ...)
    SELECT ?, barbershop_id, ... FROM customers WHERE id IN (?)
  `, [keep_id, otherIds]);

  // Redireciona agendamentos para o registro mantido
  await db.query('UPDATE appointments SET customer_id = ? WHERE customer_id IN (?)', [keep_id, otherIds]);

  // Remove duplicatas
  await db.query('DELETE FROM customers WHERE id IN (?)', [otherIds]);
}

// 2. Migra todos os vínculos restantes
await db.query(`
  INSERT IGNORE INTO customer_barbershops (customer_id, barbershop_id, ...)
  SELECT id, barbershop_id, ... FROM customers WHERE barbershop_id IS NOT NULL
`);

// 3. Remove colunas que saíram de customers
await db.query('ALTER TABLE customers DROP FOREIGN KEY fk_customers_barbershop');
await db.query('ALTER TABLE customers DROP COLUMN barbershop_id');
// ... outras colunas de consentimento removidas de customers
```

**Campos adicionados a `customers`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `password_hash` | `VARCHAR(255) NULL` | Hash bcrypt para login do cliente na plataforma |

**Unique constraints alteradas:**

| Antes | Depois |
|---|---|
| `UNIQUE (phone, barbershop_id)` | `UNIQUE (phone)` — telefone global |
| — | `UNIQUE (email)` — e-mail global |

---

### `003_barbershop_location.js` — Localização das barbearias

Adiciona campos de endereço e coordenadas geográficas à tabela `barbershops` para suportar a busca por proximidade na tela do cliente.

**Campos adicionados:**

| Campo | Tipo | Descrição |
|---|---|---|
| `address` | `VARCHAR(500) NULL` | Endereço completo (rua + número) |
| `city` | `VARCHAR(100) NULL` | Cidade — usada também como filtro textual |
| `state` | `VARCHAR(2) NULL` | UF (sigla), ex.: `SP` |
| `latitude` ~~removida em `004`~~ | `DECIMAL(10,6) NULL` | Latitude WGS-84 em graus decimais |
| `longitude` ~~removida em `004`~~ | `DECIMAL(11,6) NULL` | Longitude WGS-84 em graus decimais |

**Índices criados:**

```sql
-- Filtra rapidamente linhas com coordenadas (latitude IS NOT NULL)
-- antes do cálculo Haversine, evitando full table scan
-- (removido em 004 — ver abaixo)
ALTER TABLE barbershops ADD INDEX idx_barbershops_geo (latitude, longitude);

-- Busca textual por cidade (LIKE 'cidade%' aproveita este índice)
ALTER TABLE barbershops ADD INDEX idx_barbershops_city (city);
```

A busca por proximidade (Haversine) descrita originalmente aqui foi removida — ver `004_remove_barbershop_coordinates.js`.

---

### `004_remove_barbershop_coordinates.js` — Remove coordenadas das barbearias

A busca por proximidade (Haversine) foi descontinuada. Remove as colunas `latitude` e `longitude` e o índice `idx_barbershops_geo` da tabela `barbershops`, adicionados pela migração 003.

`address`, `city` e `state` permanecem — continuam em uso na busca por cidade e na exibição do endereço.

```sql
ALTER TABLE barbershops DROP INDEX idx_barbershops_geo;
ALTER TABLE barbershops DROP COLUMN latitude;
ALTER TABLE barbershops DROP COLUMN longitude;
```

---

### `006_appointment_slot_unique.js` — Horário cancelado volta a ficar livre

O banco tinha um `UNIQUE unique_barber_time (barber_id, appointment_date, appointment_time)` criado à mão, fora de migration e ausente do `schema.md`. Ele protege a corrida entre o `SELECT` do `checkConflict` e o `INSERT` (duas requisições simultâneas para o mesmo barbeiro/horário passam as duas pelo check antes de qualquer uma gravar), mas conta linhas canceladas: **depois de um cancelamento, aquele horário daquele barbeiro ficava queimado para sempre** — nenhum outro cliente conseguia marcar, e o erro chegava como 500.

A 006 troca esse índice por um equivalente que ignora cancelados:

```sql
-- 1 enquanto o agendamento vale, NULL quando cancelado
ALTER TABLE appointments
  ADD COLUMN active_slot TINYINT
  GENERATED ALWAYS AS (IF(status = 'cancelled', NULL, 1)) STORED;

ALTER TABLE appointments
  ADD UNIQUE INDEX uk_apt_barber_slot (barber_id, appointment_date, appointment_time, active_slot);

ALTER TABLE appointments DROP INDEX unique_barber_time;
```

O MySQL não aplica `UNIQUE` sobre `NULL`, então linhas canceladas saem da trava. Dois agendamentos **ativos** no mesmo barbeiro/data/hora continuam impossíveis — o novo índice cobre as mesmas colunas do antigo, nenhuma proteção se perde. O drop vem depois do `ADD`, para nunca existir uma janela sem trava.

A trava é **por barbeiro**: dois clientes continuam podendo marcar o mesmo horário com barbeiros diferentes.

No código, `asSlotConflict()` ([src/services/appointmentService.js](../src/services/appointmentService.js)) traduz o `ER_DUP_ENTRY` desse índice no mesmo 409 (`Horario ja ocupado para este barbeiro`) do `checkConflict`, em vez do 500 genérico (ou do 409 `Slug ou email ja cadastrado` do handler global). O `checkConflict` continua existindo — cobre o caso normal sem depender de exceção; o índice é a rede de segurança da corrida.

**Atenção:** a migration aborta se já existirem agendamentos ativos duplicados, listando cada conflito. Cancele ou remaneje as duplicatas e reinicie o servidor para aplicá-la.

---

## Criar uma nova migration

1. Crie o arquivo `migrations/NNN_nome_descritivo.js` seguindo a numeração (ex.: `004_...`)
2. Exporte `{ async up(db) { ... } }` com lógica idempotente
3. Documente no início do arquivo o **que** muda e **por que**
4. Atualize este arquivo adicionando uma seção `### NNN_nome_descritivo.js`
5. Atualize `docs/schema.md` com as novas tabelas/colunas

> **Atenção:** Nunca use `DROP TABLE` ou `DROP COLUMN` sem garantir que dados históricos não sejam perdidos. Prefira renomear ou marcar como obsoleto antes de remover.
