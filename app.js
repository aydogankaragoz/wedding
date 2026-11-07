(function () {
  'use strict';

  // ---------- i18n ----------
  var STR = {
    tr: { date: '18 Haziran 2022', title: 'Düğün', password: 'Şifre', remember: 'Bu cihazda hatırla', open: 'Aç',
      opening: 'Açılıyor…', wrong: 'Şifre yanlış. Tekrar deneyin.', netErr: 'Bağlantı hatası. Tekrar deneyin.',
      favorites: 'Favoriler', slideshow: 'Slayt', lock: 'Kilitle', download: 'Orijinal', photos: 'fotoğraf',
      noFavs: 'Henüz favori yok. Bir fotoğrafta ♡ simgesine dokunun.', play: 'Oynat', part: 'Bölüm',
      unsupported: 'Bu tarayıcı desteklenmiyor. Lütfen güncel bir tarayıcı kullanın.' },
    en: { date: '18 June 2022', title: 'Wedding', password: 'Password', remember: 'Remember on this device', open: 'Open',
      opening: 'Opening…', wrong: 'Wrong password. Try again.', netErr: 'Network error. Try again.',
      favorites: 'Favorites', slideshow: 'Slideshow', lock: 'Lock', download: 'Original', photos: 'photos',
      noFavs: 'No favorites yet. Tap ♡ on a photo.', play: 'Play', part: 'Part',
      unsupported: 'This browser is not supported. Please use an up-to-date browser.' }
  };
  var lang = store('lang') || ((navigator.language || 'tr').slice(0, 2) === 'tr' ? 'tr' : 'en');
  function t(k) { return STR[lang][k] || k; }
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    $('#lang').textContent = lang === 'tr' ? 'EN' : 'TR';
    if (M) { renderChrome(); }
  }

  // ---------- helpers ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('g_' + k);
      if (v === null) localStorage.removeItem('g_' + k); else localStorage.setItem('g_' + k, v);
    } catch (e) { return null; }
  }
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function hexBytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function time(iso) { return iso ? iso.slice(11, 16) : ''; }
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

  var subtle = window.crypto && window.crypto.subtle;
  var KEY = null, CFG = null, M = null, cfgReady = null;
  var photos = [];          // flat list in display order
  var favs = {};
  try { favs = JSON.parse(store('favs') || '{}'); } catch (e) {}

  // ---------- crypto ----------
  function decrypt(buf) {
    return subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf, 0, 12) }, KEY, new Uint8Array(buf, 12));
  }
  function fetchBin(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('net'); return r.arrayBuffer(); });
  }
  function fetchImage(url) {
    return fetchBin(url).then(decrypt).then(function (d) {
      return URL.createObjectURL(new Blob([d], { type: 'image/jpeg' }));
    });
  }
  function deriveKey(pw) {
    return subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: hexBytes(CFG.salt), iterations: CFG.iter, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
  }
  function openWith(key) {
    KEY = key;
    return fetchBin('data/manifest.bin').then(decrypt).then(function (d) {
      return JSON.parse(new TextDecoder().decode(d));
    });
  }

  // ---------- lock screen ----------
  function init() {
    applyLang();
    if (!subtle || !window.fetch) { msg(t('unsupported'), true); $('#unlockBtn').disabled = true; return; }
    cfgReady = fetch('data/config.json').then(function (r) { return r.json(); }).then(function (c) { CFG = c; return c; });
    cfgReady.then(function () {
      var saved = store('key_' + CFG.salt);
      if (!saved) return;
      return subtle.importKey('raw', unb64(saved), 'AES-GCM', true, ['decrypt'])
        .then(openWith).then(start)
        .catch(function () { store('key_' + CFG.salt, null); KEY = null; });
    }).catch(function () { msg(t('netErr'), true); });

    $('#lockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#unlockBtn'); btn.disabled = true; msg(t('opening'));
      cfgReady.then(function () { return deriveKey($('#pw').value); }).then(function (key) {
        return openWith(key).then(function (m) {
          if ($('#remember').checked) {
            subtle.exportKey('raw', key).then(function (raw) { store('key_' + CFG.salt, b64(raw)); });
          }
          start(m);
        });
      }).catch(function (err) {
        msg(err && err.message === 'net' ? t('netErr') : t('wrong'), true);
        $('#pw').select();
      }).then(function () { btn.disabled = false; });
    });
    $('#lang').addEventListener('click', function () { lang = lang === 'tr' ? 'en' : 'tr'; store('lang', lang); applyLang(); });
  }
  function msg(s, err) { var el = $('#lockMsg'); el.textContent = s; el.className = 'lock-msg' + (err ? ' err' : ''); }

  // ---------- gallery ----------
  function groupTitle(g, i) {
    var x = g.title; if (x && typeof x === 'object') x = x[lang] || x.tr || x.en;
    return x || (t('part') + ' ' + (i + 1));
  }

  function start(m) {
    M = m;
    photos = [];
    M.groups.forEach(function (g, gi) { g.photos.forEach(function (p) { p.g = gi; p.i = photos.length; photos.push(p); }); });
    $('#lock').hidden = true; $('#app').hidden = false;
    document.title = M.title;
    renderSections();
    renderChrome();
    bindApp();
    var m2 = location.hash.match(/^#\/p\/(\w+)/);
    if (m2) { var p = photos.filter(function (x) { return x.id === m2[1]; })[0]; if (p) openViewer(p.i, true); }
  }

  function renderChrome() {
    $('#galleryTitle').textContent = M.title;
    $('#count').textContent = photos.length + ' ' + t('photos');
    $('#chips').innerHTML = M.groups.map(function (g, i) {
      return '<a href="#s' + i + '" data-g="' + i + '">' + esc(groupTitle(g, i)) + ' <span class="count">' + time(g.start) + '</span></a>';
    }).join('');
    M.groups.forEach(function (g, i) {
      var h = $('#s' + i + ' .section-head');
      if (!h) return;
      $('h2', h).textContent = groupTitle(g, i);
      $('.meta', h).textContent = time(g.start) + '–' + time(g.end) + ' · ' + g.photos.length + ' ' + t('photos');
      $('.play', h).innerHTML = '<span aria-hidden="true">▶</span> ' + t('play');
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderSections() {
    var html = M.groups.map(function (g, gi) {
      return '<section class="section" id="s' + gi + '"><div class="section-head"><h2></h2><span class="meta"></span>' +
        '<button class="chip-btn play" data-play="' + g.photos[0].i + '"></button></div><div class="grid">' +
        g.photos.map(function (p) {
          return '<button class="tile" data-i="' + p.i + '" aria-label="' + esc(p.name) + '"><img alt="">' +
            (favs[p.id] ? '<span class="h">♥</span>' : '') + '</button>';
        }).join('') + '</div></section>';
    }).join('');
    $('#sections').innerHTML = html;
    lazyThumbs();
  }

  // Thumbnails: lazy, limited concurrency, cached as blob URLs
  var thumbURL = {}, queue = [], active = 0, MAX = 6;
  function lazyThumbs() {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        queue.push(e.target);
      });
      pump();
    }, { rootMargin: '600px 0px' });
    $$('.tile').forEach(function (el) { io.observe(el); });
  }
  function pump() {
    while (active < MAX && queue.length) {
      (function (el) {
        var p = photos[+el.getAttribute('data-i')];
        active++;
        getThumb(p).then(function (u) {
          var img = $('img', el); img.onload = function () { img.className = 'ok'; }; img.src = u;
        }).catch(function () {}).then(function () { active--; pump(); });
      })(queue.shift());
    }
  }
  var thumbPending = {};
  function getThumb(p) {
    if (thumbURL[p.id]) return Promise.resolve(thumbURL[p.id]);
    if (!thumbPending[p.id]) thumbPending[p.id] = fetchImage('t/' + p.id + '.bin').then(function (u) { thumbURL[p.id] = u; return u; });
    return thumbPending[p.id];
  }

  var bound = false;
  function bindApp() {
    if (bound) return; bound = true;
    $('#sections').addEventListener('click', function (e) {
      var tile = e.target.closest('.tile');
      if (tile) return openViewer(+tile.getAttribute('data-i'));
      var pl = e.target.closest('[data-play]');
      if (pl) { openViewer(+pl.getAttribute('data-play')); startShow(); }
    });
    $('#chips').addEventListener('click', function (e) {
      var a = e.target.closest('a'); if (!a) return;
      e.preventDefault();
      var s = $('#s' + a.getAttribute('data-g'));
      s.scrollIntoView({ behavior: 'smooth' });
      var first = $('.tile:not([hidden])', s); if (first) first.focus({ preventScroll: true });
    });
    $('#playAll').addEventListener('click', function () { openViewer(visible()[0] || 0); startShow(); });
    $('#favFilter').addEventListener('click', toggleFavFilter);
    $('#logout').addEventListener('click', function () { store('key_' + CFG.salt, null); location.hash = ''; location.reload(); });

    // highlight the chip for the section on screen
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        $$('#chips a').forEach(function (a) { a.classList.toggle('on', 's' + a.getAttribute('data-g') === e.target.id); });
        var on = $('#chips a.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('.section').forEach(function (s) { so.observe(s); });

    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', function () { if (!$('#viewer').hidden && !/^#\/p\//.test(location.hash)) closeViewer(true); });
    bindViewer();
  }

  var favOnly = false;
  function toggleFavFilter() {
    favOnly = !favOnly;
    $('#favFilter').setAttribute('aria-pressed', favOnly);
    var any = false;
    $$('.section').forEach(function (s) {
      var n = 0;
      $$('.tile', s).forEach(function (el) {
        var show = !favOnly || favs[photos[+el.getAttribute('data-i')].id];
        el.hidden = !show; if (show) n++;
      });
      s.hidden = n === 0; if (n) any = true;
    });
    $('#empty').hidden = any;
  }
  function visible() {
    return favOnly ? photos.filter(function (p) { return favs[p.id]; }).map(function (p) { return p.i; }) : photos.map(function (p) { return p.i; });
  }
  function setFav(p, on) {
    if (on) favs[p.id] = 1; else delete favs[p.id];
    store('favs', JSON.stringify(favs));
    var tile = $('.tile[data-i="' + p.i + '"]');
    var h = $('.h', tile);
    if (on && !h) tile.insertAdjacentHTML('beforeend', '<span class="h">♥</span>');
    if (!on && h) h.remove();
  }

  // ---------- viewer ----------
  var cur = -1, list = [], previewURL = {}, previewOrder = [], showTimer = null, chromeTimer = null, lastFocus = null;
  var V = {}, pushed = false;
  function bindViewer() {
    V = { root: $('#viewer'), img: $('#vImg'), spin: $('#vSpin'), pos: $('#vPos'), meta: $('#vMeta'),
      fav: $('#vFav'), dl: $('#vDl'), size: $('#vSize'), play: $('#vPlay') };
    $('#vClose').addEventListener('click', function () { closeViewer(); });
    $('#vPrev').addEventListener('click', function () { step(-1); });
    $('#vNext').addEventListener('click', function () { step(1); });
    V.fav.addEventListener('click', function () { var p = photos[cur]; setFav(p, !favs[p.id]); updateMeta(); });
    V.play.addEventListener('click', function () { showTimer ? stopShow() : startShow(); });
    V.root.addEventListener('mousemove', pokeChrome);
    gestures();
  }
  function getPreview(p) {
    if (previewURL[p.id]) return previewURL[p.id];
    previewURL[p.id] = fetchImage('p/' + p.id + '.bin');
    previewOrder.push(p.id);
    while (previewOrder.length > 12) {           // keep memory bounded on TVs/phones
      var old = previewOrder.shift();
      previewURL[old].then(function (u) { URL.revokeObjectURL(u); });
      delete previewURL[old];
    }
    return previewURL[p.id];
  }
  function openViewer(i, fromHash) {
    list = visible();
    if (list.indexOf(i) < 0) list = photos.map(function (p) { return p.i; });
    lastFocus = document.activeElement;
    V.root.hidden = false;
    document.body.style.overflow = 'hidden';
    show(i, fromHash ? 'replace' : 'push');
    $('#vNext').focus({ preventScroll: true });
    pokeChrome();
  }
  function closeViewer(fromPop) {
    stopShow();
    V.root.hidden = true;
    document.body.style.overflow = '';
    if (!fromPop) { if (pushed) history.back(); else history.replaceState(null, '', location.pathname + location.search); }
    pushed = false;
    var tile = $('.tile[data-i="' + cur + '"]');
    if (tile) { tile.focus({ preventScroll: true }); tile.scrollIntoView({ block: 'nearest' }); }
    else if (lastFocus) lastFocus.focus();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }
  function show(i, hist) {
    cur = i; resetZoom();
    var p = photos[i];
    var h = '#/p/' + p.id;
    if (hist === 'push') { history.pushState({ v: 1 }, '', h); pushed = true; } else history.replaceState({ v: 1 }, '', h);
    updateMeta();
    V.img.style.aspectRatio = p.w + '/' + p.h;
    // show the thumbnail instantly, then swap in the sharp preview
    if (thumbURL[p.id]) V.img.src = thumbURL[p.id]; else V.img.removeAttribute('src');
    V.spin.hidden = false;
    getPreview(p).then(function (u) { if (cur === i) { V.img.src = u; V.spin.hidden = true; } })
      .catch(function () { if (cur === i) V.spin.hidden = true; });
    if (!thumbURL[p.id]) getThumb(p).then(function (u) { if (cur === i && V.spin.hidden === false) V.img.src = u; });
    var k = list.indexOf(i);
    [1, -1, 2].forEach(function (d) { var j = list[k + d]; if (j != null) getPreview(photos[j]); });
  }
  function updateMeta() {
    var p = photos[cur], g = M.groups[p.g];
    V.pos.textContent = (list.indexOf(cur) + 1) + ' / ' + list.length;
    V.meta.textContent = groupTitle(g, p.g) + ' · ' + time(p.t) + ' · ' + p.name;
    V.fav.textContent = favs[p.id] ? '♥' : '♡'; V.fav.classList.toggle('on', !!favs[p.id]);
    V.dl.href = p.url; V.dl.setAttribute('download', p.name);
    V.size.textContent = mb(p.size);
  }
  function step(d) {
    var k = list.indexOf(cur) + d;
    if (k < 0 || k >= list.length) { if (showTimer && k >= list.length) k = 0; else return; }
    show(list[k], 'replace');
  }
  function startShow() {
    stopShow();
    showTimer = setInterval(function () { step(1); }, 5000);
    V.play.textContent = '❚❚';
    var el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(function () {});
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wake = l; }).catch(function () {});
    V.root.classList.add('chrome-off');
  }
  var wake = null;
  function stopShow() {
    if (showTimer) clearInterval(showTimer); showTimer = null;
    if (V.play) V.play.textContent = '▶';
    if (wake) { wake.release(); wake = null; }
  }
  function pokeChrome() {
    V.root.classList.remove('chrome-off');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(function () { V.root.classList.add('chrome-off'); }, showTimer ? 1500 : 3500);
  }

  // touch: swipe to change, swipe down to close, double-tap / pinch to zoom, drag to pan
  var zoom = 1, tx = 0, ty = 0;
  function resetZoom() { zoom = 1; tx = ty = 0; applyZoom(); }
  function applyZoom() { V.img.style.transform = zoom === 1 && !tx && !ty ? '' : 'translate(' + tx + 'px,' + ty + 'px) scale(' + zoom + ')'; }
  function gestures() {
    var stage = $('#stage'), sx, sy, st, pinch0 = 0, z0 = 1, lastTap = 0, moved = false, ox = 0, oy = 0;
    stage.addEventListener('touchstart', function (e) {
      pokeChrome(); moved = false;
      if (e.touches.length === 2) { pinch0 = dist(e.touches); z0 = zoom; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); ox = tx; oy = ty;
      V.img.classList.add('dragging');
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
      moved = true;
      if (e.touches.length === 2 && pinch0) { zoom = Math.max(1, Math.min(5, z0 * dist(e.touches) / pinch0)); applyZoom(); return; }
      var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (zoom > 1) { tx = ox + dx; ty = oy + dy; } else { tx = dx; ty = Math.max(0, dy) * 0.6; }
      applyZoom();
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (e.touches.length) return;
      V.img.classList.remove('dragging');
      if (pinch0) { pinch0 = 0; if (zoom < 1.05) resetZoom(); return; }
      var dx = tx - (zoom > 1 ? ox : 0), dy = ty;
      if (!moved) {
        var now = Date.now();
        if (now - lastTap < 300) { zoom = zoom > 1 ? 1 : 2.5; tx = ty = 0; applyZoom(); lastTap = 0; }
        else { lastTap = now; setTimeout(function () { if (lastTap === now) toggleChrome(); }, 300); }
        return;
      }
      if (zoom > 1) return;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { stopShow(); step(dx < 0 ? 1 : -1); return; }
      if (dy > 120) { closeViewer(); return; }
      resetZoom();
    });
    stage.addEventListener('dblclick', function () { zoom = zoom > 1 ? 1 : 2.5; tx = ty = 0; applyZoom(); });
  }
  function toggleChrome() { if (V.root.classList.contains('chrome-off')) pokeChrome(); else V.root.classList.add('chrome-off'); }
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

  // ---------- keyboard / TV remote ----------
  var BACK = { Escape: 1, Backspace: 1, GoBack: 1, BrowserBack: 1 };
  function onKey(e) {
    var k = e.key, viewerOpen = !V.root.hidden;
    var back = BACK[k] || e.keyCode === 10009 || e.keyCode === 461;   // Tizen / webOS back keys
    if (viewerOpen) {
      pokeChrome();
      if (k === 'ArrowRight' || k === 'MediaTrackNext') { stopShow(); step(1); }
      else if (k === 'ArrowLeft' || k === 'MediaTrackPrevious') { stopShow(); step(-1); }
      else if (back) { closeViewer(); }
      else if (k === ' ' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { showTimer ? stopShow() : startShow(); }
      else if (k === 'f') { V.fav.click(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { return; }   // let focus move between viewer buttons
      else if (k === 'Enter') { return; }
      else return;
      e.preventDefault();
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      var a = document.activeElement;
      if (a && a.classList && a.classList.contains('tile')) { e.preventDefault(); moveFocus(a, k); }
      else if (a && a.closest && a.closest('.top') && k === 'ArrowDown') {
        e.preventDefault();
        var first = $('.tile:not([hidden])'); if (first) first.focus();
      } else if ((!a || a === document.body) && $('.tile')) { e.preventDefault(); $('.tile:not([hidden])').focus(); }
    }
  }
  // spatial navigation over the visible tiles
  function moveFocus(el, k) {
    var r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var tiles = $$('.tile').filter(function (x) { return !x.hidden && !x.parentNode.parentNode.hidden; });
    var idx = tiles.indexOf(el);
    if (k === 'ArrowRight') return focusTile(tiles[idx + 1]);
    if (k === 'ArrowLeft') return focusTile(tiles[idx - 1]);
    var dir = k === 'ArrowDown' ? 1 : -1, best = null, bestRow = Infinity, bestDx = Infinity;
    tiles.forEach(function (x) {
      var q = x.getBoundingClientRect(), qy = q.top + q.height / 2, dy = (qy - cy) * dir;
      if (dy < r.height / 2) return;
      var dx = Math.abs(q.left + q.width / 2 - cx);
      if (dy < bestRow - 2 || (Math.abs(dy - bestRow) <= 2 && dx < bestDx)) { best = x; bestRow = dy; bestDx = dx; }
    });
    if (best) focusTile(best);
    else if (dir < 0) { var on = $('#chips a.on') || $('#chips a'); if (on) on.focus(); }
  }
  function focusTile(x) { if (!x) return; x.focus({ preventScroll: true }); x.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

  init();
})();
