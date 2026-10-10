const BASE = 'https://volby.gov.cz/appdata/kv2026/20261009/odata';
const PLS = 'https://www.volby.cz/pls/kv2026/vysledky_okrsky';

export default async function handler(req, res) {
  const raw = String(req.query?.n || 'latest').toLowerCase();
  if (raw !== 'latest' && (!/^\d{1,5}$/.test(raw) || Number(raw) < 1)) {
    return res.status(400).json({ error: 'Parametr n musí být latest nebo číslo dávky.' });
  }

  const suffix = raw === 'latest'
    ? 'vysledky_okrsky.xml'
    : `vysledky_okrsky_${String(Number(raw)).padStart(5, '0')}.xml`;

  const candidates = raw === 'latest'
    ? [
        `${BASE}/okrsky/${suffix}`,
        `${PLS}?datumvoleb=20261009`
      ]
    : [
        `${BASE}/okrsky/${suffix}`,
        `${PLS}?datumvoleb=20261009&davka=${Number(raw)}`
      ];

  let lastStatus = null;
  for (const url of candidates) {
    try {
      const upstream = await fetch(url, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
      lastStatus = upstream.status;
      if (!upstream.ok) continue;
      const xml = await upstream.text();
      if (!xml.includes('<VYSLEDKY_OKRSKY')) continue;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', raw === 'latest' ? 's-maxage=45, stale-while-revalidate=45' : 's-maxage=31536000, immutable');
      return res.status(200).send(xml);
    } catch {}
  }

  res.status(502).json({
    error: 'Nepodařilo se načíst dávku výsledků z ČSÚ.',
    detail: `ČSÚ HTTP ${lastStatus ?? 'chyba spojení'}`,
    file: suffix
  });
}
