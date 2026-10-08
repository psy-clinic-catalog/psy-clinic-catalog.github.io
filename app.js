/*
 * Отрисовка каталога: предметы (свёрнуты по умолчанию), группы, файлы,
 * поиск, фильтр по типу и просмотр фотографий со листанием.
 * Зависит от index-data.js (window.CATALOG) и search.js (window.SEARCH).
 */
(function () {
  'use strict';

  var C = window.CATALOG;
  var S = window.SEARCH;

  var state = {
    query: '',
    types: [],          // пусто = все
    openSubjects: {},   // ключ предмета -> развёрнут
    openGroups: {},     // ключ группы   -> развёрнута
    viewer: null,       // { items, index, title }
  };

  var el = {
    list: document.getElementById('list'),
    search: document.getElementById('search'),
    clear: document.getElementById('clear'),
    counter: document.getElementById('counter'),
    chips: document.getElementById('chips'),
    collapse: document.getElementById('collapse-all'),
    stats: document.getElementById('stats'),
    theme: document.getElementById('theme'),
    viewer: document.getElementById('viewer'),
    viewerImg: document.getElementById('viewer-img'),
    viewerTitle: document.getElementById('viewer-title'),
    viewerCount: document.getElementById('viewer-count'),
    viewerOpen: document.getElementById('viewer-open'),
    viewerClose: document.getElementById('viewer-close'),
    viewerPrev: document.getElementById('viewer-prev'),
    viewerNext: document.getElementById('viewer-next'),
  };

  /* ---------- вспомогательное ---------- */

  function fmtSize(b) {
    if (b < 1024) return b + ' Б';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' КБ';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' МБ';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
  }

  function fmtCount(n) { return n.toLocaleString('ru-RU'); }

  function toHref(relPath) { return relPath.split('/').map(encodeURIComponent).join('/'); }

  function absPath(relPath) { return C.rootPath + '\\' + relPath.split('/').join('\\'); }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function isShortToken(t) { return t.length <= 3; }

  /* Подсветка совпадений. Длина строки не меняется (ё→е той же длины),
     поэтому позиции совпадений остаются корректными. */
  function highlightInto(node, text, toks) {
    if (!toks || !toks.length) { node.textContent = text; return; }
    var low = text.toLowerCase().replace(/ё/g, 'е');
    var marks = new Array(text.length);
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti], from = 0;
      while (true) {
        var idx = low.indexOf(t, from);
        if (idx < 0) break;
        var ok = !isShortToken(t) || idx === 0 || !/[\p{L}\p{N}]/u.test(text[idx - 1]);
        if (ok) for (var k = idx; k < idx + t.length; k++) marks[k] = true;
        from = idx + t.length;
      }
    }
    var i = 0;
    while (i < text.length) {
      var m = !!marks[i], j = i;
      while (j < text.length && !!marks[j] === m) j++;
      var seg = text.slice(i, j);
      if (m) {
        var mk = document.createElement('mark');
        mk.textContent = seg;
        node.appendChild(mk);
      } else {
        node.appendChild(document.createTextNode(seg));
      }
      i = j;
    }
  }

  function copyText(text, btn) {
    function done(ok) {
      var old = btn.getAttribute('title');
      btn.textContent = ok ? '✓' : '×';
      btn.setAttribute('title', ok ? 'Путь скопирован' : 'Не удалось скопировать');
      setTimeout(function () { btn.textContent = '⧉'; btn.setAttribute('title', old); }, 1200);
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else { fallback(); }
  }

  /* ---------- просмотр фотографий ---------- */

  function photosOf(items) {
    return (items || []).filter(function (i) { return i.t === 'photo'; });
  }

  function openViewer(items, index, title) {
    if (!items || !items.length) return;
    var i = Math.max(0, Math.min(index, items.length - 1));
    state.viewer = { items: items, index: i, title: title || '' };
    el.viewer.hidden = false;
    el.viewer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open');
    updateViewer();
  }

  function closeViewer() {
    state.viewer = null;
    el.viewer.hidden = true;
    el.viewer.setAttribute('aria-hidden', 'true');
    el.viewerImg.removeAttribute('src');
    document.body.classList.remove('viewer-open');
  }

  function stepViewer(delta) {
    var v = state.viewer;
    if (!v) return;
    v.index = (v.index + delta + v.items.length) % v.items.length;  // по кругу
    updateViewer();
  }

  function updateViewer() {
    var v = state.viewer;
    if (!v) return;
    var item = v.items[v.index];
    var href = toHref(item.p);
    el.viewerImg.setAttribute('src', href);
    el.viewerImg.setAttribute('alt', item.n);
    el.viewerTitle.textContent = (v.title ? v.title + ' · ' : '') + item.n;
    el.viewerCount.textContent = (v.index + 1) + ' / ' + v.items.length;
    el.viewerOpen.setAttribute('href', href);

    /* заранее подгружаем соседние кадры, чтобы листалось без задержки */
    [1, -1].forEach(function (d) {
      var nb = v.items[(v.index + d + v.items.length) % v.items.length];
      if (nb) {
        var im = document.createElement('img');
        im.setAttribute('src', toHref(nb.p));
      }
    });
  }

  function initViewer() {
    el.viewerClose.addEventListener('click', closeViewer);
    el.viewerPrev.addEventListener('click', function () { stepViewer(-1); });
    el.viewerNext.addEventListener('click', function () { stepViewer(1); });
    el.viewer.addEventListener('click', function (ev) {
      if (ev.target === el.viewer) closeViewer();   // клик по фону
    });

    var tx = null, ty = null;
    el.viewer.addEventListener('touchstart', function (ev) {
      tx = ev.changedTouches[0].clientX;
      ty = ev.changedTouches[0].clientY;
    }, { passive: true });
    el.viewer.addEventListener('touchend', function (ev) {
      if (tx === null) return;
      var dx = ev.changedTouches[0].clientX - tx;
      var dy = ev.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) stepViewer(dx < 0 ? 1 : -1);
      tx = null;
    }, { passive: true });
  }

  /* ---------- построение узлов ---------- */

  var TYPE_ICON = {
    photo: '🖼', pdf: '📕', word: '📄', powerpoint: '📊',
    excel: '📈', archive: '🗜', book: '📚', other: '📎',
  };

  /* Открывать фото в просмотрщике, но не мешать Ctrl/Shift-клику
     и средней кнопке открыть файл отдельно. */
  function bindPhoto(a, photos, index, title) {
    a.addEventListener('click', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      ev.preventDefault();
      openViewer(photos, index, title);
    });
  }

  function makeItemRow(item, toks, photos, title) {
    var row = document.createElement('div');
    row.className = 'item item-' + item.t;

    var inCloud = !!item.x;          // ссылка в облако (на файл или на папку)
    var inFolder = !!item.cf;        // значит x — ссылка на сам файл, а cf — на папку
    var noLink = !!item.no;          // ещё не загружено в облако
    var node;

    if (noLink) {
      node = document.createElement('span');
      node.className = 'item-name disabled';
      node.title = 'Файл ещё не загружен в облако';
    } else {
      node = document.createElement('a');
      node.className = 'item-name';
      node.href = inCloud ? item.x : toHref(item.p);
      node.target = '_blank';
      node.rel = 'noopener';
      if (inCloud) {
        node.title = item.p + (inFolder ? ' — откроется сам документ в облаке'
                                        : ' — откроется папка в облаке');
      } else {
        node.title = item.t === 'photo' ? item.p + ' — открыть в просмотрщике' : item.p;
      }
    }

    var icon = document.createElement('span');
    icon.className = 'item-icon';
    icon.textContent = TYPE_ICON[item.t] || '📎';
    node.appendChild(icon);

    var label = document.createElement('span');
    label.className = 'item-label';
    highlightInto(label, item.n, toks);
    node.appendChild(label);

    if (inCloud) {
      var cloud = document.createElement('span');
      cloud.className = 'cloud-dot';
      cloud.textContent = '☁';
      cloud.title = inFolder ? 'Документ в облаке — откроется сразу сам файл'
                             : 'Документ лежит в облаке';
      node.appendChild(cloud);
    }
    row.appendChild(node);

    if (item.t === 'photo' && photos && photos.length && !noLink) {
      var idx = photos.indexOf(item);
      if (idx >= 0) bindPhoto(node, photos, idx, title);
    }

    var meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = fmtSize(item.s) + ' · ' + item.d;
    row.appendChild(meta);

    if (item.w) {
      var warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = '⚠';
      warn.title = 'Путь к файлу длиннее 260 символов — Windows не откроет его обычным способом. ' +
                   'Файл нужно переименовать или перенести в папку с более коротким путём.';
      row.appendChild(warn);
    }

    if (item.cf) {
      // запасной вариант: открыть всю папку предмета в облаке
      var fold = document.createElement('button');
      fold.className = 'copy';
      fold.type = 'button';
      fold.textContent = '🗂';
      fold.title = 'Открыть всю папку с документами этого предмета в облаке';
      fold.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.open(item.cf, '_blank', 'noopener');
      });
      row.appendChild(fold);
    }

    if (!noLink) {
      var cp = document.createElement('button');
      cp.className = 'copy';
      cp.type = 'button';
      cp.textContent = '⧉';
      cp.title = inCloud ? 'Скопировать ссылку на облако' : 'Скопировать полный путь';
      cp.addEventListener('click', function () { copyText(inCloud ? item.x : absPath(item.p), cp); });
      row.appendChild(cp);
    } else {
      var soon = document.createElement('span');
      soon.className = 'soon';
      soon.textContent = 'в облако';
      soon.title = 'Документ появится здесь после загрузки в облачное хранилище';
      row.appendChild(soon);
    }

    return row;
  }

  function makePhotoChips(items, toks, title) {
    var photos = photosOf(items);
    var box = document.createElement('div');
    box.className = 'chips-items';
    photos.forEach(function (item, i) {
      var a = document.createElement('a');
      a.className = 'slide';
      a.href = toHref(item.p);
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = item.n + ' · ' + fmtSize(item.s);
      var num = item.n.replace(/^Слайд\s*/i, '').replace(/\.[^.]+$/, '');
      var span = document.createElement('span');
      highlightInto(span, num, toks);
      a.appendChild(span);
      bindPhoto(a, photos, i, title);
      box.appendChild(a);
    });
    return box;
  }

  function fillBody(body, g, toks, title) {
    if (g.kind === 'photos') {
      body.appendChild(makePhotoChips(g.files, toks, title));
      return;
    }
    var photos = photosOf(g.files);
    g.files.forEach(function (it) {
      body.appendChild(makeItemRow(it, toks, photos, title));
    });
  }

  function makeGroupBlock(g, toks, forceOpen) {
    var wrap = document.createElement('section');
    wrap.className = 'group';

    var key = g.p;
    var open = !!forceOpen || !!state.openGroups[key];

    var head = document.createElement('button');
    head.className = 'group-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', open ? 'true' : 'false');

    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = open ? '▾' : '▸';
    head.appendChild(chev);

    var title = document.createElement('span');
    title.className = 'group-title';
    highlightInto(title, g.name, toks);
    head.appendChild(title);

    var cnt = document.createElement('span');
    cnt.className = 'group-count';
    cnt.textContent = fmtCount(g.count) + ' ' + plural(g.count, 'файл', 'файла', 'файлов') + ' · ' + fmtSize(g.bytes);
    head.appendChild(cnt);

    var cp = document.createElement('button');
    cp.className = 'copy copy-folder';
    cp.type = 'button';
    cp.textContent = '⧉';
    cp.title = 'Скопировать путь к папке';
    cp.addEventListener('click', function (ev) {
      ev.stopPropagation();
      copyText(absPath(g.p), cp);
    });
    head.appendChild(cp);

    wrap.appendChild(head);

    var body = document.createElement('div');
    body.className = 'group-body';
    wrap.appendChild(body);

    var rendered = false;
    function renderBody() {
      if (rendered) return;
      rendered = true;
      fillBody(body, g, toks, g.name);
    }

    if (open) { wrap.classList.add('open'); renderBody(); }

    head.addEventListener('click', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('copy-folder')) return;
      var nowOpen = wrap.classList.toggle('open');
      head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      chev.textContent = nowOpen ? '▾' : '▸';
      state.openGroups[key] = nowOpen;
      if (nowOpen) renderBody();
    });

    return wrap;
  }

  function makeSubjectBlock(sub, toks, forceOpen) {
    var sec = document.createElement('section');
    sec.className = 'subject';

    var key = sub.p || '__loose__';
    var open = !!forceOpen || !!state.openSubjects[key];

    var head = document.createElement('button');
    head.className = 'subject-head';
    head.type = 'button';
    head.setAttribute('aria-expanded', open ? 'true' : 'false');

    var chev = document.createElement('span');
    chev.className = 'subject-chev';
    chev.textContent = open ? '▾' : '▸';
    head.appendChild(chev);

    var name = document.createElement('span');
    name.className = 'subject-name';
    highlightInto(name, sub.name, toks);
    head.appendChild(name);

    var meta = document.createElement('span');
    meta.className = 'subject-meta';
    meta.textContent = fmtCount(sub.count) + ' ' + plural(sub.count, 'файл', 'файла', 'файлов') + ' · ' + fmtSize(sub.bytes);
    head.appendChild(meta);

    sec.appendChild(head);

    var body = document.createElement('div');
    body.className = 'subject-body';
    sec.appendChild(body);

    var rendered = false;
    function renderBody() {
      if (rendered) return;
      rendered = true;
      if (sub.files && sub.files.length) {
        var box = document.createElement('div');
        box.className = 'files';
        var photos = photosOf(sub.files);
        sub.files.forEach(function (it) {
          box.appendChild(makeItemRow(it, toks, photos, sub.name));
        });
        body.appendChild(box);
      }
      sub.groups.forEach(function (g) {
        body.appendChild(makeGroupBlock(g, toks, forceOpen));
      });
    }

    if (open) { sec.classList.add('open'); renderBody(); }

    head.addEventListener('click', function () {
      var nowOpen = sec.classList.toggle('open');
      head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      chev.textContent = nowOpen ? '▾' : '▸';
      state.openSubjects[key] = nowOpen;
      if (nowOpen) renderBody();
    });

    return sec;
  }

  /* ---------- главный рендер ---------- */

  function render() {
    var res = S.filter(C, { query: state.query, types: state.types });
    var searching = S.tokens(state.query).length > 0;
    var filtered = searching || state.types.length > 0;

    el.counter.textContent = filtered
      ? 'Найдено: ' + fmtCount(res.total) + ' ' + plural(res.total, 'файл', 'файла', 'файлов')
      : 'Всего: ' + fmtCount(res.total) + ' ' + plural(res.total, 'файл', 'файла', 'файлов');

    var frag = document.createDocumentFragment();
    if (!res.subjects.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Ничего не найдено. Попробуйте другое слово или сбросьте фильтры.';
      frag.appendChild(empty);
    } else {
      /* при поиске и фильтрации всё раскрываем, иначе совпадения были бы скрыты */
      res.subjects.forEach(function (sub) {
        frag.appendChild(makeSubjectBlock(sub, res.tokens, filtered));
      });
    }
    el.list.textContent = '';
    el.list.appendChild(frag);
    el.clear.hidden = !state.query;
  }

  var renderDebounced = debounce(render, 110);

  /* ---------- фильтры и управление ---------- */

  function buildChips() {
    var byType = C.stats.byType || {};
    ['photo', 'pdf', 'word', 'powerpoint', 'excel', 'book', 'archive', 'other'].forEach(function (t) {
      if (!byType[t]) return;
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.type = t;
      b.textContent = (C.typeLabels[t] || t) + ' ' + byType[t];
      b.addEventListener('click', function () {
        var i = state.types.indexOf(t);
        if (i >= 0) state.types.splice(i, 1); else state.types.push(t);
        b.classList.toggle('on', state.types.indexOf(t) >= 0);
        render();
      });
      el.chips.appendChild(b);
    });
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('catalog-theme'); } catch (e) {}
    var dark = saved ? saved === 'dark'
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    el.theme.textContent = dark ? '☀' : '☾';
    el.theme.addEventListener('click', function () {
      var nowDark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = nowDark ? 'dark' : 'light';
      el.theme.textContent = nowDark ? '☀' : '☾';
      try { localStorage.setItem('catalog-theme', nowDark ? 'dark' : 'light'); } catch (e) {}
    });
  }

  function anythingOpen() {
    var a = Object.keys(state.openSubjects).some(function (k) { return state.openSubjects[k]; });
    var b = Object.keys(state.openGroups).some(function (k) { return state.openGroups[k]; });
    return a || b;
  }

  function init() {
    var st = C.stats;
    el.stats.textContent = fmtCount(st.subjects) + ' ' + plural(st.subjects, 'предмет', 'предмета', 'предметов') +
      ' · ' + fmtCount(st.files) + ' ' + plural(st.files, 'файл', 'файла', 'файлов') +
      ' · ' + fmtSize(st.bytes) + ' · собрано ' + C.generated;

    buildChips();
    initTheme();
    initViewer();

    el.search.addEventListener('input', function () {
      state.query = el.search.value;
      renderDebounced();
    });
    el.search.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { el.search.value = ''; state.query = ''; render(); }
    });
    el.clear.addEventListener('click', function () {
      el.search.value = ''; state.query = ''; el.search.focus(); render();
    });
    el.collapse.addEventListener('click', function () {
      if (anythingOpen()) {
        state.openSubjects = {};
        state.openGroups = {};
        el.collapse.textContent = 'Развернуть все';
      } else {
        (C.subjects || []).forEach(function (s) {
          state.openSubjects[s.p] = true;
        });
        (C.subjects || []).forEach(function (s) {
          (s.groups || []).forEach(function (g) { state.openGroups[g.p] = true; });
        });
        el.collapse.textContent = 'Свернуть все';
      }
      render();
    });

    document.addEventListener('keydown', function (ev) {
      if (state.viewer) {
        if (ev.key === 'Escape') { closeViewer(); }
        else if (ev.key === 'ArrowLeft') { stepViewer(-1); }
        else if (ev.key === 'ArrowRight') { stepViewer(1); }
        else if (ev.key === 'Home') { state.viewer.index = 0; updateViewer(); }
        else if (ev.key === 'End') { state.viewer.index = state.viewer.items.length - 1; updateViewer(); }
        return;
      }
      if (ev.key === '/' && document.activeElement !== el.search) {
        ev.preventDefault(); el.search.focus();
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault(); el.search.focus();
      }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
