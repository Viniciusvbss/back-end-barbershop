const https = require('https');

/**
 * Converte um endereço textual em coordenadas via Nominatim (OpenStreetMap).
 * Retorna { latitude, longitude } ou null se não encontrar / falhar.
 * Fire-and-forget: erros de rede nunca propagam — resolvem null.
 */
const geocodeAddress = ({ address, city, state }) => {
  const parts = [address, city, state, 'Brasil'].filter(Boolean);
  if (!parts.length) return Promise.resolve(null);

  const q = encodeURIComponent(parts.join(', '));
  const path = `/search?q=${q}&format=json&limit=1&countrycodes=br`;

  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'nominatim.openstreetmap.org',
        path,
        headers: { 'User-Agent': 'BarberSaaS/1.0' },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const results = JSON.parse(raw);
            if (Array.isArray(results) && results.length) {
              resolve({
                latitude: parseFloat(results[0].lat),
                longitude: parseFloat(results[0].lon),
              });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
};

module.exports = { geocodeAddress };
