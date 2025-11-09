(() => {
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
  const getGamesKey = (username) => `backloggd_games_${username}`;
  const getCacheTimeKey = (username) => `backloggd_cache_time_${username}`;

  const getUsernameFromPath = () => {
    const pathParts = window.location.pathname.split('/');
    return pathParts[2] || null;
  };

  let username = getUsernameFromPath();
  if (!username) return;

  const showMessage = (text, type = 'info') => {
    const msgEl = document.getElementById('message');
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = type === 'error' ? 'red' : 'green';
  };

  const getPage = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.error('Error loading page:', err);
      throw err;
    }
  };

  const scrapeDoc = (doc, allGames) => {
    const cards = doc.querySelectorAll('#user-games-library-container .rating-hover .card');
    cards.forEach(card => {
      const gameId = card.getAttribute('game_id');
      const rating = card.dataset.rating ? (card.dataset.rating / 2) : undefined;
      const title = card.querySelector('.game-text-centered')?.textContent.trim();
      const link = card.querySelector('a.cover-link')?.getAttribute('href');
      allGames.push({ id: gameId, rating, title, slug: link?.replace('/games/', '').replace(/\/$/, '') });
    });
  };

  const getMaxPages = (doc) => {
    const links = [...doc.querySelectorAll('nav.pagy a[href]')];
    const numbers = links.map(a => {
      const m = a.href.match(/page=(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }).filter(n => n !== null);
    return numbers.length ? Math.max(...numbers) : 1;
  };

  const loadGames = async (username) => {
    const loader = document.getElementById('loader');
    loader.style.display = 'inline';
    loader.textContent = '⏳ Loading page 1...';
    const allGames = [];
    const baseUrl = 'https://backloggd.com/';
    const userGameUrl = `${baseUrl}u/${username}/games`;

    try {
      const firstHtml = await getPage(`${userGameUrl}?page=1`);
      const parser = new DOMParser();
      const firstDoc = parser.parseFromString(firstHtml, 'text/html');
      scrapeDoc(firstDoc, allGames);
      const maxPages = getMaxPages(firstDoc);

      for (let page = 2; page <= maxPages; page++) {
        loader.textContent = `⏳ Loading page ${page} of ${maxPages}...`;
        const html = await getPage(`${userGameUrl}?page=${page}`);
        const doc = parser.parseFromString(html, 'text/html');
        scrapeDoc(doc, allGames);
      }

      chrome.storage.local.set({
        [getGamesKey(username)]: allGames,
        [getCacheTimeKey(username)]: Date.now().toString()
      }, () => {
        loader.style.display = 'none';
        updateCacheInfo();
        showMessage(`Load complete: ${allGames.length} games cached.`, 'info');
      });
    } catch (err) {
      loader.style.display = 'none';
      showMessage(`Error loading games. Check your connection or if the user exists.`, 'error');
      console.error(err);
    }
  };

  const updateCacheInfo = () => {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    searchInput.value = '';
    chrome.storage.local.get([getGamesKey(username), getCacheTimeKey(username)], ({ [getGamesKey(username)]: games, [getCacheTimeKey(username)]: cacheTime }) => {
      const infoEl = document.getElementById('cacheInfo');
      if (!infoEl) return;
      if (!games) {
        infoEl.textContent = 'No games loaded.';
        searchInput.disabled = true;
        return;
      }
      const total = games.length;
      let timeStr = '';
      if (cacheTime) {
        const diffMs = Date.now() - parseInt(cacheTime);
        const diffMin = Math.floor(diffMs / 60000);
        timeStr = diffMin < 60 ? `${diffMin} min` : `${Math.floor(diffMin / 60)} h`;
      }
      infoEl.textContent = `Games loaded: ${total} (last updated: ${timeStr} ago)`;
      searchInput.disabled = false;
    });
  };

  const searchGames = async (query) => {
    query = query.toLowerCase().trim();
    if (!query) return [];
    return new Promise(resolve => {
      chrome.storage.local.get([getGamesKey(username)], ({ [getGamesKey(username)]: games }) => {
        if (!games) return resolve([]);
        resolve(games.filter(g => g.title.toLowerCase().includes(query)));
      });
    });
  };

  const displayResults = (games) => {
    const resultsEl = document.getElementById('results');
    const searchInfo = document.getElementById('searchInfo');
    if (!resultsEl || !searchInfo) return;
    resultsEl.innerHTML = '';
    searchInfo.textContent = `Results: ${games.length}`;
    games.forEach(g => {
      const stars = g.rating ? '★'.repeat(Math.round(g.rating)) + '☆'.repeat(5 - Math.round(g.rating)) : 'No rating';
      const li = document.createElement('li');
      li.innerHTML = `<strong>${g.title}</strong> (${stars}) <a href="https://backloggd.com/games/${g.slug}" target="_blank">link</a>`;
      resultsEl.appendChild(li);
    });
  };

  const injectContainer = (main) => {
    if (document.getElementById('backloggd-extension')) return;

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
        name="bckgd_srch_${Math.random().toString(36).substr(2, 9)}"
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

    main.prepend(container);
    main.classList.add('has-extension');

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

    const updateBtn = document.getElementById('updateBtn');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');

    if (updateBtn) {
      updateBtn.addEventListener('click', () => loadGames(username));
    }

    if (searchInput) {
      searchInput.addEventListener('input', async e => {
        const q = e.target.value;
        if (!q.trim()) {
          displayResults([]);
          resultsEl.style.display = 'none';
          return;
        }
        const results = await searchGames(q);
        displayResults(results);
        if (results.length > 0) {
          resultsEl.style.display = 'block';
        }
      });

      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
          resultsEl.style.display = 'none';
        }
      });
    }

    updateCacheInfo();
  };

  const checkAndInject = () => {
    username = getUsernameFromPath();
    if (!username) return;

    const mainEl = document.querySelector('main');
    if (mainEl) {
      injectContainer(mainEl);
    }
  };

  checkAndInject();

  let lastUrl = location.href;
  let injectionTimer = null;
  let isInjecting = false;

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      if (injectionTimer) {
        clearInterval(injectionTimer);
        injectionTimer = null;
      }

      isInjecting = false;
      const existing = document.getElementById('backloggd-extension');
      if (existing) {
        existing.remove();
        document.querySelector('main')?.classList.remove('has-extension');
      }

      username = getUsernameFromPath();
      if (!username) return;

      setTimeout(() => {
        let attempts = 0;
        injectionTimer = setInterval(() => {
          if (isInjecting) return;

          attempts++;
          const alreadyExists = document.getElementById('backloggd-extension');

          if (alreadyExists) {
            clearInterval(injectionTimer);
            injectionTimer = null;
            return;
          }

          const mainEl = document.querySelector('main');
          if (mainEl && mainEl.children.length > 0) {
            isInjecting = true;
            injectContainer(mainEl);
            isInjecting = false;
            clearInterval(injectionTimer);
            injectionTimer = null;
          }

          if (attempts > 30) {
            clearInterval(injectionTimer);
            injectionTimer = null;
          }
        }, 150);
      }, 400);
    }
  }, 300);
})();