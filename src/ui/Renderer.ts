// ============================================================
// RENDERER — high-performance Canvas 2D renderer.
//
// PERFORMANCE STRATEGY:
//   1. OffscreenCanvas tile layer: world tiles are only re-painted
//      when the world changes (tilesDirty flag). Otherwise the
//      cached bitmap is blitted onto screen in one drawImage call.
//   2. Batched entity rendering: entities are grouped by type.
//      fillStyle is set ONCE per group, and all entities of that
//      type are drawn in sequence — minimising GPU state changes.
//   3. Zero per-entity save/restore: global state is managed
//      for the whole frame, not per entity.
//   4. Viewport culling: entities outside the visible area are
//      skipped before any draw work begins.
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { EntityState, EntityType } from '../entities/Entity';
import { TILE_COLORS } from '../world/Tile';
import { CANVAS, WORLD } from '../config/constants';
import { StageManager } from '../stages/StageManager';
import { SettlementManager } from '../entities/SettlementManager';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const ENTITY_COLORS: Record<EntityType, string> = {
  hunter_gatherer: '#ffcc44',
  villager:        '#88dd66',
  farmer:          '#44cc88',
  craftsman:       '#cc8844',
  warrior:         '#ff4444',
  merchant:        '#aa88ff',
  scholar:         '#44ddff',
  noble:           '#ffaa22',
};

// Visual size of each entity type in world-tile pixels
const ENTITY_BASE_SIZE: Record<EntityType, number> = {
  hunter_gatherer: 2.0,
  villager:        2.5,
  farmer:          2.2,
  craftsman:       2.5,
  warrior:         3.0,
  merchant:        2.5,
  scholar:         2.5,
  noble:           3.5,
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  // OffscreenCanvas caches the tile layer. Replumbing every tile
  // every frame (150×100 = 15,000 fillRect calls) is expensive.
  // With caching, it's one drawImage call instead.
  private tileCanvas: OffscreenCanvas;
  private tileCtx: OffscreenCanvasRenderingContext2D;
  private tilesDirty = true;

  private frameCount = 0;
  private animOffset = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly em: EntityManager,
    private readonly stages: StageManager,
    private readonly settlements: SettlementManager,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.tileCanvas = new OffscreenCanvas(
      world.cols * world.tileSize,
      world.rows * world.tileSize,
    );
    this.tileCtx = this.tileCanvas.getContext('2d', { alpha: false })!;
  }

  markTilesDirty(): void { this.tilesDirty = true; }

  render(camera: Camera, highlightTile: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    this.frameCount++;
    // Use a slow sine for ambient pulsing — cheap to compute once per frame
    this.animOffset = (this.frameCount * 0.04) % (Math.PI * 2);

    ctx.fillStyle = CANVAS.BG_COLOR;
    ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    this.renderTileLayer(ctx, camera);
    this.renderGrid(ctx, camera);
    this.renderEntities(ctx, camera);
    this.renderSettlementLabels(ctx, camera);
    this.renderHighlight(ctx, highlightTile);

    ctx.restore();
  }

  // ── Tile layer ────────────────────────────────────────────

  private renderTileLayer(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.tilesDirty) {
      this.rebuildTileCache();
      this.tilesDirty = false;
    }
    // Blit the cached tile bitmap onto the screen — one draw call
    ctx.drawImage(this.tileCanvas, 0, 0);
  }

  // ── Grid overlay ───────────────────────────────────────────

  private renderGrid(ctx: CanvasRenderingContext2D, camera: Camera): void {
    // Only show grid when zoomed in enough
    if (camera.zoom < 0.8) return;

    const ts = WORLD.TILE_SIZE;
    const invZoom = 1 / camera.zoom;
    
    // Calculate visible viewport in world coordinates
    const vLeft   = -camera.x * invZoom;
    const vTop    = -camera.y * invZoom;
    const vRight  = vLeft + CANVAS.WIDTH * invZoom;
    const vBottom = vTop  + CANVAS.HEIGHT * invZoom;

    // Calculate which grid lines are visible
    const startX = Math.max(0, Math.floor(vLeft / ts));
    const startY = Math.max(0, Math.floor(vTop / ts));
    const endX = Math.min(this.world.cols, Math.ceil(vRight / ts) + 1);
    const endY = Math.min(this.world.rows, Math.ceil(vBottom / ts) + 1);

    // Grid line opacity based on zoom
    const gridAlpha = Math.min(0.3, (camera.zoom - 0.8) * 0.5);
    ctx.strokeStyle = `rgba(255, 255, 255, ${gridAlpha})`;
    ctx.lineWidth = 0.15;

    ctx.beginPath();
    
    // Vertical lines
    for (let x = startX; x <= endX; x++) {
      ctx.moveTo(x * ts, startY * ts);
      ctx.lineTo(x * ts, endY * ts);
    }
    
    // Horizontal lines
    for (let y = startY; y <= endY; y++) {
      ctx.moveTo(startX * ts, y * ts);
      ctx.lineTo(endX * ts, y * ts);
    }
    
    ctx.stroke();
  }

  /** Full tile repaint into the OffscreenCanvas. Only called when tiles change. */
  private rebuildTileCache(): void {
    const tCtx = this.tileCtx;
    const ts = WORLD.TILE_SIZE;

    tCtx.fillStyle = '#0a0a0f';
    tCtx.fillRect(0, 0, this.tileCanvas.width, this.tileCanvas.height);

    for (let y = 0; y < this.world.rows; y++) {
      for (let x = 0; x < this.world.cols; x++) {
        const tile = this.world.getTile(x, y);
        if (!tile) continue;

        let color = TILE_COLORS[tile.type];

        if (tile.pollution > 0) {
          color = this.blendHex(color, '#3a2a00', tile.pollution * 0.6);
        }

        tCtx.fillStyle = color;
        tCtx.fillRect(x * ts, y * ts, ts, ts);

        if (tile.improvement) {
          this.paintImprovement(tCtx, x, y, ts, tile.improvement);
        }
      }
    }
  }

  private paintImprovement(
    tCtx: OffscreenCanvasRenderingContext2D,
    x: number, y: number, ts: number,
    type: string
  ): void {
    const cx = x * ts + ts / 2;
    const cy = y * ts + ts / 2;

    switch (type) {
      case 'settlement': {
        tCtx.fillStyle = '#ddcc88';
        tCtx.fillRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);
        tCtx.fillStyle = '#aa8844';
        tCtx.fillRect(cx - 1.5, y * ts + 1, 3, ts - 2);
        break;
      }
      case 'farm': {
        tCtx.strokeStyle = '#88cc44';
        tCtx.lineWidth = 0.6;
        for (let i = 1; i < 4; i++) {
          tCtx.beginPath();
          tCtx.moveTo(x * ts, y * ts + i * (ts / 4));
          tCtx.lineTo(x * ts + ts, y * ts + i * (ts / 4));
          tCtx.stroke();
        }
        break;
      }
      case 'mine': {
        tCtx.fillStyle = '#886644';
        tCtx.beginPath();
        tCtx.arc(cx, cy, ts * 0.28, 0, Math.PI * 2);
        tCtx.fill();
        break;
      }
      case 'castle': {
        tCtx.fillStyle = '#888888';
        tCtx.fillRect(x * ts + 1, y * ts + 2, ts - 2, ts - 3);
        tCtx.fillStyle = '#666666';
        tCtx.fillRect(x * ts + 2, y * ts, 2, 3);
        tCtx.fillRect(x * ts + ts - 4, y * ts, 2, 3);
        break;
      }
      case 'road': {
        tCtx.strokeStyle = '#aa9966';
        tCtx.lineWidth = 1.5;
        tCtx.beginPath();
        tCtx.moveTo(x * ts, cy);
        tCtx.lineTo(x * ts + ts, cy);
        tCtx.stroke();
        break;
      }
      case 'factory': {
        tCtx.fillStyle = '#555566';
        tCtx.fillRect(x * ts + 1, y * ts + 2, ts - 2, ts - 3);
        tCtx.fillStyle = '#aaaacc';
        tCtx.fillRect(cx - 1, y * ts, 2, 3);
        break;
      }
    }
  }

  // ── Entity rendering ──────────────────────────────────────

  /**
   * Groups entities by type, renders all entities of one type before moving
   * to the next. This keeps fillStyle changes to one per entity-type instead
   * of one per entity (8 changes total vs. potentially 1000+).
   */
  private renderEntities(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const ts = WORLD.TILE_SIZE;
    const invZoom = 1 / camera.zoom;

    // Viewport bounds in world-pixels (for culling)
    const vLeft   = -camera.x * invZoom;
    const vTop    = -camera.y * invZoom;
    const vRight  = vLeft + CANVAS.WIDTH  * invZoom;
    const vBottom = vTop  + CANVAS.HEIGHT * invZoom;

    // Bucket entities by type for batched rendering
    const buckets = new Map<EntityType, EntityState[]>();

    this.em.forEachAlive(e => {
      const px = e.x * ts + ts * 0.5;
      const py = e.y * ts + ts * 0.5;
      // Viewport cull
      if (px < vLeft - 16 || px > vRight + 16 || py < vTop - 16 || py > vBottom + 16) return;

      let bucket = buckets.get(e.type);
      if (!bucket) { bucket = []; buckets.set(e.type, bucket); }
      bucket.push(e);
    });

    // Render each bucket
    for (const [type, bucket] of buckets) {
      const color = ENTITY_COLORS[type] ?? '#ffffff';
      const baseSize = ENTITY_BASE_SIZE[type] ?? 2;

      for (const e of bucket) {
        const px = e.x * ts + ts * 0.5;
        const py = e.y * ts + ts * 0.5;
        const pulse = 1 + Math.sin(this.animOffset + e.id * 0.53) * 0.08;
        const size = baseSize * (0.75 + e.genes.resilience * 0.5) * pulse;

        ctx.globalAlpha = 0.45 + e.energy * 0.55;

        this.drawEntityShape(ctx, type, e, px, py, size, color);

        // Energy bar: only shown when low
        if (e.energy < 0.45) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#ff3333';
          ctx.fillRect(px - size, py + size + 1, size * 2 * e.energy, 0.8);
        }

        // Carry indicator dot
        if (e.carryingFood > 0) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#ffff44';
          ctx.beginPath();
          ctx.arc(px + size * 0.6, py - size * 0.6, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  private drawEntityShape(
    ctx: CanvasRenderingContext2D,
    type: EntityType,
    e: EntityState,
    px: number, py: number,
    size: number,
    color: string
  ): void {
    ctx.fillStyle = color;

    switch (type) {
      case 'hunter_gatherer': {
        // Diamond
        ctx.beginPath();
        ctx.moveTo(px, py - size);
        ctx.lineTo(px + size * 0.7, py);
        ctx.lineTo(px, py + size);
        ctx.lineTo(px - size * 0.7, py);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'villager':
      case 'farmer': {
        // Circle
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'craftsman': {
        // Square
        ctx.fillRect(px - size * 0.7, py - size * 0.7, size * 1.4, size * 1.4);
        break;
      }
      case 'warrior': {
        // Upward triangle
        ctx.beginPath();
        ctx.moveTo(px, py - size);
        ctx.lineTo(px + size, py + size * 0.8);
        ctx.lineTo(px - size, py + size * 0.8);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'merchant': {
        // Circle with inner dot (ring + dot)
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CANVAS.BG_COLOR;
        ctx.beginPath();
        ctx.arc(px, py, size * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, size * 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'scholar': {
        // Star (5 points)
        this.drawStar(ctx, px, py, size * 0.45, size, 5, color);
        break;
      }
      case 'noble': {
        // Crown-like: large circle + cross
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CANVAS.BG_COLOR;
        ctx.fillRect(px - size * 0.15, py - size * 0.85, size * 0.3, size * 1.7);
        ctx.fillRect(px - size * 0.85, py - size * 0.15, size * 1.7, size * 0.3);
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    innerR: number, outerR: number,
    points: number,
    color: string
  ): void {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ── Settlement name labels ────────────────────────────────

  private renderSettlementLabels(ctx: CanvasRenderingContext2D, camera: Camera): void {
    // Only show labels at zoom > 1.2 to avoid clutter
    if (camera.zoom < 1.0) return;

    const ts = WORLD.TILE_SIZE;
    ctx.font = `${Math.floor(4 / camera.zoom + 6)}px 'Share Tech Mono', monospace`;
    ctx.textAlign = 'center';

    for (const s of this.settlements.getAll()) {
      const px = s.x * ts + ts / 2;
      const py = s.y * ts - 4;

      // Cull off-screen labels
      const sx = px * camera.zoom + camera.x;
      const sy = py * camera.zoom + camera.y;
      if (sx < -80 || sx > CANVAS.WIDTH + 80 || sy < -20 || sy > CANVAS.HEIGHT + 20) continue;

      const levelColors = ['', '#aa8844', '#88aa44', '#44aa88', '#aa88ff'];
      ctx.fillStyle = levelColors[s.level] ?? '#ffffff';
      ctx.globalAlpha = 0.85;
      ctx.fillText(s.name, px, py);

      // Food indicator
      const foodPct = s.foodStorage / s.maxFoodStorage;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = foodPct > 0.5 ? '#44cc44' : foodPct > 0.2 ? '#ccaa22' : '#cc2222';
      ctx.fillRect(px - 6, py + 1, 12 * foodPct, 1.2);
    }

    ctx.globalAlpha = 1;
  }

  // ── Highlight ─────────────────────────────────────────────

  private renderHighlight(
    ctx: CanvasRenderingContext2D,
    tile: { x: number; y: number } | null
  ): void {
    if (!tile) return;
    const ts = WORLD.TILE_SIZE;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.5 + Math.sin(this.animOffset * 3) * 0.5;
    ctx.strokeRect(tile.x * ts, tile.y * ts, ts, ts);
    ctx.globalAlpha = 1;
  }

  // ── Helpers ───────────────────────────────────────────────

  private blendHex(hex1: string, hex2: string, t: number): string {
    const r1 = parseInt(hex1.slice(1, 3), 16);
    const g1 = parseInt(hex1.slice(3, 5), 16);
    const b1 = parseInt(hex1.slice(5, 7), 16);
    const r2 = parseInt(hex2.slice(1, 3), 16);
    const g2 = parseInt(hex2.slice(3, 5), 16);
    const b2 = parseInt(hex2.slice(5, 7), 16);
    return `rgb(${Math.round(r1 + (r2-r1)*t)},${Math.round(g1 + (g2-g1)*t)},${Math.round(b1 + (b2-b1)*t)})`;
  }
}
