# Distância e Endereço em Texto — 2026-06-19

Implementação da busca por proximidade (Haversine) e exibição do endereço completo nos cards de barbearia.

---

## Contexto

A migração `003` havia adicionado `latitude` e `longitude` à tabela `barbershops` para uma versão anterior de busca por proximidade. A migração `004` removeu essas colunas ao descartar essa funcionalidade.

Esta implementação reintroduz as colunas com uma abordagem diferente: as coordenadas são obtidas automaticamente via **geocoding reverso** (Nominatim/OpenStreetMap) sempre que o dono da barbearia salva o endereço — sem nenhuma interação extra do usuário. A distância é calculada no back-end com a fórmula de Haversine usando as coordenadas do cliente (Browser Geolocation API).

---

## Arquivos criados

### `back/migrations/005_barbershop_coordinates_v2.js`

Reintroduz as colunas `latitude` e `longitude` na tabela `barbershops`. Idempotente: usa `SHOW COLUMNS LIKE` antes de cada `ALTER TABLE` para não falhar em bases que já tenham as colunas.

```js
module.exports = {
  async up(db) {
    const addIfMissing = async (column, definition) => {
      const [rows] = await db.query('SHOW COLUMNS FROM barbershops LIKE ?', [column]);
      if (!rows.length) {
        await db.query(`ALTER TABLE barbershops ADD COLUMN ${column} ${definition}`);
      }
    };
    await addIfMissing('latitude', 'DECIMAL(10,6) NULL');
    await addIfMissing('longitude', 'DECIMAL(11,6) NULL');
  },
};
```

### `back/src/utils/geocoding.js`

Utilitário que converte um endereço textual em coordenadas geográficas via **Nominatim** (API gratuita do OpenStreetMap). Projetado para uso fire-and-forget: qualquer falha de rede ou timeout resolve `null` sem propagar erro.

```js
const geocodeAddress = ({ address, city, state }) => {
  const parts = [address, city, state, 'Brasil'].filter(Boolean);
  if (!parts.length) return Promise.resolve(null);

  const q = encodeURIComponent(parts.join(', '));
  // Nominatim: 1 req/s, gratuito, sem chave de API
  const path = `/search?q=${q}&format=json&limit=1&countrycodes=br`;

  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'nominatim.openstreetmap.org',
        path,
        headers: { 'User-Agent': 'BarberSaaS/1.0' },
      },
      (res) => { /* parse JSON, resolve({ latitude, longitude }) ou null */ },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
};
```

**Comportamento em falha:** se o Nominatim estiver fora do ar ou o endereço não for encontrado, a função retorna `null` silenciosamente. A barbearia simplesmente não aparecerá nos resultados de "Próximas" até que a próxima alteração de endereço dispare um novo geocoding.

---

## Arquivos alterados

### `back/src/utils/barbershopSettings.js`

**`getPublicBarbershopSelectFields()`** — adicionadas as colunas `latitude` e `longitude` ao SELECT público:

```js
// Antes
`${prefix}address`,
`${prefix}city`,
`${prefix}state`,

// Depois
`${prefix}address`,
`${prefix}city`,
`${prefix}state`,
`${prefix}latitude`,
`${prefix}longitude`,
```

**`normalizeBarbershopRow()`** — adicionada normalização dos campos numéricos (MySQL retorna `DECIMAL` como string):

```js
// Adicionado ao final do objeto retornado
latitude: row.latitude != null ? parseFloat(row.latitude) : null,
longitude: row.longitude != null ? parseFloat(row.longitude) : null,
```

---

### `back/src/repositories/barbershopRepository.js`

Adicionada a função `updateCoordinates()`, chamada pelo service após o geocoding resolver:

```js
const updateCoordinates = async (db, id, latitude, longitude) => {
  await db.query(
    'UPDATE barbershops SET latitude = ?, longitude = ? WHERE id = ?',
    [latitude, longitude, id],
  );
};
```

---

### `back/src/services/barbershopService.js`

**Haversine helper** — calcula a distância em km entre dois pontos geográficos. Resultado arredondado a 1 casa decimal:

```js
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // raio da Terra em km
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
};
```

**`list()`** — tornou-se `async` e aceita `lat`/`lng` opcionais. Quando informados, injeta `distance_km` em cada barbearia (usando Haversine) e ordena do mais próximo ao mais distante. Barbearias sem coordenadas cadastradas ficam ao final com `distance_km: null`:

```js
const list = async (db, { q, city, lat, lng } = {}) => {
  let rows;
  if (city) rows = await barbershopRepo.listByCity(db, city);
  else if (q)  rows = await barbershopRepo.listByName(db, q);
  else         rows = await barbershopRepo.list(db);

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  if (!Number.isNaN(userLat) && !Number.isNaN(userLng)) {
    rows = rows
      .map((shop) => ({
        ...shop,
        distance_km:
          shop.latitude != null && shop.longitude != null
            ? haversine(userLat, userLng, shop.latitude, shop.longitude)
            : null,
      }))
      .sort((a, b) => {
        if (a.distance_km == null) return 1;
        if (b.distance_km == null) return -1;
        return a.distance_km - b.distance_km;
      });
  }

  return rows;
};
```

**`geocodeAndSave()`** — função interna que orquestra o geocoding e persiste as coordenadas:

```js
const geocodeAndSave = async (db, id, { address, city, state }) => {
  const coords = await geocodeAddress({ address, city, state });
  if (coords) await barbershopRepo.updateCoordinates(db, id, coords.latitude, coords.longitude);
};
```

**`update()`** — após persistir as alterações, verifica se algum campo de endereço mudou e dispara `geocodeAndSave` em fire-and-forget. A resposta ao cliente não é bloqueada:

```js
// Detecta se address, city ou state foram enviados no body
const addressChanged = 'address' in updates || 'city' in updates || 'state' in updates;

// ... (salva no banco normalmente) ...

if (addressChanged) {
  const addr = {
    address: updates.address !== undefined ? updates.address : current.address,
    city:    updates.city    !== undefined ? updates.city    : current.city,
    state:   updates.state   !== undefined ? updates.state   : current.state,
  };
  geocodeAndSave(db, id, addr).catch(() => {}); // fire-and-forget
}

return barbershopRepo.findById(db, id); // retorna imediatamente
```

---

### `back/src/routes/barbershops.js`

A rota `GET /api/barbershops` passou a repassar `lat` e `lng` da query string ao service:

```js
// Antes
router.get('/', async (req, res, next) => {
  const { q, city } = req.query;
  res.json(await barbershopService.list(db, { q, city }));
});

// Depois
router.get('/', async (req, res, next) => {
  const { q, city, lat, lng } = req.query;
  res.json(await barbershopService.list(db, { q, city, lat, lng }));
});
```

---

### `front/src/views/cliente/BuscarView.vue`

O card de barbearia foi atualizado para:

1. Exibir a distância com **uma casa decimal** (`toFixed(1)`) em vez de bruta
2. Mostrar **sempre** o endereço completo (campo `address`) ou `cidade · UF` como fallback — tanto quando há distância quanto quando não há

```html
<!-- Antes: distância OU cidade·estado (mutuamente exclusivos) -->
<p v-if="shop.distance_km != null" class="text-xs text-primary font-bold mt-0.5">
  {{ shop.distance_km < 1 ? `${Math.round(shop.distance_km * 1000)} m` : `${shop.distance_km} km` }}
</p>
<p v-else-if="shop.city" class="text-xs text-text-muted mt-0.5 truncate">
  {{ shop.city }}{{ shop.state ? ` · ${shop.state}` : '' }}
</p>

<!-- Depois: distância (quando disponível) + endereço abaixo (sempre) -->
<p v-if="shop.distance_km != null" class="text-xs text-primary font-bold mt-0.5">
  {{ shop.distance_km < 1 ? `${Math.round(shop.distance_km * 1000)} m` : `${shop.distance_km.toFixed(1)} km` }}
</p>
<p v-if="shop.address || shop.city" class="text-xs text-text-muted truncate" :class="shop.distance_km != null ? '' : 'mt-0.5'">
  {{ shop.address ? shop.address : `${shop.city ?? ''}${shop.state ? ` · ${shop.state}` : ''}` }}
</p>
```

**Resultado visual no card:**

```
┌─────────────────┐
│      [logo]     │
│   Barbearia X   │
│    2.3 km       │  ← primário (amarelo), só na aba Próximas
│ Rua das Flores  │  ← cinza, truncado, sempre visível
└─────────────────┘

┌─────────────────┐
│      [logo]     │
│   Barbearia Y   │
│ Rua Augusta, 10 │  ← sem distância (busca por nome/cidade)
└─────────────────┘
```

---

## Fluxo completo

### Cadastro / atualização de endereço

```
PUT /api/barbershops/:id
  body: { address: "Rua das Flores, 123", city: "São Paulo", state: "SP" }

  ↓ barbershopService.update()
  ↓ persiste no banco (síncrono)
  ↓ retorna 200 para o cliente ←────────────── resposta imediata
  ↓ (em paralelo, async)
  ↓ geocodeAddress({ address, city, state })
  ↓ GET nominatim.openstreetmap.org/search?q=Rua+das+Flores...
  ↓ resolve { latitude: -23.561, longitude: -46.656 }
  ↓ UPDATE barbershops SET latitude = ?, longitude = ? WHERE id = ?
```

### Busca por proximidade

```
GET /api/barbershops?lat=-23.550&lng=-46.633

  ↓ barbershopService.list(db, { lat, lng })
  ↓ SELECT ... latitude, longitude FROM barbershops
  ↓ para cada barbearia com coordenadas:
      distance_km = haversine(userLat, userLng, shop.lat, shop.lng)
  ↓ ordena ASC por distance_km (sem coordenadas → fim da lista)
  ↓ retorna JSON com distance_km injetado

  Exemplo de resposta:
  [
    { id: 3, name: "Barbearia X", distance_km: 0.8, address: "Rua das Flores, 123", ... },
    { id: 1, name: "Barbearia Y", distance_km: 2.3, address: "Av. Paulista, 900", ... },
    { id: 7, name: "Barbearia Z", distance_km: null, address: null, ... }
  ]
```

---

## Limitações e decisões de design

| Decisão | Motivo |
|---|---|
| Nominatim (gratuito) em vez de Google Geocoding | Sem custo, sem chave de API. Para volume maior, basta trocar a implementação em `geocoding.js` |
| Distância em linha reta (Haversine), não por rota | Suficiente para descoberta. Distância por rota exige API paga (Google Directions) e latência extra |
| Geocoding fire-and-forget | Não penaliza o tempo de resposta do `PUT`. Coordenadas chegam em ~1-2 s depois |
| Coordenadas na resposta pública | Endereços de barbearias são informação pública. Exposição via `getPublicBarbershopSelectFields` é intencional |
| Barbearias sem coordenadas ficam ao final | Graceful degradation: aparecem na busca por nome/cidade, mas sem distância na aba "Próximas" |
