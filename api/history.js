import AdmZip from 'adm-zip';

const T3_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvt3_csvod.zip';
const HL_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvhl_csvod.zip';
const KAND_URL = 'https://volby.gov.cz/opendata/kv2022/csv_od/kvrk.csv';
const DATE = '20220923';
const CODE = '500208';

const PARTY_2022 = [
  { ballot: 1, currentId: 4, name: 'Občanská demokratická strana', short: 'ODS', seats: 10 },
  { ballot: 2, currentId: 8, name: 'SPD a Trikolora pro Osmičku', short: 'SPD + Trikolora', seats: 3 },
  { ballot: 4, currentId: 9, name: 'ANO 2011', short: 'ANO', seats: 9 },
  { ballot: 5, currentId: 6, name: 'Česká pirátská strana', short: 'Piráti', seats: 6 },
  { ballot: 6, currentId: 7, name: 'Společně pro Prahu 8 - TOP 09 a Starostové a nezávislí', short: 'TOP 09 + STAN', seats: 5 },
  { ballot: 8, currentId: 5, name: 'Libeňský mourek', short: 'Libeňský mourek', seats: 0 },
  { ballot: 11, currentId: 1, name: '8ŽIJE a PRAHA SOBĚ, kandidáti podpoření podpisy občanů', short: '8ŽIJE + Praha sobě', seats: 9 },
  { ballot: 12, currentId: 3, name: 'PATRIOTI PRO PRAHU 8', short: 'Patrioti', seats: 3 }
];

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

async function buildHistory() {
  const [t3Resp, hlResp, kandResp] = await Promise.all([
    fetch(T3_URL), fetch(HL_URL), fetch(KAND_URL)
  ]);
  for (const [label, resp] of [['T3', t3Resp], ['HL', hlResp], ['KAND', kandResp]]) {
    if (!resp.ok) throw new Error(`${label} HTTP ${resp.status}`);
  }

  const [t3Buf, hlBuf, kandText] = await Promise.all([
    t3Resp.arrayBuffer(), hlResp.arrayBuffer(), kandResp.text()
  ]);

  const t3Rows = parseDelimited(unzipCsv(t3Buf));
  const t3 = t3Rows.filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === CODE);
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
      parties: {},
      currentParties: {},
      winnerId: null
    };
  }

  const ballotMap = Object.fromEntries(PARTY_2022.map(p => [String(p.ballot), p.currentId]));
  const hlRows = parseDelimited(unzipCsv(hlBuf));
  for (const r of hlRows) {
    if (String(r.DATUMVOLEB) !== DATE || !ids.has(String(r.ID_OKRSKY))) continue;
    const p = String(r.OKRSEK);
    if (!precincts[p]) continue;
    const ballot = String(r.POR_STR_HL);
    const votes = Number(r.POC_HLASU || 0);
    precincts[p].parties[ballot] = votes;
    const cid = ballotMap[ballot];
    if (cid) precincts[p].currentParties[String(cid)] = (precincts[p].currentParties[String(cid)] || 0) + votes;
  }

  for (const pdata of Object.values(precincts)) {
    const ranked = Object.entries(pdata.currentParties).sort((a,b) => b[1]-a[1]);
    pdata.winnerId = ranked.length ? Number(ranked[0][0]) : null;
  }

  const totals = {};
  let allVotes = 0;
  for (const pdata of Object.values(precincts)) {
    allVotes += pdata.validVotes || 0;
    for (const [id, votes] of Object.entries(pdata.currentParties)) {
      totals[id] = (totals[id] || 0) + votes;
    }
  }
  const parties = PARTY_2022.map(p => ({
    ...p,
    votes: totals[p.currentId] || 0,
    pct: allVotes ? (totals[p.currentId] || 0) / allVotes * 100 : null
  }));

  const partyByBallot = Object.fromEntries(PARTY_2022.map(p => [String(p.ballot), p]));
  const kandRows = parseDelimited(kandText);
  const councillors = kandRows
    .filter(r => String(r.DATUMVOLEB) === DATE && String(r.KODZASTUP) === CODE && String(r.MANDAT).toUpperCase() === 'A')
    .map(r => {
      const party = partyByBallot[String(r.POR_STR_HL)];
      return {
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
        currentId: party?.currentId || null,
        partyName: party?.name || ''
      };
    })
    .sort((a,b) => (a.currentId || 99) - (b.currentId || 99) || a.mandateOrder - b.mandateOrder);

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
