/* Slaak.gg — Modrinth API layer */
const API = 'https://api.modrinth.com/v2';

const PROJECT_TYPES = {
  mod: 'Mod',
  modpack: 'Modpack',
  resourcepack: 'Resource Pack',
  shader: 'Shader',
  datapack: 'Data Pack',
  plugin: 'Plugin',
};

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt', 'spigot', 'paper', 'bungee', 'velocity', 'bukkit', 'folia', 'purpur', 'sponge', 'vanilla'];
const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', bukkit: 'Bukkit', spigot: 'Spigot', paper: 'Paper', purpur: 'Purpur', folia: 'Folia', bungee: 'BungeeCord', velocity: 'Velocity', sponge: 'Sponge', vanilla: 'Vanilla' };

const SORTS = {
  relevance: 'Relevance',
  downloads: 'Most downloaded',
  follows: 'Most followed',
  newest: 'Newest',
  updated: 'Recently updated',
};

async function mr(path) {
  const res = await fetch(API + path, { headers: { 'User-Agent': 'Slaak.gg/1.0' } });
  if (!res.ok) throw new Error('Modrinth returned ' + res.status);
  return res.json();
}

// facets -> [[k:v], [k:v]] -> encoded
function facetStr(facets) {
  return encodeURIComponent(JSON.stringify(facets));
}

function search({ query = '', type = 'mod', loaders = [], versions = [], categories = [], sort = 'relevance', limit = 24, offset = 0 }) {
  const facets = [];
  if (type) facets.push(['project_type:' + type]);
  if (loaders.length) facets.push(loaders.map(l => 'categories:' + l));
  if (versions.length) facets.push(versions.map(v => 'versions:' + v));
  if (categories.length) facets.push(categories.map(c => 'categories:' + c));
  let q = `?limit=${limit}&offset=${offset}&sort_by=${sort}&facets=${facetStr(facets)}`;
  if (query) q += `&query=${encodeURIComponent(query)}`;
  return mr('/search' + q);
}

const project = (id) => mr('/project/' + encodeURIComponent(id));
const projectVersions = (id) => mr('/project/' + encodeURIComponent(id) + '/version');
const projectReadme = (id) => mr('/project/' + encodeURIComponent(id) + '/readme');
const projectTeams = (id) => mr(`/project/${encodeURIComponent(id)}/team`).catch(() => []);
const contributions = (id) => mr(`/project/${encodeURIComponent(id)}/membership`).catch(() => []);

async function gameVersions() {
  const all = await mr('/tag/game_version');
  const stable = all.filter(v => /^\d+(\.\d+){1,2}$/.test(v));
  const sorted = stable.sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d;
    }
    return 0;
  });
  return sorted;
}

async function loaders() {
  const list = await mr('/tag/loader');
  return list.map(l => l.name);
}

async function categories() {
  const list = await mr('/tag/category');
  return list;
}

function fmtNum(n) {
  if (n == null) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
}