const CODES = { p8: '500208', hmp: '554782' };

export default async function handler(req, res) {
  const scope = String(req.query?.scope || 'p8').toLowerCase() === 'hmp' ? 'hmp' : 'p8';
  const code = CODES[scope];
  const url = `https://volby.gov.cz/appdata/kv2026/20261009/odata/zastup/vysledky_obec_${code}.xml`;
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
    if (!upstream.ok) throw new Error(`ČSÚ HTTP ${upstream.status}`);
    const xml = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=45');
    res.status(200).send(xml);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst souhrnný výsledek z ČSÚ.', detail: String(error.message || error), scope, code });
  }
}
