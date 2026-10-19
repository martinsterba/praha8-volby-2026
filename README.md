# Volby 2026 · interaktivní mapa komunálních voleb

Open-source volební mapa postavená pro komunální volby 2026 v Praze 8. Projekt průběžně načítá oficiální data ČSÚ, vykresluje výsledky po volebních okrscích a funguje jako jednoduchý základ pro podobnou mapu v jiné městské části nebo obci.

Živá ukázka: https://praha8-volby-2026.vercel.app

## Co aplikace umí

- zobrazuje výsledky komunálních voleb po jednotlivých volebních okrscích,
- automaticky načítá průběžná data z ČSÚ a mapu během sčítání aktualizuje,
- po zahájení sčítání zobrazuje pouze aktuální výsledky 2026 — nesečtené okrsky zůstávají prázdné,
- umí režimy **Strana / Vítěz / Účast**,
- zobrazuje detail okrsku včetně výsledků jednotlivých kandidátek,
- ukazuje průběžný počet sečtených okrsků, volební účast a orientační rozdělení mandátů,
- obsahuje přehled stran, sekci zastupitelů, jednoduchou koaliční kalkulačku a seznam okrsků,
- umožňuje přepnout mezi výsledkem voleb do MČ Praha 8 a hlasováním do **Hlavního města Prahy** v okrscích Prahy 8,
- používá geometrii volebních okrsků z RÚIAN a OpenStreetMap jako mapový podklad,
- je responzivní pro desktop i mobil,
- nepotřebuje databázi.

## Jak je projekt postavený

Frontend je záměrně jednoduchý a většina aplikace je v jednom souboru `index.html`. Backend tvoří několik malých Vercel Functions v adresáři `api/`.

Hlavní endpointy:

- `/api/geo` — geometrie volebních okrsků,
- `/api/summary?scope=p8` — souhrnný výsledek městské části,
- `/api/summary?scope=hmp` — souhrnný výsledek hlavního města,
- `/api/batch?n=latest` — poslední dávka okrskových výsledků ČSÚ,
- `/api/candidates` — kandidáti a po přidělení mandátů také zvolení zastupitelé,
- `/api/history` — historická data používaná před zahájením sčítání.

## Použití pro jinou obec nebo městskou část

Projekt vznikl pro Prahu 8, ale většina logiky je obecná. Pro vlastní použití je potřeba upravit hlavně:

1. **Kód zastupitelstva / obce**  
   Praha 8 používá kód `500208`. Pro jinou obec nebo městskou část nahraďte tento identifikátor v API routách a konfiguraci frontendu.

2. **Volební okrsky**  
   Upravte rozsah nebo identifikaci okrsků a dotaz na RÚIAN v `api/geo.js`.

3. **Kandidující strany**  
   Upravte výchozí konfiguraci kandidátek ve frontendu, případně ji nechte plně sestavit z aktuálních dat ČSÚ.

4. **Počet mandátů a většina**  
   Změňte počet členů zastupitelstva a hranici většiny v konfiguraci aplikace.

5. **Texty a branding**  
   Nahraďte „Praha 8“, barvy, nadpisy a případný druhý volební režim podle svého použití.

Pro běžnou obec lze režim **Hlavní město Praha** jednoduše odstranit a ponechat jen jeden typ voleb.

## Chování během voleb

Před začátkem sčítání může aplikace zobrazovat historická data jako orientační vrstvu.

Od okamžiku zahájení sčítání se mapa vynuluje a **nemíchá historické a aktuální výsledky**. Vybarvují se pouze okrsky, pro které už ČSÚ zveřejnil data z aktuálních voleb.

Průběžné souhrnné výsledky a okrskové dávky se načítají odděleně. Díky tomu se může celkový počet sečtených okrsků změnit o něco dříve, než se konkrétní okrsek objeví v detailní dávce pro mapu.

## Lokální spuštění

```bash
npm install
npx vercel dev
```

Potom otevřete adresu, kterou Vercel vypíše, obvykle:

```
http://localhost:3000
```

## Nasazení na Vercel

1. Forkněte nebo naklonujte repozitář.
2. Importujte ho do Vercelu.
3. Není potřeba žádná databáze.
4. Po deployi zkontrolujte dostupnost API endpointů a načtení mapy.

Projekt byl během voleb 2026 provozován přímo na Vercelu.

## Datové zdroje

- **ČSÚ / volby.gov.cz** — průběžné a konečné výsledky voleb,
- **ČÚZK / RÚIAN** — geometrie volebních okrsků,
- **OpenStreetMap** — mapový podklad.

## Poznámka k dalším volbám

Datová struktura ČSÚ se mezi jednotlivými typy a ročníky voleb může změnit. Při použití projektu pro další volby proto doporučuji před ostrým nasazením ověřit:

- adresy aktuálních open-data endpointů ČSÚ,
- názvy XML atributů a elementů,
- identifikátory zastupitelstev,
- číslování kandidátních listin,
- způsob přidělení mandátů pro daný typ voleb.

## Licence a další použití

Projekt je určený i jako základ pro další lokální volební mapy. Pokud si ho chcete upravit pro vlastní obec, městskou část nebo jiný volební projekt, klidně ho forkněte a přizpůsobte.

Pull requesty a praktická vylepšení jsou vítaná.
