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
import { CANVAS, WORLD, ENTITY } from '../config/constants';
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

  render(
    camera: Camera,
    highlightTile: { x: number; y: number } | null,
    selectedTile: { x: number; y: number } | null,
    selectedEntity: EntityState | null,
    showPartnerLines = false,
    showFriendLines  = false,
  ): void {
    const ctx = this.ctx;
    this.frameCount++;
    this.animOffset = (this.frameCount * 0.04) % (Math.PI * 2);

    ctx.fillStyle = CANVAS.BG_COLOR;
    ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    this.renderTileLayer(ctx, camera);
    this.renderGrid(ctx, camera);
    this.renderSocialLines(ctx, selectedEntity, showPartnerLines, showFriendLines);
    this.renderEntities(ctx, camera, selectedEntity);
    this.renderSettlementLabels(ctx, camera);
    this.renderHighlight(ctx, highlightTile);
    this.renderSelectedTile(ctx, selectedTile);
    this.renderSelectedEntityRing(ctx, selectedEntity);

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
  private renderEntities(ctx: CanvasRenderingContext2D, camera: Camera, selectedEntity: EntityState | null): void {
    const ts = WORLD.TILE_SIZE;
    const invZoom = 1 / camera.zoom;

    const vLeft   = -camera.x * invZoom;
    const vTop    = -camera.y * invZoom;
    const vRight  = vLeft + CANVAS.WIDTH  * invZoom;
    const vBottom = vTop  + CANVAS.HEIGHT * invZoom;

    const buckets = new Map<EntityType, EntityState[]>();
    const allVisible: EntityState[] = [];

    this.em.forEachAlive(e => {
      const px = e.x * ts + ts * 0.5;
      const py = e.y * ts + ts * 0.5;
      if (px < vLeft - 16 || px > vRight + 16 || py < vTop - 16 || py > vBottom + 16) return;
      allVisible.push(e);
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

        // Babies: 35% size, soft white circle
        const ageFactor = e.isChild
          ? 0.25 + (e.age / ENTITY.SPECIALIZE_AGE) * 0.15
          : 1.0;
        const size = baseSize * (0.75 + e.genes.resilience * 0.5) * pulse * ageFactor;

        ctx.globalAlpha = 0.45 + e.energy * 0.55;

        // Selection ring
        if (selectedEntity && e.id === selectedEntity.id) {
          const ringPulse = 1 + Math.sin(this.animOffset * 4) * 0.3;
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(px, py, size * 1.8 * ringPulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#ffee88';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.arc(px, py, size * 2.4 * ringPulse, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (e.isChild) {
          // Baby: soft cream-coloured circle
          ctx.globalAlpha = 0.55 + e.energy * 0.4;
          ctx.fillStyle = '#ffeecc';
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
          // Tiny highlight dot
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px - size * 0.3, py - size * 0.3, size * 0.28, 0, Math.PI * 2);
          ctx.fill();
        } else {
          this.drawEntityShape(ctx, type, e, px, py, size, color);
        }

        // Energy bar when low
        if (e.energy < 0.45) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = '#ff3333';
          ctx.fillRect(px - size, py + size + 1, size * 2 * e.energy, 0.8);
        }

        // Carry indicator dot
        if (e.carryingFood > 0 && !e.isChild) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#ffff44';
          ctx.beginPath();
          ctx.arc(px + size * 0.6, py - size * 0.6, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }

        // Action animation: gathering/mining sparks
        if (e.actionAnim.type !== null && camera.zoom >= 1.2) {
          const prog = e.actionAnim.progress;
          const angle = (prog / 8) * Math.PI * 2;
          const dist  = size * 1.6;
          const ax    = px + Math.cos(angle) * dist;
          const ay    = py + Math.sin(angle) * dist;
          const aColors: Record<string, string> = { gather: '#aaff66', mine: '#ffcc44', farm: '#44ffaa' };
          ctx.globalAlpha = 0.85 - prog * 0.1;
          ctx.fillStyle = aColors[e.actionAnim.type] ?? '#ffffff';
          ctx.beginPath();
          ctx.arc(ax, ay, 0.8, 0, Math.PI * 2);
          ctx.fill();
          // Tiny trail
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.arc(ax - Math.cos(angle) * 1.2, ay - Math.sin(angle) * 1.2, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Social state icon (zoomed in)
        if (camera.zoom >= 1.5 && !e.isChild) {
          const state = e.social.socialState;
          if (state === 'chatting' || state === 'relaxing') {
            const icon = state === 'chatting' ? '💬' : '💤';
            ctx.globalAlpha = 0.85 + Math.sin(this.animOffset * 2 + e.id) * 0.15;
            ctx.font = `${Math.max(4, ts * 0.55)}px serif`;
            ctx.textAlign = 'center';
            ctx.fillText(icon, px, py - size - 2);
          }
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

  const settlements = this.settlements.getAll();
  const ts = WORLD.TILE_SIZE;

  for (const s of settlements) {

    const x = s.x * ts + ts * 0.5;
    const y = s.y * ts + ts * 0.5;

    ctx.fillStyle = "#c89b3c";

    ctx.beginPath();
    ctx.arc(x, y, ts * 0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = `${ts * 0.8}px sans-serif`;
    ctx.textAlign = "center";

    ctx.fillText(`T${s.id}`, x, y - ts);
  }

}

  // ── Highlight ─────────────────────────────────────────────

  // ── Social relationship / friend lines ───────────────────

  private renderSocialLines(
    ctx: CanvasRenderingContext2D,
    selectedEntity: EntityState | null,
    showPartnerLines: boolean,
    showFriendLines: boolean,
  ): void {
    if (!selectedEntity) return;
    if (!showPartnerLines && !showFriendLines) return;

    const ts = WORLD.TILE_SIZE;
    const sx = selectedEntity.x * ts + ts * 0.5;
    const sy = selectedEntity.y * ts + ts * 0.5;
    const s  = selectedEntity.social;

    const byId = new Map<number, EntityState>();
    this.em.forEachAlive(e => byId.set(e.id, e));

    ctx.save();
    ctx.lineWidth = 0.8;

    // ── Partner lines ──────────────────────────────────────
    if (showPartnerLines) {
      const pulse = 0.55 + Math.sin(this.animOffset * 3 + selectedEntity.id * 0.4) * 0.2;

      for (const pid of s.partnerIds) {
        const partner = byId.get(pid);
        if (!partner) continue;
        const px = partner.x * ts + ts * 0.5;
        const py = partner.y * ts + ts * 0.5;
        const isNearby = Math.abs(partner.x - selectedEntity.x) + Math.abs(partner.y - selectedEntity.y) <= 6;
        ctx.globalAlpha = pulse * (isNearby ? 1 : 0.45);
        ctx.strokeStyle = '#ff88aa';
        ctx.setLineDash(isNearby ? [] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = pulse * 0.9;
        ctx.font = '5px serif'; ctx.textAlign = 'center';
        ctx.fillText('❤', (sx + px) / 2, (sy + py) / 2);
      }

      for (const pid of s.affairPartnerIds) {
        const partner = byId.get(pid);
        if (!partner) continue;
        const px = partner.x * ts + ts * 0.5;
        const py = partner.y * ts + ts * 0.5;
        ctx.globalAlpha = pulse * 0.4;
        ctx.strokeStyle = '#ffaa44';
        ctx.setLineDash([1.5, 3]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '5px serif'; ctx.textAlign = 'center';
        ctx.fillText('🔥', (sx + px) / 2, (sy + py) / 2);
      }
    }

    // ── Friend lines ──────────────────────────────────────
    if (showFriendLines) {
      const pulse = 0.32 + Math.sin(this.animOffset * 2 + selectedEntity.id * 0.7) * 0.1;
      for (const fid of s.friendIds) {
        const friend = byId.get(fid);
        if (!friend) continue;
        const fx = friend.x * ts + ts * 0.5;
        const fy = friend.y * ts + ts * 0.5;
        const isChatting = friend.social.socialState === 'chatting' &&
          selectedEntity.social.socialState === 'chatting';
        ctx.globalAlpha = pulse + (isChatting ? 0.3 : 0);
        ctx.strokeStyle = isChatting ? '#88ffee' : '#4488cc';
        ctx.setLineDash([1, 2.5]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.setLineDash([]);
        if (isChatting) {
          ctx.font = '5px serif'; ctx.textAlign = 'center';
          ctx.fillText('💬', (sx + fx) / 2, (sy + fy) / 2);
        }
      }
    }

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

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

  // ── Selected tile highlight ───────────────────────────────

  private renderSelectedTile(
    ctx: CanvasRenderingContext2D,
    tile: { x: number; y: number } | null
  ): void {
    if (!tile) return;
    const ts = WORLD.TILE_SIZE;
    // Solid corner brackets for selected tile
    const m = 0.5; // margin
    const b = ts * 0.28; // bracket length
    ctx.strokeStyle = '#ffee44';
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.9 + Math.sin(this.animOffset * 2) * 0.1;
    const x = tile.x * ts + m;
    const y = tile.y * ts + m;
    const w = ts - m * 2;
    const h = ts - m * 2;
    ctx.beginPath();
    // TL
    ctx.moveTo(x, y + b); ctx.lineTo(x, y); ctx.lineTo(x + b, y);
    // TR
    ctx.moveTo(x + w - b, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + b);
    // BR
    ctx.moveTo(x + w, y + h - b); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - b, y + h);
    // BL
    ctx.moveTo(x + b, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - b);
    ctx.stroke();
    // Subtle fill tint
    ctx.globalAlpha = 0.08 + Math.sin(this.animOffset * 2) * 0.04;
    ctx.fillStyle = '#ffee44';
    ctx.fillRect(tile.x * ts, tile.y * ts, ts, ts);
    ctx.globalAlpha = 1;
  }

  // ── Selected entity outer ring ────────────────────────────

  private renderSelectedEntityRing(
    ctx: CanvasRenderingContext2D,
    entity: EntityState | null
  ): void {
    if (!entity) return;
    const ts = WORLD.TILE_SIZE;
    const px = entity.x * ts + ts * 0.5;
    const py = entity.y * ts + ts * 0.5;
    // Outer pulsing ring
    const pulse = 1 + Math.sin(this.animOffset * 3) * 0.2;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#ffee44';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath();
    ctx.arc(px, py, ts * 0.72 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
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
