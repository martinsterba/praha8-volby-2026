import AdmZip from 'adm-zip';

const T3_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvt3_csvod.zip';
const HL_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvhl_csvod.zip';
const KAND_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvrk.csv';
const ROS_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvros.csv';
const DATE = '20220923';
const CODES = { p8: '500208', hmp: '554782' };
const P8_BALLOT_TO_2026 = { 1: 4, 2: 8, 4: 9, 5: 6, 6: 7, 8: 5, 11: 1, 12: 3 };
const caches = new Map();

function number(value) {
  const n = Number(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

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

function compactName(name) {
  const n = String(name || '');
  const low = n.toLocaleLowerCase('cs-CZ');
  if (low.includes('piráts')) return 'Piráti';
  if (low.includes('praha sobě')) return 'PRAHA SOBĚ';
  if (low.includes('starostové') || /\bstan\b/i.test(n)) return 'STAN';
  if (low.includes('spolu')) return 'SPOLU';
  if (low.includes('ano 2011')) return 'ANO';
  if (low.includes('spd')) return 'SPD';
  if (low.includes('motorist')) return 'Motoristé';
  if (low.includes('patrioti')) return 'Patrioti';
  if (low.includes('sen pro prahu')) return 'SEN 21';
  if (low.includes('spojená levice')) return 'Spojená levice';
  if (low.includes('svobodní')) return 'Svobodní';
  return n.length > 30 ? `${n.slice(0, 28)}…` : n;
}

async function buildHistory(scope) {
  const code = CODES[scope];
  const [t3Resp, hlResp, kandResp, rosResp] = await Promise.all([
    fetch(T3_URL), fetch(HL_URL), fetch(KAND_URL), fetch(ROS_URL)
  ]);
  for (const [label, resp] of [['T3', t3Resp], ['HL', hlResp], ['KAND', kandResp], ['ROS', rosResp]]) {
    if (!resp.ok) throw new Error(`${label} HTTP ${resp.status}`);
  }

  const [t3Buf, hlBuf, kandText, rosText] = await Promise.all([
    t3Resp.arrayBuffer(), hlResp.arrayBuffer(), kandResp.text(), rosResp.text()
  ]);

  const rosRows = parseDelimited(rosText).filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === code);
  const partyByBallot = new Map();
  const parties = rosRows.map(r => {
    const ballot = number(r.POR_STR_HL);
    const name = r.NAZEVCELK || r.NAZEV_STRANY || r.ZKRATKAO30 || `Strana ${ballot}`;
    const currentId = scope === 'p8' ? (P8_BALLOT_TO_2026[ballot] || null) : ballot;
    const item = {
      ballot,
      currentId,
      name,
      short: r.ZKRATKAO30 || r.ZKRATKAO8 || compactName(name),
      votes: number(r.HLASY_STR),
      pct: number(r.PROCHLSTR),
      seats: number(r.MAND_STR),
      localVotes: 0,
      localPct: null
    };
    partyByBallot.set(String(ballot), item);
    return item;
  }).filter(p => p.ballot > 0);

  const t3Rows = parseDelimited(unzipCsv(t3Buf));
  const allT3 = t3Rows.filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === code);
  const localT3 = scope === 'hmp'
    ? allT3.filter(r => number(r.OKRSEK) >= 8001 && number(r.OKRSEK) <= 8108)
    : allT3;
  const ids = new Set(localT3.map(r => String(r.ID_OKRSKY)));
  const precincts = {};

  for (const r of localT3) {
    const p = String(number(r.OKRSEK));
    const registered = number(r.VOL_SEZNAM);
    const envelopes = number(r.VYD_OBALKY);
    precincts[p] = {
      precinct: number(p),
      registered,
      envelopes,
      submitted: number(r.ODEVZ_OBAL),
      validVotes: number(r.PL_HL_CELK),
      turnout: registered ? envelopes / registered * 100 : null,
      parties: {},
      currentParties: {},
      winnerId: null
    };
  }

  const hlRows = parseDelimited(unzipCsv(hlBuf));
  for (const r of hlRows) {
    if (String(r.DATUMVOLEB) !== DATE || !ids.has(String(r.ID_OKRSKY))) continue;
    const p = String(number(r.OKRSEK));
    if (!precincts[p]) continue;
    const ballot = String(number(r.POR_STR_HL));
    const votes = number(r.POC_HLASU);
    precincts[p].parties[ballot] = votes;
    const currentId = scope === 'p8' ? P8_BALLOT_TO_2026[ballot] : number(ballot);
    if (currentId) precincts[p].currentParties[String(currentId)] = (precincts[p].currentParties[String(currentId)] || 0) + votes;
  }

  let localTotal = 0;
  const localByBallot = {};
  for (const pdata of Object.values(precincts)) {
    localTotal += pdata.validVotes || 0;
    for (const [ballot, votes] of Object.entries(pdata.parties)) {
      localByBallot[ballot] = (localByBallot[ballot] || 0) + votes;
    }
    const ranked = Object.entries(pdata.currentParties).sort((a, b) => b[1] - a[1]);
    pdata.winnerId = ranked.length ? number(ranked[0][0]) : null;
  }
  for (const p of parties) {
    p.localVotes = localByBallot[String(p.ballot)] || 0;
    p.localPct = localTotal ? p.localVotes / localTotal * 100 : null;
  }

  const kandRows = parseDelimited(kandText);
  const councillors = kandRows
    .filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === code && String(r.MANDAT).toUpperCase() === 'A')
    .map(r => {
      const ballot = number(r.POR_STR_HL);
      const party = partyByBallot.get(String(ballot));
      return {
        ballot,
        candidateNo: number(r.PORCISLO),
        firstName: r.JMENO || '',
        lastName: r.PRIJMENI || '',
        titleBefore: r.TITULPRED || '',
        titleAfter: r.TITULZA || '',
        age: number(r.VEK) || null,
        occupation: r.POVOLANI || '',
        residence: r.BYDLISTEN || '',
        votes: number(r.POCHLASU),
        mandateOrder: number(r.PORADIMAND),
        currentId: scope === 'p8' ? (P8_BALLOT_TO_2026[ballot] || null) : ballot,
        partyName: party?.name || ''
      };
    })
    .sort((a, b) => a.ballot - b.ballot || a.mandateOrder - b.mandateOrder);

  return {
    scope,
    year: 2022,
    code,
    seatCount: scope === 'hmp' ? 65 : 45,
    generatedAt: new Date().toISOString(),
    parties,
    councillors,
    precincts,
    precinctCount: Object.keys(precincts).length,
    localTotalVotes: localTotal
  };
}

export default async function handler(req, res) {
  const scope = String(req.query?.scope || 'p8').toLowerCase() === 'hmp' ? 'hmp' : 'p8';
  try {
    if (!caches.has(scope)) caches.set(scope, await buildHistory(scope));
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(caches.get(scope));
  } catch (error) {
    res.status(502).json({ error: 'Nepodařilo se připravit historická data 2022.', detail: String(error.message || error), scope });
  }
}
