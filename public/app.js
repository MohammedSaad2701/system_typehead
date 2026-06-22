const input = document.querySelector('#search-input');
const form = document.querySelector('#search-form');
const suggestionsBox = document.querySelector('#suggestions');
const loader = document.querySelector('#input-loader');
const status = document.querySelector('#search-status');
const toast = document.querySelector('#toast');
const trendingList = document.querySelector('#trending-list');
const cacheNodes = document.querySelector('#cache-nodes');
const routeKey = document.querySelector('#route-key');

let mode = 'count';
let suggestions = [];
let activeIndex = -1;
let debounceTimer;
let suggestionController;

function ensureCacheNodeCards(stats) {
  const existing = [...cacheNodes.querySelectorAll('.cache-node')];
  if (existing.length === stats.length) return existing;
  cacheNodes.replaceChildren();
  return stats.map((node, index) => {
    const card = document.createElement('div');
    card.className = 'cache-node';
    card.innerHTML = `<span>N${index}</span><strong></strong><small>idle</small>`;
    card.querySelector('strong').textContent = node.id.replaceAll('-', ' ');
    cacheNodes.append(card);
    return card;
  });
}

function showError(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function formatCount(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function closeSuggestions() {
  suggestionsBox.classList.add('hidden');
  input.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
}

function renderSuggestions() {
  suggestionsBox.replaceChildren();
  if (!suggestions.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion';
    empty.innerHTML = '<span class="suggestion-meta">Nothing surfaced yet</span>';
    suggestionsBox.append(empty);
  } else {
    suggestions.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `suggestion${index === activeIndex ? ' active' : ''}`;
      button.id = `suggestion-${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === activeIndex));
      button.innerHTML = `
        <span class="suggestion-main"><span class="suggestion-icon">⌕</span><span class="suggestion-query"></span></span>
        <span class="suggestion-meta">${mode === 'trend' ? `lift ${item.trendScore.toFixed(3)}` : `${formatCount(item.count)} uses`}</span>
      `;
      button.querySelector('.suggestion-query').textContent = item.query;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        input.value = item.query;
        closeSuggestions();
        form.requestSubmit();
      });
      suggestionsBox.append(button);
    });
  }
  suggestionsBox.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
  if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `suggestion-${activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

async function inspectRoute(prefix, cached) {
  try {
    const response = await fetch(`/cache/debug?prefix=${encodeURIComponent(prefix)}&mode=${mode}`);
    if (!response.ok) return;
    const data = await response.json();
    routeKey.textContent = `${data.key} -> ${data.assignedNode} - ${cached ? 'cache ready' : 'fresh read'}`;
    ensureCacheNodeCards(data.nodeStats).forEach((node, index) => {
      const stats = data.nodeStats[index];
      node.classList.toggle('active', stats?.id === data.assignedNode);
      if (stats) node.querySelector('small').textContent = `${stats.hits} served - ${stats.size} keys`;
    });
  } catch {
    // Debug UI is non-critical.
  }
}

async function fetchSuggestions() {
  const query = input.value.trim();
  if (!query) {
    closeSuggestions();
    return;
  }
  suggestionController?.abort();
  suggestionController = new AbortController();
  loader.classList.remove('hidden');
  try {
    const response = await fetch(`/suggest?q=${encodeURIComponent(query)}&mode=${mode}`, {
      signal: suggestionController.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Suggestions are taking a moment');
    suggestions = data.suggestions;
    activeIndex = -1;
    renderSuggestions();
    void inspectRoute(query.toLowerCase(), data.cached);
  } catch (error) {
    if (error.name !== 'AbortError') showError(error.message);
  } finally {
    if (!suggestionController.signal.aborted) loader.classList.add('hidden');
  }
}

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  suggestionController?.abort();
  loader.classList.toggle('hidden', !input.value.trim());
  debounceTimer = setTimeout(fetchSuggestions, 300);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return closeSuggestions();
  if (!suggestions.length || suggestionsBox.classList.contains('hidden')) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex = (activeIndex + 1) % suggestions.length;
    renderSuggestions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
    renderSuggestions();
  } else if (event.key === 'Enter' && activeIndex >= 0) {
    event.preventDefault();
    input.value = suggestions[activeIndex].query;
    closeSuggestions();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  closeSuggestions();
  status.textContent = 'Adding this search to the live signal...';
  try {
    const response = await fetch('/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search could not be saved');
    status.textContent = `Captured "${data.query}" and queued the update`;
    setTimeout(loadTrending, 300);
  } catch (error) {
    status.textContent = '';
    showError(error.message);
  }
});

document.querySelectorAll('.mode').forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    document.querySelectorAll('.mode').forEach((item) => item.classList.toggle('active', item === button));
    if (input.value.trim()) void fetchSuggestions();
  });
});

async function loadTrending() {
  try {
    const response = await fetch('/trending');
    if (!response.ok) throw new Error('Rising searches are unavailable right now');
    const data = await response.json();
    trendingList.replaceChildren();
    data.trending.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'trend-row';
      row.innerHTML = `<span class="trend-rank">${String(index + 1).padStart(2, '0')}</span><span class="trend-query"></span><span class="trend-score">${item.trendScore.toFixed(3)}</span>`;
      row.querySelector('.trend-query').textContent = item.query;
      row.addEventListener('click', () => {
        input.value = item.query;
        input.focus();
        void fetchSuggestions();
      });
      trendingList.append(row);
    });
  } catch (error) {
    showError(error.message);
  }
}

async function loadStats() {
  try {
    const response = await fetch('/stats');
    if (!response.ok) return;
    const data = await response.json();
    document.querySelector('#metric-p95').textContent = data.latencyMs.p95.toFixed(2);
    document.querySelector('#metric-hit-rate').textContent = `${data.cache.hitRate}%`;
    document.querySelector('#metric-cache-nodes').textContent =
      `across ${data.cache.nodes.length} ${data.cache.backend === 'redis' ? 'Redis' : 'local'} nodes`;
    document.querySelector('#cache-backend-badge').textContent =
      data.cache.backend === 'redis' ? 'Redis' : 'Memory';
    document.querySelector('#metric-reduction').textContent = `${data.batch.writeReductionRatio || 0}×`;
    document.querySelector('#metric-dataset').textContent = formatCount(data.dataset.rows);
    ensureCacheNodeCards(data.cache.nodes).forEach((node, index) => {
      const stats = data.cache.nodes[index];
      if (stats) node.querySelector('small').textContent = `${stats.hits} served - ${stats.size} keys`;
    });
  } catch {
    // Metrics are supplementary.
  }
}

document.querySelector('#refresh-trending').addEventListener('click', loadTrending);
document.addEventListener('click', (event) => {
  if (!form.contains(event.target)) closeSuggestions();
});

void loadTrending();
void loadStats();
setInterval(loadTrending, 30000);
setInterval(loadStats, 5000);
