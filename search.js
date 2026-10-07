/*
 * Логика поиска по каталогу. Чистые функции без обращения к DOM —
 * это позволяет тестировать их отдельно (node search.js).
 */
(function (global) {
  'use strict';

  /* Приводим строку к сравнимому виду: нижний регистр, ё→е,
     разделители (точки, дефисы, скобки, слэши) → пробелы. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[._\-/\\()\[\]{},;:!?"'«»]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Разбиваем запрос на слова. Короткие (1–3 символа) — это чаще всего
     номера слайдов, для них нужен отдельный режим сравнения. */
  function tokens(query) {
    const n = normalize(query);
    return n ? n.split(' ').filter(Boolean) : [];
  }

  /* Для коротких слов требуем совпадения с началом слова: иначе запрос
     «слайд 6» находил бы и слайд 16, и 26, и 36. Для длинных слов —
     обычный поиск подстроки, чтобы «терапия» находила «психотерапия». */
  function tokenRegex(tok) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return tok.length <= 3 ? new RegExp('(^|\\s)' + esc, 'i') : new RegExp(esc, 'i');
  }

  function matchHaystack(haystack, toks) {
    if (!toks.length) return true;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (tokenRegex(t).test(haystack)) continue;
      /* Мягкий запас для длинных русских слов: «терапия» должно находить
         «психотерапии». Отбрасываем последние два символа и ищем основу. */
      if (t.length >= 6 && haystack.indexOf(t.slice(0, t.length - 2)) >= 0) continue;
      return false;
    }
    return true;
  }

  function itemHaystack(item, labels, subjectName, groupName) {
    return normalize([
      item.n,
      item.e,
      labels[item.t] || item.t,
      subjectName,
      groupName,
    ].filter(Boolean).join(' '));
  }

  /* Главная функция: возвращает структуру только с тем, что нужно показать.
     opts = { query, types (массив или null = все) } */
  function filter(catalog, opts) {
    opts = opts || {};
    const toks = tokens(opts.query || '');
    const typeSet = opts.types && opts.types.length ? new Set(opts.types) : null;
    const labels = catalog.typeLabels || {};
    const empty = toks.length === 0;

    const out = { total: 0, subjects: [], tokens: toks };

    function keep(item) {
      return !typeSet || typeSet.has(item.t);
    }

    const loose = (catalog.loose || []).filter(keep).filter(
      (it) => empty || matchHaystack(itemHaystack(it, labels, null, null), toks)
    );
    if (loose.length) {
      out.subjects.push({
        name: 'Файлы в корне каталога',
        p: '',
        isLoose: true,
        files: loose,
        groups: [],
        count: loose.length,
        bytes: loose.reduce((s, i) => s + i.s, 0),
      });
      out.total += loose.length;
    }

    (catalog.subjects || []).forEach((sub) => {
      const subMatch = empty || matchHaystack(normalize(sub.name), toks);

      const files = (sub.files || []).filter(keep).filter((it) => {
        if (empty) return true;
        return subMatch || matchHaystack(itemHaystack(it, labels, sub.name, null), toks);
      });

      const groups = [];
      (sub.groups || []).forEach((g) => {
        const groupMatch = subMatch || matchHaystack(normalize(g.name), toks) ||
          matchHaystack(normalize(sub.name + ' ' + g.name), toks);
        const gfiles = (g.files || []).filter(keep).filter((it) => {
          if (empty) return true;
          return groupMatch || matchHaystack(itemHaystack(it, labels, sub.name, g.name), toks);
        });
        if (!gfiles.length) return;
        groups.push({
          ref: g,
          name: g.name,
          p: g.p,
          kind: g.kind,
          files: gfiles,
          count: gfiles.length,
          bytes: gfiles.reduce((s, i) => s + i.s, 0),
        });
      });

      if (!files.length && !groups.length) return;
      const count = files.length + groups.reduce((s, g) => s + g.count, 0);
      const bytes = files.reduce((s, i) => s + i.s, 0) + groups.reduce((s, g) => s + g.bytes, 0);
      out.subjects.push({
        name: sub.name,
        p: sub.p,
        files: files,
        groups,
        count,
        bytes,
      });
      out.total += count;
    });

    return out;
  }

  const api = { normalize, tokens, matchHaystack, itemHaystack, filter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SEARCH = api;
})(typeof window !== 'undefined' ? window : globalThis);
