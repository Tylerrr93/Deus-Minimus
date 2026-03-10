// ============================================================
// UI MANAGER — DOM panel updates
//
// KEY DESIGN: The entity info panel is split into two operations:
//   _buildEntityPanel()   — full HTML rebuild (tab switch / new entity)
//   _patchEntityPanel()   — targeted value-only DOM updates (tick loop)
//
// This prevents the hover-flash bug caused by innerHTML replacement
// destroying button elements mid-hover on every refresh cycle.
// Social toggle buttons update only their className, never innerHTML.
// ============================================================

import { SimulationState } from '../simulation/Simulation';
import { EntityState } from '../entities/Entity';
import { Tile } from '../world/Tile';
import { SettlementManager, Settlement, LEVEL_NAMES } from '../entities/SettlementManager';

let _notifId = 0;
interface Notification { id: number; message: string; severity: string; opacity: number; age: number; }

type EntityTab = 'overview' | 'social' | 'skills' | 'genes';

export class UIManager {
  private hud:            HTMLElement;
  private activityLog:    HTMLElement;
  private notifContainer: HTMLElement;
  private popChart:       HTMLElement;
  private infoPanel:      HTMLElement;
  private notifications:  Notification[] = [];

  private _entityTab:    EntityTab = 'overview';
  private _panelMode:    'entity' | 'settlement' | 'tile' | 'none' = 'none';
  private _lastEntityId: number = -1;

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

    // Block all pointer events from passing through panel to canvas
    this.infoPanel.addEventListener('pointerdown', e => e.stopPropagation());
    this.infoPanel.addEventListener('pointerup',   e => e.stopPropagation());
    this.infoPanel.addEventListener('click',       e => e.stopPropagation());
    this.infoPanel.addEventListener('wheel',       e => e.stopPropagation());
  }

  // ── Simulation HUD ────────────────────────────────────────

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
      wanderer:  '#ffcc44', hunter:   '#ff8833', gatherer:  '#88dd66',
      farmer:    '#44cc88', builder:  '#cc8844', crafter:   '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff', scholar:   '#44ddff', elder: '#ffaa22',
    };
    const typeBar = Object.entries(dist).map(([type, count]) => {
      const pct   = (count / total * 100).toFixed(1);
      const color = typeColors[type] ?? '#888';
      return `<div class="type-seg" style="width:${pct}%;background:${color}" title="${type}: ${count}"></div>`;
    }).join('');

    const sl = state.settlementLevels;
    const settlSummary = [
      sl.campsite ? `<span class="hud-stype campsite">${sl.campsite} Campsites</span>` : '',
      sl.hamlet   ? `<span class="hud-stype hamlet">${sl.hamlet} Hamlets</span>`   : '',
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
      wanderer:  '#ffcc44', hunter:   '#ff8833', gatherer:  '#88dd66',
      farmer:    '#44cc88', builder:  '#cc8844', crafter:   '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff', scholar:   '#44ddff', elder: '#ffaa22',
    };
    const rows = Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
      const color = typeColors[type] ?? '#888';
      return `<div class="chart-row">
        <span class="chart-dot" style="background:${color}"></span>
        <span class="chart-label">${type.replace(/_/g, ' ')}</span>
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

  // ── Entity panel public API ───────────────────────────────

  updateInfoPanelEntity(entity: EntityState, settlements: SettlementManager): void {
    const needsFullBuild =
      this._panelMode !== 'entity' ||
      this._lastEntityId !== entity.id;

    if (needsFullBuild) {
      this._buildEntityPanel(entity, settlements);
    } else {
      this._patchEntityPanel(entity, settlements);
    }
  }

  // ── Full panel rebuild ────────────────────────────────────

  private _buildEntityPanel(entity: EntityState, settlements: SettlementManager): void {
    this._panelMode    = 'entity';
    this._lastEntityId = entity.id;

    const roleColors: Record<string, string> = {
      wanderer:  '#ffcc44', hunter:   '#ff8833', gatherer:  '#88dd66',
      farmer:    '#44cc88', builder:  '#cc8844', crafter:   '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff', scholar:   '#44ddff', elder: '#ffaa22',
    };

    const color      = roleColors[entity.type] ?? '#ffffff';
    const label      = entity.isChild ? 'Child' : entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
    const s          = entity.social;
    const settl      = entity.settlementId >= 0 ? settlements.getById(entity.settlementId) : null;
    const genderIcon = s.gender === 'male' ? '♂' : '♀';

    const tabs: EntityTab[] = ['overview', 'social', 'skills', 'genes'];
    const tabLabels: Record<EntityTab, string> = {
      overview: '⚑ Overview', social: '❤ Social', skills: '◈ Skills', genes: '⬡ Genes',
    };

    const tabsHtml = tabs.map(t =>
      `<button class="ip-tab${this._entityTab === t ? ' active' : ''}" data-tab="${t}">${tabLabels[t]}</button>`
    ).join('');

    const contentsHtml = `
      <div class="ip-tab-content${this._entityTab === 'overview' ? ' active' : ''}" data-content="overview">${this._buildOverviewTab(entity, settl)}</div>
      <div class="ip-tab-content${this._entityTab === 'social'   ? ' active' : ''}" data-content="social">${this._buildSocialTab(entity)}</div>
      <div class="ip-tab-content${this._entityTab === 'skills'   ? ' active' : ''}" data-content="skills">${this._buildSkillsTab(entity)}</div>
      <div class="ip-tab-content${this._entityTab === 'genes'    ? ' active' : ''}" data-content="genes">${this._buildGenesTab(entity)}</div>
    `;

    this.infoPanel.innerHTML = `
      <div class="ip-header entity-header">
        <div class="ip-header-left">
          <span class="ip-role-dot" style="background:${color};box-shadow:0 0 6px ${color}88"></span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:${color}">${label}</span>
            <span class="ip-subtitle">${genderIcon} Entity #${entity.id}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-tabs">${tabsHtml}</div>
      <div class="ip-body">${contentsHtml}</div>
    `;

    this.infoPanel.classList.add('active');
    this._bindEntityPanelEvents(entity, settlements);
  }

  // ── Live patch — touch only data nodes, never buttons ─────

  private _patchEntityPanel(entity: EntityState, settlements: SettlementManager): void {
    switch (this._entityTab) {
      case 'overview': {
        const energyColor = entity.energy > 0.6 ? '#44cc88' : entity.energy > 0.3 ? '#ccaa22' : '#cc3333';
        const ageFrac     = entity.age / entity.maxAge;
        const ageColor    = ageFrac > 0.8 ? '#cc3333' : ageFrac > 0.6 ? '#ccaa22' : '#8899cc';
        this._setEl('ip-patch-task',    this._taskLabel(entity));
        this._setEl('ip-patch-energy',  `${Math.round(entity.energy * 100)}%`, energyColor);
        this._setBar('ip-patch-energy-bar', entity.energy * 100, energyColor);
        this._setEl('ip-patch-age',     `${Math.floor(entity.age)} / ${Math.floor(entity.maxAge)}`, ageColor);
        this._setBar('ip-patch-age-bar', ageFrac * 100, ageColor);
        const settl   = entity.settlementId >= 0 ? settlements.getById(entity.settlementId) : null;
        this._setEl('ip-patch-home',    settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused', '#aa88ff');
        const carrying = entity.carryingFood > 0
          ? `🌾 ${entity.carryingFood.toFixed(1)} food`
          : entity.carryingResource > 0
            ? `⛏ ${entity.carryingResource.toFixed(1)} ${entity.carryingResourceType ?? ''}`
            : 'Nothing';
        this._setEl('ip-patch-carrying', carrying);
        break;
      }
      case 'social': {
        const s = entity.social;
        const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#667799';
        const stateEmoji: Record<string, string> = { idle: '—', chatting: '💬', relaxing: '💤', seeking: '👀' };
        this._setEl('ip-patch-state',   `${stateEmoji[s.socialState] ?? '–'} ${s.socialState}`);
        this._setEl('ip-patch-stress',  `${s.stressTicks}`, stressColor);
        this._setBar('ip-patch-stress-bar', Math.min(100, (s.stressTicks / 120) * 100), stressColor);
        break;
      }
      case 'skills': {
        for (const [key, val] of Object.entries(entity.skills)) {
          this._setEl(`ip-patch-skill-${key}`, `${Math.floor(val as number)}`);
          this._setBar(`ip-patch-skillbar-${key}`, Math.min(100, val as number));
        }
        break;
      }
      case 'genes': {
        for (const [key, val] of Object.entries(entity.genes)) {
          const pct = Math.round((val as number) * 100);
          this._setEl(`ip-patch-gene-${key}`, `${pct}`);
          this._setBar(`ip-patch-genebar-${key}`, pct);
        }
        break;
      }
    }
  }

  // ── Helpers for targeted DOM updates ─────────────────────

  private _setEl(pid: string, text: string, color?: string): void {
    const el = this.infoPanel.querySelector(`[data-pid="${pid}"]`) as HTMLElement | null;
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    if (color && el.style.color !== color) el.style.color = color;
  }

  private _setBar(barId: string, pct: number, color?: string): void {
    const el = this.infoPanel.querySelector(`[data-bar="${barId}"]`) as HTMLElement | null;
    if (!el) return;
    const w = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (el.style.width !== w) el.style.width = w;
    if (color && el.style.background !== color) el.style.background = color;
  }

  // ── Tab content builders ──────────────────────────────────

  private _taskLabel(entity: EntityState): string {
    if (entity.buildingProjectId !== -1)          return '🔨 Building';
    if (entity.actionAnim.type === 'gather')       return '🌾 Gathering Food';
    if (entity.actionAnim.type === 'mine')         return '⛏ Mining Resources';
    if (entity.actionAnim.type === 'farm')         return '🪴 Farming';
    if (entity.memory.returning)                   return '⛺ Returning Home';
    if (entity.social.socialState === 'chatting')  return '💬 Chatting';
    if (entity.social.socialState === 'relaxing')  return '💤 Relaxing';
    if (entity.energy < 0.45)                      return '🍖 Seeking Food';
    return 'Wandering / Idle';
  }

  private _buildOverviewTab(entity: EntityState, settl: Settlement | null): string {
    const energyPct   = Math.round(entity.energy * 100);
    const energyColor = entity.energy > 0.6 ? '#44cc88' : entity.energy > 0.3 ? '#ccaa22' : '#cc3333';
    const ageFrac     = entity.age / entity.maxAge;
    const ageColor    = ageFrac > 0.8 ? '#cc3333' : ageFrac > 0.6 ? '#ccaa22' : '#8899cc';
    const settlName   = settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused';
    const carrying    = entity.carryingFood > 0
      ? `🌾 ${entity.carryingFood.toFixed(1)} food`
      : entity.carryingResource > 0
        ? `⛏ ${entity.carryingResource.toFixed(1)} ${entity.carryingResourceType ?? ''}`
        : 'Nothing';

    return `
      <div class="ip-stat-row">
        <span class="ip-stat-label">Task</span>
        <span class="ip-stat-val task-val" data-pid="ip-patch-task">${this._taskLabel(entity)}</span>
      </div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Energy</span>
        <div class="ip-stat-bar-wrap">
          <div class="stat-bar-bg"><div class="stat-bar" data-bar="ip-patch-energy-bar" style="width:${energyPct}%;background:${energyColor}"></div></div>
          <span class="ip-stat-val bar-num" data-pid="ip-patch-energy" style="color:${energyColor}">${energyPct}%</span>
        </div>
      </div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Age</span>
        <div class="ip-stat-bar-wrap">
          <div class="stat-bar-bg"><div class="stat-bar" data-bar="ip-patch-age-bar" style="width:${Math.round(ageFrac * 100)}%;background:${ageColor}"></div></div>
          <span class="ip-stat-val bar-num" data-pid="ip-patch-age" style="color:${ageColor}">${Math.floor(entity.age)} / ${Math.floor(entity.maxAge)}</span>
        </div>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Position</span>
        <span class="ip-stat-val">${entity.x}, ${entity.y}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Home</span>
        <span class="ip-stat-val" data-pid="ip-patch-home" style="color:#aa88ff">${settlName}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Carrying</span>
        <span class="ip-stat-val" data-pid="ip-patch-carrying">${carrying}</span>
      </div>
      ${entity.isChild ? `<div class="ip-stat-row"><span class="ip-stat-label">Parent</span><span class="ip-stat-val">${entity.parentId >= 0 ? '#' + entity.parentId : '—'}</span></div>` : ''}
    `;
  }

  private _buildSocialTab(entity: EntityState): string {
    const s           = entity.social;
    const orientIcons: Record<string, string> = { straight: '⇄', gay: '⇆', bi: '⇋' };
    const orientIcon  = s.orientation ? orientIcons[s.orientation] : '–';
    const stressPct   = Math.min(100, (s.stressTicks / 120) * 100);
    const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#667799';
    const stateEmoji: Record<string, string> = { idle: '—', chatting: '💬', relaxing: '💤', seeking: '👀' };
    const roleLabel   = s.followingId !== null ? '↩ Following' : s.partnerIds.length > 0 ? '↪ Leading' : '—';

    const partnerHtml = s.partnerIds.length > 0
      ? s.partnerIds.map(id => `<span class="id-chip partner">#${id}</span>`).join('')
      : '<span class="ip-stat-empty">none</span>';
    const affairHtml = s.affairPartnerIds.length > 0
      ? s.affairPartnerIds.map(id => `<span class="id-chip affair">#${id}</span>`).join('')
      : '<span class="ip-stat-empty">—</span>';
    const friendHtml = s.friendIds.length > 0
      ? `<span class="id-chip friend">${s.friendIds.length} known</span>`
      : '<span class="ip-stat-empty">none</span>';

    return `
      <div class="ip-social-toggles">
        <button id="btn-partner-lines" class="social-toggle-btn${this._showPartnerLines ? ' active-bond' : ''}">❤ Show Bonds</button>
        <button id="btn-friend-lines"  class="social-toggle-btn${this._showFriendLines  ? ' active-friend' : ''}">★ Show Friends</button>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">${orientIcon} Orientation</span>
        <span class="ip-stat-val">${s.orientation ?? '–'}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">❤ Rel. Style</span>
        <span class="ip-stat-val">${s.relationshipStyle ?? (entity.isChild ? '–' : '?')}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">State</span>
        <span class="ip-stat-val" data-pid="ip-patch-state">${stateEmoji[s.socialState] ?? '–'} ${s.socialState}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Role</span>
        <span class="ip-stat-val">${roleLabel}</span>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-chip-row">
        <span class="ip-stat-label">Partners</span>
        <div class="chip-list">${partnerHtml}</div>
      </div>
      <div class="ip-chip-row">
        <span class="ip-stat-label">Affairs</span>
        <div class="chip-list">${affairHtml}</div>
      </div>
      <div class="ip-chip-row">
        <span class="ip-stat-label">Friends</span>
        <div class="chip-list">${friendHtml}</div>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Stress</span>
        <div class="ip-stat-bar-wrap">
          <div class="stat-bar-bg"><div class="stat-bar" data-bar="ip-patch-stress-bar" style="width:${stressPct}%;background:${stressColor}"></div></div>
          <span class="ip-stat-val bar-num" data-pid="ip-patch-stress" style="color:${stressColor}">${s.stressTicks}</span>
        </div>
      </div>
    `;
  }

  private _buildSkillsTab(entity: EntityState): string {
    const sk = entity.skills;
    const skillIcons:  Record<string, string> = {
      hunting: '🏹', gathering: '🌾', farming: '🪴',
      building: '🔨', crafting: '⛏', trading: '⚖', study: '📜',
    };
    const skillColors: Record<string, string> = {
      hunting: '#ff8833', gathering: '#88dd66', farming: '#44cc88',
      building: '#cc8844', crafting: '#dd6633', trading: '#aa88ff', study: '#44ddff',
    };
    const topSkill = Object.entries(sk).reduce((best, cur) => (cur[1] as number) > (best[1] as number) ? cur : best, ['', 0]);
    const dominant = (topSkill[1] as number) >= 5
      ? `<div class="ip-badge" style="border-color:${skillColors[topSkill[0]] ?? '#8899cc'};color:${skillColors[topSkill[0]] ?? '#8899cc'}">◈ Dominant: ${topSkill[0].toUpperCase()}</div>`
      : `<div class="ip-badge" style="border-color:#445566;color:#667788">◈ No dominant skill yet</div>`;

    const rows = Object.entries(sk).map(([key, val]) => {
      const pct   = Math.min(100, val as number);
      const color = skillColors[key] ?? '#8899cc';
      const icon  = skillIcons[key]  ?? '◈';
      const isTop = key === topSkill[0] && (val as number) >= 5;
      return `
        <div class="skill-row${isTop ? ' top-skill' : ''}">
          <span class="skill-icon">${icon}</span>
          <span class="skill-name">${key}</span>
          <div class="skill-bar-bg"><div class="skill-bar" data-bar="ip-patch-skillbar-${key}" style="width:${pct}%;background:${color}"></div></div>
          <span class="skill-val" data-pid="ip-patch-skill-${key}" style="color:${color}">${Math.floor(val as number)}</span>
        </div>`;
    }).join('');

    return `${dominant}${rows}`;
  }

  private _buildGenesTab(entity: EntityState): string {
    const geneIcons:  Record<string, string> = {
      strength: '⚔', intelligence: '◈', sociability: '❤',
      resilience: '◉', creativity: '✦', ambition: '⬡',
    };
    const geneColors: Record<string, string> = {
      strength: '#ff6644', intelligence: '#44ddff', sociability: '#ff88aa',
      resilience: '#44cc88', creativity: '#ffcc44', ambition: '#cc88ff',
    };
    const geneDesc: Record<string, string> = {
      strength:     'Mining, hunting, combat power',
      intelligence: 'Food scan range, learning speed',
      sociability:  'Relationship formation chance',
      resilience:   'Hunger resistance, lifespan',
      creativity:   'Farming unlock, new behaviours',
      ambition:     'Building motivation, leadership',
    };

    return Object.entries(entity.genes).map(([key, val]) => {
      const pct   = Math.round((val as number) * 100);
      const color = geneColors[key] ?? '#8899cc';
      const icon  = geneIcons[key]  ?? '⬡';
      const desc  = geneDesc[key]   ?? '';
      return `
        <div class="gene-card">
          <div class="gene-card-header">
            <span class="gene-card-icon">${icon}</span>
            <span class="gene-card-name">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
            <span class="gene-card-val" data-pid="ip-patch-gene-${key}" style="color:${color}">${pct}</span>
          </div>
          <div class="gene-card-bar-bg">
            <div class="gene-card-bar" data-bar="ip-patch-genebar-${key}" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="gene-card-desc">${desc}</div>
        </div>`;
    }).join('');
  }

  // ── Event bindings ────────────────────────────────────────

  private _bindEntityPanelEvents(entity: EntityState, settlements: SettlementManager): void {
    this.infoPanel.querySelectorAll('.ip-tab').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const tab = (btn as HTMLElement).dataset.tab as EntityTab;
        if (tab && tab !== this._entityTab) {
          this._entityTab = tab;
          this._buildEntityPanel(entity, settlements);
        }
      });
    });

    document.getElementById('ip-close-btn')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); this.clearInfoPanel();
    });

    // Social toggles: update only className, never re-render innerHTML
    document.getElementById('btn-partner-lines')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._showPartnerLines = !this._showPartnerLines;
      this.onTogglePartnerLines?.(this._showPartnerLines);
      const btn = document.getElementById('btn-partner-lines');
      if (btn) btn.className = `social-toggle-btn${this._showPartnerLines ? ' active-bond' : ''}`;
    });

    document.getElementById('btn-friend-lines')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._showFriendLines = !this._showFriendLines;
      this.onToggleFriendLines?.(this._showFriendLines);
      const btn = document.getElementById('btn-friend-lines');
      if (btn) btn.className = `social-toggle-btn${this._showFriendLines ? ' active-friend' : ''}`;
    });
  }

  // ── Settlement panel ──────────────────────────────────────

  updateInfoPanelSettlement(settlement: Settlement): void {
    if (this._panelMode !== 'settlement') {
      this._buildSettlementPanel(settlement);
    } else {
      this._patchSettlementPanel(settlement);
    }
  }

  private _buildSettlementPanel(settlement: Settlement): void {
    this._panelMode = 'settlement';
    const levelColors: Record<number, string> = { 1: '#c87a22', 2: '#d4aa44', 3: '#88cc66' };
    const color     = levelColors[settlement.level] ?? '#8899cc';
    const levelName = LEVEL_NAMES[settlement.level];
    const foodPct   = Math.round((settlement.foodStorage / settlement.maxFoodStorage) * 100);
    const foodColor = foodPct > 50 ? '#44aa44' : foodPct > 25 ? '#aaaa22' : '#aa2222';
    const activeProjects   = settlement.projects.filter(p => !p.complete);
    const completedCount   = settlement.projects.filter(p => p.complete).length;

    const projectsHtml = activeProjects.length > 0
      ? activeProjects.map(p => {
          const pct       = Math.round(p.progress * 100);
          const projColor = p.type === 'dirt_road' ? '#8a7050' : '#a07848';
          const projIcon  = p.type === 'dirt_road' ? '🛤' : '🏠';
          return `
            <div class="project-row">
              <span class="project-icon">${projIcon}</span>
              <span class="project-name">${p.type.replace('_', ' ')}</span>
              <div class="stat-bar-bg" style="flex:1"><div class="stat-bar" style="width:${pct}%;background:${projColor}"></div></div>
              <span class="project-pct">${pct}%</span>
              <span class="project-workers">${p.workerIds.length}👤</span>
            </div>`;
        }).join('')
      : '<div class="ip-stat-empty" style="padding:4px 0">No active projects</div>';

    this.infoPanel.innerHTML = `
      <div class="ip-header settlement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:${color}">${settlement.level === 1 ? '⛺' : settlement.level === 2 ? '🏠' : '🏘'}</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:${color}">${settlement.name}</span>
            <span class="ip-subtitle">${levelName} · Age <span data-pid="s-age">${settlement.age}</span></span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="settle-stat-grid">
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-pop">${settlement.population}</span><span class="settle-stat-label">Population</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-homes">${settlement.homesBuilt}</span><span class="settle-stat-label">Homes</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-roads">${settlement.roadsBuilt}</span><span class="settle-stat-label">Roads</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-tech">${Math.floor(settlement.techPoints)}</span><span class="settle-stat-label">Tech Pts</span></div>
        </div>
        <div class="ip-divider"></div>
        <div class="ip-stat-row bar-row">
          <span class="ip-stat-label">Food</span>
          <div class="ip-stat-bar-wrap">
            <div class="stat-bar-bg"><div class="stat-bar" data-bar="s-food-bar" style="width:${foodPct}%;background:${foodColor}"></div></div>
            <span class="ip-stat-val bar-num" data-pid="s-food" style="color:${foodColor}">${Math.floor(settlement.foodStorage)}/${settlement.maxFoodStorage}</span>
          </div>
        </div>
        <div class="ip-stat-row">
          <span class="ip-stat-label">🪵 Wood</span>
          <span class="ip-stat-val" data-pid="s-wood">${Math.floor(settlement.woodStorage)}</span>
        </div>
        <div class="ip-stat-row">
          <span class="ip-stat-label">🪨 Stone</span>
          <span class="ip-stat-val" data-pid="s-stone">${Math.floor(settlement.stoneStorage)}</span>
        </div>
        <div class="ip-divider"></div>
        <div class="settle-section-title">Active Projects (${activeProjects.length})</div>
        ${projectsHtml}
        ${completedCount > 0 ? `<div class="ip-stat-row" style="margin-top:4px"><span class="ip-stat-label">Completed</span><span class="ip-stat-val" style="color:#667799">${completedCount} done</span></div>` : ''}
        <div class="ip-divider"></div>
        <div class="settle-coords">📍 ${settlement.x}, ${settlement.y}</div>
      </div>
    `;
    this.infoPanel.classList.add('active');
    document.getElementById('ip-close-btn')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); this.clearInfoPanel();
    });
  }

  private _patchSettlementPanel(settlement: Settlement): void {
    const foodPct   = Math.round((settlement.foodStorage / settlement.maxFoodStorage) * 100);
    const foodColor = foodPct > 50 ? '#44aa44' : foodPct > 25 ? '#aaaa22' : '#aa2222';
    this._setEl('s-pop',   `${settlement.population}`);
    this._setEl('s-homes', `${settlement.homesBuilt}`);
    this._setEl('s-roads', `${settlement.roadsBuilt}`);
    this._setEl('s-tech',  `${Math.floor(settlement.techPoints)}`);
    this._setEl('s-age',   `${settlement.age}`);
    this._setEl('s-food',  `${Math.floor(settlement.foodStorage)}/${settlement.maxFoodStorage}`, foodColor);
    this._setEl('s-wood',  `${Math.floor(settlement.woodStorage)}`);
    this._setEl('s-stone', `${Math.floor(settlement.stoneStorage)}`);
    this._setBar('s-food-bar', foodPct, foodColor);
  }

  // ── Tile / improvement panel ──────────────────────────────

  updateInfoPanelTile(tile: Tile): void {
    this._panelMode = 'tile';
    if      (tile.improvement === 'dirt_road')  this._showRoadPanel(tile);
    else if (tile.improvement === 'rough_home') this._showHomePanel(tile);
    else if (tile.improvement === 'farm')       this._showFarmPanel(tile);
    else                                         this._showGenericTilePanel(tile);
  }

  private _showRoadPanel(tile: Tile): void {
    this.infoPanel.innerHTML = `
      <div class="ip-header improvement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:#8a7050">🛤</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:#c4a870">Dirt Road</span>
            <span class="ip-subtitle">Infrastructure · ${tile.x}, ${tile.y}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="ip-flavour">A rough path worn by the feet of many, connecting settlement to resource.</div>
        <div class="ip-divider"></div>
        ${this._tileBaseStats(tile)}
      </div>`;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _showHomePanel(tile: Tile): void {
    this.infoPanel.innerHTML = `
      <div class="ip-header improvement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:#a07848">🏠</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:#c49a5a">Rough Home</span>
            <span class="ip-subtitle">Dwelling · ${tile.x}, ${tile.y}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="ip-flavour">A humble structure of wood and mud. Shelter from the wild, built by willing hands.</div>
        <div class="ip-divider"></div>
        ${this._tileBaseStats(tile)}
      </div>`;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _showFarmPanel(tile: Tile): void {
    const food    = tile.resources.find(r => r.type === 'food');
    const foodPct = food ? Math.round((food.amount / food.max) * 100) : 0;
    this.infoPanel.innerHTML = `
      <div class="ip-header improvement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:#44cc88">🪴</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:#88dd66">Cultivated Farm</span>
            <span class="ip-subtitle">Agriculture · ${tile.x}, ${tile.y}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="ip-flavour">Rows cut by careful hands. Regen rate doubled by cultivation.</div>
        <div class="ip-divider"></div>
        ${food ? `
          <div class="ip-stat-row bar-row">
            <span class="ip-stat-label">Food Yield</span>
            <div class="ip-stat-bar-wrap">
              <div class="stat-bar-bg"><div class="stat-bar" style="width:${foodPct}%;background:#44cc88"></div></div>
              <span class="ip-stat-val bar-num" style="color:#44cc88">${food.amount.toFixed(1)}/${food.max}</span>
            </div>
          </div>
          <div class="ip-stat-row">
            <span class="ip-stat-label">Regen Rate</span>
            <span class="ip-stat-val" style="color:#44cc88">×2.5 base</span>
          </div>
          <div class="ip-divider"></div>` : ''}
        ${this._tileBaseStats(tile)}
      </div>`;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _showGenericTilePanel(tile: Tile): void {
    const typeIcons: Record<string, string> = {
      deep_water: '🌊', shallow_water: '🌊', beach: '🏖',
      plains: '🌿', forest: '🌲', mountain: '⛰', peak: '🏔',
    };
    const typeColors: Record<string, string> = {
      deep_water: '#1a3a5a', shallow_water: '#2a5a7a', beach: '#c8b880',
      plains: '#5a8a3a', forest: '#2a5a2a', mountain: '#7a7a7a', peak: '#c8c8d8',
    };
    const icon  = typeIcons[tile.type]  ?? '◻';
    const color = typeColors[tile.type] ?? '#8899cc';
    const label = tile.type.replace(/_/g, ' ');

    const resources = tile.resources.length > 0
      ? tile.resources.map(r => {
          const pct      = Math.round((r.amount / r.max) * 100);
          const resColor = r.type === 'food' ? '#88dd66' : r.type === 'wood' ? '#6a9a4a'
            : r.type === 'stone' ? '#9a9a9a' : r.type === 'iron' ? '#aa7755' : '#aa88ff';
          return `
            <div class="ip-stat-row bar-row">
              <span class="ip-stat-label">${r.type}</span>
              <div class="ip-stat-bar-wrap">
                <div class="stat-bar-bg"><div class="stat-bar" style="width:${pct}%;background:${resColor}"></div></div>
                <span class="ip-stat-val bar-num" style="color:${resColor}">${Math.floor(r.amount)}/${r.max}</span>
              </div>
            </div>`;
        }).join('')
      : '<div class="ip-stat-empty">No resources</div>';

    this.infoPanel.innerHTML = `
      <div class="ip-header tile-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon">${icon}</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:${color}">${label.toUpperCase()}</span>
            <span class="ip-subtitle">Tile · ${tile.x}, ${tile.y}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        ${this._tileBaseStats(tile)}
        <div class="ip-divider"></div>
        <div class="settle-section-title">Resources</div>
        ${resources}
      </div>`;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _tileBaseStats(tile: Tile): string {
    return `
      <div class="ip-stat-row">
        <span class="ip-stat-label">Elevation</span>
        <span class="ip-stat-val">${tile.elevation.toFixed(3)}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Fertility</span>
        <span class="ip-stat-val">${tile.fertility.toFixed(3)}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Moisture</span>
        <span class="ip-stat-val">${tile.moisture.toFixed(3)}</span>
      </div>
      ${tile.occupied ? `<div class="ip-stat-row"><span class="ip-stat-label">Occupied</span><span class="ip-stat-val" style="color:#ffcc44">Yes</span></div>` : ''}
    `;
  }

  private _bindClose(): void {
    document.getElementById('ip-close-btn')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); this.clearInfoPanel();
    });
  }

  clearInfoPanel(): void {
    this._panelMode    = 'none';
    this._lastEntityId = -1;
    this.infoPanel.classList.remove('active');
    this.infoPanel.innerHTML = '';
    this._showPartnerLines = false;
    this._showFriendLines  = false;
    this.onTogglePartnerLines?.(false);
    this.onToggleFriendLines?.(false);
  }
}
