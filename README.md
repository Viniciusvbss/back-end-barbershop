# Barbershop SaaS API

API RESTful para gerenciamento de barbearias. Permite cadastrar barbearias, barbeiros, serviços, clientes, agendamentos e horários de funcionamento.

## Tecnologias

- **Node.js** + **Express.js**
- **MySQL** (mysql2/promise)
- **dotenv**

## Configuração

### Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=barbershop_saas
```

### Instalação e execução

```bash
npm install
node src/index.js
```

A API estará disponível em `http://localhost:3000`.

---

## Endpoints

### Base URL

```text
http://localhost:3000/api
```

---

## Barbearias — `/api/barbershops`

### Listar todas as barbearias

```http
GET /api/barbershops
```

**Resposta:**

```json
[
  {
    "id": 1,
    "name": "Barbearia do João",
    "slug": "barbearia-do-joao",
    "phone": "11999999999",
    "email": "joao@barbearia.com",
    "created_at": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### Buscar barbearia por ID

```http
GET /api/barbershops/:id
```

**Resposta:** objeto da barbearia ou `404`.

---

### Buscar barbearia por slug

```http
GET /api/barbershops/slug/:slug
```

**Exemplo:** `GET /api/barbershops/slug/barbearia-do-joao`

---

### Criar barbearia

```http
POST /api/barbershops
```

**Body:**

```json
{
  "name": "Barbearia do João",
  "slug": "barbearia-do-joao",
  "email": "joao@barbearia.com",
  "password": "senha123",
  "phone": "11999999999"
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| name | string | sim |
| slug | string | sim — deve ser único |
| email | string | sim — deve ser único |
| password | string | sim |
| phone | string | não |

**Resposta `201`:**

```json
{
  "id": 1,
  "name": "Barbearia do João",
  "slug": "barbearia-do-joao",
  "email": "joao@barbearia.com"
}
```

**Erros:**

- `400` — campos obrigatórios ausentes
- `409` — slug ou email já cadastrado

---

### Atualizar barbearia

```http
PUT /api/barbershops/:id
```

**Body:**

```json
{
  "name": "Novo Nome",
  "slug": "novo-slug",
  "email": "novo@email.com",
  "phone": "11888888888"
}
```

---

### Deletar barbearia

```http
DELETE /api/barbershops/:id
```

---

## Barbeiros — `/api/barbers`

### Listar barbeiros

```http
GET /api/barbers
GET /api/barbers?barbershop_id=1
```

Filtro opcional por barbearia.

---

### Buscar barbeiro por ID

```http
GET /api/barbers/:id
```

---

### Criar barbeiro

```http
POST /api/barbers
```

**Body:**

```json
{
  "barbershop_id": 1,
  "name": "Carlos",
  "phone": "11977777777"
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| barbershop_id | number | sim |
| name | string | sim |
| phone | string | não |

**Resposta `201`:**

```json
{
  "id": 1,
  "barbershop_id": 1,
  "name": "Carlos"
}
```

---

### Atualizar barbeiro

```http
PUT /api/barbers/:id
```

**Body:**

```json
{
  "name": "Carlos Silva",
  "phone": "11966666666"
}
```

---

### Deletar barbeiro

```http
DELETE /api/barbers/:id
```

---

## Serviços — `/api/services`

### Listar serviços

```http
GET /api/services
GET /api/services?barbershop_id=1
```

---

### Buscar serviço por ID

```http
GET /api/services/:id
```

---

### Criar serviço

```http
POST /api/services
```

**Body:**

```json
{
  "barbershop_id": 1,
  "name": "Corte Simples",
  "duration_minutes": 30,
  "price": 35.00
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| barbershop_id | number | sim |
| name | string | sim |
| duration_minutes | number | sim |
| price | number | sim |

**Resposta `201`:**

```json
{
  "id": 1,
  "barbershop_id": 1,
  "name": "Corte Simples",
  "duration_minutes": 30,
  "price": 35.00
}
```

---

### Atualizar serviço

```http
PUT /api/services/:id
```

**Body:**

```json
{
  "name": "Corte + Barba",
  "duration_minutes": 50,
  "price": 55.00
}
```

---

### Deletar serviço

```http
DELETE /api/services/:id
```

---

## Clientes — `/api/customers`

### Listar clientes

```http
GET /api/customers
GET /api/customers?barbershop_id=1
```

---

### Buscar cliente por ID

```http
GET /api/customers/:id
```

---

### Criar cliente

```http
POST /api/customers
```

**Body:**

```json
{
  "barbershop_id": 1,
  "name": "Pedro Alves",
  "phone": "11955555555",
  "email": "pedro@email.com"
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| barbershop_id | number | sim |
| name | string | sim |
| phone | string | não |
| email | string | não |

**Resposta `201`:**

```json
{
  "id": 1,
  "barbershop_id": 1,
  "name": "Pedro Alves"
}
```

---

### Atualizar cliente

```http
PUT /api/customers/:id
```

**Body:**

```json
{
  "name": "Pedro Alves",
  "phone": "11944444444",
  "email": "pedro@novo.com"
}
```

---

### Deletar cliente

```http
DELETE /api/customers/:id
```

---

## Agendamentos — `/api/appointments`

### Listar agendamentos

```http
GET /api/appointments
GET /api/appointments?barbershop_id=1&barber_id=2&date=2025-06-15&status=pending
```

**Filtros disponíveis (todos opcionais):**

| Parâmetro | Descrição |
| --- | --- |
| barbershop_id | Filtra por barbearia |
| barber_id | Filtra por barbeiro |
| date | Filtra por data (`YYYY-MM-DD`) |
| status | Filtra por status |

**Resposta** — inclui dados do cliente, barbeiro e serviço via JOIN:

```json
[
  {
    "id": 1,
    "appointment_date": "2025-06-15",
    "appointment_time": "10:00:00",
    "status": "pending",
    "created_at": "2025-06-01T00:00:00.000Z",
    "customer_name": "Pedro Alves",
    "customer_phone": "11955555555",
    "barber_name": "Carlos",
    "service_name": "Corte Simples",
    "duration_minutes": 30,
    "price": 35.00
  }
]
```

---

### Buscar agendamento por ID

```http
GET /api/appointments/:id
```

Retorna todos os dados do agendamento com nome do cliente, barbeiro e serviço.

---

### Criar agendamento

```http
POST /api/appointments
```

**Body:**

```json
{
  "barbershop_id": 1,
  "barber_id": 1,
  "customer_id": 1,
  "service_id": 1,
  "appointment_date": "2025-06-15",
  "appointment_time": "10:00:00"
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| barbershop_id | number | sim |
| barber_id | number | sim |
| customer_id | number | sim |
| service_id | number | sim |
| appointment_date | string | sim — formato `YYYY-MM-DD` |
| appointment_time | string | sim — formato `HH:MM:SS` |

**Regra de negócio:** se o barbeiro já tiver um agendamento ativo (não cancelado) no mesmo horário, retorna `409`.

**Resposta `201`:**

```json
{
  "id": 1,
  "appointment_date": "2025-06-15",
  "appointment_time": "10:00:00",
  "status": "pending"
}
```

**Erros:**

- `400` — campos obrigatórios ausentes
- `409` — horário já ocupado para este barbeiro

---

### Atualizar status do agendamento

```http
PATCH /api/appointments/:id/status
```

**Body:**

```json
{
  "status": "confirmed"
}
```

**Status válidos:**

| Status | Descrição |
| --- | --- |
| `pending` | Aguardando confirmação |
| `confirmed` | Confirmado |
| `completed` | Concluído |
| `cancelled` | Cancelado |

---

### Deletar agendamento

```http
DELETE /api/appointments/:id
```

---

## Horários de Funcionamento — `/api/business-hours`

### Listar horários

```http
GET /api/business-hours
GET /api/business-hours?barbershop_id=1
```

**Resposta** — inclui o nome do dia da semana:

```json
[
  {
    "id": 1,
    "barbershop_id": 1,
    "weekday": 1,
    "weekday_name": "Segunda",
    "open_time": "09:00:00",
    "close_time": "18:00:00"
  }
]
```

---

### Buscar horário por ID

```http
GET /api/business-hours/:id
```

---

### Criar horário de funcionamento

```http
POST /api/business-hours
```

**Body:**

```json
{
  "barbershop_id": 1,
  "weekday": 1,
  "open_time": "09:00:00",
  "close_time": "18:00:00"
}
```

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| barbershop_id | number | sim |
| weekday | number | sim — `0` a `6` |
| open_time | string | sim — formato `HH:MM:SS` |
| close_time | string | sim — formato `HH:MM:SS` |

**Referência de dias da semana:**

| Valor | Dia |
| --- | --- |
| 0 | Domingo |
| 1 | Segunda |
| 2 | Terça |
| 3 | Quarta |
| 4 | Quinta |
| 5 | Sexta |
| 6 | Sábado |

**Resposta `201`:**

```json
{
  "id": 1,
  "barbershop_id": 1,
  "weekday": 1,
  "weekday_name": "Segunda",
  "open_time": "09:00:00",
  "close_time": "18:00:00"
}
```

---

### Atualizar horário de funcionamento

```http
PUT /api/business-hours/:id
```

**Body:**

```json
{
  "weekday": 1,
  "open_time": "08:00:00",
  "close_time": "20:00:00"
}
```

---

### Deletar horário de funcionamento

```http
DELETE /api/business-hours/:id
```

---

## Banco de dados

### Schema das tabelas

```sql
CREATE TABLE barbershop (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE barbers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  FOREIGN KEY (barbershop_id) REFERENCES barbershop(id)
);

CREATE TABLE services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  duration_minutes INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (barbershop_id) REFERENCES barbershop(id)
);

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbershop_id) REFERENCES barbershop(id)
);

CREATE TABLE appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id INT NOT NULL,
  barber_id INT NOT NULL,
  customer_id INT NOT NULL,
  service_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status ENUM('pending','confirmed','completed','cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barbershop_id) REFERENCES barbershop(id),
  FOREIGN KEY (barber_id) REFERENCES barbers(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE business_hours (
  id INT AUTO_INCREMENT PRIMARY KEY,
  barbershop_id INT NOT NULL,
  weekday TINYINT NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  FOREIGN KEY (barbershop_id) REFERENCES barbershop(id)
);
```

---

## Respostas de erro

Todos os erros seguem o formato:

```json
{
  "error": "Mensagem descrevendo o problema"
}
```

| Código | Situação |
| --- | --- |
| `400` | Campos obrigatórios ausentes ou valor inválido |
| `404` | Recurso não encontrado |
| `409` | Conflito — dado duplicado ou horário já ocupado |
| `500` | Erro interno no servidor |
