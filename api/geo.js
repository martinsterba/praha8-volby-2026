const SOURCE = 'https://ags.cuzk.cz/arcgis/rest/services/RUIAN/MapServer/20/query?where=momc%3D500208&outFields=kod%2Ccislo%2Cmomc%2Cobec&returnGeometry=true&outSR=4326&f=geojson';

export default async function handler(req, res) {
  try {
    const upstream = await fetch(SOURCE, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
    if (!upstream.ok) throw new Error(`RUIAN HTTP ${upstream.status}`);
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(body);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst volební okrsky z RÚIAN.', detail: String(error.message || error) });
  }
}
