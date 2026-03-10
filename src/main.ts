// ============================================================
// MAIN — boots the game and wires the main loop.
// ============================================================

import { Simulation } from './simulation/Simulation';
import { Renderer, Camera } from './ui/Renderer';
import { UIManager } from './ui/UIManager';
import { InputHandler } from './ui/InputHandler';
import { SIM, CANVAS, WORLD } from './config/constants';
import { EntityState } from './entities/Entity';

class Game {
  private sim: Simulation;
  private renderer: Renderer;
  private ui: UIManager;
  private input: InputHandler;
  private camera: Camera;

  private isPaused = false;
  private speed = 1;
  private lastTickTime = 0;
  private accumulator = 0;
  private selectedPowerId: string | null = null;

  private selectedTile: { x: number; y: number } | null = null;
  private selectedEntity: EntityState | null = null;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.width  = CANVAS.WIDTH;
    canvas.height = CANVAS.HEIGHT;

    this.sim = new Simulation();
    this.camera = { x: 100, y: 50, zoom: 1.2 };

    this.renderer = new Renderer(
      canvas,
      this.sim.world,
      this.sim.entities,
      this.sim.stages,
      this.sim.settlements,
    );
    this.ui    = new UIManager();
    this.input = new InputHandler(canvas, this.camera);
    this.input.setEntityManager(this.sim.entities);

    const worldCenterX = (this.sim.world.cols * WORLD.TILE_SIZE) / 2;
    const worldCenterY = (this.sim.world.rows * WORLD.TILE_SIZE) / 2;
    this.input.centerCamera(worldCenterX, worldCenterY);

    this.bindEvents();
    this.bindControls();

    requestAnimationFrame(this.loop.bind(this));
  }

  private bindEvents(): void {
    this.sim.onStageTransition = (_prev, next) => {
      this.ui.pushNotification(`✦ Era of ${next.name} begins`, 'major');
      document.body.style.setProperty('--stage-tint', next.bgTint);
      this.renderer.markTilesDirty();
    };

    this.sim.onEvent = (ev) => {
      this.ui.pushNotification(`◉ ${ev.event.name}: ${ev.message}`, ev.event.severity);
      this.renderer.markTilesDirty();
    };

    this.ui.onPowerSelected = (id) => {
      this.selectedPowerId = id;
      (document.getElementById('game-canvas') as HTMLCanvasElement).style.cursor =
        id ? 'crosshair' : 'default';
    };

    this.input.onEntityClick = (entity) => {
      if (this.selectedPowerId) return;
      if (this.selectedEntity?.id === entity.id) {
        this.selectedEntity = null;
        this.selectedTile = null;
        this.ui.clearInfoPanel();
      } else {
        this.selectedEntity = entity;
        this.selectedTile = null;
        this.ui.updateInfoPanelEntity(entity, this.sim.settlements);
      }
    };

    this.input.onTileClick = (tile) => {
      if (this.selectedPowerId) {
        const result = this.sim.godPowers.execute(
          this.selectedPowerId,
          this.sim.year,
          this.sim.world,
          this.sim.entities,
          this.sim.settlements,
          this.sim.getState() as any,
          tile,
        );
        if (result) {
          this.ui.pushNotification(result, 'minor');
          this.renderer.markTilesDirty();
        }
        this.ui.clearSelectedPower();
        this.selectedPowerId = null;
        (document.getElementById('game-canvas') as HTMLCanvasElement).style.cursor = 'default';
        return;
      }

      if (this.selectedTile?.x === tile.x && this.selectedTile?.y === tile.y) {
        this.selectedTile = null;
        this.ui.clearInfoPanel();
      } else {
        this.selectedTile = tile;
        this.selectedEntity = null;
        const tileData = this.sim.world.getTile(tile.x, tile.y);
        if (tileData) this.ui.updateInfoPanelTile(tileData);
        else this.ui.clearInfoPanel();
      }
    };
  }

  private bindControls(): void {
    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      const btn = document.getElementById('btn-pause')!;
      btn.textContent = this.isPaused ? '▶ Resume' : '⏸ Pause';
    });

    document.getElementById('btn-speed')?.addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      document.getElementById('btn-speed')!.textContent = `⏩ ${this.speed}x`;
    });

    document.getElementById('btn-new-world')?.addEventListener('click', () => {
      if (confirm('Start a new world?')) {
        this.sim = new Simulation(Math.random());
        this.renderer = new Renderer(
          document.getElementById('game-canvas') as HTMLCanvasElement,
          this.sim.world,
          this.sim.entities,
          this.sim.stages,
          this.sim.settlements,
        );
        this.input.setEntityManager(this.sim.entities);
        this.selectedEntity = null;
        this.selectedTile = null;
        this.ui.clearInfoPanel();
        this.bindEvents();
      }
    });
  }

  private loop(timestamp: number): void {
    const dt = Math.min(timestamp - this.lastTickTime, 100);
    this.lastTickTime = timestamp;

    this.input.processKeys(dt);

    if (!this.isPaused) {
      this.accumulator += dt * this.speed;
      const tickMs = SIM.BASE_TICK_MS;
      let ticks = 0;
      while (this.accumulator >= tickMs && ticks++ < 4) {
        this.sim.tick();
        this.accumulator -= tickMs;
      }
    }

    if (this.selectedEntity) {
      let fresh: EntityState | null = null;
      this.sim.entities.forEachAlive(e => {
        if (e.id === this.selectedEntity!.id) fresh = e;
      });
      if (fresh) {
        this.selectedEntity = fresh;
        if (Math.floor(timestamp / 16) % 10 === 0) {
          this.ui.updateInfoPanelEntity(this.selectedEntity, this.sim.settlements);
        }
      } else {
        this.selectedEntity = null;
        this.ui.clearInfoPanel();
      }
    }

    this.renderer.render(this.camera, this.input.hoveredTile, this.selectedTile, this.selectedEntity);

    const state = this.sim.getState();
    const powers = this.sim.godPowers.getAvailablePowers(this.sim.year);
    this.ui.update(state, powers);

    requestAnimationFrame(this.loop.bind(this));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
