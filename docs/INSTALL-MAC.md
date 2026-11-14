# LoL Tool installeren op een Mac (Apple Silicon / M1-M4)

## 1. Downloaden
1. Ga naar https://github.com/AyoubElkaoui/lol-tool/releases en open de bovenste (nieuwste) release.
2. Klik onder **Assets** op **`LoL Tool-x.y.z-arm64.dmg`**.
   Neem de **arm64**-versie: die is voor Apple-chips (M1, M2, M3, M4). De dmg zonder "arm64" is voor oude Intel-Macs.
   Weet je het niet zeker: Apple-menu  → Over deze Mac → bij "Chip" staat "Apple M…" = arm64.

## 2. Installeren
1. Open de gedownloade dmg (dubbelklik in Downloads).
2. Sleep **LoL Tool** naar de map **Programma's** (Applications).
3. Gooi de dmg daarna uit (eject-knopje in Finder) en verwijder hem uit Downloads.

## 3. Eerste keer openen (app is niet door Apple gesigneerd)
1. Open Programma's en dubbelklik op **LoL Tool**. macOS zegt dat de app niet geopend kan worden: klik **Gereed / OK**.
2. Ga naar **Systeeminstellingen → Privacy en beveiliging**, scroll naar beneden naar **Beveiliging**.
3. Bij "LoL Tool is geblokkeerd" klik **Open toch** (Open Anyway) en bevestig met je wachtwoord / Touch ID.
4. Klik nog een keer **Open**. Daarna start de app voortaan gewoon.

(Op oudere macOS-versies, tot en met 14 Sonoma, kan het ook met rechtermuisklik op de app → **Open** → **Open**.)

### Zegt macOS "LoL Tool is beschadigd en kan niet worden geopend"?
Dat ligt niet aan de download, maar aan het ontbrekende Apple-certificaat. Open **Terminal** (Spotlight: cmd+spatie, typ "Terminal") en plak:
```bash
xattr -cr "/Applications/LoL Tool.app"
```
Start de app opnieuw. Helpt dat niet, plak dan ook nog:
```bash
codesign --force --deep -s - "/Applications/LoL Tool.app"
```

## 4. Instellen (één keer)
1. Klik in LoL Tool rechtsboven op **⚙**.
2. **Profiel**: kies **Danny (jungle: Rengar / Kha'Zix / Nidalee · top: Gangplank / Kled / Aatrox)**.
3. **Data van tier**: kies je eigen elo (Gold en hoger is een goede standaard).
4. Laat "Runes automatisch zetten", "Item sets automatisch zetten" en "Beste ban en pick automatisch hoveren" aan.
   Zet "Summoner spells automatisch zetten" aan als je dat wilt; kies bij **Flash op** D of F.
De instellingen blijven bewaard.

## 5. Gebruiken
1. Start League of Legends; laat LoL Tool openstaan (de volgorde maakt niet uit).
2. In champ select:
   - **Ban-fase**: ban-advies voor jouw pool.
   - **Pick-fase**: de tool hovert de beste champ uit je pool tegen hun team (bij twijfel Rengar). **Locken doe je zelf.**
   - Zodra de vijandelijke jungler bekend is, zet de tool runes **tegen die jungler** en een item set in je client
     (pages/sets heten "LoLTool …"). Andere rune page of build? Klik erop in de tool.
3. Na de game zie je je stats en 1-2 werkpunten.

## Updaten
Staat er bovenin de tool een melding "Nieuwe versie … beschikbaar", klik erop, download de nieuwe **arm64.dmg**
en sleep hem weer naar Programma's (vervangen). Stap 3 kan dan opnieuw nodig zijn.

## Werkt iets niet?
- "Client zoeken…" blijft staan: start League opnieuw terwijl LoL Tool openstaat.
- Geen runes gezet: klik **↻ Opnieuw** bovenin. Je hebt een vrije rune page nodig; de tool vervangt alleen zijn eigen "LoLTool"-page (of, als alles vol is, je oudste page).
- Open onderaan **Log** en stuur een screenshot naar Ayoub.
