// ============================================================================
// Backloggd Game Search Extension - Content Script
// ============================================================================

class BackloggdExtension {
  constructor() {
    this.username = null;
    this.lastUrl = location.href;
    this.injectionTimer = null;
    this.isInjecting = false;
    
    // Detect invalid context (e.g., extension uninstalled)
    try {
      if (chrome?.runtime?.id) {
        this.init();
      }
    } catch (e) {
      console.log('Extension context invalidated, stopping execution');
      return;
    }
  }

  // ========== Initialization ==========
  
  init() {
    this.injectStyles();
    this.username = this.getUsernameFromPath();
    
    if (this.username) {
      this.checkAndInject();
      this.startUrlMonitoring();
    }
  }

  // Verify if extension context is still valid
  isContextValid() {
    try {
      return chrome?.runtime?.id !== undefined;
    } catch {
      return false;
    }
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      main::before {
        content: '';
        display: block;
        height: 104px;
        margin: 10px auto;
        max-width: 600px;
      }
      main.has-extension::before {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  // ========== Storage Helpers ==========
  
  getStorageKeys() {
    return {
      games: `backloggd_games_${this.username}`,
      cacheTime: `backloggd_cache_time_${this.username}`
    };
  }

  async getStoredData() {
    if (!this.isContextValid()) return { games: null, cacheTime: null };
    
    const keys = this.getStorageKeys();
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([keys.games, keys.cacheTime], data => {
          resolve({
            games: data[keys.games] || null,
            cacheTime: data[keys.cacheTime] || null
          });
        });
      } catch (e) {
        resolve({ games: null, cacheTime: null });
      }
    });
  }

  async saveGames(games) {
    if (!this.isContextValid()) return;
    
    const keys = this.getStorageKeys();
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({
          [keys.games]: games,
          [keys.cacheTime]: Date.now().toString()
        }, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  // ========== URL & Navigation ==========
  
  getUsernameFromPath() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[2] || null;
  }

  startUrlMonitoring() {
    setInterval(() => {
      if (!this.isContextValid()) return;
      
      if (location.href !== this.lastUrl) {
        this.handleNavigation();
      }
    }, 300);
  }

  handleNavigation() {
    this.lastUrl = location.href;
    this.cleanup();
    
    this.username = this.getUsernameFromPath();
    if (!this.username) return;

    setTimeout(() => this.retryInjection(), 400);
  }

  cleanup() {
    if (this.injectionTimer) {
      clearInterval(this.injectionTimer);
      this.injectionTimer = null;
    }

    this.isInjecting = false;
    
    const existing = document.getElementById('backloggd-extension');
    if (existing) {
      existing.remove();
      document.querySelector('main')?.classList.remove('has-extension');
    }
  }

  retryInjection() {
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const RETRY_INTERVAL = 150;

    this.injectionTimer = setInterval(() => {
      if (!this.isContextValid()) {
        clearInterval(this.injectionTimer);
        return;
      }
      
      if (this.isInjecting) return;

      attempts++;

      if (document.getElementById('backloggd-extension')) {
        clearInterval(this.injectionTimer);
        this.injectionTimer = null;
        return;
      }

      const mainEl = document.querySelector('main');
      if (mainEl && mainEl.children.length > 0) {
        this.isInjecting = true;
        this.injectContainer(mainEl);
        this.isInjecting = false;
        clearInterval(this.injectionTimer);
        this.injectionTimer = null;
      }

      if (attempts > MAX_ATTEMPTS) {
        clearInterval(this.injectionTimer);
        this.injectionTimer = null;
      }
    }, RETRY_INTERVAL);
  }

  // ========== Scraping & Data Loading ==========
  
  async fetchPage(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }

  parseGamesFromDocument(doc) {
    const games = [];
    const cards = doc.querySelectorAll('#user-games-library-container .rating-hover .card');
    
    cards.forEach(card => {
      const gameId = card.getAttribute('game_id');
      const rating = card.dataset.rating ? (card.dataset.rating / 2) : undefined;
      const title = card.querySelector('.game-text-centered')?.textContent.trim();
      const link = card.querySelector('a.cover-link')?.getAttribute('href');
      const slug = link?.replace('/games/', '').replace(/\/$/, '');
      
      games.push({ id: gameId, rating, title, slug });
    });
    
    return games;
  }

  getMaxPages(doc) {
    const links = [...doc.querySelectorAll('nav.pagy a[href]')];
    const pageNumbers = links
      .map(a => {
        const match = a.href.match(/page=(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(n => n !== null);
    
    return pageNumbers.length ? Math.max(...pageNumbers) : 1;
  }

  async loadAllGames() {
    const loader = document.getElementById('loader');
    const baseUrl = `https://backloggd.com/u/${this.username}/games`;
    const allGames = [];

    try {
      this.updateLoader(loader, 'Loading page 1...');
      
      const firstHtml = await this.fetchPage(`${baseUrl}?page=1`);
      const parser = new DOMParser();
      const firstDoc = parser.parseFromString(firstHtml, 'text/html');
      
      allGames.push(...this.parseGamesFromDocument(firstDoc));
      
      const maxPages = this.getMaxPages(firstDoc);

      for (let page = 2; page <= maxPages; page++) {
        this.updateLoader(loader, `Loading page ${page} of ${maxPages}...`);
        const html = await this.fetchPage(`${baseUrl}?page=${page}`);
        const doc = parser.parseFromString(html, 'text/html');
        allGames.push(...this.parseGamesFromDocument(doc));
      }

      await this.saveGames(allGames);
      
      this.hideLoader(loader);
      this.updateCacheInfo();
      this.showMessage(`Load complete: ${allGames.length} games cached.`, 'info');
      
    } catch (error) {
      this.hideLoader(loader);
      this.showMessage('Error loading games. Check your connection or if the user exists.', 'error');
      console.error('Load error:', error);
    }
  }

  // ========== Utilities ==========
  
  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  
  // ========== Search ==========
  
  normalizeText(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  async searchGames(query) {
    const normalizedQuery = this.normalizeText(query);
    if (!normalizedQuery) return [];

    const { games } = await this.getStoredData();
    if (!games) return [];

    const searchTerms = normalizedQuery.split(' ').filter(term => term.length > 0);

    return games.filter(game => {
      const normalizedTitle = this.normalizeText(game.title);
      
      if (searchTerms.length > 1) {
        return searchTerms.every(term => normalizedTitle.includes(term));
      }
      
      return normalizedTitle.includes(normalizedQuery);
    });
  }

  // ========== UI Updates ==========
  
  updateLoader(loader, text) {
    if (loader) {
      loader.style.display = 'inline';
      loader.textContent = `⏳ ${text}`;
    }
  }

  hideLoader(loader) {
    if (loader) {
      loader.style.display = 'none';
    }
  }

  showMessage(text, type = 'info') {
    const msgEl = document.getElementById('message');
    if (!msgEl) return;
    
    msgEl.textContent = text;
    msgEl.style.color = type === 'error' ? 'red' : 'green';
  }

  async updateCacheInfo() {
    const searchInput = document.getElementById('searchInput');
    const infoEl = document.getElementById('cacheInfo');
    
    if (!searchInput || !infoEl) return;

    searchInput.value = '';
    
    const { games, cacheTime } = await this.getStoredData();
    
    if (!games) {
      infoEl.textContent = 'No games loaded.';
      searchInput.disabled = true;
      return;
    }

    const timeAgo = this.getTimeAgo(cacheTime);
    infoEl.textContent = `Games loaded: ${games.length} (last updated: ${timeAgo} ago)`;
    searchInput.disabled = false;
  }

  getTimeAgo(cacheTime) {
    if (!cacheTime) return 'unknown';
    
    const diffMs = Date.now() - parseInt(cacheTime);
    const diffMin = Math.floor(diffMs / 60000);
    
    return diffMin < 60 
      ? `${diffMin} min` 
      : `${Math.floor(diffMin / 60)} h`;
  }

  displayResults(games) {
    const resultsEl = document.getElementById('results');
    const searchInfo = document.getElementById('searchInfo');
    
    if (!resultsEl || !searchInfo) return;

    resultsEl.innerHTML = '';
    searchInfo.textContent = `Results: ${games.length}`;

    games.forEach(game => {
      const li = document.createElement('li');
      const stars = this.formatRating(game.rating);
      
      li.innerHTML = `
        <strong>${game.title}</strong> (${stars}) 
        <a href="https://backloggd.com/games/${game.slug}" target="_blank">link</a>
      `;
      
      resultsEl.appendChild(li);
    });
  }

  formatRating(rating) {
    if (!rating) return 'No rating';
    
    const filled = Math.round(rating);
    const empty = 5 - filled;
    
    return '★'.repeat(filled) + '☆'.repeat(empty);
  }

  // ========== UI Injection ==========
  
  checkAndInject() {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      this.injectContainer(mainEl);
    }
  }

  injectContainer(main) {
    if (document.getElementById('backloggd-extension')) return;

    const container = this.createContainer();
    main.prepend(container);
    main.classList.add('has-extension');

    this.injectComponentStyles();
    this.attachEventListeners();
    this.updateCacheInfo();
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'backloggd-extension';
    container.style.cssText = `
      position: relative;
      max-width: 600px;
      margin: 10px auto;
      padding: 16px;
      border-radius: 8px;
      background: #1e2126;
      border: 1px solid #2a2d35;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.95em;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;

    const randomId = Math.random().toString(36).substr(2, 9);
    
    container.innerHTML = `
      <h2 style="margin:0 0 12px 0; font-size:1.1em; text-align:center; color:#9ca3af; font-weight:600;">
        🎮 Game Search
      </h2>
      
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <button id="updateBtn" style="
          padding: 6px 12px;
          font-size: 0.85em;
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          transition: background 0.2s;
        ">Update user list</button>
        
        <span id="loader" style="display:none; color:#9ca3af;">⏳ Loading...</span>
        
        <input 
          id="searchInput" 
          type="text"
          name="bckgd_srch_${randomId}"
          placeholder="Search game..." 
          style="
            flex: 1;
            padding: 8px 12px;
            font-size: 0.9em;
            background: #16181c;
            color: #e5e7eb;
            border: 1px solid #2a2d35;
            border-radius: 6px;
            outline: none;
            transition: border-color 0.2s;
          " 
          autocomplete="one-time-code"
          autocorrect="off" 
          autocapitalize="off" 
          spellcheck="false"
          disabled>
      </div>
      
      <div id="message" style="margin:6px 0; font-size:0.85em; color:#9ca3af;"></div>
      <div id="cacheInfo" style="font-size:0.8em; color:#6b7280; margin-bottom:4px; text-align:center;"></div>
      <div id="searchInfo" style="font-size:0.8em; color:#6b7280; margin-bottom:8px; text-align:center;"></div>
      
      <ul id="results" style="
        list-style: none;
        padding: 0;
        margin: 0;
        max-height: 300px;
        overflow-y: auto;
        position: absolute;
        left: 16px;
        right: 16px;
        background: #1e2126;
        border: 1px solid #2a2d35;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 1000;
        display: none;
      "></ul>
    `;

    return container;
  }

  injectComponentStyles() {
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
      #updateBtn:hover {
        background: #1d4ed8 !important;
      }
      #searchInput:focus {
        border-color: #3b82f6 !important;
      }
      #searchInput:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #results::-webkit-scrollbar {
        width: 8px;
      }
      #results::-webkit-scrollbar-track {
        background: #16181c;
        border-radius: 4px;
      }
      #results::-webkit-scrollbar-thumb {
        background: #374151;
        border-radius: 4px;
      }
      #results::-webkit-scrollbar-thumb:hover {
        background: #4b5563;
      }
      #results li {
        padding: 10px 12px;
        border-bottom: 1px solid #2a2d35;
        color: #e5e7eb;
        font-size: 0.9em;
      }
      #results li:last-child {
        border-bottom: none;
      }
      #results li:hover {
        background: #252830;
      }
      #results li strong {
        color: #f3f4f6;
        font-weight: 600;
      }
      #results li a {
        color: #60a5fa;
        text-decoration: none;
        margin-left: 8px;
        font-size: 0.85em;
      }
      #results li a:hover {
        color: #93c5fd;
        text-decoration: underline;
      }
    `;
    document.head.appendChild(styleSheet);
  }

  attachEventListeners() {
    const updateBtn = document.getElementById('updateBtn');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');
    const container = document.getElementById('backloggd-extension');

    if (updateBtn) {
      updateBtn.addEventListener('click', () => this.loadAllGames());
    }

    if (searchInput) {
      const debouncedSearch = this.debounce(async (query) => {
        if (!query.trim()) {
          this.displayResults([]);
          resultsEl.style.display = 'none';
          return;
        }

        const results = await this.searchGames(query);
        this.displayResults(results);
        
        if (results.length > 0) {
          resultsEl.style.display = 'block';
        }
      }, 150);

      searchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
      });
    }

    document.addEventListener('click', (e) => {
      if (container && !container.contains(e.target)) {
        resultsEl.style.display = 'none';
      }
    });
  }
}

// ========== Initialize Extension ==========
(() => {
  new BackloggdExtension();
})();