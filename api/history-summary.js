const URL = 'https://www.volby.cz/pls/kv2022/vysledky_obec?cislo_obce=500208&datumvoleb=20220923';

export default async function handler(req, res) {
  try {
    const upstream = await fetch(URL, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
    if (!upstream.ok) throw new Error(`ČSÚ 2022 HTTP ${upstream.status}`);
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(body);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst výsledky 2022.', detail: String(error.message || error) });
  }
}
