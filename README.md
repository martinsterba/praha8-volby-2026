# Volby 2026 · Praha 8 — základní mapa výsledků

Statický frontend + tři malé Vercel Functions. Vzhledově vychází z dodaného vzoru, ale je připravený jako samostatný projekt pro Prahu 8.

## Co umí

- mapa volebních okrsků Prahy 8 přes veřejnou vrstvu RÚIAN,
- přepínání politických stran a choropleth podle výsledku v okrsku,
- odpočet do uzavření volebních místností 10. 10. 2026 ve 14:00,
- před volbami bezpečný **DEMO režim** (vždy označený jako simulace),
- po 14:00 automatické načítání průběžných dávek ČSÚ a obnova po 70 s,
- zachování poslední verze výsledku okrsku podle `PORADI_ZPRAC`,
- responzivní desktop/mobilní layout.

## Důležitá poznámka před ostrým nasazením

ČSÚ zveřejňuje ostrá data až po uzavření volebních místností. Parser je proto napsaný tolerantně k několika běžným názvům elementů, ale **v sobotu po zveřejnění první dávky je potřeba udělat krátký smoke test** a případně upravit názvy XML elementů v `app.js`.

Také doporučuji zkontrolovat, že pořadová čísla kandidátních listin 1–9 v poli `parties` odpovídají `POR_STR_HL` v ostrém XML. Celý seznam je schválně na jednom místě v horní části `app.js`, takže oprava zabere pár sekund.

## Lokální spuštění

```bash
npm install
npx vercel dev
```

Pak otevři adresu, kterou Vercel vypíše (obvykle `http://localhost:3000`).

## Nasazení

Projekt je připravený pro Vercel. Stačí importovat repozitář a deploynout. Žádná databáze není potřeba.

Volitelná env proměnná:

- `PRAHA8_KODZASTUP` — výchozí hodnota `500208`.

## Datové zdroje

- ČÚZK / RÚIAN — polygonová geometrie volebních okrsků.
- ČSÚ / volby.gov.cz — průběžné výsledky komunálních voleb 2026.
- OpenStreetMap — podkladová mapa.
