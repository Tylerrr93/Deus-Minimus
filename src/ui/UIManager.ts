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
import { SIM } from '../config/constants';

let _notifId = 0;
interface Notification { id: number; message: string; severity: string; opacity: number; age: number; }

type EntityTab = 'overview' | 'social' | 'skills' | 'genes';

// ── Tick → Year conversion ─────────────────────────────────
const TICKS_PER_YEAR = SIM.TICKS_PER_YEAR;

function ticksToYears(ticks: number): number {
  return Math.floor(ticks / TICKS_PER_YEAR);
}

function ticksToYearsDecimal(ticks: number): string {
  const years = ticks / TICKS_PER_YEAR;
  if (years < 1) return `${Math.floor(ticks)} days`;
  return `${years.toFixed(1)} yrs`;
}

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

    const stopEvent = (e: Event) => e.stopPropagation();
    this.infoPanel.addEventListener('mousedown', stopEvent);
    this.infoPanel.addEventListener('mouseup', stopEvent);
    this.infoPanel.addEventListener('click', stopEvent);
    this.infoPanel.addEventListener('wheel', stopEvent, { passive: false });

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
        const ageYears    = ticksToYears(entity.age);
        const maxAgeYears = ticksToYears(entity.maxAge);
        const ageFrac     = entity.age / entity.maxAge;
        const ageColor    = ageFrac > 0.8 ? '#cc3333' : ageFrac > 0.6 ? '#ccaa22' : '#8899cc';
        const yearsLeft   = maxAgeYears - ageYears;
        this._setEl('ip-patch-action',  this._actionLabel(entity));
        this._setEl('ip-patch-task',    this._brainTaskLabel(entity));
        this._setEl('ip-patch-energy',  `${Math.round(entity.energy * 100)}%`, energyColor);
        this._setBar('ip-patch-energy-bar', entity.energy * 100, energyColor);
        this._setEl('ip-patch-age',     `${ageYears} yrs`, ageColor);
        this._setEl('ip-patch-agelife', `~${yearsLeft} left`, yearsLeft < 5 ? '#cc3333' : '#667799');
        this._setBar('ip-patch-age-bar', ageFrac * 100, ageColor);
        const settl   = entity.settlementId >= 0 ? settlements.getById(entity.settlementId) : null;
        this._setEl('ip-patch-home',    settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused', '#aa88ff');
        this._setEl('ip-patch-carrying', this._carryingLabel(entity));
        this._setEl('ip-patch-repro',   entity.reproductionCooldown > 0
          ? `${ticksToYearsDecimal(entity.reproductionCooldown)}` : 'Ready');
        break;
      }
      case 'social': {
        const thought = this._generateThought(entity, null);
        this._setEl('ip-patch-thought', thought);
        const s = entity.social;
        const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#667799';
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

  // ── Label helpers ─────────────────────────────────────────

  /** What the entity is physically doing RIGHT NOW (animation / movement state). */
  private _actionLabel(entity: EntityState): string {
    if (entity.buildingProjectId !== -1)          return '🔨 Building';
    if (entity.actionAnim.type === 'gather')       return '🌾 Foraging';
    if (entity.actionAnim.type === 'mine')         return '⛏ Mining';
    if (entity.actionAnim.type === 'farm')         return '🪴 Farming';
    if (entity.actionAnim.type === 'build')        return '🔨 Constructing';
    if (entity.memory.returning)                   return '⛺ Heading Home';
    if (entity.social.socialState === 'chatting')  return '💬 Chatting';
    if (entity.social.socialState === 'relaxing')  return '💤 Resting';
    if (entity.energy < 0.35)                      return '🍖 Desperately Hungry';
    if (entity.energy < 0.55)                      return '🍖 Looking for Food';
    if (entity.isChild)                            return '🐾 Exploring';
    return '🚶 Wandering';
  }

  /** The role the Settlement Brain has assigned this entity. */
  private _brainTaskLabel(entity: EntityState): string {
    if (entity.settlementId === -1) return 'Nomad — no assignment';
    if (!entity.currentTask || entity.currentTask === 'idle') return 'Unassigned';
    const labels: Record<string, string> = {
      gather: '🌾 Gather Food',
      wood:   '🪵 Cut Wood',
      build:  '🔨 Build',
      farm:   '🌱 Farm',
      mine:   '⛏ Mine',
      trade:  '⚖ Trade',
    };
    return labels[entity.currentTask] ?? entity.currentTask;
  }

  /** Everything the entity is physically carrying. */
  private _carryingLabel(entity: EntityState): string {
    const parts: string[] = [];
    if (entity.carryingFood > 0) {
      parts.push(`🌾 ${entity.carryingFood.toFixed(1)} food`);
    }
    if (entity.carryingResource > 0 && entity.carryingResourceType) {
      const icons: Record<string, string> = { wood: '🌳', stone: '⛏', iron: '⚪' };
      const icon = icons[entity.carryingResourceType] ?? '⛏';
      parts.push(`${icon} ${entity.carryingResource.toFixed(1)} ${entity.carryingResourceType}`);
    }
    return parts.length > 0 ? parts.join('  ') : 'Nothing';
  }

  /**
   * Generates a short contextual "thought" for the entity based on
   * their current conditions — replaces the old bland social state display.
   */
  private _generateThought(entity: EntityState, _settl: Settlement | null): string {
    const s = entity.social;
    const e = entity.energy;
    const stress = s.stressTicks;
    const hasPartner = s.partnerIds.length > 0;
    const hasAffair  = s.affairPartnerIds.length > 0;
    const hasFriends = s.friendIds.length > 0;
    const alone      = s.ticksAloneFromPartners > 100;
    const task       = entity.currentTask;
    const returning  = entity.memory.returning;

    // Crisis states first
    if (e <= 0.15) return `"I… can't go on much longer."`;
    if (e <= 0.25) return `"Must find something to eat. Anything."`;
    if (e <= 0.40) return `"My stomach aches. Food. Now."`;

    // High stress
    if (stress > 80) return `"Everything is falling apart."`;
    if (stress > 50) {
      if (hasPartner && alone) return `"Why haven't they come back?"`;
      return `"I can't shake this feeling of dread."`;
    }

    // Task-focused thoughts
    if (entity.buildingProjectId !== -1)      return `"One plank at a time. It'll stand."`;
    if (entity.actionAnim.type === 'farm')    return `"The soil is good here. It'll yield."`;
    if (entity.actionAnim.type === 'mine')    return `"Stone by stone."`;
    if (entity.actionAnim.type === 'gather')  return `"A bit more and I'll head back."`;
    if (returning && entity.carryingFood > 0) return `"Heavy load. They'll eat well tonight."`;
    if (returning)                            return `"Time to bring this back."`;

    // Social states
    if (s.socialState === 'chatting') {
      if (hasFriends) return `"Good to see a familiar face."`;
      return `"Maybe we can be friends."`;
    }
    if (s.socialState === 'relaxing') {
      if (e > 0.85) return `"A moment's peace. I've earned it."`;
      return `"Just need to catch my breath."`;
    }

    // Relationship thoughts
    if (hasAffair && hasPartner)       return `"This is getting complicated."`;
    if (hasAffair)                     return `"My heart is pulled in two directions."`;
    if (s.seekCooldown === 0 && !hasPartner && !entity.isChild) {
      return `"I wonder if I'll find someone."`;
    }
    if (alone && hasPartner)           return `"I miss them."`;
    if (hasPartner && e > 0.7 && !alone) return `"Content. For now."`;

    // Assignment-based
    if (task === 'gather')  return `"Always hungry mouths to fill."`;
    if (task === 'wood')    return `"The forest gives what we need."`;
    if (task === 'build')   return `"This place deserves better walls."`;
    if (task === 'farm')    return `"Patience. The harvest will come."`;
    if (task === 'mine')    return `"Somewhere down here, iron."`;
    if (task === 'trade')   return `"A fair deal benefits everyone."`;

    // Default calm thoughts
    if (entity.isChild)     return `"The world is so big."`;
    if (e > 0.85 && hasFriends && hasPartner) return `"Life is… not so bad."`;
    if (e > 0.7)            return `"What next, I wonder."`;
    return `"Keeping on."`;
  }

  // ── Tab content builders ──────────────────────────────────

  private _buildOverviewTab(entity: EntityState, settl: Settlement | null): string {
    const energyPct   = Math.round(entity.energy * 100);
    const energyColor = entity.energy > 0.6 ? '#44cc88' : entity.energy > 0.3 ? '#ccaa22' : '#cc3333';
    const ageFrac     = entity.age / entity.maxAge;
    const ageColor    = ageFrac > 0.8 ? '#cc3333' : ageFrac > 0.6 ? '#ccaa22' : '#8899cc';
    const ageYears    = ticksToYears(entity.age);
    const maxAgeYears = ticksToYears(entity.maxAge);
    const yearsLeft   = maxAgeYears - ageYears;
    const settlName   = settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused';
    const carrying    = this._carryingLabel(entity);
    const reproReady  = entity.reproductionCooldown <= 0;
    const reproLabel  = reproReady ? 'Ready' : ticksToYearsDecimal(entity.reproductionCooldown);
    const reproColor  = reproReady ? '#44cc88' : '#667799';

    // Housing context
    let housingNote = '';
    if (settl) {
      const { ENTITY: _E, SETTLEMENT: _S } = { ENTITY: { SHELTER_BASE: 8, SHELTER_PER_HOME: 4 }, SETTLEMENT: {} };
      const cap = 8 + settl.homesBuilt * 4;
      if (settl.population >= cap) {
        housingNote = `<div class="ip-warn-row">⚠ Settlement at housing capacity (${cap})</div>`;
      }
    }

    return `
      <div class="ip-stat-row">
        <span class="ip-stat-label">Doing</span>
        <span class="ip-stat-val task-val" data-pid="ip-patch-action">${this._actionLabel(entity)}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Assigned</span>
        <span class="ip-stat-val" style="color:#88aacc" data-pid="ip-patch-task">${this._brainTaskLabel(entity)}</span>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Vitality</span>
        <div class="ip-stat-bar-wrap">
          <div class="stat-bar-bg"><div class="stat-bar" data-bar="ip-patch-energy-bar" style="width:${energyPct}%;background:${energyColor}"></div></div>
          <span class="ip-stat-val bar-num" data-pid="ip-patch-energy" style="color:${energyColor}">${energyPct}%</span>
        </div>
      </div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Age</span>
        <div class="ip-stat-bar-wrap">
          <div class="stat-bar-bg"><div class="stat-bar" data-bar="ip-patch-age-bar" style="width:${Math.round(ageFrac * 100)}%;background:${ageColor}"></div></div>
          <span class="ip-stat-val bar-num" data-pid="ip-patch-age" style="color:${ageColor}">${ageYears} yrs</span>
        </div>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Lifespan</span>
        <span class="ip-stat-val" data-pid="ip-patch-agelife" style="color:${yearsLeft < 5 ? '#cc3333' : '#667799'}">~${yearsLeft} left of ${maxAgeYears}</span>
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
      <div class="ip-stat-row">
        <span class="ip-stat-label">Reproduct.</span>
        <span class="ip-stat-val" data-pid="ip-patch-repro" style="color:${reproColor}">${reproLabel}</span>
      </div>
      ${entity.isChild ? `<div class="ip-stat-row"><span class="ip-stat-label">Parent</span><span class="ip-stat-val">${entity.parentId >= 0 ? '#' + entity.parentId : '—'}</span></div>` : ''}
      ${housingNote}
    `;
  }

  private _buildSocialTab(entity: EntityState): string {
    const s           = entity.social;
    const settl       = null; // passed separately in patch
    const orientIcons: Record<string, string> = { straight: '⇄', gay: '⇆', bi: '⇋' };
    const orientIcon  = s.orientation ? orientIcons[s.orientation] : '–';
    const stressPct   = Math.min(100, (s.stressTicks / 120) * 100);
    const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#667799';
    const roleLabel   = s.followingId !== null ? '↩ Following' : s.partnerIds.length > 0 ? '↪ Leading' : '—';

    const thought = this._generateThought(entity, settl);

    const partnerHtml = s.partnerIds.length > 0
      ? s.partnerIds.map(id => `<span class="id-chip partner">#${id}</span>`).join('')
      : '<span class="ip-stat-empty">none</span>';
    const affairHtml = s.affairPartnerIds.length > 0
      ? s.affairPartnerIds.map(id => `<span class="id-chip affair">#${id}</span>`).join('')
      : '<span class="ip-stat-empty">—</span>';
    const friendHtml = s.friendIds.length > 0
      ? `<span class="id-chip friend">${s.friendIds.length} known</span>`
      : '<span class="ip-stat-empty">none</span>';

    // Alone-from-partner ticker
    let lonelinessNote = '';
    if (s.partnerIds.length > 0 && s.ticksAloneFromPartners > 80) {
      const ticksAway = s.ticksAloneFromPartners;
      lonelinessNote = `<div class="ip-warn-row">💔 Apart from partner for ${ticksToYearsDecimal(ticksAway)}</div>`;
    }

    return `
      <div class="ip-thought-box">
        <span class="ip-thought-label">Thoughts</span>
        <span class="ip-thought-text" data-pid="ip-patch-thought">${thought}</span>
      </div>
      <div class="ip-divider"></div>
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
      ${lonelinessNote}
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
    // Unlock thresholds — what each skill unlocks at certain levels
    const skillUnlocks: Record<string, [number, string][]> = {
      hunting:   [[5, 'longer hunt range'], [20, 'rich kills']],
      gathering: [[5, 'wider scan'], [15, 'rich forage']],
      farming:   [[2, 'can farm'], [10, 'fast harvest']],
      building:  [[2, 'can build'], [15, 'fast builds']],
      crafting:  [[3, 'can mine'], [20, 'rich yields']],
      trading:   [[5, 'can trade'], [15, 'efficient routes']],
      study:     [[1, 'drips tech pts'], [10, 'fast drip']],
    };

    const topSkill = Object.entries(sk).reduce((best, cur) => (cur[1] as number) > (best[1] as number) ? cur : best, ['', 0]);
    const dominant = (topSkill[1] as number) >= 5
      ? `<div class="ip-badge" style="border-color:${skillColors[topSkill[0]] ?? '#8899cc'};color:${skillColors[topSkill[0]] ?? '#8899cc'}">◈ Dominant: ${topSkill[0].toUpperCase()}</div>`
      : `<div class="ip-badge" style="border-color:#445566;color:#667788">◈ No dominant skill yet</div>`;

    const rows = Object.entries(sk).map(([key, val]) => {
      const pct    = Math.min(100, val as number);
      const color  = skillColors[key] ?? '#8899cc';
      const icon   = skillIcons[key]  ?? '◈';
      const isTop  = key === topSkill[0] && (val as number) >= 5;
      const unlocks = skillUnlocks[key] ?? [];
      // Find the highest unlocked tier
      const unlocked = unlocks.filter(([thresh]) => (val as number) >= thresh);
      const nextUp   = unlocks.find(([thresh]) => (val as number) < thresh);
      const unlockedHtml = unlocked.length > 0
        ? `<span class="skill-unlock">${unlocked[unlocked.length - 1][1]}</span>`
        : nextUp
          ? `<span class="skill-locked">@${nextUp[0]}: ${nextUp[1]}</span>`
          : '';
      return `
        <div class="skill-row${isTop ? ' top-skill' : ''}">
          <span class="skill-icon">${icon}</span>
          <div class="skill-main">
            <div class="skill-name-row">
              <span class="skill-name">${key}</span>
              ${unlockedHtml}
            </div>
            <div class="skill-bar-bg"><div class="skill-bar" data-bar="ip-patch-skillbar-${key}" style="width:${pct}%;background:${color}"></div></div>
          </div>
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
    // Qualitative labels
    const geneRating = (val: number): string => {
      if (val >= 0.80) return 'Exceptional';
      if (val >= 0.65) return 'High';
      if (val >= 0.45) return 'Average';
      if (val >= 0.30) return 'Low';
      return 'Weak';
    };

    return Object.entries(entity.genes).map(([key, val]) => {
      const pct   = Math.round((val as number) * 100);
      const color = geneColors[key] ?? '#8899cc';
      const icon  = geneIcons[key]  ?? '⬡';
      const desc  = geneDesc[key]   ?? '';
      const rating = geneRating(val as number);
      const ratingColor = (val as number) >= 0.65 ? '#44cc88' : (val as number) >= 0.45 ? '#ccaa22' : '#cc6644';
      return `
        <div class="gene-card">
          <div class="gene-card-header">
            <span class="gene-card-icon">${icon}</span>
            <span class="gene-card-name">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
            <span class="gene-card-rating" style="color:${ratingColor}">${rating}</span>
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

    // Housing capacity
    const housingCap    = 8 + settlement.homesBuilt * 4;
    const housingColor  = settlement.population >= housingCap ? '#cc4444' : '#44cc88';
    const housingLabel  = `${settlement.population} / ${housingCap}`;

    // Needs matrix
    const n = settlement.needs;
    const foodNeedPct  = Math.round(n.food * 100);
    const woodNeedPct  = Math.round(n.wood * 100);
    const foodNeedColor = n.food > 0.8 ? '#cc3333' : n.food > 0.5 ? '#ccaa22' : '#44cc88';
    const woodNeedColor = n.wood > 0.7 ? '#ccaa22' : '#667799';

    // Agri status
    const agriHtml = settlement.agriUnlocked
      ? `<div class="ip-stat-row">
           <span class="ip-stat-label">🌱 Agri</span>
           <span class="ip-stat-val" style="color:#44cc88">${settlement.farmPlots.length} plots active</span>
         </div>`
      : `<div class="ip-stat-row">
           <span class="ip-stat-label">🌱 Agri</span>
           <span class="ip-stat-val" style="color:#667799">Not yet unlocked (${Math.floor(settlement.techPoints)}/${40} tech)</span>
         </div>`;

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
            <span class="ip-subtitle">${levelName} · Age <span data-pid="s-age">${ticksToYears(settlement.age)} yrs</span></span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="settle-stat-grid">
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-pop">${settlement.population}</span><span class="settle-stat-label">People</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-homes">${settlement.homesBuilt}</span><span class="settle-stat-label">Homes</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-roads">${settlement.roadsBuilt}</span><span class="settle-stat-label">Roads</span></div>
          <div class="settle-stat"><span class="settle-stat-val" data-pid="s-tech">${Math.floor(settlement.techPoints)}</span><span class="settle-stat-label">Tech</span></div>
        </div>
        <div class="ip-divider"></div>
        <div class="ip-stat-row">
          <span class="ip-stat-label">🏠 Housing</span>
          <span class="ip-stat-val" data-pid="s-housing" style="color:${housingColor}">${housingLabel}</span>
        </div>
        <div class="ip-stat-row bar-row">
          <span class="ip-stat-label">🌾 Food</span>
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
        <div class="settle-section-title">Needs</div>
        <div class="ip-stat-row bar-row">
          <span class="ip-stat-label">Food Need</span>
          <div class="ip-stat-bar-wrap">
            <div class="stat-bar-bg"><div class="stat-bar" data-bar="s-foodneed-bar" style="width:${foodNeedPct}%;background:${foodNeedColor}"></div></div>
            <span class="ip-stat-val bar-num" data-pid="s-foodneed" style="color:${foodNeedColor}">${foodNeedPct}%</span>
          </div>
        </div>
        <div class="ip-stat-row bar-row">
          <span class="ip-stat-label">Wood Need</span>
          <div class="ip-stat-bar-wrap">
            <div class="stat-bar-bg"><div class="stat-bar" data-bar="s-woodneed-bar" style="width:${woodNeedPct}%;background:${woodNeedColor}"></div></div>
            <span class="ip-stat-val bar-num" data-pid="s-woodneed" style="color:${woodNeedColor}">${woodNeedPct}%</span>
          </div>
        </div>
        <div class="ip-divider"></div>
        ${agriHtml}
        <div class="ip-divider"></div>
        <div class="settle-section-title">Projects (${activeProjects.length} active)</div>
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
    const foodPct    = Math.round((settlement.foodStorage / settlement.maxFoodStorage) * 100);
    const foodColor  = foodPct > 50 ? '#44aa44' : foodPct > 25 ? '#aaaa22' : '#aa2222';
    const housingCap = 8 + settlement.homesBuilt * 4;
    const housingColor = settlement.population >= housingCap ? '#cc4444' : '#44cc88';
    const n = settlement.needs;
    const foodNeedPct   = Math.round(n.food * 100);
    const woodNeedPct   = Math.round(n.wood * 100);
    const foodNeedColor = n.food > 0.8 ? '#cc3333' : n.food > 0.5 ? '#ccaa22' : '#44cc88';
    const woodNeedColor = n.wood > 0.7 ? '#ccaa22' : '#667799';

    this._setEl('s-pop',      `${settlement.population}`);
    this._setEl('s-homes',    `${settlement.homesBuilt}`);
    this._setEl('s-roads',    `${settlement.roadsBuilt}`);
    this._setEl('s-tech',     `${Math.floor(settlement.techPoints)}`);
    this._setEl('s-age',      `${ticksToYears(settlement.age)} yrs`);
    this._setEl('s-food',     `${Math.floor(settlement.foodStorage)}/${settlement.maxFoodStorage}`, foodColor);
    this._setEl('s-wood',     `${Math.floor(settlement.woodStorage)}`);
    this._setEl('s-stone',    `${Math.floor(settlement.stoneStorage)}`);
    this._setEl('s-housing',  `${settlement.population} / ${housingCap}`, housingColor);
    this._setEl('s-foodneed', `${foodNeedPct}%`, foodNeedColor);
    this._setEl('s-woodneed', `${woodNeedPct}%`, woodNeedColor);
    this._setBar('s-food-bar',     foodPct,     foodColor);
    this._setBar('s-foodneed-bar', foodNeedPct, foodNeedColor);
    this._setBar('s-woodneed-bar', woodNeedPct, woodNeedColor);
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
        <div class="ip-stat-row"><span class="ip-stat-label">Shelters</span><span class="ip-stat-val" style="color:#44cc88">up to 4 people</span></div>
        <div class="ip-divider"></div>
        ${this._tileBaseStats(tile)}
      </div>`;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _showFarmPanel(tile: Tile): void {
    const food    = tile.resources.find(r => r.type === 'food');
    const foodPct = food ? Math.round((food.amount / food.max) * 100) : 0;
    const isAgri  = food && food.max >= 20; // AGRI_FOOD_CAP — boosted by dedicated farmer
    const regenLabel = food
      ? (isAgri ? `${(food.regenRate * 100).toFixed(3)}/tick (agrarian)` : `${(food.regenRate * 100).toFixed(3)}/tick`)
      : '—';
    this.infoPanel.innerHTML = `
      <div class="ip-header improvement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:#44cc88">🪴</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:#88dd66">${isAgri ? 'Agrarian Farm' : 'Cultivated Farm'}</span>
            <span class="ip-subtitle">Agriculture · ${tile.x}, ${tile.y}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>
      <div class="ip-settle-body">
        <div class="ip-flavour">${isAgri ? 'A dedicated plot managed by a skilled farmer. Yields far exceed wild foraging.' : 'Rows cut by careful hands. Regen rate boosted by cultivation.'}</div>
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
            <span class="ip-stat-label">Regen</span>
            <span class="ip-stat-val" style="color:#44cc88">${regenLabel}</span>
          </div>
          ${food.regenCrashTicks > 0 ? `<div class="ip-warn-row">⚠ Soil depleted — recovering (${food.regenCrashTicks} ticks)</div>` : ''}
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
          const crashed  = r.regenCrashTicks > 0;
          const regenStr = r.baseRegenRate > 0
            ? (crashed ? `⚠ depleted (${r.regenCrashTicks}t)` : `+${(r.regenRate * 100).toFixed(2)}/tick`)
            : 'non-renewable';
          return `
            <div class="ip-stat-row bar-row">
              <span class="ip-stat-label">${r.type}</span>
              <div class="ip-stat-bar-wrap">
                <div class="stat-bar-bg"><div class="stat-bar" style="width:${pct}%;background:${resColor}${crashed ? '88' : ''}"></div></div>
                <span class="ip-stat-val bar-num" style="color:${resColor}">${Math.floor(r.amount)}/${r.max}</span>
              </div>
            </div>
            <div class="ip-stat-row" style="padding-top:0">
              <span class="ip-stat-label" style="font-size:9px;color:#445566">regen</span>
              <span class="ip-stat-val" style="font-size:10px;color:${crashed ? '#cc8844' : '#445577'}">${regenStr}</span>
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