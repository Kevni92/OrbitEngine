# Spike #240 – Branch-Status

Task Type: Spike

Stand: 2026-08-25  
Branch: `spike/240-openworlds-lunar-terrain`  
Remote: [Kevni92/OrbitEngine – Spike-Branch](https://github.com/Kevni92/OrbitEngine/tree/spike/240-openworlds-lunar-terrain)  
Spike-Commit: `46796c0` (`spike: integrate OpenWorlds lunar terrain (#240)`)  
Ausgangsbasis: `main` bei `ea26b0e`

## Aktueller Stand

Der Branch enthält den lokalen Proof of Concept für Spike #240. In
`apps/solar-system-demo` wird ausschließlich der Mond im Nahbereich mit dem
OpenWorlds-Fork gerendert. Der normale Renderer bleibt außerhalb des
Nahbereichs aktiv; andere Himmelskörper wurden nicht migriert.

OrbitEngine bleibt autoritativ für Mondposition, Orientierung, Radius,
Simulationszeit und Referenzrahmen. Verwendet wird der Fork
`Kevni92/OpenWorlds` bei Commit
`b1fe8ae33090f6faf5f3cd8b919ce2177c8da1bd` mit Three.js `0.185.1`.

Der PoC besitzt drei feste, manuell umgeschaltete Terrainstufen:

- `coarse`: 27.648 Dreiecke
- `close`: 442.368 Dreiecke
- `near`: 1.228.800 Dreiecke

Beim Hineinzoomen steigen zusätzlich die prozedurale Mikrodetail-Frequenz und
die Mesh-Auflösung. Die OpenWorlds-QuadTree-/Worker-LOD wurde für diesen Spike
nicht als stabiler Main-Thread-Pfad verwendet; die Workarounds und bekannten
Einschränkungen sind im [Spike-Bericht](https://github.com/Kevni92/OrbitEngine/blob/spike/240-openworlds-lunar-terrain/docs/spikes/240-openworlds-lunar-terrain.md)
dokumentiert.

## Validierungsstand

- Typecheck erfolgreich
- Build erfolgreich
- Unit-Suite: `104/104` erfolgreich
- Manuelle Playwright-Prüfung: Moon-Fokus, OpenWorlds-Aktivierung,
  `coarse → close → near` und Rückkehr zum normalen Renderer erfolgreich
- Zwei isoliert wiederholte bestehende Smoke-Fälle erfolgreich (`2/2`)

Die Height-/Farbkarten sind weiterhin repräsentative Spike-Daten und keine
Produktions-Assets. Der Branch ist daher experimentell und nicht als bereits
übernommene Produktionsarchitektur zu verstehen.
