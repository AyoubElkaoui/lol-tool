# LoL Tool

Zet automatisch de beste runes en item set in de League-client zodra je in champ select je champion kiest, en laat een korte matchup-guide zien. Werkt op Windows en Mac.

## Voor Danny (Mac)
1. Download `LoL Tool-x.y.z.dmg` uit de nieuwste release op GitHub.
2. Open de dmg en sleep **LoL Tool** naar Programma's.
3. Eerste keer: rechtermuisknop op de app → **Open** → **Open** (de app is niet door Apple gesigneerd).
4. Start League of Legends. Laat LoL Tool open staan; in champ select verschijnen runes, items en guide vanzelf en staan ze meteen in je client.

## Voor Windows
Download `LoL Tool Setup x.y.z.exe` uit de release en installeer. Verder hetzelfde.

## Hoe het werkt
- Leest de League-client via de lokale LCU-API (lockfile), niets wordt in de Riot-mappen geschreven.
- Data: lolalytics (runes, items, matchups per tier) + Riot Data Dragon (namen/plaatjes). Patch wordt automatisch bepaald.
- Runes: maakt een page "LoLTool <champ> vs <tegenstander>" en zet hem actief. Eigen pages blijven staan.
- Items: zet een item set "LoLTool …" op je champion (Start / eerste 3 / volledig / situationeel).
- Guide: eigen notities per matchup (`src/guides.json`) + data (winrate, build vs deze tegenstander).

## Instellingen (bovenin)
- **Tier**: welke elo-data (Bronze, Silver, Gold+, Emerald+). Gold+ = beste balans tussen "werkt in lage elo" en genoeg games.
- **Runes**: meest gespeelde page of hoogste winrate.
- Automatisch aan/uit voor runes en items; **Opnieuw** forceert een nieuwe ophaalronde.

## Ontwikkelen
```bash
npm install
npm start                      # app starten
npm run test:data irelia top jax   # data-laag testen zonder client
npm run dist:win               # installer bouwen (op Windows)
```
Mac-installers worden door GitHub Actions gebouwd: tag pushen (`git tag v0.1.0 && git push --tags`) → release met .exe en .dmg.

## Guides aanvullen
`src/guides.json`: per champion-slug `algemeen` (altijd), `fallback` (onbekende tegenstander) en `vs.<tegenstander-slug>` (specifiek). Slugs zijn lowercase zonder spaties (`drmundo`, `wukong`, `ksante`).
