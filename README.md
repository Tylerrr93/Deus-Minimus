# Deus Minimus

> *A god of little consequence.*

A browser-based god-game / long-form simulation. Watch life emerge from primordial soup, evolve into creatures, form tribes, build civilisations, and reach the industrial age — while you wield limited divine influence over their fate.

## Features

- **9 progressive eras** — Primordial → Microbial → Multicellular → Creatures → Tribal → Ancient Civilisation → Iron Age → Medieval → Industrial
- **Procedurally generated world** — Simplex noise heightmap with biomes, resources, and fertility
- **Emergent entity behaviour** — Modular AI pipeline per entity type (proto-cells, organisms, carnivores, tribals, warriors, merchants…)
- **Random & triggered events** — Volcanic eruptions, plagues, trade booms, divine miracles, great wars
- **God powers** — 9 powers gated by era and Favor cost (Smite, Bless Land, Seed Life, Gift of Fire, Apocalypse…)
- **Fully modular** — Adding a new stage, event, power, or entity type requires editing only one file

## Stack

- **TypeScript** + **Vite** — fast builds, type safety, hot reload in dev
- **HTML5 Canvas** — pixel-perfect geometric rendering, no dependencies
- **GitHub Actions** — automatic deploy on push to `main`  

## Local Development

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. **Fork or create** a repo on GitHub
2. In `vite.config.ts`, change `base: '/deus-minimus/'` to `base: '/YOUR-REPO-NAME/'`
3. In GitHub repo settings → **Pages** → set source to **GitHub Actions**
4. Push to `main` — GitHub Actions handles the rest

## Project Structure

```
src/
  config/          # Constants & tunables
  world/           # World generation, tiles, noise
  entities/        # Entity types, genes, behaviour pipeline
  simulation/      # Main orchestrator
  stages/          # Era definitions & stage manager
  events/          # Random/triggered world events
  godpowers/       # Player's divine abilities
  ui/              # Renderer, HUD, input handling
```

## Adding Content

### New Stage
Add an entry to `src/stages/stageDefinitions.ts`.

### New Event
Add an entry to `src/events/eventDefinitions.ts`.

### New God Power
Add an entry to `src/godpowers/godPowerDefinitions.ts`.

### New Entity Type
1. Add the type string to `EntityType` in `src/entities/Entity.ts`
2. Add a behaviour pipeline entry in `src/entities/Behaviours.ts`
3. Add colour/size in `src/ui/Renderer.ts`

### New Mechanic
Add the mechanic string to a stage's `mechanics` array in `stageDefinitions.ts`, then gate behaviours/powers/events with `hasMechanic('your_mechanic')`.

## Controls

| Action | Input |
|---|---|
| Pan | Right-click drag or WASD/Arrow keys |
| Zoom | Scroll wheel |
| Use divine power | Select power → left-click world |
| Pause/Resume | ⏸ button |
| Speed | ⏩ button (1x / 2x / 4x) |
| New world | ↺ button |

## License

MIT
