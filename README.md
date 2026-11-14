# LoL Tool

Zet automatisch de beste runes en item set in de League-client zodra je in champ select je champion kiest, en laat een korte matchup-guide zien. Werkt op Windows en Mac.

## Voor Danny (Mac)
Uitgebreide stap-voor-stap gids (ook voor "beschadigd"-meldingen): [docs/INSTALL-MAC.md](docs/INSTALL-MAC.md).

1. Download `LoL Tool-x.y.z-arm64.dmg` (Apple M-chip) uit de nieuwste release op GitHub.
2. Open de dmg en sleep **LoL Tool** naar Programma's.
3. Eerste keer: rechtermuisknop op de app → **Open** → **Open** (de app is niet door Apple gesigneerd).
4. Start League of Legends. Laat LoL Tool open staan; in champ select verschijnen runes, items en guide vanzelf en staan ze meteen in je client.

## Voor Windows
Download `LoL Tool Setup x.y.z.exe` uit de release en installeer. Verder hetzelfde.

## Wat de tool doet
- **Ban-fase:** top-5 bans voor jouw pool in jouw lane (waar je pool het slechtst tegen scoort) + wat de tegenstanders hoveren.
- **Pick-fase (hoveren is genoeg):** runes (page "LoLTool …" actief), summoner spells, twee item sets ("standaard" en "vs team"), skill order, matchup-guide met winrate-badge.
- **Danny (jungle):** pool Rengar / Kha'Zix / Nidalee; krijgt hij top, dan Gangplank / Kled / Aatrox. Zodra er tegenstanders bekend zijn scoort de tool elke champ tegen het hele vijandelijke team (de vijandelijke jungler telt dubbel); scheelt het minder dan 1% met de beste, of is er geen data, dan wordt het Rengar.
- **Runes en builds wisselen:** klik op een andere rune page of build; die wordt meteen in de client gezet. Rune-opties: **runes tegen je tegenstander** (uit de lolalytics-matchuppagina; bij Danny tegen de vijandelijke jungler, standaard actief zodra hij bekend is, vanaf 200 games), meest gespeeld, hoogste winrate en u.gg (dubbele weg), plus een "vs dit team"-page (Tenacity bij veel CC, Health bij veel burst).
- **Build tegen je tegenstander:** zodra de tegenstander in jouw lane bekend is (bij Danny de vijandelijke jungler) komt de build uit de lolalytics-matchuppagina: item 1-3 wat tegen hem het meest gekocht wordt, item 4-6 de optie met de beste winrate (gecorrigeerd voor weinig games). Onder 200 games: de algemene build.
- **Tegenstander zelf kiezen:** klopt de geschatte tegenstander niet, klik dan in "Counter picks" of "Hun team" op de juiste champ; runes, items en guide gaan mee. "↺ Automatisch" laat de tool weer zelf kiezen.
- **Automatisch bannen/locken (instelling, standaard uit):** in de laatste 8 seconden van je beurt bant/lockt de tool wat er gehoverd staat; staat er niets, dan de beste ban of pick. Jouw eigen hover gaat altijd voor.
- **Tegenstander in jouw lane:** alle bekende tegenstanders worden tegelijk over de lanes verdeeld op hun lane-percentages, zodat een flex-pick (Sylas, Taliyah) niet zomaar als mid geteld wordt.
- **Build vs dit team:** kijkt naar AD/AP, tanks, healers, assassins en CC, en kiest per dreiging een item dat bij jouw build past (een AP-build krijgt Zhonya's/Banshee's, AD-fighters Death's Dance/Maw, enz.). Per item staat erbij waarom.
- **Counter picks (tot je lockt):** zodra de tegenstander in jouw lane bekend is: jouw pool op winrate tegen hem en de 5 beste champs in die lane. Nog geen tegenstander: de veiligste blind pick uit je pool, met de matchups om voor op te passen. Bezette champs tellen niet mee.
- **Automatisch hoveren (standaard aan):** op jouw ban-beurt hovert de tool de beste ban, in de pick-fase de beste champ uit je pool. Wordt de tegenstander bekend of verandert hij, dan schakelt de tool om en gaan runes en items mee. Klikken op een pick of ban in de tool hovert die ook. Een eigen keuze wordt nooit overschreven; locken doet de tool alleen als je automatisch locken aanzet.
- **Jouw record:** winst/verlies per champion uit je eigen recente games, bij de picks en bovenin.
- **Data-status:** bovenin staat van welke patch en tier de data is. De tool pakt de nieuwste patch zodra daar genoeg games op staan, ook als de app open blijft staan.
- **Update-melding:** staat er een nieuwe versie op GitHub, dan verschijnt bovenin een downloadlink.
- **Hun team:** AD/AP/tank/healer-telling, boots-keuze met reden, defensief item als het nodig is, anti-heal-advies. Werkt live bij als tegenstanders bijkomen.
- **Na de game:** KDA, CS/min, vision en 1-2 concrete werkpunten.
- **Instellingen:** profiel (Ayoub mid: Galio, Ekko, Sylas / Danny jungle: Rengar, Kha'Zix, Nidalee · top: Gangplank, Kled, Aatrox), tier, rune-keuze, auto runes/items/spells, automatisch bannen/locken, ready check auto-accepteren, venster altijd bovenaan.

## Hoe het werkt
- Leest de League-client via de lokale LCU-API (lockfile), niets wordt in de Riot-mappen geschreven.
- Data: lolalytics (runes, items, matchups per tier), u.gg (spells, skill order, startitems, 4e-6e item) + Riot Data Dragon (namen/plaatjes). Patch wordt automatisch bepaald.
- Runes: maakt een page "LoLTool <champ> vs <tegenstander>" en zet hem actief. Eigen pages blijven staan.
- Items: zet een item set "LoLTool …" op je champion (Start / eerste 3 / volledig / situationeel).
- Guide: eigen notities per matchup (`src/guides.json`) + data (winrate, build vs deze tegenstander).

## Instellingen (bovenin)
- **Tier**: welke elo-data (Bronze, Silver, Gold+, Emerald+). Gold+ = beste balans tussen "werkt in lage elo" en genoeg games.
- **Runes**: meest gespeelde page of hoogste winrate.
- **Flash op**: D of F. Bepaalt de volgorde waarin spells in de client worden gezet (de schakelaar "Summoner spells automatisch zetten" moet aan staan).
- Automatisch aan/uit voor runes en items; **Opnieuw** forceert een nieuwe ophaalronde.

## Ontwikkelen
```bash
npm install
npm start                      # app starten
npm run test:data irelia top jax   # data-laag testen zonder client
node scripts/test-picks.mjs top silver irelia,teemo,jax jax,leesin,zed,jinx,leona   # counter picks; zonder vijf-lijst blind pick
npm run dist:win               # installer bouwen (op Windows)
```
Mac-installers worden door GitHub Actions gebouwd: tag pushen (`git tag v0.1.0 && git push --tags`) → release met .exe en .dmg.

## Mock-modus (ontwerpen zonder League)
`python -m http.server 5178 --directory src/renderer` en open `http://localhost:5178/index.html?mock=1` (pick), `?mock=ban` (ban-fase + vorige game), `?mock=counter`, `?mock=blind` of `?mock=idle`. Voeg `&update=1` toe voor de update-melding.

## Guides aanvullen
`src/guides.json`: per champion-slug `algemeen` (altijd), `fallback` (onbekende tegenstander) en `vs.<tegenstander-slug>` (specifiek). Slugs zijn lowercase zonder spaties (`drmundo`, `wukong`, `ksante`).
