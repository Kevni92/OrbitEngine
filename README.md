# OrbitEngine

OrbitEngine is a standalone astronomical simulation engine for physically plausible positioning, orbit propagation, encounter handling, collision-relevant simulation, reference frames, and spacecraft trajectory calculation.

The engine is intentionally decoupled from any game. It does not generate celestial bodies and does not model economy, population, ownership, buildings, or other gameplay concepts. Consumers register abstract objects with stable IDs and physical properties; higher layers map those IDs to domain objects.

## Technology direction

- Public consumer API: TypeScript / npm
- Primary runtime: Node.js
- Performance core: portable C++
- Native backend: Node-API
- Portable backend: WebAssembly via Emscripten
- Both backends should expose equivalent TypeScript behavior

## Documentation

Start with [`docs/README.md`](docs/README.md).

Repository-wide agent and contribution rules are defined in [`AGENTS.md`](AGENTS.md). Cloud-agent execution rules are additionally defined in [`CLOUD.md`](CLOUD.md).
