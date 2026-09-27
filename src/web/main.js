function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

class NeutronDashboard {
  constructor() {
    this.state = {
      currentView: 'overview',
      repository: '',
      repositories: [],
      analysis: null,
      graph: null,
      plan: null,
      executionResult: null,
      selectedNode: null,
      sidebarCollapsed: false,
      pendingApproval: null,
    };
    this.apiBase = '';
    this.eventSource = null;
    this.sidebar = null;
    this.mainContent = null;
    this.navItems = null;
    this.viewContainers = null;
    this.repoSelect = null;
    this.executeBtn = null;
    this.planOnlyBtn = null;
    this.analyzeBtn = null;
    this.requestInput = null;
    this.riskOptions = null;
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadRepositories();
    this.render();
    this.startPolling();
  }

  bindElements() {
    this.sidebar = document.getElementById('sidebar');
    this.mainContent = document.getElementById('main-content');
    this.navItems = document.querySelectorAll('.nav-item[data-view]');
    this.viewContainers = document.querySelectorAll('.neutron-view');
    this.repoSelect = document.getElementById('repo-select');
    this.executeBtn = document.getElementById('execute-btn');
    this.planOnlyBtn = document.getElementById('plan-only-btn');
    this.analyzeBtn = document.getElementById('analyze-btn');
    this.requestInput = document.getElementById('request-input');
    this.riskOptions = document.querySelectorAll('.risk-option input');
  }

  bindEvents() {
    this.navItems.forEach(item => {
      item.addEventListener('click', () => this.switchView(item.dataset.view));
    });

    this.repoSelect.addEventListener('change', (e) => {
      this.state.repository = e.target.value;
      this.saveRepoPreference();
      this.refreshCurrentView();
    });

    this.executeBtn?.addEventListener('click', () => this.executeMaintenance('implement-and-test'));
    this.planOnlyBtn?.addEventListener('click', () => this.executeMaintenance('plan-only'));
    this.analyzeBtn?.addEventListener('click', () => this.analyzeImpact());

    this.riskOptions.forEach(opt => {
      opt.addEventListener('change', () => this.updateRiskSelection());
    });

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => this.toggleSidebar());
    document.getElementById('what-breaks-btn')?.addEventListener('click', () => this.switchView('what-breaks'));
  }

  async loadRepositories() {
    try {
      const res = await fetch(`${this.apiBase}/api/neutron/repositories`);
      if (res.ok) {
        const data = await res.json();
        this.state.repositories = data.repositories || [];
      }
    } catch {
      this.state.repositories = ['TaskFlow (Demo)'];
    }

    const saved = localStorage.getItem('neutron-current-repo') || localStorage.getItem('sun-current-repo');
    if (saved && this.state.repositories.includes(saved)) {
      this.state.repository = saved;
    } else if (this.state.repositories.length > 0) {
      this.state.repository = this.state.repositories[0];
    }

    this.updateRepoSelect();
  }

  updateRepoSelect() {
    this.repoSelect.innerHTML = this.state.repositories.map(r =>
      `<option value="${esc(r)}" ${r === this.state.repository ? 'selected' : ''}>${esc(r)}</option>`
    ).join('');
  }

  saveRepoPreference() {
    localStorage.setItem('neutron-current-repo', this.state.repository);
  }

  switchView(view) {
    this.state.currentView = view;
    this.render();
    this.loadViewData(view);
  }

  render() {
    this.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === this.state.currentView);
    });

    this.viewContainers.forEach(container => {
      container.classList.toggle('active', container.id === `view-${this.state.currentView}`);
    });

    document.getElementById('view-title').textContent = this.getViewTitle(this.state.currentView);
  }

  getViewTitle(view) {
    const titles = {
      overview: 'Dashboard',
      analyze: 'Repository Analysis',
      plan: 'Maintenance Plan',
      execute: 'Execution',
      impact: 'Impact Graph',
      'what-breaks': 'What Could Break?',
      tests: 'Test Intelligence',
      security: 'Security Review',
      review: 'Code Review',
      release: 'Release Readiness',
      memory: 'Engineering Memory',
      history: 'Maintenance History',
      bob: 'IBM Bob 2.0',
      settings: 'Settings',
    };
    return titles[view] || 'NEUTRON';
  }

  async loadViewData(view) {
    switch (view) {
      case 'overview': await this.loadOverview(); break;
      case 'analyze': await this.loadAnalysis(); break;
      case 'plan': await this.loadPlan(); break;
      case 'impact': await this.loadImpactGraph(); break;
      case 'what-breaks': await this.loadWhatBreaks(); break;
      case 'tests': await this.loadTests(); break;
      case 'security': await this.loadSecurity(); break;
      case 'review': await this.loadReview(); break;
      case 'release': await this.loadRelease(); break;
      case 'memory': await this.loadMemory(); break;
      case 'history': await this.loadHistory(); break;
      case 'bob': await this.loadBob(); break;
    }
  }

  async api(path, options) {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      let extra = {};
      try {
        const parsed = JSON.parse(text);
        message = parsed.error || text;
        extra = parsed;
      } catch { /* not JSON */ }
      const err = new Error(message || `HTTP ${res.status}`);
      err.status = res.status;
      err.details = extra;
      throw err;
    }
    return res.json();
  }

  async analyzeImpact() {
    if (!this.state.repository) return;
    const request = this.requestInput.value.trim();
    if (!request) { this.notify('warn', 'Maintenance request is empty', 'Describe what needs to change, then run the analysis again.'); return; }

    this.setAnalyzeLoading(true);
    try {
      const data = await this.api('/api/neutron/analyze', {
        method: 'POST',
        body: JSON.stringify({ request, repository: this.state.repository, branch: 'main', riskTolerance: 'balanced', execution: 'plan-only' }),
      });
      this.state.analysis = data.analysis;
      this.state.graph = data.graph;
      this.renderAnalysis(data.analysis);
      this.renderGraph(data.graph);
      this.switchView('impact');
    } catch (e) {
      this.notify('error', 'Unable to analyze repository.', e.message || String(e), [{ label: 'Retry', run: () => this.analyzeImpact() }]);
    } finally {
      this.setAnalyzeLoading(false);
    }
  }

  /**
   * Human-approval flow. Nothing that changes code runs until the user has seen the plan and clicked
   * [Approve Plan]. Both buttons first generate a plan (plan-only); "Implement & Test" then waits.
   */
  async executeMaintenance(mode) {
    if (!this.state.repository) return;
    const request = this.requestInput.value.trim();
    if (!request) { this.notify('warn', 'Maintenance request is empty', 'Describe what needs to change first.'); return; }
    const riskTolerance = document.querySelector('.risk-option input:checked')?.value || 'balanced';

    this.setExecuteLoading(true);
    try {
      // Generate the plan via /plan: it persists request/graph/plan server-side and resets
      // any stale approval, so the approval gate below can verify against the stored plan.
      const data = await this.api('/api/neutron/plan', {
        method: 'POST',
        body: JSON.stringify({ request, riskTolerance }),
      });
      const plan = data.plan;
      this.state.plan = plan;
      this.state.pendingApproval = mode === 'plan-only' ? null : { request, riskTolerance, mode };
      this.renderPlan(plan);
      this.switchView('plan');
      this.notify(mode === 'plan-only' ? 'success' : 'info',
        mode === 'plan-only' ? 'Plan ready (no changes made).' : 'Plan ready - review it and approve to start implementation.', '');
    } catch (e) {
      this.notify('error', 'Unable to build the plan.', e.message || String(e), [{ label: 'Retry', run: () => this.executeMaintenance(mode) }]);
    } finally {
      this.setExecuteLoading(false);
    }
  }

  renderApprovalBar() {
    const container = document.getElementById('view-plan');
    container.querySelector('#plan-approval')?.remove();
    const pending = this.state.pendingApproval;
    if (!pending) return;
    const bar = document.createElement('div');
    bar.id = 'plan-approval';
    bar.className = 'neutron-card';
    bar.innerHTML = `<div class="neutron-card-body" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <strong>Approval required before any code is changed.</strong>
        <span style="flex:1"></span>
        <button class="btn btn-primary" data-act="approve">Approve Plan</button>
        <button class="btn btn-secondary" data-act="edit">Edit Plan</button>
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      </div>`;
    bar.querySelector('[data-act=approve]').addEventListener('click', () => this.approvePlan());
    bar.querySelector('[data-act=edit]').addEventListener('click', () => this.editPlan());
    bar.querySelector('[data-act=cancel]').addEventListener('click', () => this.cancelPlan());
    container.prepend(bar);
  }

  async approvePlan() {
    const pending = this.state.pendingApproval;
    if (!pending) return;
    this.state.pendingApproval = null;
    this.renderApprovalBar();
    this.setExecuteLoading(true);
    try {
      // Server-side approval first: the server records it and the subsequent execute is
      // authorized by that server-side state, never by a client-supplied flag.
      await this.api('/api/neutron/approve', {
        method: 'POST',
        body: JSON.stringify({ request: pending.request }),
      });
      const data = await this.api('/api/neutron/execute', {
        method: 'POST',
        body: JSON.stringify({ request: pending.request, repository: this.state.repository, branch: 'main', riskTolerance: pending.riskTolerance, execution: pending.mode }),
      });
      this.state.executionResult = data.result;
      this.renderExecution(data.result);
      this.switchView('execute');
    } catch (e) {
      this.state.pendingApproval = pending;
      this.renderApprovalBar();
      this.notify('error', 'Execution failed.', e.message || String(e), [{ label: 'Retry', run: () => this.approvePlan() }]);
    } finally {
      this.setExecuteLoading(false);
    }
  }

  editPlan() {
    this.state.pendingApproval = null;
    this.renderApprovalBar();
    this.switchView('analyze');
    this.requestInput.focus();
  }

  cancelPlan() {
    this.state.pendingApproval = null;
    this.renderApprovalBar();
    this.notify('info', 'Cancelled.', 'No changes were made.');
  }

  /** Non-blocking status message with optional actions (replaces alert()). */
  notify(kind, title, reason, actions = []) {
    let host = document.getElementById('notice-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notice-host';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:1000;display:flex;flex-direction:column;gap:8px;max-width:420px;';
      document.body.appendChild(host);
    }
    const item = document.createElement('div');
    item.className = 'neutron-card';
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    item.style.cssText = 'padding:12px 14px;';
    const head = document.createElement('div');
    head.style.fontWeight = '600';
    head.textContent = title;
    item.appendChild(head);
    if (reason) {
      const body = document.createElement('div');
      body.style.cssText = 'font-size:12px;opacity:.85;margin-top:4px;white-space:pre-wrap;';
      body.textContent = kind === 'error' ? `Reason: ${reason}` : reason;
      item.appendChild(body);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { item.remove(); a.run(); });
      row.appendChild(btn);
    }
    const close = document.createElement('button');
    close.className = 'btn btn-ghost btn-sm';
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => item.remove());
    row.appendChild(close);
    item.appendChild(row);
    host.appendChild(item);
    if (kind !== 'error' && actions.length === 0) setTimeout(() => item.remove(), 6000);
  }

  async loadOverview() {
    if (!this.state.repository) return;
    try {
      const [analysis, memory] = await Promise.all([
        this.api('/api/neutron/analyze'),
        this.api('/api/neutron/memory'),
      ]);
      this.renderOverview(analysis, memory);
    } catch (e) {
      console.error('Failed to load overview:', e);
    }
  }

  async loadAnalysis() {
    if (!this.state.repository) return;
    try {
      const data = await this.api('/api/neutron/analyze', {
        method: 'POST',
        body: JSON.stringify({ request: '', repository: this.state.repository, branch: 'main', riskTolerance: 'balanced', execution: 'plan-only' }),
      });
      this.state.analysis = data.analysis;
      this.state.graph = data.graph;
      this.renderAnalysis(data.analysis);
      this.renderGraph(data.graph);
    } catch (e) {
      console.error('Failed to load analysis:', e);
    }
  }

  async loadPlan() {
    if (!this.state.repository || !this.requestInput.value.trim()) return;
    const request = this.requestInput.value.trim();
    const riskTolerance = document.querySelector('.risk-option input:checked')?.value || 'balanced';
    try {
      const data = await this.api('/api/neutron/plan', {
        method: 'POST',
        body: JSON.stringify({ request, riskTolerance }),
      });
      this.state.plan = data.plan;
      this.renderPlan(data.plan);
    } catch (e) {
      this.notify('error', 'Unable to load the plan.', e.message || String(e), [{ label: 'Retry', run: () => this.loadPlan() }]);
    }
  }

  async loadImpactGraph() {
    if (this.state.graph) this.renderGraph(this.state.graph);
  }

  async loadWhatBreaks() {
    if (!this.state.repository) return;
    try {
      const data = await this.api('/api/neutron/what-breaks');
      this.renderWhatBreaks(data);
    } catch (e) {
      console.error('Failed to load what-breaks:', e);
    }
  }

  async loadTests() {
    if (!this.state.executionResult?.testResult) return;
    this.renderTests(this.state.executionResult.testResult);
  }

  async loadSecurity() {
    if (!this.state.executionResult?.security) return;
    this.renderSecurity(this.state.executionResult.security);
  }

  async loadReview() {
    if (!this.state.executionResult?.codeReview) return;
    this.renderReview(this.state.executionResult.codeReview);
  }

  async loadRelease() {
    if (!this.state.executionResult?.release) return;
    this.renderRelease(this.state.executionResult.release);
  }

  async loadMemory() {
    try {
      const data = await this.api('/api/neutron/memory');
      this.renderMemory(data.memory);
    } catch (e) {
      console.error('Failed to load memory:', e);
    }
  }

  async loadHistory() {
    this.renderHistory();
  }

  async loadBob() {
    try {
      const data = await this.api('/api/neutron/bob/activity');
      this.renderBob(data);
    } catch (e) {
      console.error('Failed to load Bob activity:', e);
    }
  }

  refreshCurrentView() {
    this.state.analysis = null;
    this.state.graph = null;
    this.state.plan = null;
    this.state.executionResult = null;
    this.loadViewData(this.state.currentView);
  }

  setAnalyzeLoading(loading) {
    this.analyzeBtn.disabled = loading;
    this.analyzeBtn.textContent = loading ? 'Analyzing...' : 'Analyze Impact';
  }

  setExecuteLoading(loading) {
    this.executeBtn.disabled = loading;
    this.executeBtn.textContent = loading ? 'Executing...' : 'Implement & Test';
    this.planOnlyBtn.disabled = loading;
  }

  updateRiskSelection() {
    document.querySelectorAll('.risk-option label').forEach(label => {
      const input = label.querySelector('input');
      label.classList.toggle('selected', input.checked);
    });
  }

  toggleSidebar() {
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    this.sidebar.classList.toggle('collapsed', this.state.sidebarCollapsed);
  }

  startPolling() {
    setInterval(() => this.refreshCurrentView(), 30000);
  }

  // Render methods
  renderOverview(analysis, memory) {
    const container = document.getElementById('view-overview');
    const health = analysis.health || 90;
    container.innerHTML = `
      <div class="grid-4" style="margin-bottom: 24px;">
        <div class="stat-card"><div class="stat-value">${analysis.filesAnalyzed || 0}</div><div class="stat-label">Files Analyzed</div></div>
        <div class="stat-card"><div class="stat-value">${analysis.categories?.backend?.length || 0}</div><div class="stat-label">Backend Modules</div></div>
        <div class="stat-card"><div class="stat-value">${analysis.categories?.frontend?.length || 0}</div><div class="stat-label">Frontend Components</div></div>
        <div class="stat-card"><div class="stat-value">${analysis.categories?.tests?.length || 0}</div><div class="stat-label">Test Files</div></div>
      </div>
      <div class="grid-2">
        <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Repository Health</div></div><div class="neutron-card-body">
          <div style="height: 200px; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 700; color: var(--accent);">${health}%</div>
        </div></div>
        <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Quick Actions</div></div><div class="neutron-card-body">
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="btn btn-primary" onclick="dashboard.switchView('analyze')">Analyze Repository</button>
            <button class="btn btn-secondary" onclick="dashboard.switchView('impact')">View Impact Graph</button>
            <button class="btn btn-secondary" onclick="dashboard.switchView('bob')">IBM Bob 2.0</button>
          </div>
        </div></div>
      </div>
    `;
  }

  renderAnalysis(analysis) {
    const container = document.getElementById('view-analyze');
    const cats = analysis.categories || {};
    container.innerHTML = `
      <div class="grid-3" style="margin-bottom: 24px;">
        ${Object.entries(cats).map(([cat, files]) => `
          <div class="neutron-card">
            <div class="neutron-card-header"><div class="neutron-card-title">${cat.charAt(0).toUpperCase() + cat.slice(1)}</div></div>
            <div class="neutron-card-body">
              <div class="stat-value" style="font-size: 24px;">${Array.isArray(files) ? files.length : 0}</div>
              <div class="stat-label">files</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="neutron-card">
        <div class="neutron-card-header"><div class="neutron-card-title">File Tree</div></div>
        <div class="neutron-card-body">
          <div class="file-tree" id="file-tree"></div>
        </div>
      </div>
    `;
    this.renderFileTree(analysis.nodes);
  }

  renderFileTree(nodes) {
    const container = document.getElementById('file-tree');
    const byCategory = {};
    nodes.forEach(n => {
      if (!byCategory[n.category]) byCategory[n.category] = [];
      byCategory[n.category].push(n);
    });
    container.innerHTML = Object.entries(byCategory).map(([cat, files]) => `
      <div class="file-tree-item" style="font-weight: 600; color: var(--fg-subtle); text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em; margin-top: 12px;">${cat}</div>
      ${files.map(f => `
        <div class="file-tree-item" data-path="${f.path}" style="padding-left: 24px;">
          <span class="file-tree-icon">${this.getFileIcon(f.path)}</span>
          <span class="file-tree-name">${f.path}</span>
          <span class="file-tree-risk risk-${f.risk || 'low'}">${f.risk || 'low'}</span>
        </div>
      `).join('')}
    `).join('');
  }

  getFileIcon(path) {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) return '⚛';
    if (path.endsWith('.ts') || path.endsWith('.js')) return '📄';
    if (path.endsWith('.json')) return '⚙';
    if (path.endsWith('.md')) return '📝';
    if (path.includes('/tests/')) return '🧪';
    return '📄';
  }

  renderGraph(graph) {
    const container = document.getElementById('impact-canvas-container');
    container.innerHTML = `
      <div style="position: relative; width: 100%; height: 100%;">
        <canvas id="impact-canvas"></canvas>
        <div id="graph-controls" style="position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 10;">
          <button class="btn btn-secondary btn-sm" onclick="dashboard.zoomIn()" title="Zoom In"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
          <button class="btn btn-secondary btn-sm" onclick="dashboard.zoomOut()" title="Zoom Out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg></button>
          <button class="btn btn-secondary btn-sm" onclick="dashboard.resetView()" title="Reset View"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
        </div>
        <div id="graph-legend" style="position: absolute; bottom: 12px; left: 12px; display: flex; gap: 16px; background: var(--panel); border: 1px solid var(--panel-border); padding: 8px 12px; border-radius: var(--radius-md); font-size: 11px; z-index: 10;">
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #4ade80;"></span> Low</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #fbbf24;"></span> Medium</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #f87171;"></span> High</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444;"></span> Critical</span>
        </div>
        <div id="node-detail" style="position: absolute; top: 12px; left: 12px; right: 12px; max-width: 300px; z-index: 10;"></div>
      </div>
    `;
    
    const canvas = document.getElementById('impact-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    this.graphData = graph;
    this.graphScale = 1;
    this.graphOffset = { x: 0, y: 0 };
    this.dragStart = null;
    this.selectedNode = null;

    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    canvas.addEventListener('mouseup', () => this.handleMouseUp());
    canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    canvas.addEventListener('click', (e) => this.handleClick(e));
    canvas.style.cursor = 'grab';

    this.drawGraph();
  }

  zoomIn() { this.graphScale = Math.min(this.graphScale * 1.2, 3); this.drawGraph(); }
  zoomOut() { this.graphScale = Math.max(this.graphScale / 1.2, 0.3); this.drawGraph(); }
  resetView() { this.graphScale = 1; this.graphOffset = { x: 0, y: 0 }; this.drawGraph(); }

  handleMouseDown(e) {
    const rect = e.target.getBoundingClientRect();
    this.dragStart = { x: e.clientX, y: e.clientY };
    e.target.style.cursor = 'grabbing';
  }

  handleMouseMove(e) {
    if (!this.dragStart) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.graphOffset.x += dx;
    this.graphOffset.y += dy;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.drawGraph();
  }

  handleMouseUp() {
    this.dragStart = null;
    const canvas = document.getElementById('impact-canvas');
    canvas.style.cursor = 'grab';
  }

  handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.graphScale = Math.max(0.3, Math.min(3, this.graphScale * factor));
    this.drawGraph();
  }

  handleClick(e) {
    if (!this.graphData) return;
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvas.width / 2 - this.graphOffset.x) / this.graphScale;
    const y = (e.clientY - rect.top - canvas.height / 2 - this.graphOffset.y) / this.graphScale;

    const nodes = this.graphData.nodes || [];
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    for (const node of nodes) {
      const idx = nodes.indexOf(node);
      const angle = (idx / nodes.length) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.35 * this.graphScale;
      const nodeX = centerX + Math.cos(angle) * radius;
      const nodeY = centerY + Math.sin(angle) * radius;
      const dist = Math.hypot(x - nodeX, y - nodeY);
      if (dist < 15 * this.graphScale) {
        this.selectNode(node);
        break;
      }
    }
  }

  selectNode(node) {
    this.selectedNode = node;
    const detailEl = document.getElementById('node-detail');
    if (detailEl) {
      detailEl.innerHTML = `
        <div style="padding: 12px; background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-md); max-width: 300px;">
          <div style="font-weight: 600; margin-bottom: 8px; word-break: break-all;">${node.path}</div>
          <div style="font-size: 12px; color: var(--fg-muted); margin-bottom: 4px;">Category: ${node.category}</div>
          <div style="font-size: 12px; color: var(--fg-muted); margin-bottom: 4px;">Risk: <span class="risk-${node.risk}">${node.risk}</span></div>
          <div style="font-size: 12px; color: var(--fg-muted); margin-bottom: 4px;">Purpose: ${node.purpose}</div>
          <div style="font-size: 12px; color: var(--fg-muted);">Dependencies: ${node.imports?.join(', ') || 'None'}</div>
        </div>
      `;
    }
    this.drawGraph();
  }

  drawGraph() {
    if (!this.graphData) return;
    const container = document.getElementById('impact-canvas-container');
    const canvas = document.getElementById('impact-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const nodes = this.graphData.nodes || [];
    const edges = this.graphData.edges || [];
    const width = container.clientWidth;
    const height = container.clientHeight;
    const centerX = width / 2 + this.graphOffset.x;
    const centerY = height / 2 + this.graphOffset.y;

    const positions = new Map();
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.35 * this.graphScale;
      positions.set(node.path, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
    });

    ctx.strokeStyle = '#2d323c';
    ctx.lineWidth = 1;
    edges.forEach(edge => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (from && to) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    });

    const riskColors = { low: '#4ade80', medium: '#fbbf24', high: '#f87171', critical: '#ef4444' };
    nodes.forEach((node, i) => {
      const pos = positions.get(node.path);
      if (!pos) return;
      const isSelected = this.selectedNode?.path === node.path;
      ctx.fillStyle = riskColors[node.risk] || '#6ea8fe';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isSelected ? 16 : 12 * this.graphScale, 0, Math.PI * 2);
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = '#6ea8fe';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = '#04122b';
      ctx.font = `bold ${Math.max(10, 12 * this.graphScale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(node.path.split('/').pop() || node.path, pos.x, pos.y + 3);
    });
  }

  renderPlan(plan) {
    this.renderPlanBody(plan);
    this.renderApprovalBar();
  }

  renderPlanBody(plan) {
    const container = document.getElementById('view-plan');
    container.innerHTML = `
      <div class="neutron-card" style="margin-bottom: 16px;">
        <div class="neutron-card-header"><div class="neutron-card-title">Implementation Plan</div></div>
        <div class="neutron-card-body">
          <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px;">
            <span class="status-badge info">${plan.tasks?.length || 0} Tasks</span>
            <span class="status-badge">${plan.overallRisk || 'MEDIUM'} Risk</span>
          </div>
          <div class="table-container">
            <table class="neutron-table">
              <thead><tr><th>#</th><th>Task</th><th>Agent</th><th>Files</th><th>Risk</th><th>Dependencies</th></tr></thead>
              <tbody>
                ${plan.tasks?.map((t, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td>${esc(t.label)}</td>
                    <td>${esc(t.agent)}</td>
                    <td><code style="font-size: 11px;">${esc(t.files?.join(', ') || '—')}</code></td>
                    <td><span class="risk-${t.risk}">${t.risk}</span></td>
                    <td>${t.dependencies?.join(', ') || '—'}</td>
                  </tr>
                `).join('') || '<tr><td colspan="6">No plan generated</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  renderWhatBreaks(data) {
    const container = document.getElementById('view-what-breaks');
    container.innerHTML = `
      <div class="neutron-card">
        <div class="neutron-card-header"><div class="neutron-card-title">What Could Break?</div></div>
        <div class="neutron-card-body">
          <pre style="font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; line-height: 1.7;">${data.explanation || 'Run impact analysis first.'}</pre>
        </div>
      </div>
    `;
  }

  renderExecution(result) {
    const container = document.getElementById('view-execute');
    const outcome = result.outcome;
    container.innerHTML = `
      <div class="grid-4" style="margin-bottom: 24px;">
        <div class="stat-card"><div class="stat-value" style="color: var(--success);">${outcome?.completed || 0}</div><div class="stat-label">Completed</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--danger);">${outcome?.failed || 0}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--warning);">${outcome?.blocked || 0}</div><div class="stat-label">Blocked</div></div>
        <div class="stat-card"><div class="stat-value">${outcome?.noLlm ? 'No LLM' : 'OK'}</div><div class="stat-label">LLM Status</div></div>
      </div>
      <div class="neutron-card">
        <div class="neutron-card-header"><div class="neutron-card-title">Agent Execution</div></div>
        <div class="neutron-card-body">
          <div class="agent-grid" id="agent-grid"></div>
        </div>
      </div>
      <div class="grid-2" style="margin-top: 16px;">
        <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Timeline</div></div><div class="neutron-card-body"><div class="timeline" id="timeline"></div></div></div>
        <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">File Changes</div></div><div class="neutron-card-body"><div class="diff-container" id="diff-container"></div></div></div>
      </div>
    `;
    this.renderAgentGrid(outcome?.extended || []);
    this.renderTimeline(result);
    this.renderDiff(result);
  }

  renderAgentGrid(extended) {
    const container = document.getElementById('agent-grid');
    const byAgent = {};
    extended.forEach(e => {
      if (!byAgent[e.task.agent]) byAgent[e.task.agent] = [];
      byAgent[e.task.agent].push(e);
    });
    container.innerHTML = Object.entries(byAgent).map(([agent, tasks]) => {
      const status = tasks.some(t => t.result?.status === 'running') ? 'running' :
        tasks.some(t => t.result?.status === 'failed') ? 'failed' :
        tasks.every(t => t.result?.status === 'success') ? 'completed' : 'waiting';
      const colors = { running: 'var(--accent)', completed: 'var(--success)', failed: 'var(--danger)', waiting: 'var(--warning)' };
      return `
        <div class="agent-card ${status}">
          <div class="agent-header"><span class="agent-name">${agent}</span><span class="agent-status ${status}">${status}</span></div>
          <div class="agent-task">${tasks[0]?.task.label || '—'}</div>
          <div class="agent-progress"><div class="agent-progress-bar" style="width: ${tasks.filter(t => t.result?.status === 'success').length / tasks.length * 100}%; background: ${colors[status] || 'var(--accent)'}"></div></div>
        </div>
      `;
    }).join('');
  }

  renderTimeline(result) {
    const container = document.getElementById('timeline');
    const events = result.history || [];
    container.innerHTML = events.map(e => `
      <div class="timeline-item">
        <div class="timeline-marker ${e.stage === 'implementation' ? 'running' : 'completed'}"></div>
        <div class="timeline-time">${new Date(e.ts).toLocaleTimeString()}</div>
        <div class="timeline-event">${e.event}</div>
        <div class="timeline-agent">${e.stage}</div>
      </div>
    `).join('');
  }

  renderDiff(result) {
    const container = document.getElementById('diff-container');
    const changes = result.outcome?.changes || [];
    container.innerHTML = changes.length ? changes.map(c => `
      <div class="diff-file">
        <div class="diff-header">${c.path} <span style="margin-left: 12px; color: var(--fg-muted); font-size: 11px;">${c.type}</span></div>
        <div class="diff-content">
          ${c.diff?.split('\n').slice(0, 50).map(line => `
            <div class="diff-line ${line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context'}">
              <span class="diff-line-num"></span>
              <span class="diff-line-content">${line}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('') : '<div class="empty-state"><div class="empty-state-title">No file changes</div></div>';
  }

  renderTests(testResult) {
    const container = document.getElementById('view-tests');
    container.innerHTML = `
      <div class="grid-3" style="margin-bottom: 24px;">
        <div class="stat-card"><div class="stat-value" style="color: var(--success);">${testResult.after?.passed || 0}</div><div class="stat-label">Passed</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--danger);">${testResult.after?.failed || 0}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-value">${testResult.regression ? 'YES' : 'NO'}</div><div class="stat-label">Regression</div></div>
      </div>
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Test Selection Reasoning</div></div><div class="neutron-card-body">
        <pre style="font-family: var(--font-mono); font-size: 12px;">${testResult.selection?.map(s => `${s.path}\n  Reason: ${s.reason}\n  Tests: ${s.selected.join(', ')}`).join('\n\n') || 'No test data'}</pre>
      </div>
    `;
  }

  renderSecurity(security) {
    const container = document.getElementById('view-security');
    const findings = security.findings || [];
    const bySeverity = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});
    container.innerHTML = `
      <div class="grid-4" style="margin-bottom: 24px;">
        <div class="stat-card"><div class="stat-value" style="color: var(--danger);">${bySeverity.critical || 0}</div><div class="stat-label">Critical</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--danger);">${bySeverity.high || 0}</div><div class="stat-label">High</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--warning);">${bySeverity.medium || 0}</div><div class="stat-label">Medium</div></div>
        <div class="stat-card"><div class="stat-value" style="color: var(--info);">${bySeverity.low || 0}</div><div class="stat-label">Low</div></div>
      </div>
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Findings</div></div><div class="neutron-card-body">
        <div class="table-container">
          <table class="neutron-table">
            <thead><tr><th>Severity</th><th>Category</th><th>Title</th><th>File</th></tr></thead>
            <tbody>
              ${findings.slice(0, 50).map(f => `
                <tr>
                  <td><span class="risk-${f.severity}">${f.severity.toUpperCase()}</span></td>
                  <td>${f.category}</td>
                  <td>${f.title}</td>
                  <td><code style="font-size: 11px;">${f.file}</code></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderReview(review) {
    const container = document.getElementById('view-review');
    container.innerHTML = `
      <div class="grid-2" style="margin-bottom: 24px;">
        <div class="stat-card" style="text-align: center;">
          <div class="stat-value" style="font-size: 48px; color: ${review.passed ? 'var(--success)' : 'var(--danger)'};">${review.score || 0}</div>
          <div class="stat-label">${review.passed ? 'PASSED' : 'NEEDS WORK'}</div>
        </div>
        <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Summary</div></div><div class="neutron-card-body">
          ${review.notes?.map(n => `<div style="margin-bottom: 8px;">${n}</div>`).join('')}
        </div></div>
      </div>
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Issues</div></div><div class="neutron-card-body">
        <div class="table-container">
          <table class="neutron-table">
            <thead><tr><th>Severity</th><th>Category</th><th>Title</th></tr></thead>
            <tbody>
              ${review.issues?.map(i => `
                <tr><td><span class="risk-${i.severity}">${i.severity.toUpperCase()}</span></td><td>${i.category}</td><td>${i.title}</td></tr>
              `).join('') || '<tr><td colspan="3">No issues</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderRelease(release) {
    const container = document.getElementById('view-release');
    const checks = [
      { key: 'analysis', label: 'Repository Analysis', status: release.checks?.analysis },
      { key: 'impact', label: 'Impact Analysis', status: release.checks?.impact },
      { key: 'implementation', label: 'Implementation', status: release.checks?.implementation },
      { key: 'build', label: 'Build', status: release.checks?.build },
      { key: 'tests', label: 'Tests', status: release.checks?.tests },
      { key: 'security', label: 'Security', status: release.checks?.security },
      { key: 'review', label: 'Code Review', status: release.checks?.review },
      { key: 'config', label: 'Configuration', status: release.checks?.config },
      { key: 'deployment', label: 'Deployment Checks', status: release.checks?.deployment },
    ];
    const ready = checks.every(c => c.status === true);
    container.innerHTML = `
      <div class="neutron-card" style="margin-bottom: 24px; text-align: center; padding: 40px;">
        <div style="font-size: 24px; font-weight: 700; color: ${ready ? 'var(--success)' : 'var(--danger)'}; margin-bottom: 8px;">
          ${ready ? 'READY FOR RELEASE' : 'NOT READY'}
        </div>
        <div style="color: var(--fg-muted);">${ready ? 'All checks passed. Awaiting human approval.' : 'Some checks require attention.'}</div>
      </div>
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Release Checks</div></div><div class="neutron-card-body">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${checks.map(c => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg); border-radius: var(--radius-md);">
              <span>${c.label}</span>
              <span class="status-badge ${c.status === true ? 'success' : c.status === false ? 'danger' : c.status === 'pending' ? 'pending' : 'info'}">
                ${c.status === true ? 'Passed' : c.status === false ? 'Failed' : c.status === 'pending' ? 'Pending' : 'Skipped'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: center;">
        <button class="btn btn-primary" disabled>Approve Release</button>
        <button class="btn btn-secondary">View Changes</button>
      </div>
    `;
  }

  renderMemory(memory) {
    const container = document.getElementById('view-memory');
    container.innerHTML = `
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Project Memory</div></div><div class="neutron-card-body">
        <pre style="font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap;">${memory || 'No memory entries yet.'}</pre>
      </div>
    `;
  }

  renderHistory() {
    const container = document.getElementById('view-history');
    const runs = JSON.parse(localStorage.getItem('neutron-runs') || '[]');
    container.innerHTML = `
      <div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Maintenance History</div></div><div class="neutron-card-body">
        ${runs.length ? `
          <div class="table-container">
            <table class="neutron-table">
              <thead><tr><th>Date</th><th>Request</th><th>Status</th><th>Duration</th></tr></thead>
              <tbody>
                ${runs.map(r => `
                  <tr><td>${new Date(r.timestamp).toLocaleString()}</td><td>${r.request}</td><td><span class="status-badge ${r.status === 'completed' ? 'success' : 'danger'}">${r.status}</span></td><td>${r.duration}ms</td></tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state"><div class="empty-state-title">No maintenance history yet</div></div>'}
      </div>
    `;
  }

  /** Shows only what is actually on disk under .agent/bob - never placeholder or invented activity. */
  renderBob(data) {
    const container = document.getElementById('view-bob');
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const samples = Array.isArray(data.samples) ? data.samples : [];
    const missing = Array.isArray(data.missing) ? data.missing : [];
    const stat = (v, label) => `<div class="stat-card"><div class="stat-value">${esc(v ?? 0)}</div><div class="stat-label">${label}</div></div>`;
    const sessionRows = sessions.map((s) => `
      <tr>
        <td>${esc(s.title || s.id)}</td>
        <td>${esc(s.createdAt ? new Date(s.createdAt).toLocaleString() : '—')}</td>
        <td>${esc(s.messageCount ?? 0)}</td>
        <td><code style="font-size:11px;">${esc((s.filesTouched || []).slice(0, 6).join(', ') || '—')}</code></td>
        <td>${esc(s.summary || '—')}</td>
      </tr>`).join('');
    container.innerHTML = `
      <div class="grid-4" style="margin-bottom: 24px;">
        ${stat(data.sessionCount ?? sessions.length, 'Bob Sessions')}
        ${stat(data.taskCount, 'Bob Tasks')}
        ${stat(data.filesAnalyzed, 'Files Analyzed')}
        ${stat(data.filesModified, 'Files Modified')}
      </div>
      <div class="neutron-card" style="margin-bottom:16px;">
        <div class="neutron-card-header"><div class="neutron-card-title">Bob Sessions</div><div class="neutron-card-subtitle">Source: ${esc(data.source || 'none')}</div></div>
        <div class="neutron-card-body">
          ${sessions.length ? `<div class="table-container"><table class="neutron-table">
            <thead><tr><th>Session</th><th>Started</th><th>Messages</th><th>Files touched</th><th>Summary</th></tr></thead>
            <tbody>${sessionRows}</tbody></table></div>`
          : `<p>No IBM Bob session evidence found for this repository.</p>
             <p style="font-size:12px;opacity:.8;">NEUTRON only displays real Bob exports. Place them under <code>.agent/bob/</code>: session files in <code>sessions/</code>, optional <code>activity.json</code> and <code>summary.md</code>.</p>`}
        </div>
      </div>
      ${samples.length ? `<div class="neutron-card" style="margin-bottom:16px;"><div class="neutron-card-header"><div class="neutron-card-title">Task summaries</div></div><div class="neutron-card-body">${samples.map((t) => `<pre style="font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap;">${esc(t)}</pre>`).join('')}</div></div>` : ''}
      ${missing.length ? `<div class="neutron-card"><div class="neutron-card-header"><div class="neutron-card-title">Not found</div></div><div class="neutron-card-body"><ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div></div>` : ''}
    `;
  }
}

const dashboard = new NeutronDashboard();
dashboard.init();
window.dashboard = dashboard;