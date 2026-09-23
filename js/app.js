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
    return Object.fromEntries(new URLSearchParams(location.search));
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

  async function render() {
    const path = currentPath();
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === path.split('?')[0]));
    if (path === '/' || path === '') return home();
    if (path.startsWith('/mods')) return browse();
    if (path.startsWith('/mod/')) return projectView(decodeURIComponent(path.split('/')[2] || ''));
    if (path === '/about') return about();
    return notFound();
  }

  /* ───────────── SHARED ───────────── */

  function card(hit) {
    const cats = hit.display_categories || hit.categories || [];
    const tags = [hit.project_type ? PROJECT_TYPES[hit.project_type] : null, ...cats.slice(0, 3)].filter(Boolean)
      .map(c => `<span class="tag">${esc(LOADER_LABEL[c] || c.replace(/_/g, ' '))}</span>`).join('');
    return `
    <a class="card" href="/mod/${encodeURIComponent(hit.slug)}" onclick="return false" data-slaak-nav="/mod/${encodeURIComponent(hit.slug)}">
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
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Trending right now</h2><a class="see-all" href="/mods" onclick="return false" data-slaak-nav="/mods">See all →</a></div>
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
      document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', (a.getAttribute('href') || '') === '/mods'));
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
          <div class="dl-sub" id="dlSub">Grab the latest release file</div>
        </div>
      </div>
    </div>
    <div class="project-tabs">
      <button class="active" data-tab="overview">Overview</button>
      <button data-tab="versions">Versions <span style="opacity:.6">(${vers.length})</span></button>
    </div>
    <div class="project-body" id="projectBody"><div class="grid">${skeletons(1).repeat(1)}</div></div>`;

    const modal = document.createElement('div');
    modal.classList.add('modal-back');
    modal.id = 'slaakModal';
    document.body.appendChild(modal);

    document.getElementById('dlLatestBtn').addEventListener('click', () => showPickVersion(p, vers, modal));

    document.querySelectorAll('.project-tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.project-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderProjectBody(p, vers, b.dataset.tab, modal);
    }));

    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.remove('open'); } });

    renderProjectBody(p, vers, 'overview', modal);
  }

  async function renderProjectBody(p, vers, tab, modal) {
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

  async function showPickVersion(p, vers, modal) {
    const versionSel = await gameVersionsCache();
    const gameVers = (p.game_versions || []).filter(v => /^\d+(\.\d+){1,2}$/.test(v));
    const loaderOpts = Array.from(new Set(vers.flatMap(v => v.loaders || []))).filter(l => l !== 'vanilla');
    modal.innerHTML = `
    <div class="modal">
      <h3>Download ${esc(p.title)}</h3>
      <div class="m-row">
        <label>Game version</label>
        <select id="pickGame">${(gameVers.length ? gameVers : versionSel.slice(0, 14)).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>
      </div>
      <div class="m-row">
        <label>Loader</label>
        <select id="pickLoader"><option value="">Any</option>${loaderOpts.map(l => `<option value="${esc(l)}">${esc(LOADER_LABEL[l] || l)}</option>`).join('')}</select>
      </div>
      <div id="pickResults" style="max-height:220px;overflow:auto"></div>
      <div class="m-actions">
        <button class="btn btn-primary" id="pickDL" disabled>Download latest file</button>
        <button class="btn btn-ghost" id="pickClose">Cancel</button>
      </div>
    </div>`;
    modal.classList.add('open');

    let chosen = null;
    const refresh = () => {
      const gv = document.getElementById('pickGame').value;
      const ld = document.getElementById('pickLoader').value;
      const matches = vers.filter(v => (v.game_versions || []).includes(gv) && (!ld || (v.loaders || []).includes(ld)));
      const res = document.getElementById('pickResults');
      res.innerHTML = matches.length
        ? `<div class="version-list">${matches.slice(0, 5).map(v => {
            const f = v.files.find(f => f.primary) || v.files[0];
            return `<div class="version-row">
              <div class="vname">${esc(v.name)}</div>
              <div class="vmeta">${fmt(f?.size || 0)} · ${fmtDate(v.date_published)}</div>
              <button class="btn btn-ghost dl mchip" data-url="${esc(f?.url)}" data-name="${esc(f?.filename)}">File</button>
            </div>`;
          }).join('')}</div>`
        : '<p style="color:var(--txt3);padding:10px">No matching file for this combo.</p>';
      chosen = matches[0] && (matches[0].files.find(f => f.primary) || matches[0].files[0]);
      document.getElementById('pickDL').disabled = !chosen;
      res.querySelectorAll('.mchip').forEach(b => b.addEventListener('click', () => downloadAndToast(b.dataset.url, b.dataset.name, 'File downloaded')));
    };
    document.getElementById('pickGame').addEventListener('change', refresh);
    document.getElementById('pickLoader').addEventListener('change', refresh);
    document.getElementById('pickDL').addEventListener('click', () => {
      if (chosen) {
        const f = chosen.files.find(x => x.primary) || chosen.files[0];
        downloadAndToast(f.url, f.filename, 'Download started');
      }
    });
    document.getElementById('pickClose').addEventListener('click', () => modal.classList.remove('open'));
    refresh();
  }

  /* ───────────── ABOUT / 404 ───────────── */

  function about() {
    app.innerHTML = `
    <div class="about">
      <h1>About Slaak<span style="color:var(--txt3)">.gg</span></h1>
      <p>Slaak.gg is a fast, dark and modern way to browse the Minecraft modding scene. We pull live data from the <a href="https://modrinth.com" target="_blank" rel="noopener">Modrinth</a> public API so everything here is always up to date.</p>
      <p>Every download lands in your browser's Downloads folder. No wrappers, no installers, no nonsense.</p>
      <p>Pair the site with the <b>Slaak.gg launcher</b> for instances, mod management, friends and more.</p>
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
    if (nav && !e.defaultPrevented) { e.preventDefault(); navigate(nav.dataset.slaakNav); return; }
    const go = e.target.closest('[data-slaak-go]');
    if (go && !e.defaultPrevented) { navigate(go.dataset.slaakGo); }
  });

  const ni = document.getElementById('navSearchInput');
  if (ni) ni.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && ni.value.trim()) navigate('/mods?q=' + encodeURIComponent(ni.value.trim()));
  });

  render();
})();