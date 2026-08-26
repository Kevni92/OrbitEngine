# 19 — Celestial Appearance, Atmospheres, and Stellar Lighting

## Status and scope

This document records the browser-demo architecture decided by Architecture issue #90.

It defines application-owned astronomical appearance data and the deterministic rendering contract used by `apps/solar-system-demo` for visible layers, atmospheres, stellar emission, illumination, fallback behavior, and presentation LOD.

This architecture is deliberately outside OrbitEngine's physical registry and portable C++ core. OrbitEngine continues to own authoritative object identity, physical properties required by simulation, propagation state, time, and reference frames. Three.js and all appearance/shader concepts remain consumer-side presentation concerns.

The architecture complements:

- [06 — Solar-System Data](06-solar-system-data.md) for dataset ownership and provenance;
- [13 — Physical Object and State Model](13-physical-object-and-state-model.md) for engine physical-property boundaries;
- [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md) for application/rendering ownership;
- [17 — Adaptive Demo Rendering and Runtime Populations](17-adaptive-demo-rendering-and-runtime-populations.md) for adaptive sizing and representation LOD;
- [18 — Global Solar-System Context Presentation](18-global-solar-system-context-presentation.md) for persistent major-body context.

It does not define aerodynamic atmosphere physics, weather simulation, terrain generation, photorealistic texture production, or scientific spectral radiative transfer.

## Decisions at a glance

- Celestial appearance is an optional application/scenario dataset associated with stable OrbitEngine `ObjectId` values; it is not `PhysicalPropertiesInput`.
- Existing `display.color` becomes an accent/fallback color for UI, markers, orbit guides, and bodies lacking richer appearance data. It is not authoritative sphere color.
- A body has an optional semantic `appearance` record split into visible-layer, atmosphere, stellar-emission, and appearance-provenance concerns.
- The visible layer describes what an observer primarily sees (`solidSurface`, `iceSurface`, or `cloudDeck`) instead of assuming every body exposes a solid surface.
- Composition is represented by normalized semantic component fractions. Composition alone is never claimed to uniquely determine RGB color.
- A small versioned optical library maps stable semantic material/species identifiers to approximate visible optical characteristics. Sourced calibrated reflectance may override composition-derived reflectance when available.
- All color-space math for derived reflectance and illumination is performed in linear RGB; conversion to display sRGB happens only at the renderer output boundary.
- Atmosphere data includes semantic gas composition plus independently sourceable bulk/optical information such as pressure, scale height, optical depth, haze, and cloud layers.
- The default atmosphere renderer is a transparent shell shader with bounded fixed-cost view integration and an analytic light-path optical-depth approximation. It produces view- and light-dependent Rayleigh/Mie-like scattering without global high-cost volumetric raymarching. Presentation-only limb shaping continuously blends disk and exterior gains and fades radiance to zero before the finite shell boundary; this shaping is applied after transport and never changes physical optics or irradiance.
- Stellar emitters provide effective temperature and luminosity. Light chromaticity derives deterministically from a blackbody approximation; irradiance derives from luminosity and authoritative star/body distance using inverse-square falloff.
- `Physical` lighting contains stellar illumination only. `Enhanced` lighting preserves the same stellar solution and adds a bounded presentation-only inspection fill.
- Illumination is computed from authoritative SI-space state. Adaptive sphere radius, atmosphere rim exaggeration, render-space units, and marker size never feed physical irradiance calculations.
- Atmosphere resources exist only for sphere representations. Marker and hidden representations never allocate or update atmosphere shader resources.
- Missing appearance data uses explicit deterministic fallbacks; missing atmosphere data means no atmosphere.
- Appearance provenance is independent from orbital/ephemeris provenance.

## Ownership and dependency boundary

The authoritative dependency direction is:

```text
versioned scenario / imported astronomy metadata
        |
        +--> OrbitEngine registration inputs
        |      identity / simulation physical properties / state
        |
        +--> application-owned appearance metadata
                     |
                     v
             appearance derivation
                     |
             stellar illumination
                     |
                     v
              Three.js rendering
```

Forbidden dependency directions are:

```text
OrbitEngine -> celestial appearance schema
OrbitEngine -> optical material library
OrbitEngine -> Three.js material/shader parameters
OrbitEngine -> inspection-lighting mode
rendered/adaptive radius -> physical irradiance or atmosphere physics
```

If a future feature requires atmosphere data for simulation physics, for example aerodynamic drag, it receives a separate OrbitEngine physical contract with explicitly defined semantics and provenance. Rendering metadata must never silently become force-model input.

## Dataset structure

Each committed or imported celestial body may carry an optional application-side appearance record keyed by the same stable `ObjectId` used by OrbitEngine.

Conceptually the record contains four independent optional sections:

```text
CelestialAppearance
  visibleLayer?
  atmosphere?
  stellarEmission?
  provenance[]
```

No section is inferred solely from `ObjectType`. A `planet` does not automatically receive an Earth-like atmosphere, and a `star` is not assumed to emit light unless the scenario provides the required stellar-emission metadata.

### Display metadata remains separate

Existing catalog display metadata continues to own:

- human-facing accent color;
- marker/orbit-guide fallback color;
- aliases/search metadata;
- default visibility/category metadata.

The existing `display.color` should be renamed or documented as `accentColor` during implementation. Backward-compatible migration may temporarily accept `color`, but sphere material derivation must not treat it as the physical truth when appearance data is available.

## Visible-layer contract

### Layer kind

A visible layer has exactly one kind:

- `solidSurface` — rock/regolith/metal or a mixed solid surface;
- `iceSurface` — optically ice-dominated exposed surface;
- `cloudDeck` — the primary visible layer is atmospheric/cloud material rather than a solid surface.

The kind is descriptive presentation metadata, not a new OrbitEngine `ObjectType`.

Gas and ice giants normally use `cloudDeck`. Venus may also use `cloudDeck` because its opaque cloud system dominates disk appearance even though the body has a solid surface below it.

### Composition

A visible layer contains zero or more semantic components:

```text
component
  materialId: stable optical-library identifier
  fraction: dimensionless [0, 1]
```

For a supplied composition list:

- every fraction must be finite and within `[0, 1]`;
- duplicate material IDs are rejected;
- the list must sum to `1` within absolute tolerance `1e-6`;
- an empty/missing composition is allowed and activates calibrated/fallback behavior rather than fabricated chemistry.

Initial stable material identifiers should cover the committed demo bodies without trying to encode mineralogical detail the sources do not support. Candidate initial families are:

- silicate/regolith;
- basaltic material;
- iron-oxide-rich dust;
- carbonaceous regolith;
- water ice;
- methane/nitrogen ice;
- sulfur/sulfur-dioxide frost;
- tholin/organic-rich material;
- ammonia/water cloud material;
- sulfuric-acid cloud material;
- neutral gas-giant cloud material.

The implementation issue may refine exact identifier spelling, but identifiers are versioned dataset semantics and must not be Three.js class/property names.

### Reflectance and albedo

Visible-layer appearance supports two source paths, in priority order:

1. **calibrated visible reflectance** — preferred where a source provides an observationally useful disk/surface color or reflectance estimate;
2. **composition-derived approximation** — deterministic weighted mixture from the optical library.

The calibrated representation is an approximate linear-RGB reflectance triplet with each component in `[0, 1]`, accompanied by provenance and a declared reference/derivation limitation. It is not called a literal material color.

The layer may also provide `visualAlbedo` as a finite value in `[0, 1]`. When present it controls total diffuse reflectance magnitude; chromaticity comes from calibrated/composition-derived reflectance. When absent, the optical-library/calibrated reflectance magnitude is used directly.

Derivation order is:

```text
calibrated reflectance available
        -> use calibrated linear RGB
otherwise composition available
        -> weighted optical-library reflectance
otherwise
        -> display accent/fallback linear RGB

then, if visualAlbedo exists
        -> preserve chromaticity and normalize luminance to the albedo target
```

The exact luminance coefficients use the renderer's linear-sRGB working space consistently and are unit-tested. Values are clamped only at documented renderer boundaries; invalid source values are rejected rather than silently normalized.

### Why chemistry does not directly equal color

Composition alone cannot uniquely predict visible color because grain size, surface age/weathering, phase angle, oxidation state, crystal structure, aerosols, and wavelength-dependent scattering can dominate. The optical library is therefore an explicit visualization approximation, not a scientific chemistry-to-spectrum solver.

Sourced calibrated reflectance takes precedence when it better represents observed appearance.

## Optical library

The demo owns one small versioned deterministic optical library.

The library maps semantic material and atmospheric-species identifiers to source-independent approximation constants needed by derivation. It is application data/code, not an OrbitEngine subsystem.

For visible-layer materials it supplies at minimum an approximate linear-RGB reflectance vector.

For atmospheric gases it may supply approximate wavelength-band Rayleigh coefficients or relative scattering weights where a defensible approximation exists. Unknown species are permitted in composition metadata but require explicit optical fallback/override before they influence scattering; the renderer must not invent a coefficient from a chemical name.

The library version is recorded in derived diagnostics/tests so changes to approximation constants are intentional visual-model revisions.

## Atmosphere contract

An atmosphere is optional. Absence means that no atmosphere shell is rendered and no atmosphere is inferred.

### Bulk structure

The initial atmosphere model supports:

- `referencePressurePa`: finite and `>= 0`;
- `scaleHeightMeters`: finite and `> 0` when an atmosphere is present;
- `referenceAltitudeMeters`: optional finite and `>= 0`, defaulting to the physical reference radius altitude;
- gas composition;
- optical calibration;
- optional haze/aerosol descriptor;
- zero or more cloud layers.

Pressure and scale height describe sourceable bulk properties. The renderer is not required to derive every optical coefficient from pressure alone.

### Gas composition

Gas components contain:

```text
gasId
mixingRatio
```

Rules:

- ratios are finite and within `[0, 1]`;
- duplicate gas IDs are rejected;
- supplied ratios sum to `1` within absolute tolerance `1e-6`;
- trace species that are intentionally omitted are documented in provenance/limitations rather than compensated with fabricated values.

Initial gas IDs may include N2, O2, CO2, Ar, CH4, H2, He, NH3 and other species needed by the committed fixture.

### Optical calibration

To keep the renderer deterministic without claiming full radiative transfer, every rendered atmosphere resolves to an `AtmosphereOptics` value in linear RGB consisting of:

- Rayleigh scattering coefficient/weight;
- Mie/aerosol scattering coefficient/weight;
- absorption coefficient/weight;
- reference vertical optical depth;
- Mie anisotropy `g` in the safe range `[-0.99, 0.99]`.

These values may be obtained by:

1. explicit sourced/calibrated optical overrides on the atmosphere record; then
2. deterministic gas/aerosol lookup derivation where the optical library has known coefficients; then
3. zero contribution for unsupported optional optical effects, with diagnostics indicating fallback.

The implementation must not infer a colored atmosphere merely because a gas composition exists.

All coefficients/weights are finite and non-negative except the signed anisotropy factor. Vertical optical depth is finite and `>= 0`.

### Haze and aerosols

Haze is represented separately from gas composition because aerosol scattering can dominate disk color.

The descriptor provides:

- a stable semantic aerosol/haze ID when known;
- an optical-depth contribution;
- optional calibrated linear-RGB scattering/absorption override;
- Mie anisotropy override when source/approximation requires it.

This is the primary mechanism for Titan-like haze.

### Cloud layers

Clouds are first-class because Venus and gas giants cannot be represented credibly by gas composition alone.

Each cloud layer contains:

- lower and upper normalized atmosphere altitude or explicit altitude bounds;
- cloud material ID;
- coverage fraction `[0, 1]`;
- optical depth `>= 0`;
- optional calibrated linear-RGB reflectance/albedo;
- provenance/limitations when values are approximated.

Cloud layers in the initial renderer are not dynamic weather. Their aggregate effect influences visible-layer reflectance and atmosphere extinction/scattering parameters. Procedural spatial cloud texture/noise is a later rendering feature and must remain deterministic if introduced.

Cloud layers must be ordered by altitude and may not use invalid/reversed bounds.

## Appearance provenance

Appearance provenance is independent from orbital-state provenance.

Each appearance source record identifies:

- source family/publication/product;
- source URL or stable citation identifier where available;
- retrieval/version date where relevant;
- which appearance fields it supports;
- normalization/derivation performed by the fixture importer/editor;
- limitations/uncertainty.

A single body may therefore cite separate sources for orbit state, atmosphere composition, cloud assumptions, albedo, and stellar parameters.

The dataset must never imply that JPL Horizons state-vector provenance supplied atmosphere chemistry or optical appearance unless that source actually did so.

## Stellar-emission contract

A body that acts as a stellar emitter provides:

- `effectiveTemperatureKelvin`: finite and `> 0`;
- `luminosityWatts`: finite and `>= 0`;
- optional spectral-class metadata for display/validation only;
- appearance provenance.

A zero-luminosity emitter is permitted as deterministic test data but contributes no illumination.

The initial renderer derives visible chromaticity from the effective temperature using one documented deterministic blackbody-to-linear-sRGB approximation. Temperature controls chromaticity only; total illumination magnitude comes from luminosity.

The approximation must be continuous over the supported fixture range. Out-of-supported-range temperatures are rejected by the fixture validator or handled by an explicitly documented clamp; silently switching to arbitrary RGB is forbidden.

The star's rendered surface/glow is presentation-only and separate from its illumination record. Hiding/demoting the star's visual sphere must not disable its illumination.

## Stellar illumination

### Authoritative distance

For a body at simulation instant `T`, stellar irradiance uses the star/body relative position derived from the authoritative same-epoch OrbitEngine state snapshot before adaptive radius or marker/sphere presentation transforms.

For star luminosity `L` and physical center-to-center distance `r`:

```text
E = L / (4 * pi * r^2)
```

where `E` is irradiance in W/m².

The implementation must define a finite near-zero guard for pathological coincident test states and reject/diagnose invalid distances rather than generate infinity/NaN. Physical body geometry may later provide an eclipse/occlusion model; eclipses are not introduced by issue #90 and direct contributions are initially unobstructed.

### Multiple stars

Every configured stellar emitter contributes independently:

```text
body illumination = sum of each emitter's spectral/chromatic irradiance contribution
```

No emitter is chosen as a universal hard-coded "Sun". Binary/multiple systems therefore work through the same contract.

The CPU presentation layer constructs a per-body illumination set containing, for each emitter:

- direction from body to star in authoritative snapshot axes; the renderer adapter applies its explicit presentation-axis transform;
- physical irradiance in W/m²;
- derived linear-RGB chromaticity;
- emitter `ObjectId` for diagnostics.

The renderer-facing result retains all physical contributions and their additive linear-light total. For a bounded single-pass presentation, the semantic resolver deterministically selects at most four contributors by descending physical irradiance, breaking ties by numeric `ObjectId`; the default is configurable. Omitted contributors remain available in the complete contribution list and are reported in truncation diagnostics, so the cap is explicit and never changes physical irradiance or additive totals.

### Exposure and renderer units

W/m² is not passed off as a literal display luminance. The renderer uses one documented exposure/reference mapping from physical irradiance to linear scene radiance/intensity while preserving:

- inverse-square ratios;
- relative luminosity between stars;
- stellar chromaticity;
- additive multi-star contributions.

A useful reference normalization may map the solar constant at 1 AU to a named unit exposure, but the normalization is presentation policy only. Tone mapping/exposure must not feed back into physical irradiance calculations.

The demo's photographic display policy uses one shared `ACESFilmic` renderer tone map for celestial surfaces and atmosphere shells. The active exposure is selected from the focused body's total physical stellar irradiance: `clamp(1361 / irradiance, 0.18, 512)`, with the default exposure of `1` when the focus has no contributing emitter. This is the only exposure multiplier and is applied once at the shared renderer output; it does not alter the stored W/m² value, inverse-square ratios, or Enhanced inspection-fill semantics. Low-albedo texture layers may use a bounded material/layer pre-display radiance calibration to remain readable in a wide scene. That calibration is not per-body exposure and not incident-light or simulation data; cloud-deck maps may use a stronger fixed calibration than solid-surface maps because their source maps are low-contrast disk-albedo records. Diagnostics expose the pre-exposure mapped irradiance, active exposure, and tone-mapping mode.

## Surface lighting model

Resolved non-stellar body spheres use a lit material rather than `MeshBasicMaterial`.

The initial deterministic model is diffuse/Lambert-like reflectance:

```text
surface contribution per star
  = derived linear reflectance
  * max(dot(surfaceNormal, lightDirection), 0)
  * exposureMappedIrradiance
  * stellar chromaticity
```

Contributions add in linear space before tone mapping.

The architecture does not require a speculative PBR roughness/metalness model because the astronomical dataset does not yet provide defensible values for those renderer-specific parameters.

Stars use an emissive visual material and are not lit as ordinary diffuse planets.

## Lighting modes

The UI exposes exactly two canonical lighting modes.

### Physical

`Physical` mode contains only configured stellar illumination.

Rules:

- no artificial ambient or camera fill is applied to non-emissive celestial surfaces in `physical` mode;
- inverse-square stellar irradiance and stellar chromaticity remain visible;
- night sides may be black except for atmosphere scattering and contributions from additional stars;
- exposure/tone mapping is allowed because it is a camera/display operation, not fake incident light.

Texture-backed cloud shells use the same direct stellar direction, chromaticity, and exposure-mapped irradiance contract as their companion surface. Their coverage alpha is preserved, and their night-side visibility falls to zero rather than being rendered as an unlit `MeshBasicMaterial` overlay.

The mode is the reference for physically motivated illumination semantics, not a claim of full photometric realism because BRDFs, eclipses and spectral radiative transfer are simplified.

### Enhanced

`Enhanced` mode is strictly:

```text
Physical result + bounded inspection fill
```

It never replaces the stellar solution.

The initial fill policy is camera-oriented diffuse fill in linear scene space. It has:

- a named default strength of `0.18` relative to the renderer's reference white/key normalization;
- a hard maximum contribution of `0.25` so the stellar terminator/key direction remains readable;
- neutral chromaticity unless a later explicit presentation setting says otherwise;
- no effect on stars' physical irradiance diagnostics.

The selected/focused body receives the fill. The implementation may also apply a weaker bounded fill to other resolved spheres, but it must not turn Enhanced mode into a global replacement for physical lighting. The first Implementation issue should choose one documented consistent scope and test it.

The UI and diagnostics explicitly label the mode as artificial inspection enhancement.

## Atmosphere rendering

### Resource model

A rendered atmosphere is a separate sphere shell sharing the body's center but using its own transparent `ShaderMaterial`-style resource.

It is not implemented as a static translucent color sphere.

The shell uses:

- physical body radius;
- physical atmosphere scale height/extent for model calculations;
- a presentation shell radius/thickness derived separately for screen readability;
- camera/view vector;
- stellar illumination set;
- resolved atmosphere optical coefficients;
- exposure/tone-mapping context.

### Default shader approximation

The default WebGL 2 path uses a bounded fixed-cost single-scattering approximation:

1. intersect the fragment/view ray with the atmosphere shell;
2. integrate density along the visible segment using a fixed small sample count;
3. estimate Rayleigh and Mie source terms from resolved optical coefficients;
4. approximate optical depth toward each light analytically from local altitude, scale height, and light zenith angle instead of nesting a second full raymarch;
5. apply Rayleigh phase and Henyey-Greenstein-like Mie phase functions;
6. accumulate stellar contributions in linear RGB;
7. output premultiplied/transparent scattering and extinction compatible with normal scene depth; final exposure/tone mapping is applied once by the shared renderer output. Where the ray intersects the opaque body, the shell yields to the body disk and remains visible on the projected limb, so dense atmospheres cannot repaint an opaque surface white.

The demo may add a selective atmosphere-only bloom after the normal scene render. It renders only meshes explicitly marked as atmosphere bloom sources into a fixed half-resolution `UnrealBloomPass` and composites the result additively. Body surfaces, cloud layers, orbit guides, axes, grids, and selection indicators are excluded. Airless bodies therefore produce no atmospheric halo, and the bloom is a presentation effect that never changes physical radiance or simulation state.

The initial target is 6–8 fixed view samples per atmosphere fragment. The exact selected value is a presentation constant validated by the shader implementation tests and browser profiling; adaptive/unbounded sample counts are forbidden in the default path.

The current `orbit-engine-three` implementation fixes this cost at 8 view samples and
2 analytic light-path samples for each active stellar contributor. With the default
maximum of four contributors, one atmosphere fragment therefore evaluates at most
64 light-path density samples in addition to its 8 view samples. The light-path
segment is bounded by analytic shell/body intersections and all shader loops are
compile-time bounded. The appearance-regression browser test records the existing
frame-duration diagnostic for overview, focused-Earth, and no-focused-atmosphere
scenarios; these measurements are the quality/performance baseline for the browser
companion rather than a consumer-configurable semantic optics field.

The 2026-08-25 Chromium smoke run at 1280×900 recorded the following existing
frame diagnostics (hardware-dependent sanity measurements, not a cross-machine
performance guarantee): overview with no shell resources `2.04 ms` average /
`8.10 ms` last frame, focused Earth with one shell resource `6.79 ms` average /
`2.40 ms` last frame, and focused Vesta without an atmosphere `5.77 ms` average /
`1.90 ms` last frame.

This produces the required qualitative behavior:

- bright limb/horizon glow from longer optical path length;
- view-dependent scattering;
- star-direction-dependent day/night transition;
- Rayleigh-dominated blue/short-wavelength scattering when coefficients support it;
- Mie/haze-forward-scattering for aerosol-rich atmospheres;
- dense cloud/haze-dominated appearances through optical overrides.

Resolved body optics provide the atmospheric chromaticity. Renderer gains are spectrally neutral, and no universal display-blue tint or fixed cross-channel Rayleigh/Mie multiplier may override the body's calibrated optical inputs.

A future focused-body high-quality raymarching mode may be added only through a separate task. It is not part of the default contract and must not change the underlying atmosphere data model.

### Surface transmission

The surface material may apply atmosphere transmission/extinction to direct stellar light when an atmosphere is present. The implementation should share the same resolved optical model between atmosphere shell and surface attenuation so the two layers do not contradict each other.

Full multiple scattering, ground bounce, wavelength-resolved spectra, refraction and dynamic weather are explicit non-goals.

## Adaptive sizing and representation LOD

The existing document-17 representation state remains authoritative:

- `hidden` — no body or atmosphere primitive;
- `marker` — cheap marker only, no atmosphere resource;
- `sphere` — lit body sphere; atmosphere may be rendered if defined and useful.

### Atmosphere lifecycle

Atmosphere GPU resources are lazy:

- do not create an atmosphere resource for hidden/marker-only objects;
- create or acquire it when a body first requires atmosphere-capable sphere rendering;
- hide/release/cache it according to bounded resource policy when demoted;
- removed runtime objects release their atmosphere resources with their other presentation resources.

Large asteroid marker populations therefore incur no per-object atmosphere cost.

### Projected-size threshold

For a normal unselected sphere, atmosphere scattering is rendered only when the body's presented sphere diameter is at least approximately 12 CSS pixels. The implementation may tune this threshold within `10–16 px` after browser validation, but it must preserve hysteresis to avoid atmosphere flicker.

Selected/focused bodies may force atmosphere rendering whenever they are sphere representations, even below the ordinary threshold.

Below the atmosphere threshold the surface still uses the normal lit material; only the atmosphere shell is omitted.

### Physical vs presentation thickness

Physical atmosphere scale height and any source-defined physical extent remain unchanged.

Adaptive sizing may make a physically correct atmosphere shell too thin to see. The renderer may therefore compute:

```text
presentation atmosphere thickness
  = max(physical projected thickness, minimum readable rim)
```

where the initial readable rim target is approximately `1.5 CSS px` and is capped to at most `8%` of the presented body radius.

This thickness exists only in geometry/presentation. Density integration and optical depth continue to use physical altitude/scale-height ratios mapped onto the shell parameterization. Presentation inflation must not increase physical pressure, scale height, optical depth or irradiance.

## Global-context interaction

Document 18 keeps stars and major planets represented as markers when distant. The marker floor does not force sphere lighting or atmosphere rendering.

A distant Sun may therefore be a marker while still illuminating every relevant body because stellar illumination is derived from scenario emitters and authoritative states, not from whether the star mesh is currently a sphere.

## Fallback behavior

Fallbacks are deterministic and intentionally conservative.

### Missing visible-layer appearance

If no visible-layer data exists:

- convert the display accent color to linear RGB;
- use it as diffuse reflectance with a named neutral fallback albedo;
- flag diagnostics as `fallbackAccent`.

Runtime synthetic asteroids therefore remain renderable without fabricated mineralogy.

### Missing atmosphere

No atmosphere record means no atmosphere shell and no atmospheric attenuation/scattering.

### Partial atmosphere

If semantic atmosphere data exists but an optional optical effect cannot be resolved, that effect contributes zero and diagnostics expose the fallback. The renderer does not invent a blue atmosphere.

If required atmosphere invariants such as scale height are malformed, fixture validation rejects the record rather than producing NaN/undefined shader behavior.

### Missing stellar emission

A star without stellar-emission metadata may still be rendered as a catalog body but contributes no physical scene light. The committed Solar-System fixture must provide emission metadata for the Sun before the new physical-lighting renderer becomes the default.

## Validation and tests

### Dataset validation

Unit tests validate:

- visible-layer component fractions and duplicate IDs;
- gas mixing ratios and duplicate IDs;
- tolerance `1e-6` for normalized fraction sums;
- linear reflectance/albedo bounds;
- finite/non-negative pressure and optical-depth values;
- positive scale height;
- haze anisotropy range;
- cloud coverage/altitude ordering;
- finite non-negative stellar luminosity;
- positive supported stellar effective temperature;
- independent appearance provenance;
- optional/missing appearance sections;
- no implicit atmosphere from object type.

### Derivation tests

Pure deterministic tests cover:

- composition mixing in linear RGB;
- calibrated reflectance precedence;
- optical-library version stability;
- blackbody temperature-to-chromaticity reference cases;
- inverse-square irradiance ratios, including a 2× distance -> 1/4 irradiance check;
- additive two-star illumination;
- SI distance independence from adaptive visual radius;
- physical vs Enhanced fill semantics.

### Rendering tests

Renderer/unit/browser coverage verifies:

- ordinary planet sphere materials respond to light direction rather than remaining unlit;
- stars illuminate while visually represented as markers;
- night side is dark in Physical mode;
- Enhanced mode adds bounded fill without changing stored physical irradiance;
- an atmosphere's bright limb changes with view/light direction;
- atmosphere resources are absent at marker LOD and appear/disappear coherently across sphere LOD with hysteresis;
- presentation atmosphere thickness does not mutate source physical atmosphere values;
- global-context marker invariants from document 18 remain intact.

Pixel-perfect GPU snapshots are not the primary correctness oracle. Tests should prefer numerical shader-input/diagnostic invariants plus a small number of stable Playwright image/visibility checks with explicit tolerance where useful.

## Performance constraints

- No atmosphere mesh/material is allocated per marker-only runtime object.
- Default atmosphere shader sample count is fixed and bounded.
- Atmosphere work is gated by sphere LOD and projected-size threshold.
- CPU illumination construction is proportional to rendered/resolved bodies times configured stellar emitters, not all-pairs object count.
- Stellar emitters are a small explicit scenario subset; ordinary massive bodies are not treated as lights merely because they have mass or `mu`.
- Any future optimization that truncates stellar contributors or introduces lookup textures/precomputation must preserve documented multi-star semantics or be approved as a new architecture decision.

## Alternatives considered

### Put atmosphere/composition in OrbitEngine `PhysicalPropertiesInput`

Rejected. These fields are not currently required by OrbitEngine propagation/frame/encounter physics and would couple a reusable physics library to scenario-content/rendering concerns. A future drag model receives its own explicitly physical atmosphere contract if required.

### Keep one authoritative RGB color per body

Rejected. It cannot react to stellar spectrum, light direction, albedo, atmosphere, or multiple stars and conflates UI accent with optical appearance.

### Derive exact color solely from chemical composition

Rejected. Composition is insufficient to determine observed visible reflectance without grain/cloud/aerosol/phase/spectral information. The architecture uses calibrated reflectance where available and labels optical-library results as approximations.

### Use Three.js material parameters as dataset facts

Rejected. `roughness`, `metalness`, shader uniforms, and similar values are renderer implementation details rather than sourceable astronomical semantics.

### Render atmosphere as one transparent colored shell

Rejected. It cannot create credible limb brightening, star-direction-dependent scattering, haze phase behavior, or day/night transitions.

### Full multi-scattering volumetric raymarching for every body

Rejected as the default. It spends excessive fragment work at Solar-System scale and is unnecessary for the reference demo. A bounded single-scattering approximation provides the desired qualitative result and remains compatible with LOD.

### Replace physical lighting with an always-on ambient light

Rejected. It removes meaningful stellar direction/intensity and prevents the demo from showing physically motivated night sides. Enhanced mode adds fill only on top of the physical solution.

### Let adaptive sphere radius change light distance or atmosphere density

Rejected. Adaptive size is presentation-only and must never feed simulation/illumination semantics.

## Implementation decomposition

Implementation following this decision should be split so coding agents do not need to invent architecture:

1. catalog appearance schema, optical library, committed fixture metadata, validators, and provenance;
2. composition/calibrated-reflectance derivation plus stellar-emission/illumination resolver and lit surface materials;
3. atmosphere shell shader and LOD/resource lifecycle;
4. Physical/Enhanced controls and diagnostics;
5. unit/Playwright visual-regression coverage and representative quality/performance validation.

If browser profiling shows that the specified bounded atmosphere approximation cannot meet acceptable frame time for representative focused/local views, create a focused Spike with measured GPU/browser evidence before changing the shader architecture.

## Acceptance contract

A conforming implementation satisfies all of the following:

1. OrbitEngine public/C++ physical records contain no celestial rendering/composition fields introduced by this architecture;
2. appearance data is optional, versioned, deterministic, offline and associated through stable `ObjectId`;
3. display accent color is fallback/UI metadata, not authoritative body surface color;
4. calibrated reflectance takes precedence over composition-derived approximation;
5. all derived reflectance/illumination accumulation occurs in linear RGB;
6. atmosphere gas composition, haze, clouds and optical calibration are separate enough to represent Earth-, Venus- and Titan-like cases without claiming gas chemistry alone determines color;
7. atmosphere rendering is view- and star-direction-dependent Rayleigh/Mie-like single scattering, not a static translucent shell;
8. stellar chromaticity derives from effective temperature and illumination magnitude from luminosity plus inverse-square physical distance;
9. multiple configured stars contribute additively;
10. Physical mode adds no artificial incident light;
11. Enhanced mode is Physical plus bounded, clearly labeled inspection fill;
12. star illumination is independent from the star's sphere/marker visual representation;
13. adaptive radius and presentation atmosphere thickness cannot alter physical distance, luminosity, pressure, scale height, optical depth or irradiance;
14. atmosphere resources are LOD-gated and do not scale with marker-only runtime populations;
15. missing data follows explicit conservative fallbacks and appearance provenance remains independent from ephemeris provenance.
