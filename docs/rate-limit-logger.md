# Rate Limiting e Logger — Como Funciona

## Visão Geral

Duas camadas de segurança e observabilidade foram adicionadas à API:

| Camada | Arquivo | Função |
|---|---|---|
| **Logger** | `src/utils/logger.js` | Registra eventos estruturados (erros, avisos, info) |
| **Rate Limit** | `src/middleware/rateLimit.js` | Bloqueia requisições em excesso por IP |
| **Validation Logger** | `src/middleware/validationLogger.js` | Intercepta respostas 4xx/5xx e loga automaticamente |

---

## 1. Logger (Winston)

### Por que existe

`console.log` não tem nível, não tem timestamp padronizado e some ao reiniciar o processo em produção. O Winston resolve isso com logs estruturados que podem ser filtrados, persistidos e integrados a ferramentas de monitoramento.

### Comportamento por ambiente

```
NODE_ENV !== 'production'  →  console colorido (legível para dev)
NODE_ENV === 'production'  →  console + arquivos logs/app.log e logs/error.log
```

### Níveis disponíveis

```js
logger.info('mensagem')    // inicialização, eventos normais
logger.warn('mensagem')    // situações suspeitas (rate limit, conflito)
logger.error('mensagem')   // falhas inesperadas
logger.debug('mensagem')   // detalhes internos (só aparece em dev)
```

### Exemplo de saída (dev)

```
[08:42:11] info: Server running on port 3000
[08:42:11] info: Rate limiting: ATIVO
[08:42:11] info: Database connected successfully
[08:43:05] warn: Rate limit atingido {"ip":"::1","method":"POST","path":"/login","limit":5,"windowMs":300000}
[08:43:05] warn: Nao autorizado {"ip":"::1","method":"GET","path":"/api/barbershops","status":401}
```

### Exemplo de saída (produção — `logs/app.log`)

```json
{"level":"warn","message":"Rate limit atingido","ip":"187.45.12.8","method":"POST","path":"/login","limit":5,"windowMs":300000,"timestamp":"2026-05-18 14:33:01"}
{"level":"warn","message":"Erro de validacao","ip":"187.45.12.8","method":"POST","path":"/api/appointments/public/barbearia-x","status":400,"validationError":"Campo appointment_time invalido","timestamp":"2026-05-18 14:33:04"}
```

### Como usar em qualquer arquivo

```js
const logger = require('../utils/logger');

logger.info('Agendamento criado', { appointmentId: 42, barbershopId: 7 });
logger.error('Falha ao enviar email', { error: err.message });
```

---

## 2. Rate Limiting

### Por que existe

Sem rate limit, qualquer bot pode:
- Tentar milhares de combinações de senha (brute force no login)
- Criar centenas de agendamentos falsos (spam no agendamento público)
- Derrubar o servidor com requisições em massa (DoS)

O rate limit conta requisições por IP dentro de uma janela de tempo. Ao ultrapassar o limite, retorna `HTTP 429` e registra o evento no logger.

### Três limitadores configurados

#### `authLimiter` — Autenticação
```
Rotas:    POST /api/auth/login
          POST /api/auth/forgot-password
Limite:   5 requisições
Janela:   5 minutos por IP
Resposta: 429 { "error": "Muitas tentativas. Aguarde 5 minutos e tente novamente." }
```

**Cenário:** Um bot tenta logar com senhas diferentes.
- Requisições 1–5 → passam normalmente
- Requisição 6 → bloqueada com 429
- Após 5 minutos → contador zera, IP liberado

#### `publicBookingLimiter` — Agendamento Público
```
Rotas:    POST /api/appointments/public/:slug
Limite:   5 requisições
Janela:   10 minutos por IP
Resposta: 429 { "error": "Muitas tentativas de agendamento. Aguarde 10 minutos e tente novamente." }
```

**Cenário:** Bot tenta criar agendamentos em massa para lotar a agenda.
- Requisições 1–5 → agendamentos criados normalmente
- Requisição 6 → bloqueada com 429

#### `generalLimiter` — API Geral
```
Rotas:    Todas as rotas /api/*
Limite:   100 requisições
Janela:   1 minuto por IP
Resposta: 429 { "error": "Muitas requisicoes. Aguarde um momento e tente novamente." }
```

**Cenário:** Um cliente mal configurado entra em loop infinito de requisições.

### Como o IP é identificado

O `express-rate-limit` usa `req.ip` como chave de identificação por padrão. Cada IP tem seu próprio contador independente — IPs diferentes não interferem entre si.

```
IP 187.45.12.8  →  contador próprio (ex: 3/5 tentativas)
IP 200.10.5.1   →  contador próprio (ex: 1/5 tentativas)
```

### Como os limitadores se empilham

Uma requisição para `POST /api/auth/login` passa por **dois** limitadores em sequência:

```
Requisição
    │
    ▼
generalLimiter  (100/min)  ──── limite atingido? ──► 429
    │
    ▼
authLimiter     (5/5min)   ──── limite atingido? ──► 429
    │
    ▼
Handler da rota (login)
```

A requisição é bloqueada pelo primeiro limitador que tiver esgotado — não precisa passar pelos dois.

### Ativação por ambiente

O rate limit é **desativado por padrão em desenvolvimento** para não bloquear testes automatizados (smoke test, scripts de seed).

```
# .env
RATE_LIMIT_ENABLED=true   # força ativo em dev para testar
NODE_ENV=production       # ativa automaticamente em produção
```

Log ao iniciar o servidor:
```
info: Rate limiting: ATIVO
# ou
info: Rate limiting: DESATIVADO (dev) — defina RATE_LIMIT_ENABLED=true para testar
```

---

## 3. Validation Logger

Intercepta automaticamente **toda resposta** da API e loga os casos relevantes sem precisar adicionar código em cada rota.

### O que é logado

| Status | Nível | Descrição |
|---|---|---|
| `400` | `warn` | Erro de validação de input |
| `401` | `warn` | Requisição não autorizada |
| `409` | `warn` | Conflito de dados (ex: email duplicado) |
| `5xx` | `error` | Erro interno do servidor |

### Exemplo real

Requisição com campo inválido:
```http
POST /api/appointments/public/barbearia-x
{ "appointment_time": "99:99" }
```

Log gerado automaticamente:
```json
{
  "level": "warn",
  "message": "Erro de validacao",
  "ip": "187.45.12.8",
  "method": "POST",
  "path": "/api/appointments/public/barbearia-x",
  "status": 400,
  "validationError": "Horario invalido",
  "durationMs": 12
}
```

---

## Fluxo completo de uma requisição suspeita

```
1. POST /api/auth/login  { email: "x@x.com", password: "tentativa6" }

2. generalLimiter verifica: 6 req/min para esse IP → OK (abaixo de 100)

3. authLimiter verifica: 6 req/5min para esse IP → LIMITE ATINGIDO

4. handler do authLimiter:
   - logger.warn('Rate limit atingido', { ip, path, limit: 5 })
   - res.status(429).json({ error: 'Muitas tentativas...' })

5. validationLogger intercepta o res.json:
   - status 429 não entra nos casos monitorados (400/401/409/5xx)
   - resposta segue normal

6. Frontend recebe 429:
   - auth store captura o erro
   - retorna a mensagem para LoginView
   - LoginView mostra toast de erro + mensagem inline no formulário
```

---

## Referências

- Código: [`src/middleware/rateLimit.js`](../src/middleware/rateLimit.js)
- Código: [`src/utils/logger.js`](../src/utils/logger.js)
- Código: [`src/middleware/validationLogger.js`](../src/middleware/validationLogger.js)
- Registrado em: [`src/index.js`](../src/index.js)
- Pacotes: [`express-rate-limit@8`](https://github.com/express-rate-limit/express-rate-limit), [`winston@3`](https://github.com/winstonjs/winston)
