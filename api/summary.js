const CODE = process.env.PRAHA8_KODZASTUP || '500208';
const URL = `https://volby.gov.cz/appdata/kv2026/20261009/odata/zastup/vysledky_obec_${CODE}.xml`;

export default async function handler(req, res) {
  try {
    const upstream = await fetch(URL, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
    if (!upstream.ok) throw new Error(`ČSÚ HTTP ${upstream.status}`);
    const xml = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=45');
    res.status(200).send(xml);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst souhrnný výsledek z ČSÚ.', detail: String(error.message || error), code: CODE });
  }
}
