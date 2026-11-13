import { fetchIncidents, ack } from './api.js';

const board = document.querySelector('[data-testid="board"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const list = document.querySelector('[data-testid="incident-list"]');
const buildMeta = document.querySelector('meta[name="build"]');
const buildSha = document.querySelector('[data-testid="build-sha"]');

/** @type {Array<{id:string,service:string,region:string,summary:string,severity:string,openedAt:string}>} */
let incidents = [];
const acked = new Set();
let loadedOnce = false;
let pollTimer = null;

function formatLocal(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function syncBuildSha() {
  const sha = (buildMeta && buildMeta.getAttribute('content')) || '0000000';
  if (buildSha) buildSha.textContent = sha;
}

function render() {
  if (!loadedOnce) {
    loader.hidden = false;
    empty.hidden = true;
    list.hidden = true;
    return;
  }

  loader.hidden = true;

  if (incidents.length === 0) {
    empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = incidents
    .map((i) => {
      const isAcked = acked.has(i.id);
      return `<li data-testid="incident-row" data-id="${i.id}" class="row ${i.severity}${isAcked ? ' is-acked' : ''}">
        <span class="id">${i.id}</span>
        <span class="sev">${i.severity}</span>
        <span class="what">${escapeHtml(i.service)} · ${escapeHtml(i.region)} · ${escapeHtml(i.summary)}</span>
        <time datetime="${i.openedAt}">${formatLocal(i.openedAt)}</time>
        ${
          isAcked
            ? `<span data-testid="acked" class="acked">acked</span>`
            : `<button type="button" data-testid="ack" data-id="${i.id}" class="ack">Ack</button>`
        }
      </li>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mergeIncidents(page) {
  const byId = new Map(incidents.map((i) => [i.id, i]));
  for (const i of page.incidents) {
    byId.set(i.id, i);
  }
  // Newest first: prefer API order for known ids, then remaining by openedAt desc.
  const ordered = [];
  const seen = new Set();
  for (const i of page.incidents) {
    ordered.push(byId.get(i.id));
    seen.add(i.id);
  }
  for (const i of incidents) {
    if (!seen.has(i.id)) {
      ordered.push(i);
      seen.add(i.id);
    }
  }
  ordered.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  incidents = ordered;
}

async function refresh() {
  const page = await fetchIncidents();
  mergeIncidents(page);
  loadedOnce = true;
  render();
}

async function onAckClick(event) {
  const btn = event.target.closest('[data-testid="ack"]');
  if (!btn || !board.contains(btn)) return;
  const id = btn.getAttribute('data-id');
  if (!id || acked.has(id)) return;
  btn.disabled = true;
  try {
    await ack(id);
    acked.add(id);
    render();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
  }
}

list.addEventListener('click', onAckClick);

syncBuildSha();
render();

try {
  await refresh();
} catch (err) {
  console.error(err);
  loadedOnce = true;
  loader.hidden = true;
  empty.hidden = false;
  empty.textContent = `Failed to load: ${err.message}`;
  list.hidden = true;
}

pollTimer = setInterval(() => {
  refresh().catch((err) => console.error(err));
}, 2000);

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
});
