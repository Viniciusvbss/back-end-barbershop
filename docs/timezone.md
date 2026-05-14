# Timezone — bug de drift de 3h e workaround atual

## Sintoma

No detalhe público do agendamento (`/booking/:slug` → "Meus agendamentos" → card) o rodapé `Agendado em …` aparecia 3h adiantado em relação à hora real local do cliente.

Exemplo do dia da identificação (14/05/2026):

- Hora real do cliente em São Paulo: `05:56 BRT`
- Agendamento criado ~4 min antes → real `05:52 BRT`
- Display mostrava `08:52` (3h a mais)
- JSON do `/api/appointments/public/:slug/lookup` retornava:
  ```json
  "created_at": "2026-05-14T11:52:05.000Z"
  ```
  ou seja `11:52 UTC`, o que em BRT vira `08:52` — bate com o que o display mostrava, mas **6h** a mais que o instante real.

## Causa raiz (provável)

A combinação atual do servidor produz uma **double-conversion**:

1. O servidor de aplicação está hospedado na Virginia (EDT/UTC-4), mas o processo Node provavelmente foi iniciado com `TZ=America/Sao_Paulo` (ou herdou de algum env).
2. A coluna `created_at` é populada por `DEFAULT CURRENT_TIMESTAMP` do MySQL e armazena em UTC.
3. Quando o `mysql2/promise` lê esse `DATETIME` (string-naive), ele constrói o objeto `Date` **interpretando a string na timezone do Node**. Ou seja, lê `2026-05-14 08:52:00` (UTC) e cria um `Date` que representa `08:52` em BRT → ponto absoluto `11:52 UTC`.
4. `JSON.stringify(Date)` chama `.toISOString()`, que sempre escreve o ponto absoluto em UTC → `2026-05-14T11:52:05.000Z`.
5. O front parseia esse ISO, formata em BRT (UTC-3) e exibe `08:52` — 3h a mais que a hora real do agendamento.

Resumindo: o passo (3) trata a string como local, "carimba" 3h em cima, e o ISO acaba congelando essa hora errada.

## Workaround aplicado (front)

[front/src/views/BookingView.vue](../../front/src/views/BookingView.vue), função `formatBookingDateTime` e constante `BACKEND_DRIFT_MS`:

```ts
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})
const BACKEND_DRIFT_MS = 3 * 60 * 60 * 1000
const formatBookingDateTime = (raw) => {
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return dateTimeFormatter.format(new Date(parsed.getTime() - BACKEND_DRIFT_MS))
}
```

Só compensa **no display**. O dado em trânsito e em banco continua deslocado.

## Correção definitiva (a fazer no back)

Escolha **uma** das opções e ajuste todos os pontos afetados.

### Opção A — Rodar tudo em UTC (recomendado)

1. Garantir `TZ=UTC` no ambiente Node (Railway env var ou `process.env.TZ = 'UTC'` no topo de `src/index.js`).
2. Confirmar que o MySQL armazena `CURRENT_TIMESTAMP` em UTC (default na maioria das instalações; conferir `SELECT @@global.time_zone, @@session.time_zone`).
3. Remover o `BACKEND_DRIFT_MS` do front e voltar a confiar no `timeZone: 'America/Sao_Paulo'` puro do `Intl.DateTimeFormat`.

### Opção B — Forçar `dateStrings` no mysql2

Configurar o pool com `dateStrings: true` para o driver devolver as colunas `DATETIME`/`TIMESTAMP` como string crua (`"2026-05-14 08:52:00"`) sem montar `Date`. Então normalizar manualmente onde for serializar JSON, anexando `Z` explicitamente.

```js
// back/src/config/db.js
mysql.createPool({
  // ...
  dateStrings: true,
})
```

Vantagem: elimina toda a ambiguidade de TZ na leitura. Desvantagem: precisa converter manualmente em qualquer comparação de data no JS.

### Opção C — Trocar `DATETIME` por `TIMESTAMP`

`TIMESTAMP` no MySQL é sempre armazenado em UTC e convertido automaticamente para a `session.time_zone` na leitura. Combinar com sessão em UTC remove a ambiguidade. Requer migration da coluna.

## Pontos do código a verificar quando consertar

Lugares que mostram ou comparam `created_at` / `appointment_date` / `appointment_time`:

- [front/src/views/BookingView.vue](../../front/src/views/BookingView.vue) — `formatBookingDate`, `formatBookingDateTime`, `BACKEND_DRIFT_MS`
- [front/src/views/admin/DashboardView.vue](../../front/src/views/admin/DashboardView.vue) — listing de "Próximos agendamentos"
- [front/src/views/admin/ScheduleView.vue](../../front/src/views/admin/ScheduleView.vue) — filtro por data, exibição
- [front/src/views/admin/ReportsView.vue](../../front/src/views/admin/ReportsView.vue) — agregação por dia

Quando rodar a correção definitiva, **remover** a constante `BACKEND_DRIFT_MS` e o `- BACKEND_DRIFT_MS` da formatação no BookingView — caso contrário o display vai inverter o erro e ficar atrasado 3h.

## Como confirmar que está resolvido

1. Criar um agendamento agora e anotar a hora local exata (ex.: `14:30 BRT`).
2. `SELECT created_at FROM appointments WHERE id = <novo>` no banco — esperado: `14:30 + 3h = 17:30 UTC`.
3. Inspecionar `created_at` no JSON da API — esperado: `"2026-05-14T17:30:00.000Z"`.
4. Front sem `BACKEND_DRIFT_MS`: display mostra `14:30 BRT` ao formatar com `timeZone: 'America/Sao_Paulo'`.

Se algum dos passos acima der diferente, voltar ao passo (1) com o `process.env.TZ` corrigido antes.
