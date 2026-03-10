// ============================================================
// UI MANAGER — DOM panel updates
// Tabbed info panel for entities (Overview / Social / Skills / Genes)
// and structures (settlements, roads, improvements).
// ============================================================

import { SimulationState } from '../simulation/Simulation';
import { EntityState } from '../entities/Entity';
import { Tile } from '../world/Tile';
import { SettlementManager, Settlement, LEVEL_NAMES } from '../entities/SettlementManager';

let _notifId = 0;
interface Notification { id: number; message: string; severity: string; opacity: number; age: number; }

// Which tab is active on the entity panel
type EntityTab = 'overview' | 'social' | 'skills' | 'genes';

export class UIManager {
  private hud:            HTMLElement;
  private activityLog:    HTMLElement;
  private notifContainer: HTMLElement;
  private popChart:       HTMLElement;
  private infoPanel:      HTMLElement;
  private notifications:  Notification[] = [];

  // Remember active tab across refreshes
  private _entityTab: EntityTab = 'overview';

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

    // Block pointer events from reaching the canvas through the panel
    this.infoPanel.addEventListener('pointerdown', e => e.stopPropagation());
    this.infoPanel.addEventListener('click',       e => e.stopPropagation());
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
      wanderer:  '#ffcc44', hunter:   '#ff8833',
      gatherer:  '#88dd66', farmer:   '#44cc88',
      builder:   '#cc8844', crafter:  '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff',
      scholar:   '#44ddff', elder:    '#ffaa22',
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
      wanderer:  '#ffcc44', hunter:   '#ff8833',
      gatherer:  '#88dd66', farmer:   '#44cc88',
      builder:   '#cc8844', crafter:  '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff',
      scholar:   '#44ddff', elder:    '#ffaa22',
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
    const roleColors: Record<string, string> = {
      wanderer:  '#ffcc44', hunter:   '#ff8833',
      gatherer:  '#88dd66', farmer:   '#44cc88',
      builder:   '#cc8844', crafter:  '#dd6633',
      warrior:   '#ff4444', merchant: '#aa88ff',
      scholar:   '#44ddff', elder:    '#ffaa22',
    };

    const color = roleColors[entity.type] ?? '#ffffff';
    const label = entity.isChild ? 'Child' : entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
    const s     = entity.social;
    const settl = entity.settlementId >= 0 ? settlements.getById(entity.settlementId) : null;

    // ── Build each tab ──────────────────────────────────────

    const tabOverview  = this._buildOverviewTab(entity, settl, color);
    const tabSocial    = this._buildSocialTab(entity);
    const tabSkills    = this._buildSkillsTab(entity);
    const tabGenes     = this._buildGenesTab(entity);

    const tabs: EntityTab[] = ['overview', 'social', 'skills', 'genes'];
    const tabLabels: Record<EntityTab, string> = {
      overview: '⚑ Overview',
      social:   '❤ Social',
      skills:   '◈ Skills',
      genes:    '⬡ Genes',
    };

    const tabsHtml = tabs.map(t => `
      <button class="ip-tab ${this._entityTab === t ? 'active' : ''}" data-tab="${t}">${tabLabels[t]}</button>
    `).join('');

    const contentsHtml = `
      <div class="ip-tab-content ${this._entityTab === 'overview' ? 'active' : ''}" data-content="overview">${tabOverview}</div>
      <div class="ip-tab-content ${this._entityTab === 'social'   ? 'active' : ''}" data-content="social">${tabSocial}</div>
      <div class="ip-tab-content ${this._entityTab === 'skills'   ? 'active' : ''}" data-content="skills">${tabSkills}</div>
      <div class="ip-tab-content ${this._entityTab === 'genes'    ? 'active' : ''}" data-content="genes">${tabGenes}</div>
    `;

    const genderIcon  = s.gender === 'male' ? '♂' : '♀';

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

  private _buildOverviewTab(entity: EntityState, settl: Settlement | null, color: string): string {
    let currentTask = 'Wandering / Idle';
    if (entity.buildingProjectId !== -1)          currentTask = '🔨 Building';
    else if (entity.actionAnim.type === 'gather')  currentTask = '🌾 Gathering Food';
    else if (entity.actionAnim.type === 'mine')    currentTask = '⛏ Mining Resources';
    else if (entity.actionAnim.type === 'farm')    currentTask = '🪴 Farming';
    else if (entity.memory.returning)              currentTask = '⛺ Returning Home';
    else if (entity.social.socialState === 'chatting')  currentTask = '💬 Chatting';
    else if (entity.social.socialState === 'relaxing')  currentTask = '💤 Relaxing';
    else if (entity.energy < 0.45)                 currentTask = '🍖 Seeking Food';

    const energyPct   = Math.round(entity.energy * 100);
    const energyColor = entity.energy > 0.6 ? '#44cc88' : entity.energy > 0.3 ? '#ccaa22' : '#cc3333';
    const energyBar   = `<div class="stat-bar-bg"><div class="stat-bar" style="width:${energyPct}%;background:${energyColor}"></div></div>`;

    const agePct   = Math.round((entity.age / entity.maxAge) * 100);
    const ageColor = agePct > 80 ? '#cc3333' : agePct > 60 ? '#ccaa22' : '#8899cc';
    const ageBar   = `<div class="stat-bar-bg"><div class="stat-bar" style="width:${agePct}%;background:${ageColor}"></div></div>`;

    const settlName = settl ? `${settl.name} (Lv${settl.level})` : 'Unhoused';

    const carrying = entity.carryingFood > 0
      ? `🌾 ${entity.carryingFood.toFixed(1)} food`
      : entity.carryingResource > 0
        ? `⛏ ${entity.carryingResource.toFixed(1)} ${entity.carryingResourceType ?? ''}`
        : 'Nothing';

    return `
      <div class="ip-stat-row">
        <span class="ip-stat-label">Task</span>
        <span class="ip-stat-val task-val">${currentTask}</span>
      </div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Energy</span>
        <div class="ip-stat-bar-wrap">
          ${energyBar}
          <span class="ip-stat-val bar-num" style="color:${energyColor}">${energyPct}%</span>
        </div>
      </div>
      <div class="ip-stat-row bar-row">
        <span class="ip-stat-label">Age</span>
        <div class="ip-stat-bar-wrap">
          ${ageBar}
          <span class="ip-stat-val bar-num" style="color:${ageColor}">${Math.floor(entity.age)} / ${Math.floor(entity.maxAge)}</span>
        </div>
      </div>
      <div class="ip-divider"></div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Position</span>
        <span class="ip-stat-val">${entity.x}, ${entity.y}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Home</span>
        <span class="ip-stat-val" style="color:#aa88ff">${settlName}</span>
      </div>
      <div class="ip-stat-row">
        <span class="ip-stat-label">Carrying</span>
        <span class="ip-stat-val">${carrying}</span>
      </div>
      ${entity.isChild ? `
      <div class="ip-stat-row">
        <span class="ip-stat-label">Parent</span>
        <span class="ip-stat-val">${entity.parentId >= 0 ? '#' + entity.parentId : '—'}</span>
      </div>` : ''}
    `;
  }

  private _buildSocialTab(entity: EntityState): string {
    const s = entity.social;
    const pBtnStyle = this._showPartnerLines
      ? 'background:#cc4466;color:#fff;border-color:#ff88aa'
      : 'background:rgba(255,255,255,0.06);color:#cc88aa;border-color:#553344';
    const fBtnStyle = this._showFriendLines
      ? 'background:#224466;color:#fff;border-color:#4488cc'
      : 'background:rgba(255,255,255,0.06);color:#5588aa;border-color:#223344';

    const orientIcons: Record<string, string> = { straight: '⇄', gay: '⇆', bi: '⇋' };
    const orientIcon  = s.orientation ? orientIcons[s.orientation] : '–';
    const stressColor = s.stressTicks > 40 ? '#cc4444' : s.stressTicks > 20 ? '#ccaa22' : '#667799';
    const stressPct   = Math.min(100, (s.stressTicks / 120) * 100);
    const stressBar   = `<div class="stat-bar-bg"><div class="stat-bar" style="width:${stressPct}%;background:${stressColor}"></div></div>`;

    const stateEmoji: Record<string, string> = { idle: '—', chatting: '💬', relaxing: '💤', seeking: '👀' };
    const roleLabel = s.followingId !== null ? '↩ Following' : s.partnerIds.length > 0 ? '↪ Leading' : '—';

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
        <button id="btn-partner-lines" style="${pBtnStyle}">❤ Show Bonds</button>
        <button id="btn-friend-lines"  style="${fBtnStyle}">★ Show Friends</button>
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
        <span class="ip-stat-val">${stateEmoji[s.socialState] ?? '–'} ${s.socialState}</span>
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
          ${stressBar}
          <span class="ip-stat-val bar-num" style="color:${stressColor}">${s.stressTicks}</span>
        </div>
      </div>
    `;
  }

  private _buildSkillsTab(entity: EntityState): string {
    const sk = entity.skills;
    const skillIcons: Record<string, string> = {
      hunting: '🏹', gathering: '🌾', farming: '🪴',
      building: '🔨', crafting: '⛏', trading: '⚖', study: '📜',
    };
    const skillColors: Record<string, string> = {
      hunting: '#ff8833', gathering: '#88dd66', farming: '#44cc88',
      building: '#cc8844', crafting: '#dd6633', trading: '#aa88ff', study: '#44ddff',
    };

    const topSkill = Object.entries(sk).reduce((best, cur) => cur[1] > best[1] ? cur : best, ['', 0]);

    const rows = Object.entries(sk).map(([key, val]) => {
      const pct   = Math.min(100, val);
      const color = skillColors[key] ?? '#8899cc';
      const icon  = skillIcons[key] ?? '◈';
      const isTop = key === topSkill[0] && val >= 5;
      return `
        <div class="skill-row ${isTop ? 'top-skill' : ''}">
          <span class="skill-icon">${icon}</span>
          <span class="skill-name">${key}</span>
          <div class="skill-bar-bg"><div class="skill-bar" style="width:${pct}%;background:${color}"></div></div>
          <span class="skill-val" style="color:${color}">${Math.floor(val)}</span>
        </div>
      `;
    }).join('');

    const dominant = topSkill[1] >= 5
      ? `<div class="ip-badge" style="border-color:${skillColors[topSkill[0]] ?? '#8899cc'};color:${skillColors[topSkill[0]] ?? '#8899cc'}">
          ◈ Dominant: ${topSkill[0].toUpperCase()}
        </div>`
      : `<div class="ip-badge" style="border-color:#445566;color:#667788">◈ No dominant skill yet</div>`;

    return `${dominant}${rows}`;
  }

  private _buildGenesTab(entity: EntityState): string {
    const geneIcons: Record<string, string> = {
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
      const pct   = Math.round(val * 100);
      const color = geneColors[key] ?? '#8899cc';
      const icon  = geneIcons[key]  ?? '⬡';
      const desc  = geneDesc[key]   ?? '';
      const barW  = pct;
      return `
        <div class="gene-card">
          <div class="gene-card-header">
            <span class="gene-card-icon">${icon}</span>
            <span class="gene-card-name">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
            <span class="gene-card-val" style="color:${color}">${pct}</span>
          </div>
          <div class="gene-card-bar-bg">
            <div class="gene-card-bar" style="width:${barW}%;background:${color}"></div>
          </div>
          <div class="gene-card-desc">${desc}</div>
        </div>
      `;
    }).join('');
  }

  private _bindEntityPanelEvents(entity: EntityState, settlements: SettlementManager): void {
    // Tab switching
    this.infoPanel.querySelectorAll('.ip-tab').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const tab = (btn as HTMLElement).dataset.tab as EntityTab;
        if (tab) {
          this._entityTab = tab;
          this.updateInfoPanelEntity(entity, settlements);
        }
      });
    });

    // Close button
    document.getElementById('ip-close-btn')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.clearInfoPanel();
    });

    // Social toggles
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

  // ── Settlement info panel ─────────────────────────────────

  updateInfoPanelSettlement(settlement: Settlement): void {
    const levelColors: Record<number, string> = {
      1: '#c87a22', 2: '#d4aa44', 3: '#88cc66',
    };
    const color     = levelColors[settlement.level] ?? '#8899cc';
    const levelName = LEVEL_NAMES[settlement.level];

    const foodPct  = Math.round((settlement.foodStorage / settlement.maxFoodStorage) * 100);
    const foodColor = foodPct > 50 ? '#44aa44' : foodPct > 25 ? '#aaaa22' : '#aa2222';
    const foodBar   = `<div class="stat-bar-bg"><div class="stat-bar" style="width:${foodPct}%;background:${foodColor}"></div></div>`;

    const activeProjects  = settlement.projects.filter(p => !p.complete);
    const completedProjects = settlement.projects.filter(p => p.complete);

    const projectsHtml = activeProjects.length > 0
      ? activeProjects.map(p => {
          const pct = Math.round(p.progress * 100);
          const projColor = p.type === 'dirt_road' ? '#8a7050' : '#a07848';
          const projIcon  = p.type === 'dirt_road' ? '🛤' : '🏠';
          return `
            <div class="project-row">
              <span class="project-icon">${projIcon}</span>
              <span class="project-name">${p.type.replace('_', ' ')}</span>
              <div class="stat-bar-bg" style="flex:1">
                <div class="stat-bar" style="width:${pct}%;background:${projColor}"></div>
              </div>
              <span class="project-pct">${pct}%</span>
              <span class="project-workers">${p.workerIds.length}👤</span>
            </div>
          `;
        }).join('')
      : '<div class="ip-stat-empty" style="padding:4px 0">No active projects</div>';

    this.infoPanel.innerHTML = `
      <div class="ip-header settlement-header">
        <div class="ip-header-left">
          <span class="ip-settle-icon" style="color:${color}">${settlement.level === 1 ? '⛺' : settlement.level === 2 ? '🏠' : '🏘'}</span>
          <div class="ip-header-text">
            <span class="ip-title" style="color:${color}">${settlement.name}</span>
            <span class="ip-subtitle">${levelName} · Age ${settlement.age}</span>
          </div>
        </div>
        <button class="ip-close" id="ip-close-btn">✕</button>
      </div>

      <div class="ip-settle-body">
        <div class="settle-stat-grid">
          <div class="settle-stat">
            <span class="settle-stat-val">${settlement.population}</span>
            <span class="settle-stat-label">Population</span>
          </div>
          <div class="settle-stat">
            <span class="settle-stat-val">${settlement.homesBuilt}</span>
            <span class="settle-stat-label">Homes</span>
          </div>
          <div class="settle-stat">
            <span class="settle-stat-val">${settlement.roadsBuilt}</span>
            <span class="settle-stat-label">Roads</span>
          </div>
          <div class="settle-stat">
            <span class="settle-stat-val">${Math.floor(settlement.techPoints)}</span>
            <span class="settle-stat-label">Tech Pts</span>
          </div>
        </div>

        <div class="ip-divider"></div>

        <div class="ip-stat-row bar-row">
          <span class="ip-stat-label">Food</span>
          <div class="ip-stat-bar-wrap">
            ${foodBar}
            <span class="ip-stat-val bar-num" style="color:${foodColor}">${Math.floor(settlement.foodStorage)}/${settlement.maxFoodStorage}</span>
          </div>
        </div>
        <div class="ip-stat-row">
          <span class="ip-stat-label">🪵 Wood</span>
          <span class="ip-stat-val">${Math.floor(settlement.woodStorage)}</span>
        </div>
        <div class="ip-stat-row">
          <span class="ip-stat-label">🪨 Stone</span>
          <span class="ip-stat-val">${Math.floor(settlement.stoneStorage)}</span>
        </div>

        <div class="ip-divider"></div>

        <div class="settle-section-title">Active Projects (${activeProjects.length})</div>
        ${projectsHtml}

        ${completedProjects.length > 0 ? `
          <div class="ip-stat-row" style="margin-top:4px">
            <span class="ip-stat-label">Completed</span>
            <span class="ip-stat-val" style="color:#667799">${completedProjects.length} projects</span>
          </div>
        ` : ''}

        <div class="ip-divider"></div>
        <div class="settle-coords">📍 ${settlement.x}, ${settlement.y}</div>
      </div>
    `;

    this.infoPanel.classList.add('active');
    document.getElementById('ip-close-btn')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.clearInfoPanel();
    });
  }

  // ── Tile / improvement info panel ─────────────────────────

  updateInfoPanelTile(tile: Tile): void {
    // Check if this tile has a meaningful improvement to feature
    const improvement = tile.improvement;

    if (improvement === 'dirt_road') {
      this._showRoadPanel(tile);
    } else if (improvement === 'rough_home') {
      this._showHomePanel(tile);
    } else if (improvement === 'farm') {
      this._showFarmPanel(tile);
    } else {
      this._showGenericTilePanel(tile);
    }
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
      </div>
    `;
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
        <div class="ip-flavour">A humble structure of wood and mud, built by willing hands. Shelter from the wild.</div>
        <div class="ip-divider"></div>
        ${this._tileBaseStats(tile)}
      </div>
    `;
    this.infoPanel.classList.add('active');
    this._bindClose();
  }

  private _showFarmPanel(tile: Tile): void {
    const food = tile.resources.find(r => r.type === 'food');
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
        <div class="ip-flavour">Rows cut by careful hands. The regen rate has been doubled by cultivation.</div>
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
        ` : ''}
        <div class="ip-divider"></div>
        ${this._tileBaseStats(tile)}
      </div>
    `;
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
          const pct = Math.round((r.amount / r.max) * 100);
          const resColor = r.type === 'food' ? '#88dd66'
            : r.type === 'wood'  ? '#6a9a4a'
            : r.type === 'stone' ? '#9a9a9a'
            : r.type === 'iron'  ? '#aa7755'
            : '#aa88ff';
          return `
            <div class="ip-stat-row bar-row">
              <span class="ip-stat-label">${r.type}</span>
              <div class="ip-stat-bar-wrap">
                <div class="stat-bar-bg"><div class="stat-bar" style="width:${pct}%;background:${resColor}"></div></div>
                <span class="ip-stat-val bar-num" style="color:${resColor}">${Math.floor(r.amount)}/${r.max}</span>
              </div>
            </div>
          `;
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
      </div>
    `;
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
      e.stopPropagation();
      this.clearInfoPanel();
    });
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
