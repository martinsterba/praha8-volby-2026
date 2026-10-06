const ELECTION_CLOSE = new Date('2026-10-10T14:00:00+02:00');
const PRAHA8_CODE = '500208';
const REFRESH_SECONDS = 60;
const PRECINCT_MIN = 8001;
const PRECINCT_MAX = 8106;

const parties = [
  { id: 1, name: '8žije, Praha sobě a Zelení', short: '8ŽIJE + PS + Zelení', seats2022: 9, color: '#36a35b' },
  { id: 2, name: 'Spojená levice pro Prahu (KSČM - ČSSD)', short: 'Spojená levice', seats2022: 0, color: '#c64049' },
  { id: 3, name: 'PATRIOTI PRO PRAHU 8', short: 'Patrioti', seats2022: 3, color: '#997126' },
  { id: 4, name: 'ODS s podporou KDU-ČSL', short: 'ODS + KDU-ČSL', seats2022: 10, color: '#2f6fba' },
  { id: 5, name: 'Mourek s podporou SEN PRO PRAHU s Václavem Láskou', short: 'Mourek + SEN 21', seats2022: 0, color: '#8b5d3b' },
  { id: 6, name: 'Česká pirátská strana', short: 'Piráti', seats2022: 6, color: '#161616' },
  { id: 7, name: 'STAROSTOVÉ A NEZÁVISLÍ + TOP 09 – Společně pro Prahu 8', short: 'STAN + TOP 09', seats2022: 5, color: '#7150aa' },
  { id: 8, name: 'SPD pro Prahu 8 s podporou Česká párty, PRO a Svobodní', short: 'SPD + partneři', seats2022: 3, color: '#275f9e' },
  { id: 9, name: 'ANO 2011', short: 'ANO', seats2022: 9, color: '#25a2c4' }
];

const historyBallotToCurrent = { 1: 4, 2: 8, 4: 9, 5: 6, 6: 7, 8: 5, 11: 1, 12: 3 };

let selectedPartyId = 6;
let selectedCouncillorParty = 'all';
let mapMode = 'party';
let activeTab = 'overview';

let map = null;
let precinctLayer = null;
let precinctLayerById = new Map();
let geojsonCache = null;
let history = null;
let candidates2026 = [];
let summaryElectedRefs = [];

let liveByPrecinct = new Map();
let liveTotals = new Map();
let liveSeats = new Map();
let processedBatches = new Set();
let summaryState = {
  totalPrecincts: 106,
  processedPrecincts: 0,
  turnout: null,
  countedPct: 0,
  complete: false,
  generatedAt: null
};

const coalitionSelection = new Set([3, 4, 7, 9]);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function partyById(id) {
  return parties.find(p => p.id === Number(id));
}

function formatPct(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatInt(value) {
  return Number(value || 0).toLocaleString('cs-CZ');
}

function normalizePrecinct(value) {
  if (value == null) return '';
  return String(value).trim().replace(/^0+/, '');
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isAfterClose() {
  return new Date() >= ELECTION_CLOSE;
}

function firstAttr(node, names) {
  if (!node) return null;
  for (const name of names) {
    const value = node.getAttribute?.(name);
    if (value != null && value !== '') return value;
  }
  return null;
}

function firstAttrOrText(node, names) {
  if (!node) return null;
  const direct = firstAttr(node, names);
  if (direct != null) return direct;
  for (const name of names) {
    const el = node.querySelector?.(name);
    if (!el) continue;
    const text = el.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function nestedAttr(node, selector, names) {
  const child = node?.querySelector?.(selector);
  return firstAttr(child, names);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2500);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function ensureLeaflet() {
  if (window.L) return window.L;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  if (!window.L) throw new Error('Leaflet se nepodařilo načíst');
  return window.L;
}

function initMap() {
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    minZoom: 11,
    maxZoom: 18
  }).setView([50.116, 14.455], 13);

  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap contributors'
  });

  tiles.on('tileerror', () => {
    $('#map-status').textContent = 'Podkladová mapa se načítá pomaleji, hranice okrsků ale zůstávají funkční.';
  });
  tiles.addTo(map);

  setTimeout(() => map.invalidateSize(), 50);
}

function getPrecinctFromFeature(feature) {
  const props = feature?.properties || {};
  return normalizePrecinct(props.cislo ?? props.CISLO ?? props.cis_okrsek ?? props.CIS_OKRSEK ?? props.kod ?? props.KOD);
}

async function loadGeometry() {
  const loading = $('#map-loading');
  try {
    const data = await fetchJson('/api/geo');
    if (!data?.features?.length) throw new Error('GeoJSON je prázdný');
    geojsonCache = data;

    precinctLayer = L.geoJSON(data, {
      style: feature => styleForPrecinct(getPrecinctFromFeature(feature)),
      onEachFeature: (feature, layer) => {
        const precinct = getPrecinctFromFeature(feature);
        precinctLayerById.set(precinct, layer);
        layer.on('click', () => {
          layer.bindPopup(popupForPrecinct(precinct), { maxWidth: 290 }).openPopup();
        });
      }
    }).addTo(map);

    const bounds = precinctLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [22, 22], maxZoom: 14 });
    setTimeout(() => map.invalidateSize(), 100);
    restyleMap();
    renderPrecinctList();
    updateMapStatus();
    if (loading) loading.remove();
  } catch (error) {
    console.error('Geometry:', error);
    if (loading) loading.textContent = 'Mapu se nepodařilo načíst.';
    $('#map-status').textContent = 'Nepodařilo se načíst hranice volebních okrsků.';
  }
}

async function loadHistory() {
  try {
    history = await fetchJson('/api/history');
    renderAll();
  } catch (error) {
    console.warn('Historie 2022:', error);
    history = null;
    updateMapStatus();
  }
}

async function loadCandidates() {
  try {
    const data = await fetchJson('/api/candidates');
    candidates2026 = Array.isArray(data?.candidates) ? data.candidates : [];
    renderCouncillors();
  } catch (error) {
    console.warn('Kandidáti:', error);
  }
}

function historicalPartyInfo(id) {
  if (!history?.parties) return null;
  return history.parties.find(p => Number(p.currentId) === Number(id)) || null;
}

function historicalPrecinct(precinct) {
  return history?.precincts?.[normalizePrecinct(precinct)] || null;
}

function livePrecinct(precinct) {
  return liveByPrecinct.get(normalizePrecinct(precinct)) || null;
}

function partyPctFromData(data, partyId, source) {
  if (!data) return null;
  const votes = source === '2026'
    ? (data.partyVotes?.get?.(Number(partyId)) || 0)
    : Number(data.currentParties?.[String(partyId)] || 0);
  const total = source === '2026' ? Number(data.totalListVotes || 0) : Number(data.validVotes || 0);
  return total ? votes / total * 100 : null;
}

function winnerFromData(data, source) {
  if (!data) return null;
  if (source === '2022') return Number(data.winnerId || 0) || null;
  let winner = null;
  let max = -1;
  for (const [id, votes] of data.partyVotes || []) {
    if (votes > max) { max = votes; winner = Number(id); }
  }
  return winner;
}

function displayDataForPrecinct(precinct) {
  const live = livePrecinct(precinct);
  if (live) return { source: '2026', data: live };
  const old = historicalPrecinct(precinct);
  if (old) return { source: '2022', data: old };
  return { source: null, data: null };
}

function turnoutForDisplay(item) {
  if (!item?.data) return null;
  if (item.source === '2022') return item.data.turnout ?? null;
  const registered = Number(item.data.registered || 0);
  const envelopes = Number(item.data.envelopes || 0);
  return registered ? envelopes / registered * 100 : null;
}

function colorForPartyPct(pct) {
  if (pct == null) return '#ece9ee';
  if (pct >= 35) return '#2c1450';
  if (pct >= 30) return '#3a1c65';
  if (pct >= 25) return '#4e2b7d';
  if (pct >= 20) return '#664493';
  if (pct >= 15) return '#8267a6';
  if (pct >= 10) return '#a293b7';
  if (pct >= 5) return '#c8bfd1';
  return '#ddd8e2';
}

function colorForTurnout(pct) {
  if (pct == null) return '#ece9ee';
  if (pct >= 60) return '#2c1450';
  if (pct >= 55) return '#49306c';
  if (pct >= 50) return '#675080';
  if (pct >= 45) return '#88759a';
  if (pct >= 40) return '#aa9db4';
  if (pct >= 35) return '#c9c0cf';
  return '#e1dce5';
}

function styleForPrecinct(precinct) {
  const item = displayDataForPrecinct(precinct);
  let fillColor = '#ece9ee';

  if (mapMode === 'party') {
    fillColor = colorForPartyPct(partyPctFromData(item.data, selectedPartyId, item.source));
  } else if (mapMode === 'winner') {
    const winnerId = winnerFromData(item.data, item.source);
    fillColor = partyById(winnerId)?.color || '#ded9e1';
  } else if (mapMode === 'turnout') {
    fillColor = colorForTurnout(turnoutForDisplay(item));
  }

  return {
    fillColor,
    fillOpacity: item.source === '2026' ? 0.86 : item.source === '2022' ? 0.68 : 0.45,
    color: item.source === '2026' ? '#ffffff' : '#f8f7f8',
    weight: item.source === '2026' ? 1.5 : 1,
    opacity: 1
  };
}

function restyleMap() {
  if (!precinctLayer) return;
  precinctLayer.eachLayer(layer => {
    const precinct = getPrecinctFromFeature(layer.feature);
    layer.setStyle(styleForPrecinct(precinct));

    const item = displayDataForPrecinct(precinct);
    const party = partyById(selectedPartyId);
    let value = 'bez dat';
    if (mapMode === 'party') value = `${formatPct(partyPctFromData(item.data, selectedPartyId, item.source))} %`;
    if (mapMode === 'winner') value = partyById(winnerFromData(item.data, item.source))?.short || '—';
    if (mapMode === 'turnout') value = `${formatPct(turnoutForDisplay(item))} %`;

    const label = mapMode === 'party' ? party?.short : mapMode === 'winner' ? 'Vítěz' : 'Účast';
    layer.unbindTooltip().bindTooltip(
      `<div class="precinct-tooltip"><strong>Okrsek ${escapeHtml(precinct)}</strong>${escapeHtml(label)}<div class="value">${escapeHtml(value)}</div><div class="muted">data ${item.source || '—'}</div></div>`,
      { sticky: true }
    );
  });
  renderLegend();
  updateMapStatus();
}

function currentPartyResult(partyId) {
  const live = liveTotals.get(Number(partyId));
  if (summaryState.processedPrecincts > 0 && live?.pct != null) {
    return { pct: live.pct, seats: liveSeats.get(Number(partyId)) || 0, source: '2026' };
  }
  const historical = historicalPartyInfo(partyId);
  if (historical) return { pct: historical.pct, seats: historical.seats ?? partyById(partyId)?.seats2022 ?? 0, source: '2022' };
  return { pct: null, seats: 0, source: '—' };
}

function renderSelectedParty() {
  const p = partyById(selectedPartyId);
  const result = currentPartyResult(selectedPartyId);
  $('#selected-name').textContent = p.name.toLocaleUpperCase('cs-CZ');
  $('#selected-pct').textContent = formatPct(result.pct);
  $('#selected-seats').textContent = result.seats;
  $('#selected-note').textContent = result.source === '2026'
    ? `Průběžný výsledek 2026 · sečteno ${summaryState.processedPrecincts}/${summaryState.totalPrecincts}`
    : result.source === '2022' ? 'Výsledek komunálních voleb 2022' : 'Bez dostupných dat';
  $('#selected-seats-note').innerHTML = result.source === '2026' ? 'průběžně<br>2026' : 'mandátů<br>v 2022';
}

function renderPartyList() {
  const host = $('#party-list');
  if (!host) return;
  host.innerHTML = '';
  let maxPct = 1;
  const values = parties.map(p => ({ p, result: currentPartyResult(p.id) }));
  maxPct = Math.max(25, ...values.map(x => x.result.pct || 0));

  for (const { p, result } of values) {
    const row = document.createElement('div');
    row.className = `party-row${p.id === selectedPartyId ? ' active' : ''}`;
    const sourceSuffix = result.pct == null ? '' : result.source === '2022' ? ' · 2022' : '';
    row.innerHTML = `
      <div class="party-label"><span class="party-dot" style="background:${p.color}"></span><span>${escapeHtml(p.short)}</span></div>
      <div class="party-score">${result.pct == null ? '—' : formatPct(result.pct) + ' %'}${sourceSuffix}</div>
      <div class="party-track"><span style="width:${Math.min(100, ((result.pct || 0) / maxPct) * 100)}%;background:${p.color}"></span></div>`;
    row.addEventListener('click', () => {
      selectedPartyId = p.id;
      mapMode = 'party';
      $$('.legend-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mapMode === 'party'));
      renderSelectedParty();
      renderPartyList();
      renderPrecinctList();
      restyleMap();
    });
    host.appendChild(row);
  }
  $('#party-list-note').textContent = summaryState.processedPrecincts > 0 ? 'průběžné výsledky 2026' : 'výsledky 2022';
}

function renderStats() {
  $('#counted-stat').textContent = `${summaryState.processedPrecincts} / ${summaryState.totalPrecincts || 106}`;
  $('#turnout-stat').textContent = summaryState.processedPrecincts > 0 && summaryState.turnout != null ? `${formatPct(summaryState.turnout)} %` : '—';
  const seatSum = [...liveSeats.values()].reduce((a,b) => a + Number(b || 0), 0);
  $('#seats-stat').textContent = seatSum > 0 ? `${seatSum} / 45` : '0 / 45';
}

function renderLegend() {
  const title = $('#legend-title');
  const grid = $('#legend-grid');
  if (!title || !grid) return;

  if (mapMode === 'party') {
    const p = partyById(selectedPartyId);
    title.textContent = `${p.short.toLocaleUpperCase('cs-CZ')} — PODÍL HLASŮ`;
    const ranges = [
      ['35+ %', '#2c1450'], ['30–35 %', '#3a1c65'], ['25–30 %', '#4e2b7d'],
      ['20–25 %', '#664493'], ['15–20 %', '#8267a6'], ['10–15 %', '#a293b7'],
      ['5–10 %', '#c8bfd1'], ['< 5 %', '#ddd8e2']
    ];
    grid.innerHTML = ranges.map(([label,color]) => `<div class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</div>`).join('');
  } else if (mapMode === 'winner') {
    title.textContent = 'VÍTĚZ V OKRSKU';
    grid.innerHTML = parties.map(p => `<div class="legend-item"><span class="legend-swatch" style="background:${p.color}"></span>${escapeHtml(p.short)}</div>`).join('');
  } else {
    title.textContent = 'VOLEBNÍ ÚČAST';
    const ranges = [
      ['60+ %', '#2c1450'], ['55–60 %', '#49306c'], ['50–55 %', '#675080'],
      ['45–50 %', '#88759a'], ['40–45 %', '#aa9db4'], ['35–40 %', '#c9c0cf'], ['< 35 %', '#e1dce5']
    ];
    grid.innerHTML = ranges.map(([label,color]) => `<div class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</div>`).join('');
  }
}

function updateMapStatus() {
  const status = $('#map-status');
  const ribbon = $('#year-ribbon');
  if (!status || !ribbon) return;

  const liveCount = liveByPrecinct.size;
  if (liveCount === 0) {
    ribbon.textContent = 'MAPA: VOLBY 2022';
    status.innerHTML = history
      ? '<strong>Mapa je aktivní.</strong> Do začátku sčítání zobrazuje okrskové výsledky komunálních voleb 2022.'
      : '<strong>Mapa je aktivní.</strong> Čekám na načtení historických výsledků.';
  } else if (liveCount < (summaryState.totalPrecincts || 106)) {
    ribbon.textContent = `2026: ${liveCount}/${summaryState.totalPrecincts || 106} OKRSKŮ`;
    status.innerHTML = `<strong>${liveCount}</strong> okrsků už zobrazuje rok 2026. U ostatních zůstává pro orientaci výsledek 2022.`;
  } else {
    ribbon.textContent = 'MAPA: VOLBY 2026';
    status.innerHTML = '<strong>Praha 8 je sečtená.</strong> Mapa zobrazuje výsledky komunálních voleb 2026.';
  }
}

function popupForPrecinct(precinct) {
  const item = displayDataForPrecinct(precinct);
  if (!item.data) return `<div class="popup-title">Okrsek ${escapeHtml(precinct)}</div><div class="popup-sub">Bez dostupných dat</div>`;

  const rows = parties.map(p => ({
    p,
    pct: partyPctFromData(item.data, p.id, item.source)
  })).filter(x => x.pct != null).sort((a,b) => b.pct - a.pct).slice(0, 5);

  const turnout = turnoutForDisplay(item);
  return `
    <div class="popup-title">Okrsek ${escapeHtml(precinct)}</div>
    <div class="popup-sub">Výsledky ${item.source} · účast ${formatPct(turnout)} %</div>
    ${rows.map(({p,pct}) => `<div class="popup-row"><span><i class="popup-dot" style="background:${p.color}"></i>${escapeHtml(p.short)}</span><strong>${formatPct(pct)} %</strong></div>`).join('')}
  `;
}

function renderPrecinctList() {
  const host = $('#precinct-list');
  if (!host) return;
  const query = ($('#precinct-search')?.value || '').trim();
  const items = [];

  for (let n = PRECINCT_MIN; n <= PRECINCT_MAX; n++) {
    const precinct = String(n);
    if (query && !precinct.includes(query)) continue;
    const item = displayDataForPrecinct(precinct);
    const winner = partyById(winnerFromData(item.data, item.source));
    const turnout = turnoutForDisplay(item);
    const selectedPct = partyPctFromData(item.data, selectedPartyId, item.source);
    items.push({ precinct, item, winner, turnout, selectedPct });
  }

  host.innerHTML = items.length ? items.map(({precinct,item,winner,turnout,selectedPct}) => `
    <div class="precinct-row" data-precinct="${precinct}">
      <div class="precinct-no">${precinct}</div>
      <div class="precinct-main">
        <strong>${winner ? 'Vítěz: ' + escapeHtml(winner.short) : 'Bez výsledku'} · ${escapeHtml(partyById(selectedPartyId).short)} ${formatPct(selectedPct)} %</strong>
        <span>Účast ${formatPct(turnout)} %</span>
      </div>
      <span class="precinct-source ${item.source === '2026' ? 'live' : ''}">${item.source || '—'}</span>
    </div>
  `).join('') : '<div class="empty-state">Žádný okrsek neodpovídá hledání.</div>';

  host.querySelectorAll('.precinct-row').forEach(row => {
    row.addEventListener('click', () => focusPrecinct(row.dataset.precinct));
  });
}

function focusPrecinct(precinct) {
  const layer = precinctLayerById.get(normalizePrecinct(precinct));
  if (!layer || !map) return;
  const bounds = layer.getBounds?.();
  if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
  layer.bindPopup(popupForPrecinct(precinct), { maxWidth: 290 }).openPopup();
  $$('.precinct-row').forEach(row => row.classList.toggle('active', row.dataset.precinct === String(precinct)));
}

function councillorPartyId(c, source) {
  if (source === '2026') return Number(c.ballot || 0) || null;
  if (c.currentId) return Number(c.currentId);
  return historyBallotToCurrent[Number(c.ballot)] || null;
}

function displayName(c) {
  const before = c.titleBefore ? `${c.titleBefore} ` : '';
  const after = c.titleAfter ? `, ${c.titleAfter}` : '';
  return `${before}${c.firstName || ''} ${c.lastName || ''}${after}`.replace(/\s+/g, ' ').trim();
}

function getElected2026() {
  const byKey = new Map(candidates2026.map(c => [`${Number(c.ballot)}:${Number(c.candidateNo)}`, c]));
  const fromRefs = summaryElectedRefs
    .map(ref => byKey.get(`${Number(ref.ballot)}:${Number(ref.candidateNo)}`))
    .filter(Boolean);
  if (fromRefs.length) return fromRefs;
  return candidates2026.filter(c => c.elected).sort((a,b) => (a.mandateOrder || 999) - (b.mandateOrder || 999));
}

function renderCouncillors() {
  const elected2026 = getElected2026();
  const use2026 = elected2026.length > 0;
  const list = use2026 ? elected2026 : (history?.councillors || []);
  const source = use2026 ? '2026' : '2022';

  $('#councillors-title').textContent = use2026 ? 'Zastupitelstvo 2026' : 'Zastupitelstvo 2022';
  $('#councillors-count').textContent = list.length || '—';
  $('#councillors-help').textContent = use2026
    ? 'Zvolení zastupitelé podle výsledků komunálních voleb 2026.'
    : 'Do přidělení mandátů v roce 2026 zobrazujeme zastupitele zvolené v roce 2022. Po přidělení mandátů se seznam přepne automaticky.';

  const available = [...new Set(list.map(c => councillorPartyId(c, source)).filter(Boolean))];
  if (selectedCouncillorParty !== 'all' && !available.includes(Number(selectedCouncillorParty))) selectedCouncillorParty = 'all';

  const filters = $('#councillor-filters');
  filters.innerHTML = `
    <button class="filter-chip ${selectedCouncillorParty === 'all' ? 'active' : ''}" data-party="all">Všichni</button>
    ${available.map(id => {
      const p = partyById(id);
      return `<button class="filter-chip ${Number(selectedCouncillorParty) === id ? 'active' : ''}" data-party="${id}">${escapeHtml(p?.short || id)}</button>`;
    }).join('')}
  `;
  filters.querySelectorAll('.filter-chip').forEach(btn => btn.addEventListener('click', () => {
    selectedCouncillorParty = btn.dataset.party === 'all' ? 'all' : Number(btn.dataset.party);
    renderCouncillors();
  }));

  const filtered = selectedCouncillorParty === 'all'
    ? list
    : list.filter(c => councillorPartyId(c, source) === Number(selectedCouncillorParty));

  const host = $('#councillors-list');
  if (!filtered.length) {
    host.innerHTML = '<div class="empty-state">Zvolení zastupitelé zatím nejsou k dispozici.</div>';
    return;
  }

  host.innerHTML = filtered.map(c => {
    const pid = councillorPartyId(c, source);
    const p = partyById(pid);
    const meta = [p?.short, c.occupation, c.age ? `${c.age} let` : null].filter(Boolean).join(' · ');
    return `
      <div class="councillor-row">
        <div class="councillor-color" style="background:${p?.color || '#aaa'}"></div>
        <div>
          <div class="councillor-name">${escapeHtml(displayName(c))}</div>
          <div class="councillor-meta">${escapeHtml(meta)}</div>
        </div>
        <div class="councillor-votes">${c.votes ? formatInt(c.votes) + ' hl.' : ''}</div>
      </div>
    `;
  }).join('');
}

function seatsForParty(id) {
  const totalLiveSeats = [...liveSeats.values()].reduce((a,b) => a + Number(b || 0), 0);
  if (totalLiveSeats > 0) return liveSeats.get(Number(id)) || 0;
  return historicalPartyInfo(id)?.seats ?? partyById(id)?.seats2022 ?? 0;
}

function renderCoalition() {
  const totalLiveSeats = [...liveSeats.values()].reduce((a,b) => a + Number(b || 0), 0);
  $('#coalition-help').textContent = totalLiveSeats > 0
    ? 'Kalkulačka používá aktuálně přidělené mandáty z voleb 2026.'
    : 'Před přidělením mandátů v roce 2026 používá kalkulačka mandáty z voleb 2022.';

  const list = $('#coalition-list');
  list.innerHTML = parties.map(p => `
    <label class="coalition-option">
      <input type="checkbox" data-party="${p.id}" ${coalitionSelection.has(p.id) ? 'checked' : ''}>
      <span class="party-dot" style="background:${p.color}"></span>
      <strong>${escapeHtml(p.short)}</strong>
      <span>${seatsForParty(p.id)} mand.</span>
    </label>
  `).join('');

  list.querySelectorAll('input[type=checkbox]').forEach(input => {
    input.addEventListener('change', () => {
      const id = Number(input.dataset.party);
      if (input.checked) coalitionSelection.add(id);
      else coalitionSelection.delete(id);
      renderCoalitionMeter();
    });
  });
  renderCoalitionMeter();
}

function renderCoalitionMeter() {
  const total = [...coalitionSelection].reduce((sum, id) => sum + seatsForParty(id), 0);
  $('#coalition-total').textContent = total;
  const majority = $('#coalition-majority');
  if (total >= 23) {
    majority.textContent = `Většina +${total - 22}`;
    majority.classList.add('ok');
  } else {
    majority.textContent = `Chybí ${23 - total}`;
    majority.classList.remove('ok');
  }

  const strip = $('#coalition-strip');
  strip.innerHTML = '';
  for (let i = 0; i < 45; i++) {
    const seat = document.createElement('span');
    seat.className = `seat${i < total ? ' filled' : ''}`;
    strip.appendChild(seat);
  }
}

function renderAll() {
  renderStats();
  renderSelectedParty();
  renderPartyList();
  renderCouncillors();
  renderCoalition();
  renderPrecinctList();
  restyleMap();
}

function parseSummary(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Neplatné XML souhrnu');

  const root = doc.documentElement;
  const obec = doc.querySelector('OBEC') || root;
  const turnoutNode = doc.querySelector('UCAST');

  const totalPrecincts = parseNumber(firstAttr(turnoutNode, ['OKRSKY_CELKEM'])) ?? 106;
  const processedPrecincts = parseNumber(firstAttr(turnoutNode, ['OKRSKY_ZPRAC'])) ?? 0;
  const turnout = parseNumber(firstAttr(turnoutNode, ['UCAST_PROC']));
  const countedPct = parseNumber(firstAttr(turnoutNode, ['OKRSKY_ZPRAC_PROC'])) ?? 0;
  const complete = String(firstAttr(obec, ['JE_SPOCTENO']) || '0') === '1' || processedPrecincts >= totalPrecincts;

  const totals = new Map();
  const seats = new Map();
  const partyNodes = [...doc.querySelectorAll('VOLEBNI_STRANA')];
  for (const node of partyNodes) {
    const id = parseNumber(firstAttr(node, ['POR_STR_HLAS_LIST', 'POR_STR_HL']));
    if (!id) continue;
    const pct = parseNumber(firstAttr(node, ['HLASY_PROC']));
    const votes = parseNumber(firstAttr(node, ['HLASY'])) || 0;
    const seatCount = parseNumber(firstAttr(node, ['ZASTUPITELE_POCET', 'MANDATY', 'MAND_STR'])) || 0;
    totals.set(id, { pct, votes });
    seats.set(id, seatCount);
  }

  const refs = [];
  const all = [...doc.getElementsByTagName('*')];
  for (const node of all) {
    const candidateNo = parseNumber(firstAttr(node, ['POR_CIS_KAND', 'PORCISLO', 'POR_CISLO']));
    if (!candidateNo) continue;
    let ballot = parseNumber(firstAttr(node, ['POR_STR_HLAS_LIST', 'POR_STR_HL', 'POR_STR']));
    if (!ballot) {
      const parent = node.parentElement;
      ballot = parseNumber(firstAttr(parent, ['POR_STR_HLAS_LIST', 'POR_STR_HL', 'POR_STR']));
    }
    if (!ballot) continue;
    const name = node.tagName?.toUpperCase?.() || '';
    const mandateFlag = String(firstAttr(node, ['MANDAT', 'ZVOLEN']) || '').toUpperCase();
    if (name.includes('ZASTUP') || name.includes('ZVOL') || mandateFlag === 'A' || mandateFlag === '1') {
      refs.push({ ballot, candidateNo });
    }
  }

  liveTotals = totals;
  liveSeats = seats;
  summaryElectedRefs = refs.filter((r, i, arr) => arr.findIndex(x => x.ballot === r.ballot && x.candidateNo === r.candidateNo) === i);
  summaryState = {
    totalPrecincts,
    processedPrecincts,
    turnout,
    countedPct,
    complete,
    generatedAt: firstAttr(root, ['DATUM_CAS_GENEROVANI'])
  };
}

async function syncSummary() {
  try {
    const xml = await fetchText('/api/summary');
    parseSummary(xml);
    renderAll();
    if ((summaryState.complete || summaryElectedRefs.length) && !candidates2026.length) await loadCandidates();
  } catch (error) {
    console.warn('Summary:', error);
  } finally {
    $('#checked-at').textContent = `kontrola ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

function extractBatchNumber(doc) {
  const root = doc.documentElement;
  const candidates = [
    firstAttr(root, ['PORADI_DAVKY', 'DAVKA', 'PORADI']),
    firstAttr(doc.querySelector('DAVKA'), ['PORADI_DAVKY', 'DAVKA', 'PORADI']),
    doc.querySelector('DAVKA')?.textContent?.trim()
  ];
  for (const value of candidates) {
    const n = parseNumber(value);
    if (n != null) return n;
  }
  return null;
}

function parsePrecinctBatch(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Neplatné XML dávky');

  const precinctNodes = [...doc.querySelectorAll('OKRSEK')];
  let changed = 0;

  for (const node of precinctNodes) {
    const municipalityCode = firstAttr(node, ['CIS_OBEC', 'KOD_OBEC']);
    const councilCode = firstAttr(node, ['KODZASTUP', 'CIS_ZASTUP']);
    const type = String(firstAttr(node, ['OZNAC_TYPU', 'TYP_ZASTUP']) || '').toUpperCase();
    const precinct = normalizePrecinct(firstAttr(node, ['CIS_OKRSEK', 'OKRSEK']));
    if (!precinct) continue;

    const precinctNo = Number(precinct);
    const isPraha8 =
      String(councilCode || '') === PRAHA8_CODE ||
      String(municipalityCode || '') === PRAHA8_CODE ||
      (String(municipalityCode || '') === '554782' && type === 'MCMO' && precinctNo >= PRECINCT_MIN && precinctNo <= PRECINCT_MAX);

    if (!isPraha8 || (type && type !== 'MCMO')) continue;

    const processingOrder = parseNumber(firstAttr(node, ['PORADI_ZPRAC', 'PORADI_ZPRACOVANI'])) || 0;
    const existing = liveByPrecinct.get(precinct);
    if (existing && existing.processingOrder > processingOrder) continue;

    const partyVotes = new Map();
    const voteNodes = [...node.querySelectorAll('HLASY_OKRSEK, STRANA, VOLEBNI_STRANA, HLAS_STRANA')];
    for (const voteNode of voteNodes) {
      const id = parseNumber(firstAttr(voteNode, ['POR_STR_HL', 'POR_STR_HLAS_LIST', 'CIS_STRANA', 'POR_STR']));
      const votes = parseNumber(firstAttr(voteNode, ['POC_HLASU', 'HLASY', 'HLASY_STRANA']));
      if (id != null && votes != null) partyVotes.set(id, votes);
    }

    const turnoutNode = node.querySelector('UCAST');
    let totalListVotes = parseNumber(firstAttr(node, ['PL_HL_CELK', 'HLASY_CELKEM', 'POC_HLASU_CELKEM']));
    if (totalListVotes == null) totalListVotes = parseNumber(firstAttr(turnoutNode, ['PL_HL_CELK', 'PLATNE_HLASY']));
    if (!totalListVotes) totalListVotes = [...partyVotes.values()].reduce((a,b) => a + b, 0);
    if (!partyVotes.size || !totalListVotes) continue;

    const registered = parseNumber(firstAttr(node, ['VOL_SEZNAM', 'ZAPSANI_VOLICI']))
      ?? parseNumber(firstAttr(turnoutNode, ['VOL_SEZNAM', 'ZAPSANI_VOLICI'])) ?? 0;
    const envelopes = parseNumber(firstAttr(node, ['VYD_OBALKY']))
      ?? parseNumber(firstAttr(turnoutNode, ['VYD_OBALKY'])) ?? 0;

    liveByPrecinct.set(precinct, {
      processingOrder,
      totalListVotes,
      partyVotes,
      registered,
      envelopes
    });
    changed++;
  }

  return changed;
}

async function syncLiveBatches() {
  if (!isAfterClose()) return;
  try {
    const latestText = await fetchText('/api/batch?n=latest');
    const latestDoc = new DOMParser().parseFromString(latestText, 'application/xml');
    const latest = extractBatchNumber(latestDoc);

    if (latest == null) {
      parsePrecinctBatch(latestText);
      renderAll();
      return;
    }

    const missing = [];
    for (let n = 1; n <= latest; n++) if (!processedBatches.has(n)) missing.push(n);

    const chunkSize = 6;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      const payloads = await Promise.all(chunk.map(async n => ({
        n,
        xml: n === latest ? latestText : await fetchText(`/api/batch?n=${n}`)
      })));
      payloads.sort((a,b) => a.n - b.n).forEach(({n,xml}) => {
        parsePrecinctBatch(xml);
        processedBatches.add(n);
      });
    }
    renderAll();
  } catch (error) {
    console.warn('Live batches:', error);
  }
}

function updateCountdown() {
  const now = new Date();
  const diff = ELECTION_CLOSE - now;
  const card = $('#countdown-card');

  if (diff > 0) {
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    $('#countdown').textContent = `${days} d ${hours} h ${mins} min`;
    $('#phase-pill').textContent = 'PŘED VOLBAMI';
    $('#header-status').textContent = 'Volební místnosti se uzavírají v sobotu 10. 10. ve 14:00.';
    if (card) card.style.display = '';
  } else {
    $('#phase-pill').textContent = summaryState.complete ? 'SEČTENO' : 'SČÍTÁNÍ';
    $('#header-status').textContent = summaryState.complete
      ? 'Výsledky Prahy 8 jsou sečtené.'
      : 'Průběžné výsledky · data se automaticky obnovují.';
    if (card) card.style.display = summaryState.complete ? 'none' : '';
    if (card) {
      $('#countdown').textContent = `${summaryState.processedPrecincts} / ${summaryState.totalPrecincts} okrsků`;
      $('#countdown-note').textContent = 'Data ČSÚ se automaticky obnovují. Nesečtené okrsky v mapě zatím zůstávají v podobě výsledků 2022.';
    }
  }
}

function switchTab(name) {
  activeTab = name;
  $$('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));

  if (name === 'councillors') {
    renderCouncillors();
    if (!candidates2026.length) loadCandidates();
  }
  if (name === 'coalition') renderCoalition();
  if (name === 'precincts') renderPrecinctList();
  setTimeout(() => map?.invalidateSize(), 60);
}

function setupUi() {
  $$('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $$('.legend-tab').forEach(btn => btn.addEventListener('click', () => {
    mapMode = btn.dataset.mapMode;
    $$('.legend-tab').forEach(b => b.classList.toggle('active', b === btn));
    restyleMap();
  }));

  $('#precinct-search').addEventListener('input', renderPrecinctList);

  $('#refresh-btn').addEventListener('click', async () => {
    const label = $('#refresh-label');
    label.textContent = '…';
    await Promise.all([syncSummary(), isAfterClose() ? syncLiveBatches() : Promise.resolve()]);
    label.textContent = `${REFRESH_SECONDS} s`;
    showToast('Data byla obnovena.');
  });
}

function setupAutoRefresh() {
  let counter = REFRESH_SECONDS;
  $('#refresh-label').textContent = `${counter} s`;
  setInterval(async () => {
    counter--;
    if (counter <= 0) {
      counter = REFRESH_SECONDS;
      await syncSummary();
      if (isAfterClose()) await syncLiveBatches();
    }
    $('#refresh-label').textContent = `${counter} s`;
  }, 1000);
}

async function main() {
  setupUi();
  updateCountdown();
  setInterval(updateCountdown, 30000);
  setupAutoRefresh();

  try {
    await ensureLeaflet();
    initMap();
    await loadGeometry();
  } catch (error) {
    console.error('Map init:', error);
    $('#map-loading').textContent = 'Mapový modul se nepodařilo načíst.';
    $('#map-status').textContent = 'Mapový modul se nepodařilo spustit. Zkuste stránku obnovit.';
  }

  await Promise.allSettled([loadHistory(), syncSummary()]);
  renderAll();

  if (isAfterClose()) {
    await syncLiveBatches();
    if (summaryState.complete) await loadCandidates();
  }

  $('#checked-at').textContent = `kontrola ${new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

main();
