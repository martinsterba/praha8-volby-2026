import AdmZip from 'adm-zip';

const T3_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvt3_csvod.zip';
const HL_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvhl_csvod.zip';
const KAND_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvrk.csv';
const SUMMARY_URL = 'https://www.volby.cz/pls/kv2022/vysledky_obec?cislo_obce=500208&datumvoleb=20220923';
const DATE = '20220923';
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

function unzipCsv(buf) {
  const zip = new AdmZip(Buffer.from(buf));
  const entry = zip.getEntries().find(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.csv'));
  if (!entry) throw new Error('CSV soubor v ZIPu nebyl nalezen');
  return entry.getData().toString('utf8');
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([A-Z0-9_]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function currentIdForHistoricalName(name) {
  const n = String(name || '').toLocaleLowerCase('cs-CZ');
  if (n.includes('8žije')) return 1;
  if (n.includes('patrioti')) return 3;
  if (n.includes('ods')) return 4;
  if (n.includes('mourek') || n.includes('sen pro prahu')) return 5;
  if (n.includes('piráts')) return 6;
  if (n.includes('starostové') || n.includes('top 09')) return 7;
  if (n.includes('spd')) return 8;
  if (n.includes('ano 2011')) return 9;
  return null;
}

async function buildHistory() {
  const [t3Resp, hlResp, kandResp, summaryResp] = await Promise.all([
    fetch(T3_URL), fetch(HL_URL), fetch(KAND_URL), fetch(SUMMARY_URL)
  ]);
  for (const [label, resp] of [['T3', t3Resp], ['HL', hlResp], ['KAND', kandResp], ['SUMMARY', summaryResp]]) {
    if (!resp.ok) throw new Error(`${label} HTTP ${resp.status}`);
  }

  const [t3Buf, hlBuf, kandText, summaryXml] = await Promise.all([
    t3Resp.arrayBuffer(), hlResp.arrayBuffer(), kandResp.text(), summaryResp.text()
  ]);

  const t3Rows = parseDelimited(unzipCsv(t3Buf));
  const t3 = t3Rows.filter(r =>
    String(r.DATUMVOLEB) === DATE &&
    String(r.KODZASTUP) === CODE
  );

  const ids = new Set(t3.map(r => String(r.ID_OKRSKY)));
  const precincts = {};
  for (const r of t3) {
    const p = String(r.OKRSEK);
    const registered = Number(r.VOL_SEZNAM || 0);
    const envelopes = Number(r.VYD_OBALKY || 0);
    precincts[p] = {
      precinct: Number(p),
      registered,
      envelopes,
      submitted: Number(r.ODEVZ_OBAL || 0),
      validVotes: Number(r.PL_HL_CELK || 0),
      turnout: registered ? envelopes / registered * 100 : null,
      parties: {}
    };
  }

  const hlRows = parseDelimited(unzipCsv(hlBuf));
  for (const r of hlRows) {
    if (String(r.DATUMVOLEB) !== DATE || !ids.has(String(r.ID_OKRSKY))) continue;
    const p = String(r.OKRSEK);
    if (!precincts[p]) continue;
    precincts[p].parties[String(r.POR_STR_HL)] = Number(r.POC_HLASU || 0);
  }

  const parties = [];
  for (const m of summaryXml.matchAll(/<VOLEBNI_STRANA\b[^>]*\/>/g)) {
    const a = attrs(m[0]);
    parties.push({
      ballot: Number(a.POR_STR_HLAS_LIST ?? a.POR_STR_HL ?? 0),
      name: a.NAZEV_STRANY || '',
      votes: Number(a.HLASY || 0),
      pct: Number(String(a.HLASY_PROC || '0').replace(',', '.')),
      seats: Number(a.ZASTUPITELE_POCET || 0),
      currentId: currentIdForHistoricalName(a.NAZEV_STRANY)
    });
  }

  const partyByBallot = Object.fromEntries(parties.map(p => [String(p.ballot), p]));
  for (const pdata of Object.values(precincts)) {
    const mapped = {};
    for (const [ballot, votes] of Object.entries(pdata.parties)) {
      const cid = partyByBallot[ballot]?.currentId;
      if (cid) mapped[String(cid)] = (mapped[String(cid)] || 0) + votes;
    }
    pdata.currentParties = mapped;
    pdata.winnerId = Object.entries(mapped).sort((a,b) => b[1]-a[1])[0]?.[0] ? Number(Object.entries(mapped).sort((a,b) => b[1]-a[1])[0][0]) : null;
  }

  const kandRows = parseDelimited(kandText);
  const councillors = kandRows
    .filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === CODE && String(r.MANDAT).toUpperCase() === 'A')
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
      votes: Number(r.POCHLASU || 0),
      mandateOrder: Number(r.PORADIMAND || 0),
      currentId: partyByBallot[String(r.POR_STR_HL)]?.currentId || null,
      partyName: partyByBallot[String(r.POR_STR_HL)]?.name || ''
    }))
    .sort((a,b) => a.mandateOrder - b.mandateOrder);

  return {
    year: 2022,
    generatedAt: new Date().toISOString(),
    parties,
    councillors,
    precincts,
    precinctCount: Object.keys(precincts).length
  };
}

export default async function handler(req, res) {
  try {
    if (!cache) cache = await buildHistory();
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(cache);
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se připravit historická data 2022.', detail: String(error.message || error) });
  }
}
