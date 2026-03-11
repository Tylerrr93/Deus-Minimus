// ============================================================
// RENDERER — Canvas 2D renderer
// Animation uses continuous wall-clock progress (0→1 loop),
// not the old 8-tick counter that kept resetting too fast.
// ============================================================

import { World } from '../world/World';
import { EntityManager } from '../entities/EntityManager';
import { EntityState, EntityRole, deriveRole } from '../entities/Entity';
import { TILE_COLORS } from '../world/Tile';
import { CANVAS, WORLD, ENTITY } from '../config/constants';
import { SettlementManager, Settlement, BuildingProject } from '../entities/SettlementManager';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// Role colours — used both for entity dots and the population chart
export const ROLE_COLORS: Record<EntityRole, string> = {
  wanderer:  '#ffcc44',
  hunter:    '#ff8833',
  gatherer:  '#88dd66',
  farmer:    '#44cc88',
  builder:   '#cc8844',
  crafter:   '#dd6633',
  warrior:   '#ff4444',
  merchant:  '#aa88ff',
  scholar:   '#44ddff',
  elder:     '#ffaa22',
};

const ROLE_BASE_SIZE: Record<EntityRole, number> = {
  wanderer:  2.0,
  hunter:    2.5,
  gatherer:  2.2,
  farmer:    2.2,
  builder:   2.5,
  crafter:   2.5,
  warrior:   3.0,
  merchant:  2.5,
  scholar:   2.5,
  elder:     3.0,
};

// Action anim particle colours
const ANIM_COLORS: Record<NonNullable<EntityState['actionAnim']['type']>, string> = {
  gather: '#aaff66',
  mine:   '#ffcc44',
  farm:   '#44ffaa',
  build:  '#ffdd66',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tileCanvas: OffscreenCanvas;
  private tileCtx:    OffscreenCanvasRenderingContext2D;
  private tilesDirty = true;
  private frameCount = 0;
  private animOffset = 0; // continuous float driven by rAF

  // Resource layer toggle - when true, resources render regardless of zoom
  private showResourcesForced = false;

  constructor(
    private readonly canvas:      HTMLCanvasElement,
    private readonly world:       World,
    private readonly em:          EntityManager,
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

  setShowResourcesForced(v: boolean): void {
    this.showResourcesForced = v;
  }

  render(
    camera: Camera,
    highlightTile:   { x: number; y: number } | null,
    selectedTile:    { x: number; y: number } | null,
    selectedEntity:  EntityState | null,
    showPartnerLines = false,
    showFriendLines  = false,
  ): void {
    const ctx = this.ctx;
    this.frameCount++;
    // animOffset advances ~60fps regardless of sim speed
    this.animOffset = (performance.now() * 0.001) % (Math.PI * 2);

    ctx.fillStyle = CANVAS.BG_COLOR;
    ctx.fillRect(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    this.renderTileLayer(ctx, camera);
    this.renderResources(ctx, camera);
    this.renderGrid(ctx, camera);
    this.renderBuildingProjects(ctx, camera);
    this.renderSettlements(ctx, camera);
    this.renderSocialLines(ctx, selectedEntity, showPartnerLines, showFriendLines);
    this.renderEntities(ctx, camera, selectedEntity);
    this.renderHighlight(ctx, highlightTile);
    this.renderSelectedTile(ctx, selectedTile);
    this.renderSelectedEntityRing(ctx, selectedEntity);

    ctx.restore();
  }

  // ── Tile layer ────────────────────────────────────────────

  private renderTileLayer(ctx: CanvasRenderingContext2D, _camera: Camera): void {
    if (this.tilesDirty) { this.rebuildTileCache(); this.tilesDirty = false; }
    ctx.drawImage(this.tileCanvas, 0, 0);
  }

  private rebuildTileCache(): void {
    const tCtx = this.tileCtx;
    const ts   = WORLD.TILE_SIZE;
    tCtx.fillStyle = '#0a0a0f';
    tCtx.fillRect(0, 0, this.tileCanvas.width, this.tileCanvas.height);

    for (let y = 0; y < this.world.rows; y++) {
      for (let x = 0; x < this.world.cols; x++) {
        const tile = this.world.getTile(x, y);
        if (!tile) continue;
        let color = TILE_COLORS[tile.type];
        if (tile.pollution > 0) color = this.blendHex(color, '#3a2a00', tile.pollution * 0.6);
        tCtx.fillStyle = color;
        tCtx.fillRect(x * ts, y * ts, ts, ts);
        if (tile.improvement && tile.improvement !== 'settlement') {
          this.paintImprovement(tCtx, x, y, ts, tile.improvement);
        }
      }
    }
  }

  private paintImprovement(
    tCtx: OffscreenCanvasRenderingContext2D,
    x: number, y: number, ts: number, type: string,
  ): void {
    const cx = x * ts + ts / 2, cy = y * ts + ts / 2;
    switch (type) {
      case 'farm': {
        tCtx.strokeStyle = '#88cc44'; tCtx.lineWidth = 0.6;
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
        tCtx.beginPath(); tCtx.arc(cx, cy, ts * 0.28, 0, Math.PI * 2); tCtx.fill();
        break;
      }
      case 'dirt_road': {
        tCtx.fillStyle = '#8a7050';
        const strip = ts * 0.38;
        tCtx.fillRect(x * ts, cy - strip / 2, ts, strip);
        tCtx.strokeStyle = '#6a5438'; tCtx.lineWidth = 0.4;
        tCtx.beginPath();
        tCtx.moveTo(x * ts, cy - strip * 0.28); tCtx.lineTo(x * ts + ts, cy - strip * 0.28);
        tCtx.moveTo(x * ts, cy + strip * 0.28); tCtx.lineTo(x * ts + ts, cy + strip * 0.28);
        tCtx.stroke();
        break;
      }
      case 'rough_home': {
        const m = 1.2;
        tCtx.fillStyle = '#a07848';
        tCtx.fillRect(x * ts + m, y * ts + m + ts * 0.3, ts - m * 2, ts - m * 2 - ts * 0.3);
        tCtx.fillStyle = '#7a4a28';
        tCtx.beginPath();
        tCtx.moveTo(cx, y * ts + m);
        tCtx.lineTo(x * ts + ts - m, y * ts + ts * 0.35);
        tCtx.lineTo(x * ts + m, y * ts + ts * 0.35);
        tCtx.closePath(); tCtx.fill();
        tCtx.fillStyle = '#5a3018';
        tCtx.fillRect(cx - 0.8, y * ts + ts * 0.55, 1.6, ts * 0.38);
        break;
      }
    }
  }

  // ── Resources ─────────────────────────────────────────────

  private renderResources(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (camera.zoom < 4.0 && !this.showResourcesForced) return;
    if (camera.zoom >= 4.0 && this.showResourcesForced === false) return;
    const ts = WORLD.TILE_SIZE;
    const iZ = 1 / camera.zoom;
    const vLeft = -camera.x * iZ, vTop = -camera.y * iZ;
    const vRight = vLeft + CANVAS.WIDTH * iZ, vBottom = vTop + CANVAS.HEIGHT * iZ;

    for (let y = Math.max(0, Math.floor(vTop / ts)); y < Math.min(this.world.rows, Math.ceil(vBottom / ts)); y++) {
      for (let x = Math.max(0, Math.floor(vLeft / ts)); x < Math.min(this.world.cols, Math.ceil(vRight / ts)); x++) {
        const tile = this.world.getTile(x, y);
        if (!tile || tile.improvement) continue;
        for (const res of tile.resources) {
          if (res.amount <= 0.5) continue;
          const fullness = res.amount / res.max;
          const size = ts * 0.4 * fullness;
          const px = x * ts + ts / 2, py = y * ts + ts / 2;
          ctx.beginPath();
          if (res.type === 'wood') {
            ctx.fillStyle = `rgba(30,90,30,${0.4 + fullness * 0.6})`;
            ctx.arc(px, py, size, 0, Math.PI * 2);
          } else if (res.type === 'stone' || res.type === 'iron') {
            ctx.fillStyle = res.type === 'stone' ? '#888888' : '#aa7755';
            ctx.rect(px - size / 2, py - size / 2, size, size);
          } else if (res.type === 'food') {
            ctx.fillStyle = `rgba(180,220,100,${0.3 + fullness * 0.7})`;
            ctx.arc(px + 1, py - 1, size * 0.7, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
    }
  }

  // ── Grid ──────────────────────────────────────────────────

  private renderGrid(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (camera.zoom < 0.8) return;
    const ts = WORLD.TILE_SIZE;
    const iZ = 1 / camera.zoom;
    const vLeft = -camera.x * iZ, vTop = -camera.y * iZ;
    const vRight = vLeft + CANVAS.WIDTH * iZ, vBottom = vTop + CANVAS.HEIGHT * iZ;
    const startX = Math.max(0, Math.floor(vLeft / ts));
    const startY = Math.max(0, Math.floor(vTop / ts));
    const endX   = Math.min(this.world.cols, Math.ceil(vRight / ts) + 1);
    const endY   = Math.min(this.world.rows, Math.ceil(vBottom / ts) + 1);
    const alpha  = Math.min(0.25, (camera.zoom - 0.8) * 0.45);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 0.15;
    ctx.beginPath();
    for (let x = startX; x <= endX; x++) { ctx.moveTo(x * ts, startY * ts); ctx.lineTo(x * ts, endY * ts); }
    for (let y = startY; y <= endY; y++) { ctx.moveTo(startX * ts, y * ts); ctx.lineTo(endX * ts, y * ts); }
    ctx.stroke();
  }

  // ── Building projects ─────────────────────────────────────

  private renderBuildingProjects(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const ts       = WORLD.TILE_SIZE;
    const projects = this.settlements.getAllProjects();
    if (projects.length === 0) return;
    const iZ     = 1 / camera.zoom;
    const vLeft  = -camera.x * iZ, vTop = -camera.y * iZ;
    const vRight = vLeft + CANVAS.WIDTH * iZ, vBottom = vTop + CANVAS.HEIGHT * iZ;
    const shimmer = 0.5 + Math.sin(this.animOffset * 2) * 0.15;

    for (const p of projects) {
      if (p.complete) continue;
      for (let i = 0; i < p.tiles.length; i++) {
        const [tx, ty] = p.tiles[i];
        const px = tx * ts, py = ty * ts;
        if (px + ts < vLeft || px > vRight || py + ts < vTop || py > vBottom) continue;
        const tileProg = p.progressPerTile[i];
        const cx = px + ts / 2, cy = py + ts / 2;

        if (p.type === 'dirt_road') {
          const alpha = (0.18 + tileProg * 0.55) * shimmer;
          const strip = ts * 0.38;
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = '#8a7050';
          ctx.fillRect(px, cy - strip / 2, ts, strip);
          if (tileProg > 0) {
            ctx.globalAlpha = tileProg * 0.45;
            ctx.fillStyle   = '#c4a870';
            ctx.fillRect(px, cy - strip / 2, ts * tileProg, strip);
          }
          if (tileProg < 1) {
            ctx.globalAlpha = 0.5 * shimmer;
            ctx.fillStyle   = '#e0c88a';
            ctx.beginPath(); ctx.arc(cx, cy, 0.7, 0, Math.PI * 2); ctx.fill();
          }
        } else if (p.type === 'rough_home') {
          const m = 1.5;
          ctx.globalAlpha = (0.20 + p.progress * 0.55) * shimmer;
          ctx.strokeStyle = '#c49a5a'; ctx.lineWidth = 0.7;
          ctx.setLineDash([1.5, 1.5]);
          ctx.strokeRect(px + m, py + m, ts - m * 2, ts - m * 2);
          ctx.setLineDash([]);
          ctx.globalAlpha = (0.15 + p.progress * 0.4) * shimmer;
          ctx.beginPath();
          ctx.moveTo(cx, py + m); ctx.lineTo(px + ts - m, py + ts * 0.36); ctx.lineTo(px + m, py + ts * 0.36);
          ctx.closePath(); ctx.stroke();
          if (p.progress > 0) {
            const fillH = (ts - m * 2 - ts * 0.32) * p.progress;
            ctx.globalAlpha = p.progress * 0.25;
            ctx.fillStyle   = '#a07848';
            ctx.fillRect(px + m, py + ts - m - fillH, ts - m * 2, fillH);
          }
          if (p.workerIds.length > 0) {
            ctx.globalAlpha = 0.85 * shimmer;
            ctx.fillStyle   = '#ffdd88';
            ctx.beginPath();
            ctx.arc(
              cx + Math.cos(this.animOffset * 3) * 1.5,
              cy + Math.sin(this.animOffset * 3) * 1.5,
              0.9, 0, Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  // ── Settlements ───────────────────────────────────────────

  private renderSettlements(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const ts      = WORLD.TILE_SIZE;
    const iZ      = 1 / camera.zoom;
    const vLeft   = -camera.x * iZ, vTop = -camera.y * iZ;
    const vRight  = vLeft + CANVAS.WIDTH * iZ, vBottom = vTop + CANVAS.HEIGHT * iZ;
    const showLabels = camera.zoom >= 0.6;

    for (const s of this.settlements.getAll()) {
      const px = s.x * ts + ts * 0.5, py = s.y * ts + ts * 0.5;
      if (px < vLeft - ts * 4 || px > vRight + ts * 4 || py < vTop - ts * 4 || py > vBottom + ts * 4) continue;
      const r   = ts * 0.55 + (s.level - 1) * ts * 0.15;
      const bg  = s.level === 1 ? '#2a1800' : s.level === 2 ? '#1e1400' : '#0e1800';
      const rim = s.level === 1 ? '#c87a22' : s.level === 2 ? '#d4aa44' : '#88cc66';

      ctx.globalAlpha = 0.18 + (s.level - 1) * 0.06;
      ctx.fillStyle   = rim;
      ctx.beginPath(); ctx.arc(px, py, r * 1.9, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = 0.85;
      ctx.fillStyle   = bg;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rim; ctx.lineWidth = 0.7 + (s.level - 1) * 0.3; ctx.stroke();

      ctx.globalAlpha = 0.92;
      if (s.level === 1) this._drawCampfire(ctx, px, py, r * 0.55);
      else if (s.level === 2) this._drawHouseIcon(ctx, px, py, r * 0.58);
      else this._drawVillageIcon(ctx, px, py, r * 0.52);

      if (showLabels) {
        ctx.globalAlpha = 0.85;
        const fontSize  = Math.max(4, Math.min(7, ts * 0.75));
        ctx.font        = `${fontSize}px 'Cinzel', serif`;
        ctx.textAlign   = 'center';
        ctx.fillStyle   = rim;
        ctx.fillText(s.name, px, py - r - 2.5);
        if (camera.zoom >= 1.0) {
          ctx.font      = `${fontSize * 0.72}px monospace`;
          ctx.fillStyle = '#888888';
          ctx.fillText(`Lv${s.level} • pop ${s.population}`, px, py + r + 5);
        }
      }

      if (camera.zoom >= 1.2) {
        const barW = r * 2.4, barH = 1.2;
        const barX = px - barW / 2, barY = py + r + 2;
        const foodPct = Math.min(1, s.foodStorage / s.maxFoodStorage);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle   = '#222222'; ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle   = foodPct > 0.5 ? '#44aa44' : foodPct > 0.25 ? '#aaaa22' : '#aa2222';
        ctx.fillRect(barX, barY, barW * foodPct, barH);
      }
    }
    ctx.globalAlpha = 1;
  }

  private _drawCampfire(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const flicker = Math.sin(this.animOffset * 5 + cx) * 0.15;
    ctx.fillStyle = `rgba(255,${Math.floor(130 + flicker * 80)},30,0.9)`;
    ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.1, size * 0.35, size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,60,0.8)';
    ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.15, size * 0.18, size * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6a3a10'; ctx.lineWidth = size * 0.22;
    ctx.beginPath(); ctx.moveTo(cx - size * 0.4, cy + size * 0.55); ctx.lineTo(cx + size * 0.25, cy + size * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + size * 0.4, cy + size * 0.55); ctx.lineTo(cx - size * 0.25, cy + size * 0.2); ctx.stroke();
  }

  private _drawHouseIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    ctx.fillStyle = '#c49a5a';
    ctx.fillRect(cx - size * 0.55, cy - size * 0.1, size * 1.1, size * 0.8);
    ctx.fillStyle = '#8a4820';
    ctx.beginPath(); ctx.moveTo(cx, cy - size * 0.75); ctx.lineTo(cx + size * 0.7, cy - size * 0.1); ctx.lineTo(cx - size * 0.7, cy - size * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3018';
    ctx.fillRect(cx - size * 0.15, cy + size * 0.18, size * 0.3, size * 0.52);
  }

  private _drawVillageIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const offsets: [number, number, number][] = [[-size * 0.55, 0, 0.75], [size * 0.55, 0, 0.75], [0, -size * 0.2, 1.0]];
    for (const [ox, oy, sc] of offsets) {
      const hx = cx + ox, hy = cy + oy, s2 = size * sc * 0.55;
      ctx.fillStyle = '#c49a5a'; ctx.fillRect(hx - s2 * 0.5, hy, s2, s2 * 0.65);
      ctx.fillStyle = '#8a4820';
      ctx.beginPath(); ctx.moveTo(hx, hy - s2 * 0.55); ctx.lineTo(hx + s2 * 0.6, hy); ctx.lineTo(hx - s2 * 0.6, hy); ctx.closePath(); ctx.fill();
    }
  }

  // ── Entities ──────────────────────────────────────────────

  private renderEntities(ctx: CanvasRenderingContext2D, camera: Camera, selectedEntity: EntityState | null): void {
    const ts = WORLD.TILE_SIZE;
    const iZ = 1 / camera.zoom;
    const vLeft   = -camera.x * iZ, vTop   = -camera.y * iZ;
    const vRight  = vLeft + CANVAS.WIDTH  * iZ;
    const vBottom = vTop  + CANVAS.HEIGHT * iZ;

    // Refresh cosmetic role before bucketing
    const buckets = new Map<EntityRole, EntityState[]>();
    this.em.forEachAlive(e => {
      e.type = deriveRole(e); // cheap — just reads skill values
      const px = e.x * ts + ts * 0.5, py = e.y * ts + ts * 0.5;
      if (px < vLeft - 16 || px > vRight + 16 || py < vTop - 16 || py > vBottom + 16) return;
      let b = buckets.get(e.type);
      if (!b) { b = []; buckets.set(e.type, b); }
      b.push(e);
    });

    for (const [role, bucket] of buckets) {
      const color    = ROLE_COLORS[role]     ?? '#ffffff';
      const baseSize = ROLE_BASE_SIZE[role]  ?? 2;

      for (const e of bucket) {
        const px = e.x * ts + ts * 0.5, py = e.y * ts + ts * 0.5;
        const pulse = 1 + Math.sin(this.animOffset + e.id * 0.53) * 0.08;
        const ageFactor = e.isChild
          ? 0.25 + (e.age / ENTITY.SPECIALIZE_AGE) * 0.15
          : 1.0;
        const size = baseSize * (0.75 + e.genes.resilience * 0.5) * pulse * ageFactor;

        ctx.globalAlpha = 0.45 + e.energy * 0.55;

        // Selection ring
        if (selectedEntity && e.id === selectedEntity.id) {
          const rp = 1 + Math.sin(this.animOffset * 4) * 0.3;
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(px, py, size * 1.8 * rp, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#ffee88'; ctx.lineWidth = 0.4;
          ctx.beginPath(); ctx.arc(px, py, size * 2.4 * rp, 0, Math.PI * 2); ctx.stroke();
        }

        if (e.isChild) {
          ctx.globalAlpha = 0.55 + e.energy * 0.4;
          ctx.fillStyle   = '#ffeecc';
          ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle   = '#ffffff';
          ctx.beginPath(); ctx.arc(px - size * 0.3, py - size * 0.3, size * 0.28, 0, Math.PI * 2); ctx.fill();
        } else {
          this.drawEntityShape(ctx, role, e, px, py, size, color);
        }

        // Low energy bar
        if (e.energy < 0.45) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle   = '#ff3333';
          ctx.fillRect(px - size, py + size + 1, size * 2 * e.energy, 0.8);
        }

        // Carrying dot
        if (e.carryingFood > 0 && !e.isChild) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle   = '#ffff44';
          ctx.beginPath(); ctx.arc(px + size * 0.6, py - size * 0.6, 0.7, 0, Math.PI * 2); ctx.fill();
        }

        // ── Action animation particles ─────────────────────
        // Now visible at ALL zoom levels (removed the zoom >= 1.2 gate).
        // Uses continuous 0→1 progress from wall-clock time.
        const anim = e.actionAnim;
        if (anim.type !== null && anim.progress >= 0) {
          const animColor = ANIM_COLORS[anim.type] ?? '#ffffff';
          const angle     = anim.progress * Math.PI * 2;
          const dist      = size * 1.8;
          const ax        = px + Math.cos(angle) * dist;
          const ay        = py + Math.sin(angle) * dist;

          // Main particle
          ctx.globalAlpha = 0.90 - anim.progress * 0.2;
          ctx.fillStyle   = animColor;
          // Scale particle so it's visible even at zoom < 1
          const pSize = Math.max(1.2, size * 0.55);
          ctx.beginPath(); ctx.arc(ax, ay, pSize, 0, Math.PI * 2); ctx.fill();

          // Trail particle
          const trailAngle = angle - 0.35;
          const tax = px + Math.cos(trailAngle) * dist * 0.85;
          const tay = py + Math.sin(trailAngle) * dist * 0.85;
          ctx.globalAlpha = 0.40 - anim.progress * 0.15;
          ctx.fillStyle   = animColor;
          ctx.beginPath(); ctx.arc(tax, tay, pSize * 0.55, 0, Math.PI * 2); ctx.fill();

          // Build: extra hammer-spark flash on each revolution
          if (anim.type === 'build' && anim.progress < 0.12) {
            ctx.globalAlpha = (0.12 - anim.progress) / 0.12 * 0.9;
            ctx.fillStyle   = '#ffffff';
            ctx.beginPath(); ctx.arc(ax, ay, pSize * 1.4, 0, Math.PI * 2); ctx.fill();
          }
        }

        // Social state icon — shown at all zoom levels > 0.8
        if (camera.zoom >= 0.8 && !e.isChild) {
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
    ctx: CanvasRenderingContext2D, role: EntityRole, e: EntityState,
    px: number, py: number, size: number, color: string,
  ): void {
    ctx.fillStyle = color;
    switch (role) {
      case 'wanderer': case 'gatherer': {
        // Diamond
        ctx.beginPath();
        ctx.moveTo(px, py - size); ctx.lineTo(px + size * 0.7, py);
        ctx.lineTo(px, py + size); ctx.lineTo(px - size * 0.7, py);
        ctx.closePath(); ctx.fill(); break;
      }
      case 'hunter': {
        // Upward triangle
        ctx.beginPath();
        ctx.moveTo(px, py - size); ctx.lineTo(px + size, py + size * 0.8); ctx.lineTo(px - size, py + size * 0.8);
        ctx.closePath(); ctx.fill(); break;
      }
      case 'farmer': case 'elder': {
        // Circle
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'builder': case 'crafter': {
        // Square
        ctx.fillRect(px - size * 0.7, py - size * 0.7, size * 1.4, size * 1.4); break;
      }
      case 'warrior': {
        // Larger upward triangle
        ctx.beginPath();
        ctx.moveTo(px, py - size * 1.1); ctx.lineTo(px + size * 1.1, py + size * 0.9); ctx.lineTo(px - size * 1.1, py + size * 0.9);
        ctx.closePath(); ctx.fill(); break;
      }
      case 'merchant': {
        // Ring
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = CANVAS.BG_COLOR;
        ctx.beginPath(); ctx.arc(px, py, size * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(px, py, size * 0.2, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'scholar': {
        this.drawStar(ctx, px, py, size * 0.45, size, 5, color); break;
      }
      default: {
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  private drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number,
                   innerR: number, outerR: number, points: number, color: string): void {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  // ── Social lines ──────────────────────────────────────────

  private renderSocialLines(ctx: CanvasRenderingContext2D, selectedEntity: EntityState | null,
                             showPartnerLines: boolean, showFriendLines: boolean): void {
    if (!selectedEntity || (!showPartnerLines && !showFriendLines)) return;
    const ts = WORLD.TILE_SIZE;
    const sx = selectedEntity.x * ts + ts * 0.5, sy = selectedEntity.y * ts + ts * 0.5;
    const s  = selectedEntity.social;
    const byId = new Map<number, EntityState>();
    this.em.forEachAlive(e => byId.set(e.id, e));

    ctx.save(); ctx.lineWidth = 0.8;

    if (showPartnerLines) {
      const pulse = 0.55 + Math.sin(this.animOffset * 3 + selectedEntity.id * 0.4) * 0.2;
      for (const pid of s.partnerIds) {
        const p = byId.get(pid); if (!p) continue;
        const px = p.x * ts + ts * 0.5, py = p.y * ts + ts * 0.5;
        const near = Math.abs(selectedEntity.x - p.x) + Math.abs(selectedEntity.y - p.y) <= 6;
        ctx.globalAlpha = pulse * (near ? 1 : 0.45);
        ctx.strokeStyle = '#ff88aa'; ctx.setLineDash(near ? [] : [2, 3]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = pulse * 0.9;
        ctx.font = '5px serif'; ctx.textAlign = 'center';
        ctx.fillText('❤', (sx + px) / 2, (sy + py) / 2);
      }
      for (const pid of s.affairPartnerIds) {
        const p = byId.get(pid); if (!p) continue;
        const px = p.x * ts + ts * 0.5, py = p.y * ts + ts * 0.5;
        ctx.globalAlpha = 0.4; ctx.strokeStyle = '#ffaa44'; ctx.setLineDash([1.5, 3]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]); ctx.font = '5px serif'; ctx.textAlign = 'center';
        ctx.fillText('🔥', (sx + px) / 2, (sy + py) / 2);
      }
    }

    if (showFriendLines) {
      const pulse = 0.32 + Math.sin(this.animOffset * 2 + selectedEntity.id * 0.7) * 0.1;
      for (const fid of s.friendIds) {
        const f = byId.get(fid); if (!f) continue;
        const fx = f.x * ts + ts * 0.5, fy = f.y * ts + ts * 0.5;
        const chatting = f.social.socialState === 'chatting' && selectedEntity.social.socialState === 'chatting';
        ctx.globalAlpha = pulse + (chatting ? 0.3 : 0);
        ctx.strokeStyle = chatting ? '#88ffee' : '#4488cc';
        ctx.setLineDash([1, 2.5]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
        ctx.setLineDash([]);
        if (chatting) { ctx.font = '5px serif'; ctx.textAlign = 'center'; ctx.fillText('💬', (sx + fx) / 2, (sy + fy) / 2); }
      }
    }

    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
  }

  // ── Highlight / selected ──────────────────────────────────

  private renderHighlight(ctx: CanvasRenderingContext2D, tile: { x: number; y: number } | null): void {
    if (!tile) return;
    const ts = WORLD.TILE_SIZE;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.5 + Math.sin(this.animOffset * 3) * 0.5;
    ctx.strokeRect(tile.x * ts, tile.y * ts, ts, ts);
    ctx.globalAlpha = 1;
  }

  private renderSelectedTile(ctx: CanvasRenderingContext2D, tile: { x: number; y: number } | null): void {
    if (!tile) return;
    const ts = WORLD.TILE_SIZE;
    const m = 0.5, b = ts * 0.28;
    ctx.strokeStyle = '#ffee44'; ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.9 + Math.sin(this.animOffset * 2) * 0.1;
    const x = tile.x * ts + m, y = tile.y * ts + m, w = ts - m * 2, h = ts - m * 2;
    ctx.beginPath();
    ctx.moveTo(x, y + b); ctx.lineTo(x, y); ctx.lineTo(x + b, y);
    ctx.moveTo(x + w - b, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + b);
    ctx.moveTo(x + w, y + h - b); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - b, y + h);
    ctx.moveTo(x + b, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - b);
    ctx.stroke();
    ctx.globalAlpha = 0.08 + Math.sin(this.animOffset * 2) * 0.04;
    ctx.fillStyle   = '#ffee44';
    ctx.fillRect(tile.x * ts, tile.y * ts, ts, ts);
    ctx.globalAlpha = 1;
  }

  private renderSelectedEntityRing(ctx: CanvasRenderingContext2D, entity: EntityState | null): void {
    if (!entity) return;
    const ts = WORLD.TILE_SIZE;
    const px = entity.x * ts + ts * 0.5, py = entity.y * ts + ts * 0.5;
    const pulse = 1 + Math.sin(this.animOffset * 3) * 0.2;
    ctx.globalAlpha = 0.6; ctx.strokeStyle = '#ffee44'; ctx.lineWidth = 0.5;
    ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath(); ctx.arc(px, py, ts * 0.72 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // ── Helpers ───────────────────────────────────────────────

  private blendHex(hex1: string, hex2: string, t: number): string {
    const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
    const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
    return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
  }
}
