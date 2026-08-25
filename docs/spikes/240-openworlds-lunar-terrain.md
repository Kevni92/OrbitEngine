# Spike #240 – OpenWorlds-Mondterrain

Task Type: Spike

Datum: 2026-08-25  
Branch: `spike/240-openworlds-lunar-terrain`  
OpenWorlds-Fork: `Kevni92/OpenWorlds`  
OpenWorlds-Commit: `b1fe8ae33090f6faf5f3cd8b919ce2177c8da1bd` (`Three.js 0.185.1`)

## Ergebnis

Der Proof of Concept funktioniert lokal:

`Sonnensystem → Moon auswählen → Center view on selected → hineinzoomen → OpenWorlds-Mond mit sichtbarem Relief`

Der normale Mond-Renderer bleibt außerhalb des Nahbereichs aktiv. Beim Eintritt wird die normale Mondoberfläche ausgeblendet, um Z-Fighting zu vermeiden; beim Verlassen des hysteretischen Bereichs wird sie wieder sichtbar. Andere Himmelskörper wurden nicht migriert.

## 1. Änderungen in OrbitEngine

- `apps/solar-system-demo/src/rendering/openworlds-moon.ts` bindet `Planet` aus dem OpenWorlds-Fork in eine bestehende Three.js-Scene ein.
- Die bestehende OrbitEngine-Kamera und der bestehende Renderloop bleiben erhalten.
- Position, Quaternion, physischer Radius und Simulationszeit werden pro Presentation-Update aus OrbitEngine an den OpenWorlds-Root weitergegeben.
- Die Kamera wird für `planet.primitive.update(...)` in den lokalen Mondrahmen transformiert.
- Aktivierung erfolgt bei `18 × Radius`, Deaktivierung bei `24 × Radius`.
- Der OpenWorlds-Mond wird auf den vorhandenen OrbitEngine-Radius skaliert. Der PoC schaltet zwischen drei festen Auflösungen um: `48 × 48` Zellen (`27.648` Dreiecke) im groben Nahbereich, `192 × 192` (`442.368` Dreiecke) im Close-LOD und `320 × 320` (`1.228.800` Dreiecke) im Near-LOD.
- `SolarSystemStateSource` fragt die Quaternion über den OrbitEngine-Framegraphen ab und reicht sie bis zur Szene weiter. Falls der Framegraph keinen Wert liefert, wird für den Spike die Identität verwendet.
- Die Sonnenrichtung kommt aus OrbitEngines Moon→Sun-Illuminationsbeitrag und steuert das OpenWorlds-DirectionalLight im lokalen Mondrahmen. Die Mondbeleuchtung bleibt damit an OrbitEngine autoritativ.
- Browser-Diagnostics veröffentlichen Aktivstatus, Mesh-/Dreieckzahl, Auflösungsstufe, Radius und Kameraabstand über `BrowserRenderDiagnostics.moonTerrain` sowie temporär über Canvas-`data-*`-Attribute.

Die Heightmap ist bewusst ein reproduzierbares Spike-Asset: sechs `128 × 128` RGBA-DataTextures (`393.216` Bytes Rohdaten) mit deterministischen Kraterdaten. Der Shader ergänzt isotropes, prozedurales Makro-/Mikrorelief und erhöht dessen Detailfrequenz im Close-/Near-LOD; es wurde keine Produktions-Asset-Pipeline eingeführt.

## 2. Änderungen am OpenWorlds-Fork

Der Fork selbst wurde nicht in OrbitEngine vendored. Er wird per Git-Dependency auf den oben genannten Commit eingebunden und über `patches/@funsoftware__planettech@0.0.8-alpha.0.1.7.patch` reproduzierbar gepatcht.

Der Patch:

- erlaubt, `material` und `useWorkers` über `Planet`/`Primitive`-Parameter zu setzen;
- ergänzt einen synchronen Main-Thread-Geometriepfad für den Demo-PoC, weil der ursprüngliche Worker-/`SharedArrayBuffer`-Pfad eine zusätzliche Cross-Origin-Isolation voraussetzt;
- akzeptiert sowohl `propMethod` als auch den im Fork vorhandenen Schreibfehler `propMehtod`;
- übernimmt beim Main-Thread-Pfad die Mesh-Positionskompensation des Worker-Pfads. Ohne diese Korrektur lagen die sechs Cube-Faces fragmentiert um den Mond.

Die Materialintegration ergänzt den OpenWorlds-Meshes eine Cube-Heightmap, Vertex-Displacement, symmetrische Terrain-Normalableitung und eine kontrastierende Höhe-zu-Albedo-Abbildung. Der Fork wird für diesen Spike mit `useWorkers: false` und `levels: 1` verwendet. Die fork-eigene mehrstufige QuadTree-Lösung wurde im Browser nicht als stabiler Nahbereichspfad verwendet: mit mehreren Ebenen verschwanden die erzeugten Layer im Main-Thread-Pfad. Stattdessen übernimmt der PoC die LOD-Umschaltung pragmatisch zwischen drei vollständigen festen OpenWorlds-Planeten.

## 3. Workarounds und bekannte Probleme

- Die Heightmap und Farbschicht sind repräsentativ und nicht aus echten Lunar-Daten abgeleitet. Für Produktion müssen echte, lizenzierte Mondkarten eingesetzt werden.
- `useWorkers: false` ist nur ein pragmatischer Demo-Workaround. Für Produktion müssen Worker, `SharedArrayBuffer` und die erforderlichen COOP/COEP-Header sauber integriert oder durch eine passende OpenWorlds-API ersetzt werden.
- Die verwendete feste `dimension: 1`-Geometrie mit `resolution: 48`/`192`/`320` beweist sichtbares Relief und drei Zoomstufen, ist aber noch keine belastbare Streaming-Architektur. Die Kamera wird beim Mondfokus bei rund `2.8 × Radius` begrenzt, damit der PoC nicht in die Oberfläche clippt und trotzdem ein deutlicher Nahzoom möglich bleibt.
- Der aktuelle Szenario-Mond verwendet den im Szenario hinterlegten Ephemeris-/Earth-centered-Frame. Der Framegraph liefert damit die verfügbare Rahmenorientierung; eine dedizierte body-fixed Mondrotationsquelle ist für diesen Spike nicht vorhanden und muss für Produktionsintegration geklärt werden.
- Die geschätzten Vertex-Attribute für sechs aktive `48 × 48`-Faces liegen bei rund `450 KiB`, für `192 × 192` bei rund `7,2 MiB` und für `320 × 320` bei rund `19 MiB`; GPU-Treiber-/Shader-/Texture-Overhead wurde nicht separat profiliert.
- Die Terrainfläche bleibt bewusst demo-spezifisch. Es wurde keine allgemeine Terrain-API in `orbit-engine-three` oder im portablen OrbitEngine-Kern gebaut.

## 4. Playwright-/Screenshot-Beobachtungen

Manuelle Playwright-Prüfung gegen den selbst gestarteten Vite-Preview-Server:

- Die normale Sonnensystemansicht lädt mit `Engine ready`, `WebGL ready` und ohne Console-Fehler.
- `Moon` lässt sich im Celestial Browser auswählen und über `Center view on selected` fokussieren.
- Nach dem Fokussieren wurde beobachtet: `engine=three.js r185`, `openworldsMoonActive=true`, `openworldsMoonLod=close`, `visibleMeshCount=6`, `visibleTriangleCount=442368`, Mondradius `0.0011613801666` Scene-Units; Browser-Logs blieben leer.
- Weiteres Hineinzoomen schaltete bei `0.00439175` Scene-Units auf `openworldsMoonLod=near` und `visibleTriangleCount=1228800` um. Beim Herauszoomen wechselte die Demo reproduzierbar zurück auf `close` und anschließend `coarse`; bei `0.03597247` Scene-Units war `openworldsMoonActive=false`. Die Oberfläche blieb zusammenhängend, und die Kamera lief nicht in die Oberfläche.
- Nach Rückkehr zur Sonnenansicht wurde beobachtet: `openworldsMoonActive=false`, `openworldsMoonLod=coarse`, Kameraabstand etwa `122.19` Scene-Units, Browser-Logs leer. Der normale Mond-/Systempfad bleibt damit außerhalb des Nahbereichs unverändert.
- Screenshots wurden nur als Entwicklungs- und Diagnoseausgabe verwendet; es wurden keine dauerhaften Screenshot-Tests oder Screenshot-Dateien angelegt.

## 5. Validierung

Unveränderte bestehende Tests:

- `pnpm --filter orbit-engine-solar-system-demo typecheck` – erfolgreich
- `pnpm --filter orbit-engine-solar-system-demo build` – erfolgreich
- `pnpm --filter orbit-engine-solar-system-demo test:unit` – `104/104` erfolgreich
- vorhandene Playwright-/Smoke-Suite – ein vollständiger Lauf erreichte `19/21`; zwei bestehende Fälle liefen unter der langen seriellen Gesamtauslastung in die 90-Sekunden-Startup-Wartezeit (`bodies.length` bzw. `rendering-status=ready`). Beide Fälle liefen isoliert direkt danach erfolgreich (`2/2`), die manuelle Playwright-Prüfung des korrigierten Spike-Ablaufs war ebenfalls erfolgreich; eine frühere Suite-Runde war `21/21` erfolgreich.

Build-Warnungen sind bestehende Umgebungs-/Bundling-Hinweise: lokales Node `v26.0.0` liegt außerhalb des dokumentierten Bereichs `>=22 <25`, einige Node-Builtins werden für den Browser externalisiert und der Demo-Bundle-Chunk ist größer als `500 kB`.

## 6. Nächste Arbeiten für Produktion

1. Echte, lizenzierte Lunar-Height-/Normaldaten mit definierter Auflösung, Farb-/Höhenkonvention und Asset-Versionierung einführen.
2. OpenWorlds-Worker-/`SharedArrayBuffer`-Betrieb, Header, Fehlerpfade und Ressourcenfreigabe produktionsfähig machen.
3. Cube-Face-Nahtlosigkeit, Normals, T-Junctions und LOD-Übergänge mit gezielten Geometrie-/GPU-Tests validieren.
4. Body-fixed Mondrotation und Referenzrahmenvertrag aus der Architektur-/Orientierungsdokumentation verbindlich anschließen.
5. Streaming, LOD-Budgets, Cache-Limits sowie GPU-/CPU-Framezeit auf Zielhardware messen.
6. Erst danach eine wiederverwendbare Renderer-Schnittstelle außerhalb der Demo erwägen; der Spike selbst trifft diese Architekturentscheidung nicht.
