# Solar System Scope planet textures

The files in this directory are the 2K equirectangular planet maps from [Solar System Scope](https://www.solarsystemscope.com/textures/).
They are distributed under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/).

The demo packages these files locally so the browser build does not fetch appearance resources at runtime. The registry in
`src/scenario/planet-texture-registry.ts` is the authoritative mapping from stable body IDs to these assets.

| Body | Asset | Role | Source URL | Packaged resolution | Processing |
| --- | --- | --- | --- | --- | --- |
| Mercury | `mercury.jpg` | solid surface | [2K Mercury](https://www.solarsystemscope.com/textures/download/2k_mercury.jpg) | 2048x1024 | downloaded unchanged |
| Venus | `venus-atmosphere.jpg` | visible cloud deck | [2K Venus Atmosphere](https://www.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg) | 2048x1024 | downloaded unchanged |
| Earth | `earth-daymap.jpg` | day surface | [2K Earth Day Map](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) | 2048x1024 | downloaded unchanged |
| Earth | `earth-clouds.jpg` | transparent cloud overlay | [2K Earth Clouds](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg) | 2048x1024 | downloaded unchanged |
| Earth | `earth-nightmap.jpg` | presentation-only night lights | [2K Earth Night Map](https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg) | 2048x1024 | downloaded unchanged |
| Mars | `mars.jpg` | solid surface | [2K Mars](https://www.solarsystemscope.com/textures/download/2k_mars.jpg) | 2048x1024 | downloaded unchanged |
| Jupiter | `jupiter.jpg` | cloud deck | [2K Jupiter](https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg) | 2048x1024 | downloaded unchanged |
| Saturn | `saturn.jpg` | cloud deck | [2K Saturn](https://www.solarsystemscope.com/textures/download/2k_saturn.jpg) | 2048x1024 | downloaded unchanged |
| Uranus | `uranus.jpg` | cloud deck | [2K Uranus](https://www.solarsystemscope.com/textures/download/2k_uranus.jpg) | 2048x1024 | downloaded unchanged |
| Neptune | `neptune.jpg` | cloud deck | [2K Neptune](https://www.solarsystemscope.com/textures/download/2k_neptune.jpg) | 2048x1024 | downloaded unchanged |

No Venus surface asset is included: its SSS atmosphere map is the sole visible planet map. Gas-giant maps are likewise treated as their visible cloud decks, not as invented solid surfaces.

All maps use the SSS equirectangular orientation and stay within the issue budget. The three Earth files total less than 2 MB in this checkout; every individual file is below 1 MB.
