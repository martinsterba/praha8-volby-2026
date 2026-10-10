const BASE = 'https://volby.gov.cz/appdata/kv2026/20261009/odata/okrsky';

let cache = { latest: 0, p8: {}, hmp: {}, updatedAt: null };

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Z0-9_]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function parseBatch(xml) {
  for (const m of xml.matchAll(/<OKRSEK\b([^>]*)>([\s\S]*?)<\/OKRSEK>/g)) {
    const a = attrs(m[1]);
    const no = Number(a.CIS_OKRSEK || 0);
    if (no < 8001 || no > 8106) continue;
    const type = String(a.OZNAC_TYPU || '').toUpperCase();
    const code = String(a.KODZASTUP || '');
    let scope = null;
    if (type === 'MCMO' && code === '500208') scope = 'p8';
    if (type === 'OBEC' && code === '554782') scope = 'hmp';
    if (!scope) continue;

    const uTag = m[2].match(/<UCAST_OKRSEK\b([^>]*)\/>/)?.[1] || '';
    const u = attrs(uTag);
    const votes = {};
    for (const v of m[2].matchAll(/<HLASY_OKRSEK\b([^>]*)\/>/g)) {
      const va = attrs(v[1]);
      const id = Number(va.POR_STR_HLAS_LIST || 0);
      if (id) votes[id] = Number(va.HLASY || 0);
    }
    const processingOrder = Number(a.PORADI_ZPRAC || 0);
    const prev = cache[scope][String(no)];
    if (prev && Number(prev.processingOrder || 0) > processingOrder) continue;
    cache[scope][String(no)] = {
      precinct: no,
      processingOrder,
      partyVotes: votes,
      totalVotes: Number(u.PLATNE_HLASY || 0) || Object.values(votes).reduce((x,y)=>x+y,0),
      registered: Number(u.ZAPSANI_VOLICI || 0),
      envelopes: Number(u.VYDANE_OBALKY || 0),
      processedAt: a.DATUM_CAS_ZPRAC || null
    };
  }
}
async function fetchXml(name) {
  const r = await fetch(`${BASE}/${name}`, { headers: { 'User-Agent':'Praha8-volby-2026/1.0' } });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.text();
}
async function refresh() {
  const latestXml = await fetchXml('vysledky_okrsky.xml');
  const latest = Number(latestXml.match(/PORADI_DAVKY="(\d+)"/)?.[1] || 0);
  if (!latest) throw new Error('Číslo poslední dávky nebylo nalezeno');

  if (cache.latest === 0) {
    const nums = Array.from({length: latest}, (_,i)=>i+1);
    for (let i=0; i<nums.length; i+=8) {
      const chunk = nums.slice(i,i+8);
      const xmls = await Promise.all(chunk.map(n => n===latest ? latestXml : fetchXml(`vysledky_okrsky_${String(n).padStart(5,'0')}.xml`)));
      xmls.forEach(parseBatch);
    }
  } else if (latest > cache.latest) {
    for (let n=cache.latest+1; n<=latest; n++) {
      parseBatch(n===latest ? latestXml : await fetchXml(`vysledky_okrsky_${String(n).padStart(5,'0')}.xml`));
    }
  } else {
    parseBatch(latestXml);
  }
  cache.latest = latest;
  cache.updatedAt = new Date().toISOString();
}
export default async function handler(req,res) {
  try {
    await refresh();
    res.setHeader('Cache-Control','s-maxage=45, stale-while-revalidate=45');
    res.status(200).json({
      latestBatch: cache.latest,
      updatedAt: cache.updatedAt,
      p8: cache.p8,
      hmp: cache.hmp,
      counts: { p8:Object.keys(cache.p8).length, hmp:Object.keys(cache.hmp).length }
    });
  } catch (error) {
    res.status(502).json({error:'Nepodařilo se načíst okrsková data ČSÚ.',detail:String(error.message||error)});
  }
}
