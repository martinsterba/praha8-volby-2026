const ELECTION_CLOSE = new Date('2026-10-10T14:00:00+02:00');
const PRAHA8_CODE = '500208';
const REFRESH_SECONDS = 70;

const parties = [
  { id: 1, name: '8žije, Praha sobě a Zelení', short: '8ŽIJE + PS + Zelení', baseline: 17.04, seats2022: 9, color: '#3d9f58' },
  { id: 2, name: 'Spojená levice pro Prahu', short: 'Spojená levice', baseline: null, seats2022: 0, color: '#c23f45' },
  { id: 3, name: 'PATRIOTI PRO PRAHU 8', short: 'Patrioti', baseline: 6.80, seats2022: 3, color: '#8b6a2f' },
  { id: 4, name: 'ODS s podporou KDU-ČSL', short: 'ODS + KDU-ČSL', baseline: 19.28, seats2022: 10, color: '#326db2' },
  { id: 5, name: 'Mourek s podporou SEN PRO PRAHU s Václavem Láskou', short: 'Mourek + SEN 21', baseline: 4.23, seats2022: 0, color: '#6f6678' },
  { id: 6, name: 'Česká pirátská strana', short: 'Piráti', baseline: 11.60, seats2022: 6, color: '#111111' },
  { id: 7, name: 'STAROSTOVÉ A NEZÁVISLÍ + TOP 09 – Společně pro Prahu 8', short: 'STAN + TOP 09', baseline: 11.19, seats2022: 5, color: '#7140a3' },
  { id: 8, name: 'SPD pro Prahu 8 s podporou Česká párty, PRO a Svobodní', short: 'SPD + partneři', baseline: 5.98, seats2022: 3, color: '#225c98' },
  { id: 9, name: 'ANO 2011', short: 'ANO', baseline: 17.98, seats2022: 9, color: '#28a3c7' },
];

let selectedPartyId = 6;
let map, precinctLayer;
let geojsonCache = null;
let liveByPrecinct = new Map();
let liveTotals = new Map();
let processedBatches = new Set();
let demoMode = false;
let refreshTimer = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function formatPct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function normalizePrecinct(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^0+/, '');
}

function normalizeName(s) {
  return String(s || '')
    .toLocaleLowerCase('cs')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isAfterClose() { return new Date() >= ELECTION_CLOSE; }

function renderSeats() {
  const wrap = $('#coalition-strip');
  wrap.innerHTML = '';
  for (let i = 0; i < 45; i++) {
    const el = document.createElement('span');
    el.className = `seat${i < 27 ? ' filled' : ''}`;
    wrap.appendChild(el);
  }
}

function renderLegend() {
  const ranges = [
    ['35+ %', '#2c1450'], ['30–35 %', '#3a1c65'], ['25–30 %', '#4e2b7d'],
    ['20–25 %', '#664493'], ['15–20 %', '#8267a6'], ['10–15 %', '#a293b7'],
    ['5–10 %', '#c8bfd1'], ['< 5 %', '#ddd8e2'], ['čeká na sečtení', '#ece9ee']
  ];
  $('#legend-grid').innerHTML = ranges.map(([label, color]) => `
    <div class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</div>
  `).join('');
}

function colorForPct(pct, counted = true) {
  if (!counted || pct == null || Number.isNaN(pct)) return '#ece9ee';
  if (pct >= 35) return '#2c1450';
  if (pct >= 30) return '#3a1c65';
  if (pct >= 25) return '#4e2b7d';
  if (pct >= 20) return '#664493';
  if (pct >= 15) return '#8267a6';
  if (pct >= 10) return '#a293b7';
  if (pct >= 5) return '#c8bfd1';
  return '#ddd8e2';
}

function currentParty() { return parties.find(p => p.id === selectedPartyId); }

function currentPartyTotals() {
  const p = currentParty();
  const total = liveTotals.get(p.id);
  if (total?.pct != null) return total;
  if (demoMode) return { pct: demoPartyPct(p.id), votes: 0 };
  return { pct: null, votes: 0 };
}

function demoPartyPct(partyId) {
  const base = parties.find(p => p.id === partyId)?.baseline;
  if (base == null) return 3.7 + partyId * .35;
  const nudges = {1: 1.2, 3: -.4, 4: -1.6, 5: .6, 6: 2.8, 7: .5, 8: .8, 9: 1.1};
  return Math.max(1, base + (nudges[partyId] || 0));
}

function demoPrecinctPct(precinct, partyId) {
  const key = `${precinct}:${partyId}`;
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const noise = ((h >>> 0) % 1000) / 1000;
  return Math.max(1.5, Math.min(42, demoPartyPct(partyId) + (noise - .5) * 13));
}

function precinctPartyPct(precinct, partyId) {
  if (demoMode) return demoPrecinctPct(precinct, partyId);
  const data = liveByPrecinct.get(normalizePrecinct(precinct));
  if (!data) return null;
  const votes = data.partyVotes.get(partyId) || 0;
  if (!data.totalListVotes) return null;
  return (votes / data.totalListVotes) * 100;
}

function renderPartyList() {
  const host = $('#party-list');
  host.innerHTML = '';
  for (const p of parties) {
    const live = liveTotals.get(p.id)?.pct;
    const pct = demoMode ? demoPartyPct(p.id) : live;
    const fallback = p.baseline;
    const scoreText = pct != null ? `${formatPct(pct)} %` : (fallback != null ? `(${formatPct(fallback)} %)` : '—');
    const width = Math.max(0, Math.min(100, ((pct ?? fallback ?? 0) / 35) * 100));
    const row = document.createElement('div');
    row.className = `party-row${p.id === selectedPartyId ? ' active' : ''}`;
    row.innerHTML = `
      <div class="party-label"><span class="party-dot" style="background:${p.color}"></span><span>${p.short}</span></div>
      <div class="party-score">${scoreText}</div>
      <div class="party-track"><span style="width:${width}%;background:${p.color}"></span></div>`;
    row.addEventListener('click', () => {
      selectedPartyId = p.id;
      updateSelectedParty();
      renderPartyList();
      restyleMap();
    });
    host.appendChild(row);
  }
}

function updateSelectedParty() {
  const p = currentParty();
  const total = currentPartyTotals();
  $('#selected-name').textContent = p.name.toLocaleUpperCase('cs-CZ');
  $('#selected-pct').textContent = formatPct(total.pct);
  $('#selected-seats').textContent = p.seats2022;
  $('#legend-title').textContent = `${p.short.toLocaleUpperCase('cs-CZ')} — PODÍL HLASŮ`;
  if (demoMode) {
    $('#selected-note').textContent = 'Simulace pro náhled vzhledu';
  } else if (total.pct != null) {
    $('#selected-note').textContent = 'Průběžný výsledek ze sečtených okrsků';
  } else {
    $('#selected-note').textContent = 'Čeká na první sečtené okrsky';
  }
}

function getPrecinctFromFeature(feature) {
  const props = feature?.properties || {};
  return normalizePrecinct(props.cislo ?? props.CISLO ?? props.cis_okrsek ?? props.CIS_OKRSEK ?? props.kod ?? props.KOD);
}

function restyleMap() {
  if (!precinctLayer) return;
  precinctLayer.eachLayer(layer => {
    const precinct = getPrecinctFromFeature(layer.feature);
    const pct = precinctPartyPct(precinct, selectedPartyId);
    const counted = demoMode || liveByPrecinct.has(precinct);
    layer.setStyle({ fillColor: colorForPct(pct, counted), fillOpacity: counted ? .80 : .67, color: '#ffffff', weight: 1 });
    const p = currentParty();
    const label = counted ? `${formatPct(pct)} %` : 'čeká na sečtení';
    layer.unbindTooltip().bindTooltip(`<div class="precinct-tooltip"><strong>Okrsek ${precinct}</strong>${p.short}<div class="value">${label}</div></div>`, { sticky: true });
  });
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([50.112, 14.466], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

async function loadGeometry() {
  try {
    const res = await fetch('/api/geo');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.features?.length) throw new Error('GeoJSON je prázdný');
    geojsonCache = data;
    precinctLayer = L.geoJSON(data, {
      style: feature => {
        const precinct = getPrecinctFromFeature(feature);
        const pct = precinctPartyPct(precinct, selectedPartyId);
        return { fillColor: colorForPct(pct, demoMode), fillOpacity: .72, color: '#fff', weight: 1 };
      }
    }).addTo(map);
    map.fitBounds(precinctLayer.getBounds(), { padding: [18, 18] });
    restyleMap();
  } catch (err) {
    console.error(err);
    $('#map-status').textContent = 'Nepodařilo se načíst hranice volebních okrsků. Zkontrolujte /api/geo.';
    showToast('Mapa okrsků se nepodařila načíst.');
  }
}

function firstAttrOrText(node, names) {
  for (const name of names) {
    const attr = node.getAttribute?.(name);
    if (attr != null && attr !== '') return attr;
    const el = node.querySelector?.(name);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return null;
}

function parseNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractBatchNumber(doc) {
  const davka = doc.querySelector('DAVKA');
  const raw = davka ? firstAttrOrText(davka, ['PORADI_DAVKY', 'PORADI']) : null;
  return parseNumber(raw);
}

function partyIdFromNode(node) {
  return parseNumber(firstAttrOrText(node, ['POR_STR_HL', 'KSTRANA', 'CIS_STRANA', 'POR_STR']));
}

function votesFromNode(node) {
  return parseNumber(firstAttrOrText(node, ['POC_HLASU', 'HLASY', 'HLASY_STRANA', 'POCET_HLASU']));
}

function parsePrecinctBatch(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Neplatné XML');
  const batchNumber = extractBatchNumber(doc);
  const precinctNodes = [...doc.querySelectorAll('OKRSEK')];
  let changed = 0;

  for (const node of precinctNodes) {
    const municipalityCode = firstAttrOrText(node, ['CIS_OBEC', 'KOD_OBEC']);
    const councilCode = firstAttrOrText(node, ['KODZASTUP', 'CIS_ZASTUP']);
    const type = String(firstAttrOrText(node, ['OZNAC_TYPU', 'TYP_ZASTUP']) || '').toUpperCase();
    const precinct = normalizePrecinct(firstAttrOrText(node, ['CIS_OKRSEK', 'OKRSEK']));
    if (!precinct) continue;

    // U pražských MČ bývá CIS_OBEC kódem hlavního města (554782), zatímco
    // volené zastupitelstvo má vlastní KODZASTUP (Praha 8 = 500208).
    // Fallback přes oficiální rozsah okrsků 8001–8106 drží parser funkční i v dávce, kde KODZASTUP chybí.
    const precinctNo = Number(precinct);
    const isPraha8 =
      String(councilCode || '') === PRAHA8_CODE ||
      String(municipalityCode || '') === PRAHA8_CODE ||
      (String(municipalityCode || '') === '554782' && type === 'MCMO' && precinctNo >= 8001 && precinctNo <= 8106);
    if (!isPraha8) continue;
    if (type && type !== 'MCMO') continue;
    const processingOrder = parseNumber(firstAttrOrText(node, ['PORADI_ZPRAC', 'PORADI_ZPRACOVANI'])) || 0;

    const existing = liveByPrecinct.get(precinct);
    if (existing && existing.processingOrder > processingOrder) continue;

    const partyVotes = new Map();
    const candidates = [...node.querySelectorAll('HLASY_OKRSEK, STRANA, VOLEBNI_STRANA, HLAS_STRANA')];
    for (const pnode of candidates) {
      const pid = partyIdFromNode(pnode);
      const votes = votesFromNode(pnode);
      if (pid != null && votes != null) partyVotes.set(pid, votes);
    }

    let totalListVotes = parseNumber(firstAttrOrText(node, ['PL_HL_CELK', 'HLASY_CELKEM', 'POC_HLASU_CELKEM']));
    if (totalListVotes == null || totalListVotes <= 0) {
      totalListVotes = [...partyVotes.values()].reduce((a, b) => a + b, 0);
    }
    if (!partyVotes.size || !totalListVotes) continue;

    liveByPrecinct.set(precinct, { processingOrder, totalListVotes, partyVotes });
    changed++;
  }
  recomputeTotals();
  return { batchNumber, changed, precinctCount: precinctNodes.length };
}

function recomputeTotals() {
  const partyVotes = new Map();
  let grandTotal = 0;
  for (const pData of liveByPrecinct.values()) {
    grandTotal += pData.totalListVotes || 0;
    for (const [pid, votes] of pData.partyVotes) {
      partyVotes.set(pid, (partyVotes.get(pid) || 0) + votes);
    }
  }
  liveTotals = new Map();
  for (const p of parties) {
    const votes = partyVotes.get(p.id) || 0;
    liveTotals.set(p.id, { votes, pct: grandTotal ? (votes / grandTotal) * 100 : null });
  }
}

async function fetchXml(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function syncLiveData() {
  if (!isAfterClose() || demoMode) return;
  try {
    const latestText = await fetchXml('/api/batch?n=latest');
    const latestDoc = new DOMParser().parseFromString(latestText, 'application/xml');
    const latest = extractBatchNumber(latestDoc);
    if (latest == null) throw new Error('Nelze určit číslo poslední dávky');

    const missing = [];
    for (let n = 1; n <= latest; n++) if (!processedBatches.has(n)) missing.push(n);
    for (const n of missing) {
      const xml = n === latest ? latestText : await fetchXml(`/api/batch?n=${String(n).padStart(5, '0')}`);
      parsePrecinctBatch(xml);
      processedBatches.add(n);
    }

    updateAfterDataSync();
    const counted = liveByPrecinct.size;
    $('#map-status').innerHTML = `<strong>${counted}</strong> okrsků Prahy 8 má načtený výsledek · poslední dávka ČSÚ ${latest}.`;
  } catch (err) {
    console.warn('Live sync:', err);
    $('#map-status').textContent = 'Čekám na první dostupnou dávku ČSÚ nebo se data právě obnovují.';
  } finally {
    $('#checked-at').textContent = `kontrola ${new Date().toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`;
  }
}

function updateAfterDataSync() {
  renderPartyList();
  updateSelectedParty();
  restyleMap();
}

function updateCountdown() {
  const now = new Date();
  const diff = ELECTION_CLOSE - now;
  if (diff > 0) {
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    $('#countdown').textContent = `${days} d ${hours} h ${mins} min`;
    $('#phase-pill').textContent = 'PŘED VOLBAMI';
  } else {
    $('#countdown-card').style.display = 'none';
    $('#phase-pill').textContent = 'SČÍTÁNÍ';
    $('#header-status').textContent = 'Průběžné výsledky · data se automaticky obnovují.';
  }
}

function enableDemo() {
  demoMode = true;
  $('#demo-ribbon').hidden = false;
  $('#party-list-note').textContent = 'DEMO simulace';
  $('#map-status').innerHTML = '<strong>Demo sčítání.</strong> Hodnoty jsou smyšlené a slouží jen k náhledu vzhledu mapy.';
  renderPartyList();
  updateSelectedParty();
  restyleMap();
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2400);
}

function setupUi() {
  $('#demo-btn').addEventListener('click', enableDemo);
  $('#refresh-btn').addEventListener('click', async () => {
    if (demoMode) {
      demoMode = false;
      $('#demo-ribbon').hidden = true;
      $('#party-list-note').textContent = 'v závorkách KV 2022';
      updateAfterDataSync();
    }
    await syncLiveData();
  });
  $$('.tab').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.tab !== 'overview') {
      showToast('V první verzi je hotový Přehled a mapa. Další záložky můžeme doplnit jako druhý krok.');
      return;
    }
  }));
}

function setupAutoRefresh() {
  let counter = REFRESH_SECONDS;
  $('#refresh-label').textContent = `${counter} s`;
  refreshTimer = setInterval(async () => {
    counter--;
    if (counter <= 0) {
      counter = REFRESH_SECONDS;
      if (isAfterClose() && !demoMode) await syncLiveData();
    }
    $('#refresh-label').textContent = `${counter} s`;
  }, 1000);
}

async function main() {
  renderSeats();
  renderLegend();
  renderPartyList();
  updateSelectedParty();
  updateCountdown();
  setInterval(updateCountdown, 30000);
  setupUi();
  setupAutoRefresh();
  initMap();
  await loadGeometry();
  if (isAfterClose()) await syncLiveData();
  $('#checked-at').textContent = `kontrola ${new Date().toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`;
}

main();
