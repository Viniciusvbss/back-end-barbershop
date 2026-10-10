# Disponibilidade de horários no agendamento

> Revisão do fluxo de agendamento do cliente feita em outubro de 2026.
> Commits: `1f2f9b1` e `7456e5d` (back), `b55a86d` (front).

Três regras que a aplicação **dizia** seguir mas não seguia. As três valiam tanto
para o agendamento público (`/booking/:slug`) quanto para o criado pelo admin.

---

## 1. Horário cancelado ficava bloqueado para sempre

### O problema

A tabela `appointments` tinha um `UNIQUE unique_barber_time (barber_id,
appointment_date, appointment_time)` criado direto no banco — não estava em
nenhuma migration nem no [schema.md](schema.md), o que o tornava invisível para
quem lesse só o código.

Ele protegia contra dois clientes marcarem com o mesmo barbeiro no mesmo horário
(inclusive na corrida entre o `SELECT` do `checkConflict` e o `INSERT`), mas
contava linhas canceladas. Na prática:

> João marca com o Carlos, sexta às 10h. João cancela. Aquele horário do Carlos
> nunca mais pôde ser usado por ninguém.

E o erro chegava ao cliente como **500 genérico**, porque o `ER_DUP_ENTRY` caía
no handler global (que o traduz como "Slug ou email ja cadastrado").

### A correção

[`migrations/006_appointment_slot_unique.js`](../migrations/006_appointment_slot_unique.js)
troca o índice antigo por um equivalente que ignora cancelados:

```sql
ALTER TABLE appointments
  ADD COLUMN active_slot TINYINT
  GENERATED ALWAYS AS (IF(status = 'cancelled', NULL, 1)) STORED;

ALTER TABLE appointments
  ADD UNIQUE INDEX uk_apt_barber_slot (barber_id, appointment_date, appointment_time, active_slot);

ALTER TABLE appointments DROP INDEX unique_barber_time;
```

O MySQL não aplica `UNIQUE` sobre `NULL`, então um agendamento cancelado sai da
trava e o horário volta a ficar livre. O `DROP` vem **depois** do `ADD` para
nunca existir uma janela sem proteção.

Em [`appointmentService.js`](../src/services/appointmentService.js),
`asSlotConflict()` traduz o `ER_DUP_ENTRY` desse índice no mesmo 409 do
`checkConflict`, nos quatro caminhos que escrevem slot (`createPublic`,
`createPrivate`, `updateAppointment`, `updateStatus`).

> `updateStatus` entra na lista porque tirar um agendamento de `cancelled` o
> devolve ao índice — se o horário já tiver sido ocupado, o `UPDATE` bate no UNIQUE.

A listagem pública ([`listPublicBySlug`](../src/repositories/appointmentRepository.js))
também passou a excluir cancelados. Sem isso o banco liberava o horário mas a
tela do cliente continuava pintando ele como ocupado.

---

## 2. O conflito ignorava a duração do serviço

### O problema

`checkConflict` comparava só o horário inicial:

```sql
WHERE ... AND appointment_time = ?
```

Um Corte + Barba de 75 min marcado às 10:00 ocupa o barbeiro até 11:15, mas
bloqueava apenas o slot das 10:00. Outro cliente marcava 10:30 sem nenhum aviso,
e o barbeiro ficava com dois clientes sobrepostos.

### A correção

Conflito virou **sobreposição de intervalos**. A duração de cada agendamento
existente é a soma dos serviços dele (`duration_minutes × quantity`), e a
comparação roda em segundos via `TIME_TO_SEC`, para não depender de como o MySQL
interpreta `'HH:MM'`:

```sql
GROUP BY a.id, a.appointment_time
HAVING TIME_TO_SEC(a.appointment_time) < TIME_TO_SEC(?) + (? * 60)
   AND TIME_TO_SEC(a.appointment_time)
       + (COALESCE(SUM(s.duration_minutes * aps.quantity), 0) * 60) > TIME_TO_SEC(?)
```

Os intervalos são **semiabertos**: um atendimento que termina 11:00 e outro que
começa 11:00 não se sobrepõem.

Para saber a duração do agendamento sendo criado,
`serviceRepository.validateItems` virou
[`totalDurationForItems`](../src/repositories/serviceRepository.js) — valida que
os serviços são da barbearia **e** devolve a duração somada. Retorna `null`
(não `0`) quando algum serviço é inválido, porque `0` é um total válido.

`updateAppointment` também re-checa quando **só os serviços** mudam: um serviço
mais longo começa na mesma hora mas pode terminar em cima do próximo agendamento.

No front, [`useBookingFlow.ts`](../../front/src/composables/useBookingFlow.ts)
monta `busyIntervals` (`início` + `duração`) em vez da lista de horários de
início que existia antes, e aplica o mesmo teste de sobreposição.

---

## 3. O horário de funcionamento nunca era consultado

### O problema

`business_hours` guarda `open_time` e `close_time` por dia da semana, mas:

- o front gerava uma grade fixa de **07:00 às 21:00**, usando da tabela apenas
  quais dias estão abertos;
- o backend não olhava a tabela em momento nenhum.

Dava para agendar 07:30 numa barbearia que abre às 09:00.

### A correção

`assertWithinBusinessHours()` nos três caminhos de escrita recusa dia sem
atendimento e horário em que o atendimento **termina** depois do fechamento
(17:45 + 30 min numa loja que fecha 18:00 é recusado; 17:00 + 60 min passa).

O dia da semana é calculado em UTC:

```js
const weekdayOf = (date) => {
  if (date instanceof Date) return date.getUTCDay();
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};
```

`'YYYY-MM-DD'` interpretado no fuso local renderia o dia anterior em quem roda a
oeste de Greenwich — mesmo problema descrito em [timezone.md](timezone.md). O
body manda string, mas `getRaw` devolve `Date`, daí os dois caminhos.

No front, a grade passou a ser gerada entre abertura e fechamento do dia
escolhido, avançando de 30 em 30 min enquanto o atendimento inteiro couber antes
de fechar.

### Fallback permissivo — importante

**Barbearia sem nenhuma linha em `business_hours` não é tratada como fechada.**
A validação simplesmente não roda, e o front cai na janela larga de 07:00–21:00.

Isso não é cosmético: no momento desta escrita **nenhuma das barbearias
cadastradas tem horário de funcionamento**, porque não existe tela no admin para
cadastrar. Se o código tratasse "sem cadastro" como "fechado", todo agendamento
do sistema pararia de funcionar.

---

## Regras que valem hoje

| Situação | Resultado |
|---|---|
| Dois clientes, mesmo horário, **barbeiros diferentes** | Permitido |
| Dois clientes, mesmo horário, **mesmo barbeiro** | Bloqueado (checagem + índice UNIQUE) |
| Agendamento cancelado | Libera o horário, no banco e na tela |
| Atendimento que termina quando outro começa | Permitido (intervalo semiaberto) |
| Atendimento que invade o próximo, mesmo começando antes | Bloqueado |
| Horário fora do funcionamento do dia | Recusado com 400 |
| Barbearia sem funcionamento cadastrado | Sem restrição de janela |

---

## Onde está cada coisa

| Arquivo | Papel |
|---|---|
| [`migrations/006_appointment_slot_unique.js`](../migrations/006_appointment_slot_unique.js) | Índice `uk_apt_barber_slot` + coluna gerada `active_slot` |
| [`src/repositories/appointmentRepository.js`](../src/repositories/appointmentRepository.js) | `checkConflict` (sobreposição), `durationOf`, listagem pública sem cancelados |
| [`src/repositories/serviceRepository.js`](../src/repositories/serviceRepository.js) | `totalDurationForItems` |
| [`src/services/appointmentService.js`](../src/services/appointmentService.js) | `assertWithinBusinessHours`, `asSlotConflict`, orquestração |
| [`front/src/composables/useBookingData.ts`](../../front/src/composables/useBookingData.ts) | Carrega o funcionamento completo (antes só os dias) |
| [`front/src/composables/useBookingFlow.ts`](../../front/src/composables/useBookingFlow.ts) | `selectedDayWindow`, `busyIntervals`, geração da grade |
| [`front/src/views/booking/BookingStepTime.vue`](../../front/src/views/booking/BookingStepTime.vue) | Estado vazio quando a duração não cabe no dia |

---

## Como isso foi verificado

- **Backend:** 14 cenários rodados contra o banco real — 8 de sobreposição
  (encostar antes, invadir, mesmo início, englobar, outro barbeiro) e 6 de
  funcionamento (antes de abrir, depois de fechar, transbordar o fechamento,
  caber exato, dia sem cadastro).
- **Front:** 8 testes em
  [`useBookingFlow.spec.ts`](../../front/src/composables/__tests__/useBookingFlow.spec.ts)
  (`npx vitest run`).
- **Navegador:** fluxo percorrido no slug demo `barbearia-do-joao`, que roda sem
  backend. Com funcionamento 09:00–20:00 e serviço de 45 min, a grade saiu
  09:00–19:00 com exatamente os slots sobrepostos desabilitados.

> **Cuidado ao escrever script de teste contra o banco:** as funções `ensure*()`
> dos repositórios rodam DDL, e DDL no MySQL causa **commit implícito** — um
> `ROLLBACK` no fim não desfaz nada que venha depois disso. Chame
> `ensureSchema(pool)` **antes** de abrir a transação, ou limpe as linhas na mão.

---

## Pendências conhecidas

1. **A regra de funcionamento está dormente.** A API `/api/business-hours` existe
   e é completa (CRUD), mas nenhuma view do front a consome — não há como
   cadastrar pela interface, e por isso nenhuma barbearia tem horário definido.
2. **Existe serviço cadastrado com `duration_minutes = 0`.** Um serviço assim não
   ocupa tempo na agenda. O código conta 1 minuto para que a grade concorde com o
   índice UNIQUE, mas o cadastro em si deveria ser corrigido/impedido.
3. **Horários passados do dia de hoje continuam sendo oferecidos.** O calendário
   bloqueia dias anteriores, mas se o cliente escolhe hoje às 18h, a grade ainda
   mostra 09:00.
4. **"Sem preferência" de barbeiro sempre atribui o primeiro da lista**
   (`barbers.value[0]`), e a disponibilidade mostrada considera todos os
   barbeiros juntos. Mantido assim por decisão de produto.
5. **A consulta de agendamento por telefone não pede confirmação.** Em
   `POST /api/appointments/public/:slug/lookup`, qualquer pessoa que digite um
   telefone vê nome, data, horário e barbeiro do dono daquele número.
