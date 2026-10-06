const BASE = 'https://volby.gov.cz/appdata/kv2026/20261009/odata/okrsky';

export default async function handler(req, res) {
  const raw = String(req.query?.n || 'latest').toLowerCase();
  const file = raw === 'latest'
    ? 'vysledky_okrsky.xml'
    : `vysledky_okrsky_${String(Number(raw)).padStart(5, '0')}.xml`;

  if (raw !== 'latest' && (!/^\d{1,5}$/.test(raw) || Number(raw) < 1)) {
    return res.status(400).json({ error: 'Parametr n musí být latest nebo číslo dávky.' });
  }

  try {
    const upstream = await fetch(`${BASE}/${file}`, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
    if (!upstream.ok) throw new Error(`ČSÚ HTTP ${upstream.status}`);
    const xml = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', raw === 'latest' ? 's-maxage=45, stale-while-revalidate=45' : 's-maxage=31536000, immutable');
    res.status(200).send(xml);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst dávku výsledků z ČSÚ.', detail: String(error.message || error), file });
  }
}
