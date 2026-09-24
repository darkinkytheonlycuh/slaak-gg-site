/* Slaak.gg — app */
(function () {
  'use strict';

  const app = document.getElementById('app');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = fmtNum;

  let VERSIONS_CACHE = null;
  let CATS_CACHE = null;

  const state = { browse: { query: '', type: 'mod', loaders: [], versions: [], cats: [], sort: 'relevance', offset: 0, limit: 24, total: 0 } };

  /* ───────────── ROUTER ───────────── */

  function currentPath() {
    if (location.protocol === 'file:') return location.hash.slice(1) || '/';
    return location.pathname;
  }

  function navigate(path) {
    if (location.protocol === 'file:') {
      location.hash = path;
      render();
    } else {
      history.pushState({}, '', path);
      render();
    }
    window.scrollTo({ top: 0 });
  }

  function parseQs() {
    const src = location.protocol === 'file:' ? (location.hash.split('?')[1] || '') : location.search;
    return Object.fromEntries(new URLSearchParams(src));
  }

  function setQs(pairs) {
    if (location.protocol === 'file:') return;
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(pairs)) {
      if (v == null || v === '') u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    history.replaceState({}, '', u.pathname + u.search);
  }

  const TYPE_NAV = {
    mod: '/mods',
    plugin: '/mods',
    resourcepack: '/mods?type=resourcepack',
    shader: '/mods?type=shader',
    datapack: '/mods?type=datapack',
    modpack: '/mods?type=modpack'
  };

  function markNavActive() {
    const q = parseQs();
    const path = currentPath();
    let cur = path;
    if (path === '/mods') cur = TYPE_NAV[q.type] || '/mods';
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', (a.getAttribute('href') || '').split('?')[0] === cur.split('?')[0] && (a.getAttribute('href') || '') === cur));
  }

  async function render() {
    const path = currentPath();
    markNavActive();
    if (path === '/' || path === '') return home();
    if (path.startsWith('/mods')) return browse();
    if (path.startsWith('/mod/')) return projectView(decodeURIComponent(path.split('/')[2] || ''));
    if (path === '/download') return downloadView();
    if (path === '/about') return about();
    return notFound();
  }

  /* ───────────── SHARED ───────────── */

  function card(hit) {
    const cats = hit.display_categories || hit.categories || [];
    const tags = [hit.project_type ? PROJECT_TYPES[hit.project_type] : null, ...cats.slice(0, 3)].filter(Boolean)
      .map(c => `<span class="tag">${esc(LOADER_LABEL[c] || c.replace(/_/g, ' '))}</span>`).join('');
    return `
    <a class="card" href="/mod/${encodeURIComponent(hit.slug)}" data-slaak-nav="/mod/${encodeURIComponent(hit.slug)}">
      <div class="card-top">
        <img class="card-icon" loading="lazy" src="${esc(hit.icon_url || '/assets/icon.png')}" alt="">
        <div style="min-width:0">
          <h3>${esc(hit.title)}</h3>
          <div class="card-tags">${tags}</div>
        </div>
      </div>
      <p class="desc">${esc(hit.description || '')}</p>
      <div class="card-foot">
        <span class="stat">▼ ${fmt(hit.downloads)}</span>
        <span class="stat">★ ${fmt(hit.follows)}</span>
        <span class="card-author">${esc(hit.author || '')}</span>
      </div>
    </a>`;
  }

  function skeletons(n) {
    return Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
  }

  let toastTimer = null;
  function toast(msg, cls = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + cls;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 3600);
  }

  function downloadAndToast(url, filename, label) {
    triggerDownload(url, filename);
    toast(`${label} — downloaded to your Downloads folder`, 'good');
  }

  const stableRe = /^\d+(\.\d+){1,2}$/;
  function numDesc(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  const TYPE_RANK = { release: 0, beta: 1, alpha: 2 };
  const typeRank = (t) => (TYPE_RANK[t] == null ? 3 : TYPE_RANK[t]);
  const primaryFile = (v) => ((v.files || []).find(f => f.primary) || (v.files || [])[0]) || null;

  /* ───────────── HOME ───────────── */

  async function home() {
    app.innerHTML = `
    <section class="hero">
      <div class="hero-inner">
        <div class="eyebrow"><span class="pulse"></span> Powered by the live Modrinth catalog</div>
        <h1>Every mod.<br><span class="grad">Delivered beautifully.</span></h1>
        <p class="sub">The sleekest way to find and download Minecraft mods, resource packs, shaders and data packs. One click, straight to your downloads.</p>
        <div class="hero-meta">
          <span class="chip"><b id="statProjects">—</b> projects</span>
          <span class="chip"><b id="statDownloads">—</b> total downloads</span>
          <span class="chip"><b id="statVersions">—</b> game versions</span>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" data-slaak-go="/mods">Browse mods</button>
          <button class="btn btn-ghost" data-slaak-go="/mods?type=resourcepack">Resource packs</button>
          <button class="btn btn-ghost" data-slaak-go="/mods?type=shader">Shaders</button>
          <button class="btn btn-ghost" data-slaak-go="/download">Get the launcher</button>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Trending right now</h2><a class="see-all" href="/mods" data-slaak-nav="/mods">See all →</a></div>
      <div class="grid" id="homeGrid">${skeletons(8)}</div>
    </section>`;

    const setStat = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    stats().then(s => { setStat('statProjects', fmt(s.projects)); setStat('statDownloads', fmt(s.downloads)); setStat('statVersions', fmt(s.versions)); }).catch(() => {});
    search({ type: 'mod', sort: 'downloads', limit: 8 }).then(r => {
      document.getElementById('homeGrid').innerHTML = r.hits.map(card).join('') || '<div class="empty">Nothing found.</div>';
    }).catch(() => { document.getElementById('homeGrid').innerHTML = '<div class="empty">Could not reach Modrinth.</div>'; });
  }

  async function stats() {
    const t = await mr('/statistics');
    if (t.projects) return t;
    const vs = await gameVersionsCache();
    const r = await search({ type: 'mod', sort: 'downloads', limit: 1 });
    return { projects: r.total_hits, downloads: 0, versions: vs.length };
  }

  /* ───────────── BROWSE ───────────── */

  async function browse() {
    const q = parseQs();
    state.browse.query = q.q || '';
    if (q.type) {
      const types = ['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'plugin'];
      if (types.includes(q.type)) state.browse.type = q.type;
    }
    if (q.loaders) state.browse.loaders = q.loaders.split(',').filter(Boolean);
    if (q.versions) state.browse.versions = q.versions.split(',').filter(Boolean);
    if (q.cats) state.browse.cats = q.cats.split(',').filter(Boolean);
    if (q.sort) state.browse.sort = q.sort;
    state.browse.offset = 0;

    const versions = await gameVersionsCache();
    const cats = await categoriesCache();

    app.innerHTML = `
    <div class="browse">
      <aside class="filters">
        <div class="f-block">
          <h4>Type</h4>
          ${Object.entries(PROJECT_TYPES).map(([k, v]) => `<button class="ty ${state.browse.type === k ? 'active' : ''}" data-type="${k}">${v}</button>`).join('')}
        </div>
        <div class="f-block">
          <h4>Loader</h4>
          ${LOADERS.map(l => toggleRow('loader', l, LOADER_LABEL[l] || l, state.browse.loaders.includes(l))).join('')}
        </div>
        <div class="f-block">
          <h4>Game version</h4>
          <select id="fVersion">
            <option value="">Any version</option>
            ${versions.slice(0, 14).map(v => `<option value="${esc(v)}" ${state.browse.versions.includes(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="f-block">
          <h4>Category</h4>
          <select id="fCat">
            <option value="">Any category</option>
            ${cats.filter(c => c.project_type === state.browse.type).map(c => `<option value="${esc(c.name)}" ${state.browse.cats.includes(c.name) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="f-block">
          <h4>Sort by</h4>
          <select id="fSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${state.browse.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
      </aside>
      <div>
        <div class="results-toolbar">
          <div class="search-inline">
            <svg class="ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="fQuery" type="text" placeholder="Search…" value="${esc(state.browse.query)}">
          </div>
          <span class="results-count" id="count">—</span>
        </div>
        <div class="grid" id="resultsGrid" style="min-height:40vh">${skeletons(9)}</div>
        <div class="paging" id="paging"></div>
      </div>
    </div>`;

    wireBrowseControls();
    runSearch();
  }

  function toggleRow(kind, val, label, on) {
    return `<label class="opt"><span class="checkbox ${on ? 'on' : ''}" data-k="${kind}" data-v="${esc(val)}">${on ? '<span class="tick">✓</span>' : ''}</span><span>${esc(label)}</span></label>`;
  }

  function wireBrowseControls() {
    document.querySelectorAll('.filters .ty').forEach(b => b.addEventListener('click', () => {
      state.browse.type = b.dataset.type;
      state.browse.cats = [];
      runSearch(true);
    }));
    document.querySelectorAll('.checkbox[data-k="loader"]').forEach(c => c.addEventListener('click', () => {
      const v = c.dataset.v;
      const i = state.browse.loaders.indexOf(v);
      if (i >= 0) state.browse.loaders.splice(i, 1);
      else state.browse.loaders.push(v);
      runSearch(true);
    }));
    const fv = document.getElementById('fVersion');
    if (fv) fv.addEventListener('change', () => {
      state.browse.versions = fv.value ? [fv.value] : [];
      runSearch(true);
    });
    const fc = document.getElementById('fCat');
    if (fc) fc.addEventListener('change', () => {
      state.browse.cats = fc.value ? [fc.value] : [];
      runSearch(true);
    });
    const fs = document.getElementById('fSort');
    if (fs) fs.addEventListener('change', () => {
      state.browse.sort = fs.value;
      runSearch(true);
    });
    const qIn = document.getElementById('fQuery');
    if (qIn) qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.browse.query = qIn.value.trim(); runSearch(true); } });
  }

  async function runSearch(pushUrl) {
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    const s = state.browse;
    if (pushUrl) {
      s.offset = 0;
      setQs({
        q: s.query || '',
        type: s.type !== 'mod' ? s.type : '',
        loaders: s.loaders.length ? s.loaders.join(',') : '',
        versions: s.versions.length ? s.versions.join(',') : '',
        cats: s.cats.length ? s.cats.join(',') : '',
        sort: s.sort !== 'relevance' ? s.sort : ''
      });
      markNavActive();
    }
    const c = document.getElementById('count');
    if (c) c.innerHTML = 'Searching…';
    try {
      const r = await search(s);
      s.total = r.total_hits;
      grid.innerHTML = r.hits.length ? r.hits.map(card).join('') : `<div class="empty">No results — try clearing some filters.</div>`;
      if (c) c.innerHTML = `<b>${fmt(s.total)}</b> result${s.total === 1 ? '' : 's'}`;
      const pg = document.getElementById('paging');
      const pages = Math.max(1, Math.ceil(s.total / s.limit));
      const cur = s.offset / s.limit + 1;
      pg.innerHTML = `
        <button data-pg="prev" ${cur <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="pg">Page ${cur} / ${pages}</span>
        <button data-pg="next" ${cur >= pages ? 'disabled' : ''}>Next →</button>`;
      pg.querySelector('[data-pg="prev"]').addEventListener('click', () => { if (s.offset > 0) { s.offset -= s.limit; runSearch(); } });
      pg.querySelector('[data-pg="next"]').addEventListener('click', () => { if (s.offset + s.limit < s.total) { s.offset += s.limit; runSearch(); } });
      window.scrollTo({ top: grid.offsetTop - 90, behavior: 'smooth' });
    } catch (err) {
      grid.innerHTML = `<div class="empty">Could not reach Modrinth (${esc(err.message)}).</div>`;
      if (c) c.textContent = 'Error';
    }
  }

  /* ───────────── PROJECT ───────────── */

  async function projectView(slug) {
    app.innerHTML = `<div class="section"><div class="grid">${skeletons(1).repeat(1)}</div></div>`;
    let p;
    try { p = await project(slug); }
    catch (_) { return app.innerHTML = `<div class="about"><h1>Project not found</h1><p>It may have been removed.</p><button class="btn btn-primary" data-slaak-go="/mods">Back to browsing</button></div>`; }

    const vers = await projectVersions(p.id);
    const teamArr = Array.isArray(p.team) ? p.team : [];
    const tm = await projectTeams(p.id).catch(() => []);
    const team = [...teamArr.flatMap(m => m && m.user && m.user.username ? [m.user.username] : []), ...(Array.isArray(tm) ? tm.flatMap(m => m && m.user && m.user.username ? [m.user.username] : []) : [])];
    const authorName = p.author || team[0] || 'Unknown';

    app.innerHTML = `
    <div class="project-header">
      <img class="project-icon" src="${esc(p.icon_url || '/assets/icon.png')}" alt="">
      <div class="project-id">
        <div class="card-tags" style="margin-bottom:8px">${p.project_type ? `<span class="tag">${PROJECT_TYPES[p.project_type]}</span>` : ''}${(p.categories || []).slice(0, 6).map(c => `<span class="tag">${esc(c.replace(/_/g, ' '))}</span>`).join('')}</div>
        <h1>${esc(p.title)}</h1>
        <div class="by">by <b>${esc(authorName)}</b></div>
        <div class="project-stats">
          <span class="stat-pill">▼ <b>${fmt(p.downloads)}</b> downloads</span>
          <span class="stat-pill">★ <b>${fmt(p.followers ?? p.follows ?? 0)}</b> follows</span>
          ${p.updated ? `<span class="stat-pill">Updated <b>${fmtDate(p.updated)}</b></span>` : ''}
          ${p.game_versions?.length ? `<span class="stat-pill">Latest ${esc(p.game_versions[0])}</span>` : ''}
        </div>
        <div class="dl-bar" id="dlBar">
          <button class="btn btn-primary" id="dlLatestBtn">Download</button>
          <div class="dl-sub" id="dlSub">Choose your loader & game version below</div>
        </div>
      </div>
    </div>
    <section class="dl-widget" id="dlWidget">
      <div class="dw-head">
        <div><h3>Download</h3><span class="dw-sub">Pick a loader and game version, then grab a file.</span></div>
        <span class="dw-total" id="dwTotal"></span>
      </div>
      <div class="dw-body">
        <div class="dw-row">
          <div class="dw-label">Loader</div>
          <div class="dw-loaders" id="dwLoaders"></div>
        </div>
        <div class="dw-row">
          <div class="dw-label">Game version</div>
          <select class="dw-select" id="dwGame"></select>
        </div>
        <div class="version-list" id="dwList"></div>
        <div class="dw-foot">
          <button class="btn btn-primary dw-btn" id="dwBtn" disabled>Download</button>
          <span class="dw-file" id="dwFile"></span>
        </div>
      </div>
    </section>
    <div class="project-tabs">
      <button class="active" data-tab="overview">Overview</button>
      <button data-tab="versions">Versions <span style="opacity:.6">(${vers.length})</span></button>
    </div>
    <div class="project-body" id="projectBody"><div class="grid">${skeletons(1).repeat(1)}</div></div>`;

    const dlBtn = document.getElementById('dlLatestBtn');
    if (dlBtn) dlBtn.addEventListener('click', () => {
      const w = document.getElementById('dlWidget');
      if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.querySelectorAll('.project-tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.project-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderProjectBody(p, vers, b.dataset.tab);
    }));

    buildWidget(p, vers);

    renderProjectBody(p, vers, 'overview');
  }

  async function renderProjectBody(p, vers, tab) {
    const body = document.getElementById('projectBody');
    if (tab === 'versions') {
      body.innerHTML = `<div><div class="section-head"><h2>All versions</h2></div><div class="version-list">${vers.slice(0, 40).map(v => `
        <div class="version-row">
          <div>
            <div class="vname">${esc(v.name)}</div>
            <div class="vmeta">
              <span>${esc((v.game_versions || []).slice(0, 3).join(', '))}</span>
              ${(v.loaders || []).map(l => `<span class="tag">${esc(LOADER_LABEL[l] || l)}</span>`).join('')}
              <span>${fmtDate(v.date_published)}</span>
              <span>${fmt(v.files[0]?.size || 0)}</span>
            </div>
          </div>
          <button class="btn btn-ghost dl vdl" data-url="${esc(v.files.find(f => f.primary)?.url || v.files[0]?.url)}" data-name="${esc(v.files.find(f => f.primary)?.filename || v.files[0]?.filename)}">Download</button>
        </div>`).join('')}</div></div>`;
      wireBodyEvents(body);
      return;
    }
    body.innerHTML = `<div class="markdown" id="readme">Rendering readme…</div>` + (p.gallery?.length ? `<div class="gallery">${p.gallery.map(g => `<img loading="lazy" src="${esc(g.url)}" alt="">`).join('')}</div>` : '');
    try {
      const md = await projectReadme(p.id);
      const html = DOMPurify.sanitize(marked.parse(md || '*No description available.*'));
      const el = document.getElementById('readme');
      if (el) el.innerHTML = html;
    } catch (_) {
      const el = document.getElementById('readme');
      if (el) el.innerHTML = `<p>${esc(p.description || 'No description.')}</p>`;
    }
    wireBodyEvents(body);
  }

  function wireBodyEvents(root) {
    root.querySelectorAll('.vdl').forEach(b => b.addEventListener('click', () => {
      downloadAndToast(b.dataset.url, b.dataset.name, 'Version downloaded');
    }));
  }

  function buildWidget(p, vers) {
    const loaderSet = new Set();
    const gameSet = new Set();
    vers.forEach(v => {
      (v.loaders || []).forEach(l => { if (l !== 'vanilla' && LOADER_LABEL[l]) loaderSet.add(l); });
      (v.game_versions || []).forEach(g => { if (stableRe.test(g)) gameSet.add(g); });
    });
    const loaders = LOADERS.filter(l => loaderSet.has(l));
    const gameVs = Array.from(gameSet).sort(numDesc);

    const loadersEl = document.getElementById('dwLoaders');
    const gameEl = document.getElementById('dwGame');
    const listEl = document.getElementById('dwList');
    const btn = document.getElementById('dwBtn');
    const fileEl = document.getElementById('dwFile');
    const totalEl = document.getElementById('dwTotal');
    if (!loadersEl) return;

    if (!vers.length) {
      listEl.innerHTML = '<div class="empty">No downloadable files yet.</div>';
      if (btn) btn.disabled = true;
      return;
    }

    const loaderCounts = {};
    loaders.forEach(l => { loaderCounts[l] = vers.filter(v => (v.loaders || []).includes(l)).length; });

    const newest = vers.slice().sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
    const newestRel = newest.find(v => v.version_type === 'release') || newest[0];
    let selLoader = '';
    let selGame = gameVs[0] || '';
    if (newestRel) {
      const l = (newestRel.loaders || []).find(x => loaderSet.has(x));
      if (l) selLoader = l;
      const g = (newestRel.game_versions || []).filter(x => gameSet.has(x)).sort(numDesc)[0];
      if (g) selGame = g;
    }

    loadersEl.innerHTML = loaders.length
      ? loaders.map(l => `<button class="dw-pill${selLoader === l ? ' active' : ''}" data-l="${esc(l)}">${esc(LOADER_LABEL[l] || l)}<span class="dw-count">${loaderCounts[l]}</span></button>`).join('')
      : '<span class="dw-none">No loaders listed</span>';

    gameEl.innerHTML = gameVs.length
      ? gameVs.map(g => `<option value="${esc(g)}" ${g === selGame ? 'selected' : ''}>${esc(g)}</option>`).join('')
      : '<option value="">—</option>';

    let chosen = primaryFile(newestRel);
    const refresh = () => {
      const gv = gameEl.value;
      const matches = vers.filter(v => (v.game_versions || []).includes(gv) && (!selLoader || (v.loaders || []).includes(selLoader)))
        .sort((a, b) => (typeRank(a.version_type) - typeRank(b.version_type)) || (new Date(b.date_published) - new Date(a.date_published)));
      totalEl.textContent = matches.length ? `${matches.length} file${matches.length === 1 ? '' : 's'}` : '';
      chosen = primaryFile(matches[0]);
      listEl.innerHTML = matches.length
        ? matches.slice(0, 5).map(v => {
            const f = primaryFile(v);
            return `<div class="version-row">
              <div>
                <div class="vname">${esc(v.name)} <span class="tag">${esc(v.version_type)}</span></div>
                <div class="vmeta">
                  <span>${esc((v.game_versions || []).slice(0, 4).join(', '))}</span>
                  ${(v.loaders || []).map(l => `<span class="tag">${esc(LOADER_LABEL[l] || l)}</span>`).join('')}
                  <span>${fmt(f?.size || 0)}</span>
                  <span>${fmtDate(v.date_published)}</span>
                </div>
              </div>
              <button class="btn btn-ghost dl vdl" data-url="${esc(f?.url)}" data-name="${esc(f?.filename)}">Download</button>
            </div>`;
          }).join('')
        : '<div class="empty">No file for this combo — try another loader or version.</div>';
      if (btn) btn.disabled = !chosen;
      if (fileEl) fileEl.textContent = chosen?.filename || '';
      wireBodyEvents(listEl);
    };

    loadersEl.querySelectorAll('.dw-pill').forEach(pill => pill.addEventListener('click', () => {
      selLoader = selLoader === pill.dataset.l ? '' : pill.dataset.l;
      loadersEl.querySelectorAll('.dw-pill').forEach(x => x.classList.toggle('active', x.dataset.l === selLoader));
      refresh();
    }));
    gameEl.addEventListener('change', refresh);
    if (btn) btn.addEventListener('click', () => {
      if (chosen) downloadAndToast(chosen.url, chosen.filename, 'Download started');
    });
    refresh();
  }

  /* ───────────── DOWNLOAD / ABOUT / 404 ───────────── */

  function downloadView() {
    app.innerHTML = `
    <section class="dl-hero">
      <div class="eyebrow"><span class="pulse"></span> Slaak.gg launcher · v1.0.9 · Windows 10/11</div>
      <h1>Download the launcher</h1>
      <p class="sub">Auto-updating instances, mod management, friends, and more — all wrapped in our OLED-dark shell. Downloads start instantly.</p>
      <div class="dl-cards">
        <div class="dl-card" id="dlSetup">
          <div class="dl-card-top">
            <span class="dl-badge">Recommended</span>
            <h3>Setup</h3>
          </div>
          <p class="dl-card-desc">Full installer. Adds a start-menu shortcut and auto-updates in the background.</p>
          <div class="dl-card-meta">
            <span>slaakgg-setup-1.0.9.exe</span>
            <span>78.3 MB</span>
          </div>
          <a class="btn btn-primary dl-card-btn" href="/downloads/slaakgg-setup-1.0.9.exe" download>Download setup</a>
        </div>
        <div class="dl-card" id="dlPortable">
          <div class="dl-card-top">
            <span class="dl-badge">No install</span>
            <h3>Portable</h3>
          </div>
          <p class="dl-card-desc">Single-file launcher. Runs directly from anywhere — USB or a folder. No registry writes.</p>
          <div class="dl-card-meta">
            <span>slaakgg-portable-1.0.9.exe</span>
            <span>77.9 MB</span>
          </div>
          <a class="btn btn-ghost dl-card-btn" href="/downloads/slaakgg-portable-1.0.9.exe" download>Download portable</a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="dl-notes">
        <h3>Notes</h3>
        <ul>
          <li>Your download lands in your <b>Downloads</b> folder when the file picker is skipped.</li>
          <li>Windows SmartScreen may warn about an unsigned build — choose <b>More info → Run anyway</b>.</li>
          <li>No install required for the portable build: unzip nothing, just double-click.</li>
        </ul>
      </div>
    </section>`;
  }

  function about() {
    app.innerHTML = `
    <div class="about">
      <h1>About Slaak<span style="color:var(--txt3)">.gg</span></h1>
      <p>Slaak.gg is a fast, dark and modern way to browse the Minecraft modding scene. We pull live data from the <a href="https://modrinth.com" target="_blank" rel="noopener">Modrinth</a> public API so everything here is always up to date.</p>
      <p>Every download lands in your browser's Downloads folder. No wrappers, no installers, no nonsense.</p>
      <p>Pair the site with the <a href="/download" data-slaak-nav="/download">Slaak.gg launcher</a> for instances, mod management, friends and more.</p>
    </div>`;
  }

  function notFound() {
    app.innerHTML = `<div class="about"><h1>404</h1><p>That page doesn't exist.</p><button class="btn btn-primary" data-slaak-go="/">Go home</button></div>`;
  }

  /* ───────────── CACHES / INIT ───────────── */

  async function gameVersionsCache() {
    if (!VERSIONS_CACHE) VERSIONS_CACHE = await gameVersions();
    return VERSIONS_CACHE;
  }
  async function categoriesCache() {
    if (!CATS_CACHE) CATS_CACHE = await categories();
    return CATS_CACHE;
  }

  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);

  document.getElementById('app').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-slaak-nav]');
    if (nav) { e.preventDefault(); navigate(nav.dataset.slaakNav); return; }
    const go = e.target.closest('[data-slaak-go]');
    if (go) { e.preventDefault(); navigate(go.dataset.slaakGo); }
  });

  const ni = document.getElementById('navSearchInput');
  if (ni) ni.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && ni.value.trim()) navigate('/mods?q=' + encodeURIComponent(ni.value.trim()));
  });

  render();
})();