// ============================================================
// MAIN — boots the game and wires the loop
// ============================================================

import { Simulation } from './simulation/Simulation';
import { Renderer, Camera } from './ui/Renderer';
import { UIManager } from './ui/UIManager';
import { InputHandler } from './ui/InputHandler';
import { SIM, CANVAS, WORLD } from './config/constants';
import { EntityState } from './entities/Entity';

class Game {
  private sim:      Simulation;
  private renderer: Renderer;
  private ui:       UIManager;
  private input:    InputHandler;
  private camera:   Camera;

  private isPaused = false;
  private speed    = 1;
  private lastTickTime = 0;
  private accumulator  = 0;

  private selectedTile:   { x: number; y: number } | null = null;
  private selectedEntity: EntityState | null = null;
  private showPartnerLines = false;
  private showFriendLines  = false;
  private showResourcesForced = false;

  constructor() {
    const canvas    = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.width    = CANVAS.WIDTH;
    canvas.height   = CANVAS.HEIGHT;

    this.sim    = new Simulation();
    this.camera = { x: 100, y: 50, zoom: 1.2 };

    this.renderer = new Renderer(
      canvas, this.sim.world, this.sim.entities, this.sim.settlements,
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
    this.sim.onSettlementFounded = (s) => {
      this.ui.pushNotification(`⛺ ${s.name} — a new settlement forms!`, 'moderate');
      this.renderer.markTilesDirty();
    };

    this.sim.onSettlementLevelUp = (s) => {
      const names = ['', 'Campsite', 'Hamlet', 'Village'];
      this.ui.pushNotification(`✦ ${s.name} grows into a ${names[s.level]}!`, 'major');
      this.renderer.markTilesDirty();
    };

    this.ui.onTogglePartnerLines = (v) => { this.showPartnerLines = v; };
    this.ui.onToggleFriendLines  = (v) => { this.showFriendLines  = v; };

    this.input.onEntityClick = (entity) => {
      if (this.selectedEntity?.id === entity.id) {
        this.selectedEntity   = null;
        this.selectedTile     = null;
        this.showPartnerLines = false;
        this.showFriendLines  = false;
        this.ui.clearInfoPanel();
      } else {
        this.selectedEntity = entity;
        this.selectedTile   = null;
        this.ui.updateInfoPanelEntity(entity, this.sim.settlements);
      }
    };

    this.input.onTileClick = (tile) => {
      // Deselect if clicking same tile again
      if (this.selectedTile?.x === tile.x && this.selectedTile?.y === tile.y) {
        this.selectedTile = null;
        this.selectedEntity = null;
        this.ui.clearInfoPanel();
        return;
      }

      this.selectedEntity = null;
      this.selectedTile   = tile;

      const tileData = this.sim.world.getTile(tile.x, tile.y);
      if (!tileData) { this.ui.clearInfoPanel(); return; }

      // Check if this tile is a settlement centre
      const settlement = this.sim.settlements.getAll().find(
        s => s.x === tile.x && s.y === tile.y,
      );
      if (settlement) {
        this.ui.updateInfoPanelSettlement(settlement);
      } else {
        this.ui.updateInfoPanelTile(tileData);
      }
    };
  }

  private bindControls(): void {
    document.getElementById('btn-resources')?.addEventListener('click', () => {
      this.showResourcesForced = !this.showResourcesForced;
      this.renderer.setShowResourcesForced(this.showResourcesForced);
      document.getElementById('btn-resources')!.textContent = 
        this.showResourcesForced ? '🌿 Resources: On' : '🌿 Resources: Off';
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      document.getElementById('btn-pause')!.textContent = this.isPaused ? '▶ Resume' : '⏸ Pause';
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
          this.sim.world, this.sim.entities, this.sim.settlements,
        );
        this.input.setEntityManager(this.sim.entities);
        this.selectedEntity   = null;
        this.selectedTile     = null;
        this.showPartnerLines = false;
        this.showFriendLines  = false;
        this.ui.clearInfoPanel();
        this.bindEvents();
      }
    });
  }

  private loop(timestamp: number): void {
    const dt = Math.min(timestamp - this.lastTickTime, 200);
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

    // Refresh selected entity info.
    // UIManager.updateInfoPanelEntity() internally patches only changed DOM nodes
    // (no full rebuild) so it's safe to call every frame without hover flash.
    if (this.selectedEntity) {
      let fresh: EntityState | null = null;
      this.sim.entities.forEachAlive(e => {
        if (e.id === this.selectedEntity!.id) fresh = e;
      });
      if (fresh) {
        this.selectedEntity = fresh;
        // Throttle to every ~8 frames (~130ms) — still smooth, saves CPU
        if (Math.floor(timestamp / 16) % 8 === 0) {
          this.ui.updateInfoPanelEntity(this.selectedEntity, this.sim.settlements);
        }
      } else {
        // Entity died — clear panel
        this.selectedEntity = null;
        this.ui.clearInfoPanel();
      }
    }

    // Refresh selected settlement info periodically
    if (this.selectedTile && !this.selectedEntity) {
      if (Math.floor(timestamp / 16) % 20 === 0) {
        const tileData = this.sim.world.getTile(this.selectedTile.x, this.selectedTile.y);
        if (tileData) {
          const settlement = this.sim.settlements.getAll().find(
            s => s.x === this.selectedTile!.x && s.y === this.selectedTile!.y,
          );
          if (settlement) {
            this.ui.updateInfoPanelSettlement(settlement);
          }
        }
      }
    }

    this.renderer.render(
      this.camera,
      this.input.hoveredTile,
      this.selectedTile,
      this.selectedEntity,
      this.showPartnerLines,
      this.showFriendLines,
    );

    this.ui.update(this.sim.getState());

    requestAnimationFrame(this.loop.bind(this));
  }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
