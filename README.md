# AGI RUSH — Race to Superintelligence

A browser 3D real-time strategy game. Four AI labs — OpenAI, Anthropic, Google
DeepMind, xAI — race to train a superintelligence on one contested map. You run
one of them; three rival AI opponents run the others, expanding, raiding, and
lobbying in real time.

Plain ES modules + Three.js from a CDN import map. No build step.

## Run it

```bash
cd agi-rush
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, etc.). You need internet on first load
for the Three.js CDN. The rigged soldier model is also fetched from the
three.js CDN for combat agents; if that download fails, the game automatically
falls back to fully procedural articulated characters and keeps working.

## The metaphor is the mechanics

Nothing here is a reskinned gold mine. Each system is built from what labs
actually compete over:

| Real-world stake | In-game system |
|---|---|
| Capital | **Funding** flows passively from investors; the rate scales with Trust and post-launch hype |
| Compute | **FLOPs** stream from datacenters you build; big runs need big clusters |
| Data | Researchers scrape glowing **data clusters** — a contested, slowly regenerating commons. From Gen 3, HQ researchers also distill **synthetic data** |
| Talent | Your units. Researchers at HQ each speed an active training run by 15% |
| Public perception | **Trust** (0–100). Incidents crater it; Safety Initiatives restore it; it multiplies your funding |
| Government favor | A Lobbyist at the central **Capitol** accrues **Favor**. At 60 you can fire a **Regulatory Probe** that freezes a rival's training for 20s |
| The race | Train 5 model generations (Chatbot → Reasoner → Agent → Innovator → AGI), then the **Superintelligence Run** — which also requires a *license to deploy*: Trust ≥ 40 **or** Favor ≥ 60. First to finish wins instantly |
| Corporate conflict | **Cyber Ops Agents** raid rival datacenters to slow their runs; turrets defend. Losing your HQ ends your lab |

Rival AIs have personalities (xAI raids constantly, Anthropic buys safety
early, DeepMind out-builds everyone on compute, OpenAI rushes generations) and
they target whoever leads the race — including you.

## Faction bonuses

- **OpenAI** — Blitzscale: training 25% faster, hype gains doubled
- **Anthropic** — Safety Dividend: cheap safety, +15 trust each, incidents halved, trust floor 40
- **Google DeepMind** — TPU Empire: datacenters −33% cost, +40% output
- **xAI** — Colossus: buildings 40% faster, cheaper and harder-hitting agents

## Controls (trackpad-first)

- Two-finger scroll: pan · pinch: zoom · `WASD`/arrows also pan
- Click: select · drag: box-select · right-click / two-finger tap: command
- Right-click a data cluster = gather, your HQ = research, the Capitol = lobby, an enemy = attack, ground = move
- `F` jump to HQ · `H` in-game guide (pauses the sim) · `Esc` cancel/deselect

## Architecture

```
index.html      HUD DOM + CSS + import map
js/sim.js       pure simulation, fixed 10 Hz timestep, zero DOM/THREE
js/ai.js        rival brains, drive the sim via the same command API you use
js/render.js    Three.js scene, shadows, animated units, effects; read-only over sim
js/controls.js  trackpad camera, selection, contextual commands, placement ghost
js/ui.js        resource ledger, race panel, action buttons, minimap, toasts
js/audio.js     Web Audio synth: full SFX vocabulary + ambient pad that
                intensifies as any lab nears superintelligence
js/main.js      the loop: fixed-step sim, interpolated rendering, event routing
test/           headless Node tests (no browser needed)
```

The simulation is fully decoupled from rendering: `sim.js` and `ai.js` import
nothing from the DOM or Three.js, communicate outward only through a drained
event queue, and the renderer interpolates between sim ticks.

## Verification

This build was developed without browser access, so verification is split:

- `node test/sim-test.mjs` — four AI labs race unattended; asserts economy,
  construction, combat, training and a winner within 25 sim-minutes
  (checked across 6 seeds: ~5/6 games end in an SI win, ~1/6 by elimination,
  in 11–16 minutes)
- `node test/player-flow-test.mjs` — scripts a human-like session through the
  exact command API the UI calls: gather, build, defend, train all gens,
  lobby, probe a rival, launch and win the SI run
- All modules pass `node --check`; local imports/exports and every DOM id
  referenced from JS are cross-checked

What was *not* machine-verified: the visual/audio layer in an actual browser.
If anything renders oddly, the sim underneath is known-good — check the
browser console first, and note the CDN import map at the bottom of
`index.html`.
