// ============================================================
// UI MANAGER — DOM panel updates
// ============================================================

import { SimulationState } from '../simulation/Simulation';
import { EntityState } from '../entities/Entity';
import { Tile } from '../world/Tile';
import { SettlementManager } from '../entities/SettlementManager';

let _notifId = 0;
interface Notification { id: number; message: string; severity: string; opacity: number; age: number; }

export class UIManager {
  private hud:            HTMLElement;
  private activityLog:    HTMLElement;
  private notifContainer: HTMLElement;
  private popChart:       HTMLElement;
  private infoPanel:      HTMLElement;
  private notifications:  Notification[] = [];

  onTogglePartnerLines?: (v: boolean) => void;
  onToggleFriendLines?:  (v: boolean) => void;

  private _showPartnerLines = false;
  private _showFriendLines  = false;

  constructor() {
    this.hud            = document.getElementById('hud')!;
    this.activityLog    = document.getElementById('activity-log')!;
    this.notifContainer = document.getElementById('notifications')!;
    this.popChart       = document.getElementById('pop-chart')!;
    this.infoPanel      = document.getElementById('info-panel')!;
  }

  update(state: SimulationState): void {
    this.updateHUD(state);
    this.updateActivityLog(state.activityLog);
    this.updatePopChart(state);
    this.updateNotifications();
  }

  private updateHUD(state: SimulationState): void {
    const dist  = state.typeDistribution;
    const total = Math.max(1, Object.values(dist).reduce((a, b) => a + b, 0));
    const typeColors: Record<string, string> = {
      hunter_gatherer: '#ffcc44', villager: '#88dd66',
      farmer: '#44cc88',         craftsman: '#cc8844',
      warrior: '#ff4444',        merchant: '#aa88ff',
      scholar: '#44ddff',        noble: '#ffaa22',
    };
    const typeBar = Object.entries(dist).map(([type, count]) => {
      const pct = (count / total * 100).toFixed(1);
      const color = typeColors[type] ?? '#888';
      return `<div class="type-seg" style="width:${pct}%;background:${color}" title="${type}: ${count}"></div>`;
    }).join('');

    const sl = state.settlementLevels;
    const settlSummary = [
      sl.campsite ? `<span class="hud-stype campsite">${sl.campsite} Campsites</span>` : '',
      sl.hamlet   ? `<span class="hud-stype hamlet">${sl.hamlet} Hamlets</span>` : '',
      sl.village  ? `<span class="hud-stype village">${sl.village} Villages</span>` : '',
    ].filter(Boolean).join(' ');

    this.hud.innerHTML = `
      <div class="hud-row">
        <span class="game-year">Year ${state.year.toLocaleString()}</span>
        <span class="hud-stat">◉ <b>${state.population}</b></span>
      </div>
      <div class="hud-row">
        <span class="hud-stat">↑ Born <b>${state.totalBirths}</b></span>
        <span class="hud-stat">↓ Dead <b>${state.totalDeaths}</b></span>
        <span class="hud-stat">⛏ Res <b>${state.resourcesExtracted}</b></span>
      </div>
      <div class="type-bar-container" title="Population types">${typeBar}</div>
      <div class="hud-row settle-row">${settlSummary || '<span class="hud-stype">No settlements yet</span>'}</div>
    `;
  }

  private updateActivityLog(entries: string[]): void {
    const html = entries.map(msg => `<div class="log-entry">${msg}</div>`).join('');
    this.activityLog.innerHTML =
      `<div class="panel-title">Chronicles</div>${html || '<div class="log-empty">The world awaits…</div>'}`;
  }

  private updatePopChart(state: SimulationState): void {
    const dist = state.typeDistribution;
    const typeColors: Record<string, string> = {
      hunter_gatherer: '#ffcc44', villager: '#88dd66',
      farmer: '#44cc88',         craftsman: '#cc8844',
      warrior: '#ff4444',        merchant: '#aa88ff',
      scholar: '#44ddff',        noble: '#ffaa22',
    };
    const rows = Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
      const color = typeColors[type] ?? '#888';
      const label = type.replace(/_/g, ' ');
      return `<div class="chart-row">
        <span class="chart-dot" style="background:${color}"></span>
        <span class="chart-label">${label}</span>
        <span class="chart-count">${count}</span>
      </div>`;
    }).join('');
    this.popChart.innerHTML = `<div class="panel-title">Population</div>${rows || '<div class="log-empty">—</div>'}`;
  }

  private updateNotifications(): void {
    this.notifications = this.notifications.filter(n => n.opacity > 0);
    for (const n of this.notifications) {
      n.age++;
      if (n.age > 100) n.opacity = Math.max(0, n.opacity - 0.035);
    }
    this.notifContainer.innerHTML = this.notifications.slice(-5)
      .map(n => `<div class="notif notif-${n.severity}" style="opacity:${n.opacity}">${n.message}</div>`)
      .join('');
  }

  pushNotification(message: string, severity: string = 'minor'): void {
    this.notifications.push({ id: _notifId++, message, severity, opacity: 1, age: 0 });
  }

  // ── Entity info panel ─────────────────────────────────────

  updateInfoPanelEntity(entity: EntityState, settlements: SettlementManager): void {
    const typeColors: Record<string, string> = {
      hunter_gatherer: '#ffcc44', villager: '#88dd66',
      farmer: '#44cc88', craftsman: '#cc8844',
      warrior: '#ff4444', merchant: '#aa88ff',
      scholar: '#44ddff', noble: '#ffaa22',
    };

    let currentTask = 'Wandering / Idle';
    if (entity.buildingProjectId !== -1) {
      currentTask = '🔨 Building';
    } else if (entity.actionAnim.type === 'gather') {
      currentTask = '🌾 Gathering Food';
    } else if (entity.actionAnim.type === 'mine') {
      currentTask = '⛏ Mining Resources';
    } else if (entity.actionAnim.type === 'farm') {
      currentTask = '🪴 Farming';
    } else if (entity.memory.returning) {
      currentTask = '⛺ Returning Home';
    } else if (entity.social.socialState === 'chatting') {
      currentTask = '💬 Chatting';
    } else if (entity.social.socialState === 'relaxing') {
      currentTask = '💤 Relaxing';
    } else if (entity.energy < 0.45) {
      currentTask = '🍖 Searching for food';
    }

    const color = typeColors[entity.type] ?? '#ffffff';
    const label = entity.isChild ? 'child' : entity.type.replace(/_/g, ' ');
    const energyPct = Math.round(entity.energy * 100);
    const energyColor = entity.energy > 0.6 ? '#44cc44' : entity.energy > 0.3 ? '#ccaa22' : '#cc2222';
    const settl = entity.settlementId >= 0 ? settlements.getById(entity.settlementId) : null;
    const settlName = settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused';
    const carrying = entity.carryingFood > 0
      ? `🌾 ${entity.carryingFood.toFixed(1)} food`
      : entity.carryingResource > 0
        ? `⛏ ${entity.carryingResource.toFixed(1)} ${entity.carryingResourceType ?? ''}`
        : 'Nothing';

    const geneBar = (val: number) => {
      const pct = Math.round(val * 100);
      const col = val > 0.6 ? '#44cc88' : val > 0.35 ? '#ccaa22' : '#cc4444';
      return `<div class="gene-bar-wrap"><div class="gene-bar" style="width:${pct}%;background:${col}"></div></div>`;
    };

    const s = entity.social;
    const genderIcon = s.gender === 'male' ? '♂' : '♀';
    const orientIcons: Record<string, string> = { straight: '⇄', gay: '⇆', bi: '⇋' };
    const orientIcon  = s.orientation ? orientIcons[s.orientation] : '–';
    const styleLabel  = s.relationshipStyle ?? (entity.isChild ? '–' : '?');
    const roleLabel   = s.followingId !== null ? '↩ following' : s.partnerIds.length > 0 ? '↪ leading' : '—';
    const affairLabel = s.affairPartnerIds.length > 0 ? `#${s.affairPartnerIds.join(', #')}` : '—';
    const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#aaaaaa';
    const stateEmoji: Record<string, string> = { idle: '–', chatting: '💬', relaxing: '💤', seeking: '👀' };

    const pBtnStyle = this._showPartnerLines
      ? 'background:#cc4466;color:#fff;border-color:#ff88aa'
      : 'background:#1a1a22;color:#cc88aa;border-color:#553344';
    const fBtnStyle = this._showFriendLines
      ? 'background:#224466;color:#fff;border-color:#4488cc'
      : 'background:#1a1a22;color:#5588aa;border-color:#223344';

    this.infoPanel.innerHTML = `
      <div class="info-header">
        <span class="info-type-dot" style="background:${color}"></span>
        <span class="info-title" style="color:${color}">${label.toUpperCase()}</span>
        <span class="info-id">${genderIcon} #${entity.id}</span>
      </div>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">Task</span><span class="info-val" style="color:#88ddff;font-weight:bold;">${currentTask}</span></div>
        <div class="info-row"><span class="info-label">Age</span><span class="info-val">${Math.floor(entity.age)} / ${Math.floor(entity.maxAge)}</span></div>
        <div class="info-row"><span class="info-label">Energy</span><span class="info-val" style="color:${energyColor}">${energyPct}%</span></div>
        <div class="info-row"><span class="info-label">Position</span><span class="info-val">${entity.x}, ${entity.y}</span></div>
        <div class="info-row"><span class="info-label">Home</span><span class="info-val">${settlName}</span></div>
        <div class="info-row"><span class="info-label">Carrying</span><span class="info-val">${carrying}</span></div>
        ${entity.isChild ? `<div class="info-row"><span class="info-label">Parent</span><span class="info-val">${entity.parentId >= 0 ? '#' + entity.parentId : '—'}</span></div>` : ''}
      </div>
      <div class="info-divider"></div>
      <div class="info-social">
        <div class="info-social-header">
          <span class="info-genes-title">Social</span>
          <div class="info-social-toggles">
            <button id="btn-partner-lines" style="${pBtnStyle}">❤ Bonds</button>
            <button id="btn-friend-lines"  style="${fBtnStyle}">★ Friends</button>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">${orientIcon} Orientation</span><span class="info-val">${s.orientation ?? '–'}</span></div>
          <div class="info-row"><span class="info-label">❤ Style</span><span class="info-val">${styleLabel}</span></div>
          <div class="info-row"><span class="info-label">State</span><span class="info-val">${stateEmoji[s.socialState] ?? '–'} ${s.socialState}</span></div>
          <div class="info-row"><span class="info-label">Partners</span><span class="info-val">${s.partnerIds.length > 0 ? '#' + s.partnerIds.join(', #') : 'none'}</span></div>
          <div class="info-row"><span class="info-label">Affairs</span><span class="info-val">${affairLabel}</span></div>
          <div class="info-row"><span class="info-label">Friends</span><span class="info-val">${s.friendIds.length > 0 ? s.friendIds.length + ' known' : 'none'}</span></div>
          <div class="info-row"><span class="info-label">Role</span><span class="info-val">${roleLabel}</span></div>
          <div class="info-row"><span class="info-label">Stress</span><span class="info-val" style="color:${stressColor}">${s.stressTicks}</span></div>
        </div>
      </div>
      <div class="info-divider"></div>
      <div class="info-genes">
        <div class="info-genes-title">Genes</div>
        ${Object.entries(entity.genes).map(([k, v]) =>
          `<div class="gene-row"><span class="gene-name">${k.substring(0, 4)}</span>${geneBar(v)}<span class="gene-val">${Math.round(v * 100)}</span></div>`
        ).join('')}
      </div>
    `;
    this.infoPanel.classList.add('active');

    document.getElementById('btn-partner-lines')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._showPartnerLines = !this._showPartnerLines;
      this.onTogglePartnerLines?.(this._showPartnerLines);
      this.updateInfoPanelEntity(entity, settlements);
    });
    document.getElementById('btn-friend-lines')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._showFriendLines = !this._showFriendLines;
      this.onToggleFriendLines?.(this._showFriendLines);
      this.updateInfoPanelEntity(entity, settlements);
    });
  }

  updateInfoPanelTile(tile: Tile): void {
    const typeIcons: Record<string, string> = {
      deep_water: '🌊', shallow_water: '🌊', beach: '🏖',
      plains: '🌿', forest: '🌲', mountain: '⛰', peak: '🏔',
    };
    const icon  = typeIcons[tile.type] ?? '◻';
    const label = tile.type.replace(/_/g, ' ');
    const resources = tile.resources.length > 0
      ? tile.resources.map(r =>
          `<div class="info-row"><span class="info-label">${r.type}</span><span class="info-val">${Math.round(r.amount)}/${r.max}</span></div>`
        ).join('')
      : '<div class="info-row"><span class="info-label">Resources</span><span class="info-val">—</span></div>';

    this.infoPanel.innerHTML = `
      <div class="info-header">
        <span class="info-icon">${icon}</span>
        <span class="info-title">${label.toUpperCase()}</span>
        <span class="info-id">(${tile.x}, ${tile.y})</span>
      </div>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">Elevation</span><span class="info-val">${tile.elevation.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Fertility</span><span class="info-val">${tile.fertility.toFixed(2)}</span></div>
        <div class="info-row"><span class="info-label">Moisture</span><span class="info-val">${tile.moisture.toFixed(2)}</span></div>
        ${tile.improvement ? `<div class="info-row"><span class="info-label">Improvement</span><span class="info-val">${tile.improvement.replace('_', ' ')}</span></div>` : ''}
      </div>
      <div class="info-divider"></div>
      <div class="info-grid">${resources}</div>
    `;
    this.infoPanel.classList.add('active');
  }

  clearInfoPanel(): void {
    this.infoPanel.classList.remove('active');
    this.infoPanel.innerHTML = '';
    this._showPartnerLines = false;
    this._showFriendLines  = false;
    this.onTogglePartnerLines?.(false);
    this.onToggleFriendLines?.(false);
  }
}
