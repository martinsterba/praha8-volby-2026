const URL = 'https://volby.gov.cz/opendata/kv2026/csv_od/kvrk.csv';
const CODE = '500208';

let cache = null;

function parseDelimited(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const first = clean.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map(x => x.trim().replace(/^"|"$/g, ''));
  return rows.filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

async function loadCandidates() {
  const resp = await fetch(URL, { headers: { 'User-Agent': 'Praha8-volby-2026/1.0' } });
  if (!resp.ok) throw new Error(`ČSÚ kandidáti HTTP ${resp.status}`);
  const rows = parseDelimited(await resp.text());
  return rows
    .filter(r => String(r.KODZASTUP) === CODE)
    .map(r => ({
      ballot: Number(r.POR_STR_HL || 0),
      candidateNo: Number(r.PORCISLO || 0),
      firstName: r.JMENO || '',
      lastName: r.PRIJMENI || '',
      titleBefore: r.TITULPRED || '',
      titleAfter: r.TITULZA || '',
      age: Number(r.VEK || 0) || null,
      occupation: r.POVOLANI || '',
      residence: r.BYDLISTEN || '',
      valid: String(r.PLATNOST || 'A').toUpperCase() !== 'N',
      votes: Number(r.POCHLASU || 0),
      skipped: String(r.PRESKOCENI || '').toUpperCase() === 'A',
      elected: String(r.MANDAT || '').toUpperCase() === 'A',
      mandateOrder: Number(r.PORADIMAND || 0),
      substituteOrder: Number(r.PORADINAHR || 0)
    }))
    .filter(c => c.valid)
    .sort((a,b) => a.ballot - b.ballot || a.candidateNo - b.candidateNo);
}

export default async function handler(req, res) {
  try {
    if (!cache) cache = await loadCandidates();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(200).json({ candidates: cache, elected: cache.filter(c => c.elected).sort((a,b) => a.mandateOrder - b.mandateOrder) });
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se načíst kandidáty ČSÚ.', detail: String(error.message || error) });
  }
}
