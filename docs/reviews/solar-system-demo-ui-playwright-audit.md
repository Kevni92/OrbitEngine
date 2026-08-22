# Solar-System Demo UI/UX Playwright Audit

## Audit metadata

- Issue: [#71](https://github.com/Kevni92/OrbitEngine/issues/71)
- Task Type: Spike
- Audited commit: `950f6827d4a3eb2823d5a09367d525bdfa39ced7`
- Browser: Codex in-app Browser, Chromium-backed. The browser capability does not expose the exact Chromium build.
- Playwright: repository package `@playwright/test` `1.62.1`
- Date: 2026-08-22
- Application: `apps/solar-system-demo`, served from the production Vite preview
- Audit server: `pnpm --filter orbit-engine-solar-system-demo exec vite preview --host 127.0.0.1 --port 4175`

The screenshots in `docs/reviews/assets/` use deterministic names based on the viewport and workflow. They are evidence for this audit, not visual regression baselines.

## Question and method

The question was whether the current demo is understandable, reachable, and stable across the issue's required viewports and journeys, with special attention to LOD representations, local-system framing, panel density, and developer-facing controls.

The audit used the real production build in Chromium. Each journey was executed against the visible DOM and WebGL canvas, and the following were recorded where relevant:

- screenshot;
- selected body, focus body, representation and parent representation;
- population/LOD diagnostics;
- panel and browser state;
- console, runtime exception, failed-request, and HTTP error events.

No production behavior was changed during the audit.

## Viewport matrix

| Viewport | Initial result | Relevant measured layout |
| --- | --- | --- |
| 1920×1080 | Loads with Engine ready, WebGL ready, Sun visible | Panel content: 1482 px / 931 px visible; browser 360×654 px |
| 1440×900 | Loads with Engine ready, WebGL ready, Sun visible | Panel content: 1482 px / 751 px visible; browser 360×654 px |
| 1280×720 | Loads without body overflow | Panel content: 1482 px / 571 px visible; browser 360×654 px |
| 1024×768 | Loads without body overflow | Panel content: 1482 px / 619 px visible; browser 360×654 px |
| 390×844 portrait | Loads without body overflow; controls are stacked into two panels | Panel content: 1479 px / 260 px visible; browser begins at y≈395 and is 369×437 px |

Evidence: [1920 initial](assets/ui-audit-1920x1080-initial.png), [1440 initial](assets/ui-audit-1440x900-initial.png), [1280 initial](assets/ui-audit-1280x720-initial.png), [1024 initial](assets/ui-audit-1024x768-initial.png), [390 portrait initial](assets/ui-audit-390x844-portrait-initial.png).

## Journey results

| Journey | Result | Evidence / notes |
| --- | --- | --- |
| Initial load | Pass | Engine and WebGL become ready; 48 committed bodies and 9 reference orbits are reported. The default overview renders the Sun while distant bodies are hidden by LOD. |
| Play/pause and speed | Pass | At 86400× speed, Play advances the simulation and Pause stops it without an error. [After play/pause](assets/ui-audit-1440x900-after-play-pause.png) |
| Valid and invalid local time | Pass | A valid local jump updates the displayed civil time. An out-of-range value shows `Local date/time is outside the supported scenario interval`, then clears after a valid jump. [Invalid range](assets/ui-audit-1440x900-invalid-local-range.png), [recovered](assets/ui-audit-1440x900-error-recovered.png) |
| Exact time | Pass | Valid exact time succeeds; unsafe integer input shows `Seconds and nanoseconds must be safe integers`. [Advanced](assets/ui-audit-1440x900-advanced-open.png), [invalid overflow](assets/ui-audit-1440x900-invalid-exact-overflow.png) |
| View controls | Pass | Grid, orbit, axes, and radius mode are independent and stateful. [Controls](assets/ui-audit-1440x900-controls-default.png), [axes on](assets/ui-audit-1440x900-axes-on.png), [physical radius](assets/ui-audit-1440x900-physical-radius.png) |
| Panel/browser collapse | Pass | Both panels can be collapsed and restored; the canvas remains usable. [Both collapsed](assets/ui-audit-1440x900-panels-collapsed.png) |
| Browser search/clear/zero result | Pass | Search, clear, result count, parent breadcrumb, and zero-result messaging are clear and stable. [Europa search](assets/ui-audit-1440x900-browser-search-europa.png), [zero results](assets/ui-audit-1440x900-browser-zero-results.png) |
| Browser expand/scroll | Pass | Jupiter's child branch expands and the browser scrolls through the catalog. [Expanded moons](assets/ui-audit-1440x900-jupiter-moons-expanded.png), [scrolled](assets/ui-audit-1440x900-browser-scrolled.png) |
| Earth → Moon → Earth | Pass | Selection and focus synchronize; Moon is represented as a local-system sphere and Earth as a marker at the tested instant. [Earth](assets/ui-audit-1440x900-earth-focused.png), [Moon](assets/ui-audit-1440x900-moon-focused.png) |
| Mars → Phobos → Deimos → Mars | Pass | All targets navigate and render a local Mars system. The visible scene contains the parent context, but the local-frame explanation is not prominent. [Phobos](assets/ui-audit-1440x900-phobos-focused.png), [Deimos](assets/ui-audit-1440x900-deimos-focused.png), [Mars](assets/ui-audit-1440x900-mars-focused.png) |
| Jupiter → Europa → Jupiter | Pass | Jupiter and Europa synchronize correctly; Jupiter's moon representations change with focus as intended. [Jupiter](assets/ui-audit-1440x900-jupiter-focused.png), [Europa](assets/ui-audit-1440x900-europa-focused.png), [return](assets/ui-audit-1440x900-jupiter-return-focused.png) |
| Small asteroid | Pass | Hygiea navigates and remains represented as an asteroid marker. [Hygiea](assets/ui-audit-1440x900-hygiea-focused.png) |
| Runtime population | Pass | Adding 100 and 1000 asteroids, selecting a generated body, and removing the generated population all work. At Sun overview scale the generated population is intentionally hidden by LOD. [1000 population](assets/ui-audit-1440x900-runtime-1000.png), [selected generated body](assets/ui-audit-1440x900-runtime-selected.png), [removed](assets/ui-audit-1440x900-runtime-removed-final.png) |
| Accessibility smoke | Pass with limitation | All 44 inspected buttons, inputs, selects, summaries, and role controls had visible text, labels, or placeholders. The repository Playwright smoke covers keyboard selection with Enter and passed. The in-app browser adapter did not provide a reliable full Tab traversal, so global tab-order quality remains an unresolved verification item. |

## Findings

Priority uses P1 for a first-use or core-navigation problem, P2 for a high-value usability improvement, and P3 for polish.

| ID | Priority | Viewport / workflow | Exact reproduction | Observation and impact | Evidence | Recommendation | Implementation area |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | P1 | 390×844 initial load and any lower-panel workflow | Open the demo in portrait orientation and try to reach Selected Body, View, Runtime Population, or Advanced | Only the Time Travel section is visible in the 260 px panel viewport; the browser starts below it. Important controls require deep internal scrolling, while the scene has little usable vertical space. This makes the demo's primary interaction model undiscoverable on a phone-sized viewport. | [Portrait initial](assets/ui-audit-390x844-portrait-initial.png); measured panel content 1479 px / 260 px visible | Add a responsive control mode: compact section navigation, tabs/drawer, or a sticky current-selection summary. Keep the scene and the next actionable control visible without requiring a 1,479 px scroll path. | Demo panel layout and responsive styles |
| UI-002 | P1 | 1440×900 and 1920×1080 initial load | Load the demo without selecting a body or collapsing panels | The first scene reports `Hidden: 47 · Markers: 0 · Spheres: 1` and visually shows only the Sun, surrounded by a large mostly empty grid/orbit field. This is correct under the current LOD policy, but the first-use screen does not explain that the planets are hidden until focus/zoom. A user can reasonably interpret the empty scene as a rendering failure. | [1440 initial](assets/ui-audit-1440x900-initial.png); [1920 initial](assets/ui-audit-1920x1080-initial.png) | Add a short visible overview/LOD explanation or a first-use hint such as “Select a body to enter its local system.” Keep the existing LOD semantics unchanged until a separate implementation task validates a visual alternative. | Demo copy/guide and presentation state |
| UI-003 | P1 | Phobos/Deimos and Europa focus | Search for Phobos, Deimos, or Europa and select the result | The scene correctly switches to a local body frame and keeps the parent context, but the visible panel mainly says “Selected Body” and “View center”. It does not visibly say that the user is looking at a Mars- or Jupiter-centered local system. The parent, frame, and LOD facts are only obvious after reading lower technical diagnostics. This can make a correct local-system result look incomplete or broken. | [Phobos](assets/ui-audit-1440x900-phobos-focused.png); [Europa](assets/ui-audit-1440x900-europa-focused.png); hierarchy state captured as `parent sphere`, local target sphere | Add a compact, user-facing context label/legend: “Local system: Mars” or “Local system: Jupiter”, plus a short marker/sphere explanation. Preserve the engine frame and representation contracts. | Selected-body presentation and scene-context copy |
| UI-004 | P2 | 1440×900 and 1280×720 panel workflows | Scroll from Time Travel to View or Runtime Population | The panel content is roughly twice the visible height at common desktop sizes. Interacting with lower controls moves the user away from the simulation time and selected-body context. On the runtime screenshot, the technical population controls occupy the main panel while the top context is no longer visible. | [1000 population](assets/ui-audit-1440x900-runtime-1000.png); metrics in the viewport matrix | Use clearer section navigation or progressive disclosure, and retain a small sticky summary for simulation time and current selection. Avoid exposing all diagnostics in the primary path. | Demo panel information architecture |
| UI-005 | P2 | Runtime population workflow | Add 1000 asteroids and inspect the visible controls | The main section is titled “Asteroid stress test” and explains “Synthetic initial conditions”. That framing is useful for development but reads as an internal test harness in the consumer-facing demo. It also sits beside the main navigation and time controls rather than behind a clearly marked advanced/debug disclosure. | [Runtime 1000](assets/ui-audit-1440x900-runtime-1000.png) | Rename the primary presentation to “Generated asteroids” and move stress-test terminology, seed, raw diagnostics, and population stress details under Advanced or a clearly labeled developer section. | Runtime population UI |
| UI-006 | P3 | Jupiter focus and overview | Toggle orbits/grid and navigate between Sun, Jupiter, and Europa | The guide lines are technically readable and the selected orbit direction is highlighted, but the scene contains many low-contrast crossing lines and a subtle grid. Without the selected-body context or a legend, it takes effort to distinguish reference orbits from local moon orbits. This is a polish/readability issue, not a correctness failure. | [Jupiter focus](assets/ui-audit-1440x900-jupiter-focused.png); [axes/grid controls](assets/ui-audit-1440x900-axes-on.png) | Add a small legend or stronger selected/local-orbit distinction after the higher-priority context and responsive work. Do not change orbit data or physics as part of this Spike. | Scene-guide presentation |

## Recommendations by priority

### Fix first

- UI-001: introduce a responsive panel interaction model for portrait-sized viewports.
- UI-002: explain the initial LOD overview so a mostly empty scene is not mistaken for a failed render.
- UI-003: expose the active local-system context in the normal selected-body view.

### High-value UX

- UI-004: reduce the effective scroll depth and preserve current selection/time context.
- UI-005: separate consumer-facing generated-population controls from stress-test terminology and raw diagnostics.

### Polish

- UI-006: add a scene-guide legend and improve visual separation of global and local orbit guides.

### Do not change yet

- Do not replace round markers, sphere representations, or the current distance/hierarchy LOD policy based on this audit alone. The tested journeys produced round marker/sphere representations and correct selection/focus synchronization.
- Do not move physics, frame, time, or propagation responsibilities into the demo UI. The recommended changes are presentation-only.
- Do not add a global all-body rendering mode solely to make the initial screenshot denser; first test an explanatory hint or focused entry point.

## Follow-up issue proposals

These are proposals only; no GitHub issues were created automatically.

1. **Implementation — Responsive Solar-System demo controls** (M): implement a portrait-sized control layout with accessible section navigation and a sticky selection/time summary. Acceptance should cover 390×844 and 1024×768.
2. **Implementation — Explain local-system framing and LOD** (S/M): add visible local-system context and a concise legend/hint for hidden, marker, and sphere representations. Acceptance should cover Sun, Mars/Phobos, Jupiter/Europa, and the initial overview.
3. **Implementation — Reframe runtime population controls** (S/M): separate generated-body interaction from stress-test/debug language and progressively disclose seed/raw diagnostics. Acceptance should cover add 100, add 1000, select, and remove.
4. **Implementation — Orbit-guide readability polish** (S): add a minimal legend/contrast refinement after the context work, without changing engine orbit semantics.

No Architecture follow-up is required by the evidence in this Spike. If a future proposal changes the engine's representation contract, frame semantics, or authoritative LOD behavior rather than the demo presentation, it must be routed through the Architecture workflow first.

## Error and performance observations

- No `Runtime.exceptionThrown`, `Log.entryAdded`, or `Network.loadingFailed` events were observed during the audit journeys.
- No HTTP response with status 400 or higher was observed in the captured browser event stream.
- `auditTab.dev.logs({ levels: ["error", "warn", "warning"] })` returned no entries.
- Adding 1000 generated bodies completed and remained interactive during the manual audit. No formal frame-time or memory benchmark was performed; performance acceptance should be part of the follow-up implementation if the UI changes expose more bodies.

## Validation commands

All commands below passed on the audited branch. The workspace emitted the existing Node-engine warning because the environment is Node `v26.0.0` while the package range is `>=22.0.0 <25.0.0`.

```text
pnpm demo:build
pnpm demo:test
pnpm demo:smoke
pnpm test:wasm
pnpm check
```

The smoke test ran the existing Chromium Playwright test against the production preview and passed. The audit itself used the same production preview flow at the five required viewport sizes.

## Limitations and unresolved questions

- This was a Chromium-backed audit only; no Firefox/WebKit or assistive-technology session was run.
- The in-app browser capability did not expose the exact Chromium build and did not provide a reliable full Tab traversal API. Accessible names and the existing Playwright Enter path were verified, but a future implementation should add an explicit tab-order assertion if keyboard order is a release requirement.
- No formal FPS, memory, or screenshot-diff benchmark was collected for the 1000-body population.
- The audit confirms the current LOD/local-frame behavior is internally consistent at the tested states, but product direction is still needed on whether the overview should remain intentionally sparse or present a more explicit educational entry state.

## Spike conclusion

The demo is technically stable across the required journeys and does not show the previously suspected square-marker or missing-context behavior as a runtime correctness failure in this audit. The highest-value work is explanatory and responsive: make the LOD/local-frame state legible and make the control surface usable at portrait and constrained desktop sizes. Those changes can remain in the demo presentation layer and should be implemented as focused follow-up issues rather than as engine or physics changes.
