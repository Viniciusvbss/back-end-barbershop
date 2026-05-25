# Schema do banco de dados

Schema completo do MySQL, incluindo todas as evoluções aplicadas via funções `ensure*()`.
Para novas adições use o sistema de migrations — veja `migrations/runner.js`.

---

## Tabelas base

### `barbershops`

```sql
CREATE TABLE barbershops (
  id                              INT AUTO_INCREMENT PRIMARY KEY,
  uuid                            VARCHAR(36) NOT NULL,
  name                            VARCHAR(255) NOT NULL,
  slug                            VARCHAR(255) NOT NULL,
  phone                           VARCHAR(20) NULL,
  email                           VARCHAR(255) NOT NULL,
  password                        VARCHAR(255) NOT NULL,
  create_at                       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- typo original preservado

  -- Branding
  logo_url                        LONGTEXT NULL,
  brand_primary_color             VARCHAR(7) NOT NULL DEFAULT '#C9A84C',
  brand_secondary_color           VARCHAR(7) NOT NULL DEFAULT '#F3D58A',
  brand_public_title              VARCHAR(255) NULL,
  brand_public_description        TEXT NULL,

  -- Notificações
  notifications_whatsapp_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  notifications_email_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  notifications_reminder_enabled  TINYINT(1) NOT NULL DEFAULT 1,
  notifications_reminder_hours    INT NOT NULL DEFAULT 2,
  notifications_daily_summary_enabled TINYINT(1) NOT NULL DEFAULT 0,
  notifications_daily_summary_time    VARCHAR(5) NOT NULL DEFAULT '19:00',

  -- Segurança e privacidade
  password_updated_at             DATETIME NULL,
  privacy_policy_accepted_at      DATETIME NULL,
  privacy_policy_version          VARCHAR(32) NULL,
  terms_accepted_at               DATETIME NULL,
  terms_version                   VARCHAR(32) NULL,

  updated_at                      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE INDEX uk_barbershops_slug  (slug),
  UNIQUE INDEX uk_barbershops_email (email)
);
```

> `create_at` (sem `d`) é o nome original da coluna — `getBarbershopSelectFields()` faz alias para `created_at` nas queries.

---

### `barbers`

```sql
CREATE TABLE barbers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id   INT NOT NULL,
  name            VARCHAR(255) NOT NULL,
  phone           VARCHAR(20) NULL,
  image_url       VARCHAR(500) NULL,
  email           VARCHAR(255) NULL,
  password        VARCHAR(255) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_barbers_barbershop_id (barbershop_id),
  UNIQUE INDEX idx_barbers_email  (email),
  CONSTRAINT fk_barbers_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id)
);
```

---

### `services`

```sql
CREATE TABLE services (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id     INT NOT NULL,
  name              VARCHAR(255) NOT NULL,
  duration_minutes  INT NOT NULL,
  price             DECIMAL(10, 2) NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_services_barbershop_id (barbershop_id),
  CONSTRAINT fk_services_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id)
);
```

---

### `customers`

```sql
CREATE TABLE customers (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id               INT NOT NULL,
  name                        VARCHAR(255) NOT NULL,
  phone                       VARCHAR(20) NOT NULL,
  email                       VARCHAR(255) NULL,
  privacy_policy_accepted_at  DATETIME NULL,
  privacy_policy_version      VARCHAR(32) NULL,
  marketing_consent           TINYINT(1) NOT NULL DEFAULT 0,
  marketing_consent_at        DATETIME NULL,
  anonymized_at               DATETIME NULL,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE INDEX uk_customers_phone_shop (phone, barbershop_id),
  INDEX idx_customers_barbershop_id   (barbershop_id),
  CONSTRAINT fk_customers_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id)
);
```

---

### `appointments`

```sql
CREATE TABLE appointments (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id     INT NOT NULL,
  barber_id         INT NOT NULL,
  customer_id       INT NOT NULL,
  service_id        INT NULL,          -- legado; substituído por appointment_services
  appointment_date  DATE NOT NULL,
  appointment_time  TIME NOT NULL,
  status            ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_appointments_barbershop_id (barbershop_id),
  INDEX idx_appointments_barber_id     (barber_id),
  INDEX idx_appointments_date          (appointment_date),
  CONSTRAINT fk_appointments_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id),
  CONSTRAINT fk_appointments_barber
    FOREIGN KEY (barber_id) REFERENCES barbers(id),
  CONSTRAINT fk_appointments_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

---

### `appointment_services`

```sql
CREATE TABLE appointment_services (
  appointment_id  INT NOT NULL,
  service_id      INT NOT NULL,
  position        INT NOT NULL DEFAULT 0,
  quantity        INT NOT NULL DEFAULT 1,

  PRIMARY KEY (appointment_id, service_id),
  INDEX idx_aps_appointment (appointment_id),
  CONSTRAINT fk_aps_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_aps_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
);
```

---

### `business_hours`

```sql
CREATE TABLE business_hours (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id   INT NOT NULL,
  weekday         TINYINT NOT NULL,   -- 0=Domingo … 6=Sabado
  open_time       TIME NOT NULL,
  close_time      TIME NOT NULL,

  UNIQUE INDEX uk_business_hours_shop_weekday (barbershop_id, weekday),
  CONSTRAINT fk_business_hours_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id)
);
```

---

## Tabelas de autenticação e privacidade

### `password_resets`

```sql
CREATE TABLE password_resets (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id   INT NOT NULL,
  token_hash      CHAR(64) NOT NULL,
  expires_at      DATETIME NOT NULL,
  used_at         DATETIME NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_password_resets_token_hash    (token_hash),
  INDEX idx_password_resets_barbershop_id (barbershop_id),
  CONSTRAINT fk_password_resets_barbershop
    FOREIGN KEY (barbershop_id) REFERENCES barbershops(id) ON DELETE CASCADE
);
```

### `password_recovery_logs`

```sql
CREATE TABLE password_recovery_logs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  barbershop_id   INT NULL,
  success         TINYINT(1) NOT NULL DEFAULT 0,
  ip_address      VARCHAR(45) NULL,
  user_agent      TEXT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_password_recovery_logs_email      (email),
  INDEX idx_password_recovery_logs_created_at (created_at)
);
```

### `consent_logs`

```sql
CREATE TABLE consent_logs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id   INT NULL,
  holder_type     VARCHAR(32) NOT NULL,
  holder_id       INT NULL,
  action          VARCHAR(64) NOT NULL,
  policy_version  VARCHAR(32) NULL,
  terms_version   VARCHAR(32) NULL,
  ip_address      VARCHAR(45) NULL,
  user_agent      TEXT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_consent_logs_barbershop_id (barbershop_id),
  INDEX idx_consent_logs_holder        (holder_type, holder_id),
  INDEX idx_consent_logs_created_at    (created_at)
);
```

### `privacy_requests`

```sql
CREATE TABLE privacy_requests (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id     INT NULL,
  request_type      VARCHAR(32) NOT NULL,
  requester_name    VARCHAR(255) NULL,
  requester_email   VARCHAR(255) NULL,
  requester_phone   VARCHAR(50) NULL,
  description       TEXT NULL,
  status            VARCHAR(32) NOT NULL DEFAULT 'open',
  resolution_note   TEXT NULL,
  resolved_at       DATETIME NULL,
  ip_address        VARCHAR(45) NULL,
  user_agent        TEXT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_privacy_requests_barbershop_id (barbershop_id),
  INDEX idx_privacy_requests_status        (status),
  INDEX idx_privacy_requests_created_at    (created_at)
);
```

### `schema_migrations`

Criada pelo runner de migrations na inicialização da aplicação.

```sql
CREATE TABLE schema_migrations (
  name        VARCHAR(255) NOT NULL,
  applied_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
);
```

---

## Adicionar campo novo

1. Crie `migrations/NNN_nome_descritivo.js` com `module.exports = { async up(db) { ... } }`.
2. Use `CREATE TABLE IF NOT EXISTS` ou `SHOW COLUMNS FROM ... LIKE ?` + `ALTER TABLE ADD COLUMN` para garantir idempotência.
3. O runner aplica automaticamente no próximo startup e registra em `schema_migrations`.
