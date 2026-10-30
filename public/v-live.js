'use strict';
/* WYSIWYG-Editor: Der Text wird dauerhaft formatiert angezeigt und direkt so bearbeitet (contenteditable).
   Markdown-Eingaben (**fett**, # Titel, - Liste, [[Link]] …) wandeln sich sofort um. Gespeichert wird reines Markdown;
   unveränderte Absätze werden unverändert (Originaltext) zurückgeschrieben. Die Option „Markdown“ zeigt den Rohtext. */
(() => {
  const M = window.M;
  const FENCE = /^\s*(```|~~~)/;
  const ZW = /[\u200b\ufeff]/g;
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'AUDIO', 'VIDEO']);

  /** Text → Absätze; join() ergibt exakt den Originaltext. */
  function split(text) {
    const blocks = []; let lead = '';
    const lines = text.split('\n'); let i = 0, pos = 0;
    const lenAt = (k) => lines[k].length + (k < lines.length - 1 ? 1 : 0);
    while (i < lines.length && lines[i].trim() === '') { lead += lines[i] + (i < lines.length - 1 ? '\n' : ''); pos += lenAt(i); i++; }
    while (i < lines.length) {
      const start = pos; let fence = false, end = pos;
      while (i < lines.length) {
        const l = lines[i];
        if (FENCE.test(l)) fence = !fence;
        if (!fence && l.trim() === '') break;
        end = pos + l.length; pos += lenAt(i); i++;
      }
      let sepEnd = pos;
      while (i < lines.length && lines[i].trim() === '' && !fence) { pos += lenAt(i); i++; sepEnd = pos; }
      if (fence && i >= lines.length) sepEnd = text.length;
      blocks.push({ t: text.slice(start, end), sep: text.slice(end, sepEnd) });
      pos = sepEnd;
    }
    return { lead, blocks };
  }

  /* ------------------------------------------------ DOM → Markdown */
  const safeDec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const escText = (t) => t.replace(ZW, '').replace(/\u00a0/g, ' ').replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/`/g, '\\`')
    .replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/~~/g, '\\~\\~').replace(/(^|[^\w])_|_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'));
  const para = (s) => s.replace(/^( {0,3})(#{1,6}(?=\s)|[-+*](?=\s)|>|(?:-{3,}|\*{3,}|_{3,})\s*$)/gm, '$1\\$2').replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2');
  function mark(c, m) {
    const inner = inl(c); if (!inner.trim()) return inner;
    return inner.match(/^\s*/)[0] + m + inner.trim() + m + inner.match(/\s*$/)[0];
  }
  function inl(n) { let s = ''; const k = n.childNodes; for (let i = 0; i < k.length; i++) s += inode(k[i], i === k.length - 1); return s; }
  function inode(c, last) {
    if (c.nodeType === 3) { let v = c.nodeValue.replace(/[ \t]*\n[ \t]*/g, ' '); const pv = c.previousSibling; if (pv && pv.nodeType === 1 && pv.tagName === 'BR') v = v.replace(/^ +/, ''); return escText(v); }
    if (c.nodeType !== 1) return '';
    const md = c.getAttribute('data-md'); if (md !== null) return safeDec(md);
    const t = c.tagName;
    if (t === 'BR') return last ? '' : '\n';
    if (t === 'STRONG' || t === 'B') return mark(c, '**');
    if (t === 'EM' || t === 'I') return mark(c, '*');
    if (t === 'DEL' || t === 'S' || t === 'STRIKE') return mark(c, '~~');
    if (t === 'CODE') { const x = c.textContent.replace(ZW, ''); if (!x) return ''; const f = x.includes('`') ? '``' : '`'; return f + (x.startsWith('`') || x.endsWith('`') ? ' ' + x + ' ' : x) + f; }
    if (t === 'A') {
      const href = c.getAttribute('href') || '', txt = inl(c); if (!txt.trim()) return '';
      if (c.textContent === href) return href;
      return '[' + txt + '](' + href.replace(/\)/g, '%29').replace(/ /g, '%20') + ')';
    }
    if (t === 'IMG') return '![' + (c.getAttribute('alt') || '') + '](' + (c.getAttribute('src') || '') + ')';
    if (t === 'INPUT' || BLOCK.has(t)) return t === 'INPUT' ? '' : inl(c);
    return inl(c);
  }
  function kids(el) {
    const out = []; let run = '';
    const flush = () => { const r = para(run.trim()); if (r) out.push(r); run = ''; };
    const k = el.childNodes;
    for (let i = 0; i < k.length; i++) {
      const c = k[i];
      if (c.nodeType === 1 && BLOCK.has(c.tagName)) { flush(); const b = blk(c); if (b) out.push(b); } else run += inode(c, i === k.length - 1);
    }
    flush(); return out.join('\n\n');
  }
  function preText(el) {
    let s = '';
    const walk = (n) => { n.childNodes.forEach((c) => { if (c.nodeType === 3) s += c.nodeValue.replace(ZW, ''); else if (c.tagName === 'BR') s += '\n'; else { if ((c.tagName === 'DIV' || c.tagName === 'P') && s && !s.endsWith('\n')) s += '\n'; walk(c); } }); };
    walk(el); return s.replace(/\n+$/, '');
  }
  function list(el) {
    const ord = el.tagName === 'OL'; let n = +(el.getAttribute('start') || 1); const lines = [];
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const mk = ord ? (n++) + '. ' : '- ', ind = ' '.repeat(mk.length);
      const cb = [...li.children].find((x) => x.tagName === 'INPUT' && x.type === 'checkbox');
      const task = cb ? (cb.checked ? '[x] ' : '[ ] ') : '';
      const parts = [], nested = []; let run = '';
      const flush = () => { const r = para(run.trim()); if (r) parts.push(r); run = ''; };
      li.childNodes.forEach((c, i) => {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) { flush(); nested.push(list(c)); }
        else if (c.nodeType === 1 && (c.tagName === 'P' || c.tagName === 'DIV')) { flush(); const r = para(inl(c).trim()); if (r) parts.push(r); }
        else if (c.nodeType === 1 && c.tagName === 'INPUT') { /* Checkbox */ }
        else run += inode(c, false);
      });
      flush();
      const text = (task + parts.join('\n\n')).split('\n');
      lines.push(mk + text[0]); text.slice(1).forEach((l) => lines.push(l ? ind + l : ''));
      nested.forEach((nl) => nl.split('\n').forEach((l) => lines.push(ind + l)));
    }
    return lines.join('\n');
  }
  function table(el) {
    const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inl(c).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const w = Math.max(...rows.map((r) => r.length));
    const out = rows.map((r) => { const x = r.slice(); while (x.length < w) x.push(''); return '| ' + x.join(' | ') + ' |'; });
    out.splice(1, 0, '|' + ' --- |'.repeat(w)); return out.join('\n');
  }
  function blk(el) {
    if (el.nodeType === 3) { const x = escText(el.nodeValue).trim(); return x ? para(x) : ''; }
    if (el.nodeType !== 1) return '';
    const md = el.getAttribute('data-md'); if (md !== null) return safeDec(md);
    const t = el.tagName;
    if (/^H[1-6]$/.test(t)) { const x = inl(el).replace(/\n/g, ' ').trim(); return x ? '#'.repeat(+t[1]) + ' ' + x : ''; }
    if (t === 'UL' || t === 'OL') return list(el);
    if (t === 'BLOCKQUOTE') { const x = kids(el); return x ? x.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') : ''; }
    if (t === 'PRE') { const code = el.querySelector('code') || el, lang = ((code.className || '').match(/language-([\w+-]+)/) || [])[1] || '', txt = preText(code), f = txt.includes('```') ? '~~~' : '```'; return f + lang + '\n' + txt + '\n' + f; }
    if (t === 'HR') return '---';
    if (t === 'TABLE') return table(el);
    if (t === 'DIV' || t === 'LI') return kids(el);
    if ([...el.children].some((c) => BLOCK.has(c.tagName))) return kids(el);
    return para(inl(el).trim());
  }

  /* ------------------------------------------------ Editor */
  M.liveEditor = ({ ta, wrap, isAcOpen, onChange, onInput }) => {
    const root = document.createElement('div');
    root.className = 'live md'; root.id = 'live'; root.contentEditable = 'true'; root.spellcheck = true;
    root.setAttribute('role', 'textbox'); root.setAttribute('aria-multiline', 'true'); root.setAttribute('aria-label', 'Text');
    root.dataset.ph = ta.placeholder || '';
    wrap.insertBefore(root, ta);
    let lead = '', mode = 'live', locked = false, ready = false, pending = ta.value || '', token = 0, lastRange = null;
    const sel = () => window.getSelection();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* egal */ }

    const emptyBlock = () => { const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = '<p><br></p>'; return d; };
    const updateEmpty = () => {
      const lbs = root.children; let empty = lbs.length <= 1;
      if (empty && lbs[0]) empty = !lbs[0].textContent.replace(ZW, '').trim() && !lbs[0].querySelector('img,audio,video,hr,table,pre,li,input');
      root.dataset.empty = empty ? '1' : '';
    };

    async function renderAll(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += 300) {
        const r = await M.api('/api/render-blocks', { method: 'POST', body: { blocks: texts.slice(i, i + 300), edit: true } });
        out.push(...(r.html || []));
      }
      return out;
    }
    async function oneHtml(md) {
      const [h] = await renderAll([md]); return h || '';
    }
    async function build(text) {
      const my = ++token; pending = text; ready = false; root.contentEditable = 'false';
      const r = split(text);
      let html = [];
      try { html = await renderAll(r.blocks.map((b) => b.t)); } catch (e) { html = r.blocks.map((b) => '<p>' + M.esc(b.t) + '</p>'); }
      if (my !== token) return;
      lead = r.lead; root.textContent = '';
      r.blocks.forEach((b, i) => {
        const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = html[i] || '<p><br></p>';
        d.dataset.src = b.t; d.dataset.sep = b.sep; d.dataset.h = d.innerHTML; root.appendChild(d);
      });
      if (!root.firstChild) root.appendChild(emptyBlock());
      ready = true; updateEmpty();
      if (!locked && mode === 'live') root.contentEditable = 'true';
      paintLock();
    }
    function paintLock() {
      if (!locked) { const n = root.querySelector('.lock-note'); if (n) n.remove(); return; }
      root.textContent = ''; root.contentEditable = 'false';
      const n = document.createElement('p'); n.className = 'muted lock-note'; n.textContent = '🔒 Dieser Text ist verschlüsselt und noch gesperrt.'; root.appendChild(n);
    }

    function getLive() {
      if (!ready) return pending;
      let out = lead;
      for (const el of root.children) {
        if (el.classList.contains('lock-note')) continue;
        const own = el.classList.contains('lb') && el.dataset.src !== undefined;
        if (own && el.dataset.h === el.innerHTML) { out += el.dataset.src + el.dataset.sep; continue; }
        const md = el.classList.contains('lb') ? kids(el) : blk(el);
        if (md.trim()) out += md + (own ? el.dataset.sep || '\n\n' : '\n\n');
      }
      return out.replace(/(\n\n)+$/, '\n\n').replace(/^\n+(?=\S)/, (m) => (lead ? m : ''));
    }

    /* ---- Struktur absichern ---- */
    function normalize() {
      const s = sel(), an = s.anchorNode, ao = s.anchorOffset, coll = s.isCollapsed;
      [...root.childNodes].forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains('lb')) return;
        const lb = document.createElement('div'); lb.className = 'lb'; root.insertBefore(lb, n);
        if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.has(n.tagName))) { const p = document.createElement('p'); lb.appendChild(p); p.appendChild(n); } else lb.appendChild(n);
      });
      if (!root.firstChild) { root.appendChild(emptyBlock()); const r = document.createRange(); r.setStart(root.querySelector('p'), 0); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
      else if (coll && an && root.contains(an) && (s.anchorNode !== an || s.anchorOffset !== ao)) { try { s.collapse(an, ao); } catch (e) { /* egal */ } }
    }
    const cmd = (c, v) => document.execCommand(c, false, v);
    const caretNode = () => { const s = sel(); if (!s.rangeCount) return null; let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; return n && root.contains(n) ? n : null; };
    const closestIn = (n, q) => { const e = n && n.closest ? n.closest(q) : null; return e && root.contains(e) && e !== root ? e : null; };
    const curBlock = () => { const n = caretNode(); return n ? closestIn(n, 'p,h1,h2,h3,h4,h5,h6,li,pre,td,th') : null; };
    const topEl = (n) => { while (n && n.parentNode && !(n.parentNode.classList && n.parentNode.classList.contains('lb')) && n.parentNode !== root) n = n.parentNode; return n; };
    function placeCaret(node, off) { const r = document.createRange(); r.setStart(node, off); r.collapse(true); const s = sel(); s.removeAllRanges(); s.addRange(r); }
    function caretAtStartOf(b) { const s = sel(); if (!s.isCollapsed || !s.rangeCount) return false; const r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset); return !r.toString().replace(ZW, ''); }
    function textBefore() { const s = sel(); const n = s.anchorNode; if (!s.isCollapsed || !n || n.nodeType !== 3) return null; return { node: n, off: s.anchorOffset, text: n.nodeValue.slice(0, s.anchorOffset).replace(/\u00a0/g, ' ') }; }

    /* ---- Markdown-Kürzel beim Tippen ---- */
    function deleteBefore(b) {
      const s = sel(), r = document.createRange(); r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
      s.removeAllRanges(); s.addRange(r); cmd('delete');
    }
    /* ---- Block-Umwandlungen (per DOM, nicht per execCommand – das erzeugt in Chrome verschachtelte Absätze) ---- */
    function moveInto(newEl, b) {
      const s = sel(), an = s.anchorNode, ao = s.anchorOffset, inside = an && b.contains(an);
      while (b.firstChild) newEl.appendChild(b.firstChild);
      if (!newEl.firstChild) newEl.appendChild(document.createElement('br'));
      b.replaceWith(newEl);
      if (inside) { if (an === b) placeCaret(newEl, Math.min(ao, newEl.childNodes.length)); else { try { placeCaret(an, ao); } catch (e) { placeCaret(newEl, 0); } } }
    }
    function retag(b, tag) { const n = document.createElement(tag); moveInto(n, b); return n; }
    function liftLi(li) {
      const list = li.parentNode, p = document.createElement('p');
      [...li.childNodes].forEach((c) => { if (!(c.nodeType === 1 && c.tagName === 'INPUT')) p.appendChild(c); });
      if (!p.textContent.replace(ZW, '') && !p.querySelector('img')) p.innerHTML = '<br>';
      const items = [...list.children], idx = items.indexOf(li);
      if (items.length === 1) list.replaceWith(p);
      else if (idx === 0) { list.before(p); li.remove(); }
      else if (idx === items.length - 1) { list.after(p); li.remove(); }
      else { const l2 = list.cloneNode(false); items.slice(idx + 1).forEach((x) => l2.appendChild(x)); list.after(p); p.after(l2); li.remove(); }
      placeCaret(p, 0);
    }
    function toList(b, tag) {
      if (b.tagName === 'LI') {
        const list = b.parentNode;
        if (list.tagName === tag.toUpperCase()) { liftLi(b); return; }
        const n = document.createElement(tag); [...list.childNodes].forEach((c) => n.appendChild(c)); list.replaceWith(n); return;
      }
      const list = document.createElement(tag), li = document.createElement('li');
      b.replaceWith(list); list.appendChild(li);
      const s = sel(), an = s.anchorNode, ao = s.anchorOffset, inside = an && (an === b || b.contains(an));
      while (b.firstChild) li.appendChild(b.firstChild);
      if (!li.firstChild) li.appendChild(document.createElement('br'));
      if (inside) { if (an === b) placeCaret(li, Math.min(ao, li.childNodes.length)); else { try { placeCaret(an, ao); } catch (e) { placeCaret(li, 0); } } }
    }
    function keepCaret(fn) {
      const s = sel(), an = s.anchorNode, ao = s.anchorOffset; fn();
      if (an && root.contains(an)) { try { placeCaret(an, ao); } catch (e) { /* egal */ } }
    }
    function toQuote(b) {
      const q = closestIn(b, 'blockquote');
      keepCaret(() => {
        if (q) { [...q.childNodes].forEach((c) => q.before(c)); q.remove(); }
        else { const bq = document.createElement('blockquote'); b.replaceWith(bq); bq.appendChild(b); }
      });
    }
    function liftFromQuote(p) {
      const q = closestIn(p, 'blockquote'); if (!q) return;
      keepCaret(() => {
        const items = [...q.children], idx = items.indexOf(p);
        if (items.length <= 1) { q.replaceWith(p); return; }
        if (idx === 0) { q.before(p); return; }
        if (idx === items.length - 1) { q.after(p); return; }
        const q2 = q.cloneNode(false); items.slice(idx + 1).forEach((x) => q2.appendChild(x)); q.after(p); p.after(q2);
      });
    }
    function toHeading(b, n) { if (b.tagName === 'H' + n) retag(b, 'p'); else if (/^(P|H[1-6])$/.test(b.tagName)) retag(b, 'h' + n); }
    function blockShortcut() {
      const b = curBlock(); if (!b || !sel().isCollapsed) return;
      const txt = b.textContent.replace(/[\u00a0\u200b]/g, ' ');
      if (b.tagName === 'P') {
        let m;
        if ((m = txt.match(/^(#{1,6}) $/))) { deleteBefore(b); toHeading(curBlock() || b, m[1].length); return; }
        if (/^[-*+] $/.test(txt)) { deleteBefore(b); toList(curBlock() || b, 'ul'); return; }
        if (/^\d+[.)] $/.test(txt)) { deleteBefore(b); toList(curBlock() || b, 'ol'); return; }
        if (/^> $/.test(txt)) { deleteBefore(b); toQuote(curBlock() || b); return; }
      }
      if (b.tagName === 'LI' && /^\[[ xX]?\] $/.test(txt)) { deleteBefore(b); setTask(b, true); }
    }
    function setTask(li, on) {
      const cb = [...li.children].find((x) => x.tagName === 'INPUT');
      if (on && !cb) { const i = document.createElement('input'); i.type = 'checkbox'; li.insertBefore(i, li.firstChild); li.classList.add('task'); const t = document.createTextNode('\u200b'); i.after(t); placeCaret(t, 1); }
      else if (!on && cb) { cb.remove(); li.classList.remove('task'); }
    }
    function replaceRange(node, start, end, el) {
      const after = node.splitText(end); const mid = node.splitText(start); mid.remove();
      node.parentNode.insertBefore(el, after);
      if (!after.nodeValue) after.nodeValue = '\u200b';
      placeCaret(after, after.nodeValue === '\u200b' ? 1 : 0);
    }
    function inlineShortcut(c) {
      const tb = textBefore(); if (!tb || closestIn(tb.node.parentNode, 'pre,code')) return;
      const pats = c === '*' ? [[/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'strong'], [/(?<![*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'em']]
        : c === '~' ? [[/~~([^~\s](?:[^~]*[^~\s])?)~~$/, 'del']] : c === '`' ? [[/`([^`]+)`$/, 'code']]
        : c === '_' ? [[/(?<![\w\\])_([^_\s](?:[^_]*[^_\s])?)_$/, 'em']] : c === ']' ? [[/\[\[([^\[\]\n]+)\]\]$/, 'wiki']] : [];
      for (const [re, tag] of pats) {
        const m = tb.text.match(re); if (!m) continue;
        const start = tb.off - m[0].length;
        if (tag === 'wiki') { wikiFrom(tb.node, start, tb.off, m[0]); return; }
        const el = document.createElement(tag); el.textContent = m[1];
        replaceRange(tb.node, start, tb.off, el); return;
      }
    }
    async function linkEl(md) {
      const h = await oneHtml(md); const d = document.createElement('div'); d.innerHTML = h;
      return d.querySelector('a[data-md]');
    }
    async function wikiFrom(node, start, end, md) {
      let a = null; try { a = await linkEl(md); } catch (e) { /* egal */ }
      if (!a || !node.parentNode || node.nodeValue.slice(start, end).replace(/\u00a0/g, ' ') !== md) return;
      replaceRange(node, start, end, a); onChange(); onInput();
    }

    root.addEventListener('input', (e) => {
      if (mode !== 'live') return;
      if (!e.isComposing) normalize();
      if (!e.isComposing && e.inputType === 'insertText' && e.data) {
        if (e.data === ' ') blockShortcut();
        else if ('*~`_]'.includes(e.data)) inlineShortcut(e.data);
      }
      updateEmpty(); onInput();
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches && e.target.matches('input[type=checkbox]')) { e.target.toggleAttribute('checked', e.target.checked); root.dispatchEvent(new Event('input', { bubbles: true })); }
    });

    /* ---- Tasten ---- */
    root.addEventListener('keydown', (e) => {
      if (mode !== 'live' || e.isComposing) return;
      if (isAcOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'e') { e.preventDefault(); exec('code'); return; }
        if (k === 'k') { e.preventDefault(); exec('link'); return; }
        return;
      }
      if (e.altKey || mod) return;
      const b = curBlock();
      if (e.key === 'Enter' && !e.shiftKey && b) {
        const txt = b.textContent.replace(ZW, '').trim();
        if (b.tagName === 'P' && /^```\s*[\w+-]*$/.test(txt)) { e.preventDefault(); toCodeBlock(b, txt.replace(/^```\s*/, '')); return; }
        if (b.tagName === 'P' && /^(-{3,}|\*{3,}|_{3,})$/.test(txt)) { e.preventDefault(); const hr = document.createElement('hr'), p = document.createElement('p'); p.innerHTML = '<br>'; b.replaceWith(hr); hr.after(p); placeCaret(p, 0); onChange(); return; }
        if (b.tagName === 'PRE') {
          e.preventDefault();
          const full = preText(b), s = sel(); const r = document.createRange(); r.selectNodeContents(b); r.setStart(s.anchorNode, s.anchorOffset);
          const atEnd = !r.toString().replace(ZW, '');
          if (atEnd && /\n$/.test(b.textContent)) { b.textContent = full.replace(/\n+$/, ''); const p = document.createElement('p'); p.innerHTML = '<br>'; topEl(b).after(p); placeCaret(p, 0); }
          else { cmd('insertText', atEnd ? '\n\n' : '\n'); if (atEnd) { const s2 = sel(); try { s2.modify('move', 'backward', 'character'); } catch (x) { /* egal */ } } }
          onChange(); return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && b && b.tagName === 'LI') {
        const empty = !b.textContent.replace(ZW, '').trim() && !b.querySelector('img');
        const pli = closestIn(b.parentNode, 'li');
        if (empty) { e.preventDefault(); if (pli) { pli.after(b); const l = b.previousSibling; /* verschobenes Element steht nun hinter dem Eltern-Eintrag */ pli.querySelectorAll('ul:empty,ol:empty').forEach((x) => x.remove()); placeCaret(b, 0); } else liftLi(b); onChange(); return; }
        const cb = [...b.children].find((x) => x.tagName === 'INPUT');
        const s0 = sel(), r0 = document.createRange(); r0.selectNodeContents(b); if (s0.rangeCount) r0.setStart(s0.anchorNode, s0.anchorOffset);
        if (cb && !r0.toString().replace(ZW, '')) { e.preventDefault(); const li = document.createElement('li'), i = document.createElement('input'); i.type = 'checkbox'; li.className = 'task'; const t = document.createTextNode('\u200b'); li.append(i, t); b.after(li); placeCaret(t, 1); onChange(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && b && b.tagName === 'P' && closestIn(b, 'blockquote') && !b.textContent.replace(ZW, '').trim()) { e.preventDefault(); liftFromQuote(b); onChange(); return; }
      if (e.key === 'Backspace' && b && /^(H[1-6])$/.test(b.tagName) && caretAtStartOf(b)) { e.preventDefault(); retag(b, 'p'); onChange(); return; }
      if (e.key === 'Backspace' && b && b.tagName === 'P' && closestIn(b, 'blockquote') && !closestIn(b, 'li') && caretAtStartOf(b)) { e.preventDefault(); liftFromQuote(b); onChange(); return; }
    });
    function toCodeBlock(b, lang) {
      const pre = document.createElement('pre'), code = document.createElement('code');
      if (lang) code.className = 'language-' + lang;
      const t = b.tagName === 'P' && !lang && !/^```/.test(b.textContent) ? b.textContent.replace(ZW, '') : '';
      code.textContent = t || '\u200b'; pre.appendChild(code);
      const top = topEl(b); top.replaceWith(pre);
      if (!pre.nextSibling) { const p = document.createElement('p'); p.innerHTML = '<br>'; pre.after(p); }
      placeCaret(code.firstChild, t ? t.length : 1); onChange();
    }

    /* ---- Mausklicks ---- */
    root.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey) && a.getAttribute('href')) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }
      if (a) { e.preventDefault(); return; }
      if (e.target === root) { // Klick unter den Text: ans Ende
        const last = root.lastElementChild; const lp = last && last.lastElementChild;
        if (!lp || lp.tagName !== 'P' || lp.textContent.replace(ZW, '').trim() || lp.querySelector('img')) { const d = emptyBlock(); root.appendChild(d); placeCaret(d.firstChild, 0); } else placeCaret(lp, 0);
        root.focus();
      }
    });
    document.addEventListener('selectionchange', () => { const s = sel(); if (s.rangeCount && root.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange(); });
    function restore() { root.focus(); if (lastRange && root.contains(lastRange.startContainer)) { const s = sel(); s.removeAllRanges(); s.addRange(lastRange); } else endCaret(); }
    function endCaret() {
      root.focus();
      let last = root.lastElementChild; let lp = last && last.lastElementChild;
      if (!lp || !/^(P|H[1-6])$/.test(lp.tagName)) { const d = emptyBlock(); root.appendChild(d); lp = d.firstChild; }
      const r = document.createRange(); r.selectNodeContents(lp); r.collapse(false); const s = sel(); s.removeAllRanges(); s.addRange(r);
    }

    /* ---- Einfügen ---- */
    async function insertMd(md) {
      let h = ''; try { h = await oneHtml(md); } catch (e) { h = ''; }
      const t = h.trim(); const single = t.match(/^<p>([\s\S]*)<\/p>$/);
      restore(); cmd('insertHTML', single && !/<p>/.test(single[1]) ? single[1] : t || M.esc(md));
      normalize(); onChange(); onInput();
    }
    root.addEventListener('paste', (e) => {
      const cd = e.clipboardData; if (!cd) return;
      if ([...(cd.files || [])].length) return; // Dateien behandelt der Editor
      e.preventDefault();
      const txt = cd.getData('text/plain'); if (!txt) return;
      if (!/[\n*_`#>\[\]~|]|^\s*(?:[-+]|\d+\.)\s/.test(txt) && !/\n/.test(txt)) { cmd('insertText', txt); return; }
      insertMd(txt.replace(/\r\n?/g, '\n'));
    });

    /* ---- Werkzeugleiste ---- */
    function exec(id) {
      if (locked || mode !== 'live') return;
      restore();
      switch (id) {
        case 'bold': cmd('bold'); break;
        case 'italic': cmd('italic'); break;
        case 'strike': cmd('strikeThrough'); break;
        case 'h1': { const b = curBlock(); if (b && b.tagName !== 'LI') toHeading(b, 1); break; }
        case 'h2': case 'h2b': { const b = curBlock(); if (b && b.tagName !== 'LI') toHeading(b, 2); break; }
        case 'h3': { const b = curBlock(); if (b && b.tagName !== 'LI') toHeading(b, 3); break; }
        case 'ul': { const b = curBlock(); if (b) toList(b, 'ul'); break; }
        case 'ol': { const b = curBlock(); if (b) toList(b, 'ol'); break; }
        case 'task': { let li = closestIn(caretNode(), 'li'); if (!li) { const b = curBlock(); if (b) toList(b, 'ul'); li = closestIn(caretNode(), 'li'); } if (li) setTask(li, ![...li.children].some((x) => x.tagName === 'INPUT')); break; }
        case 'quote': { const b = curBlock(); if (b) toQuote(b); break; }
        case 'code': {
          const n = caretNode(), c = closestIn(n, 'code');
          if (c && !closestIn(c, 'pre')) { c.replaceWith(document.createTextNode(c.textContent)); break; }
          const t = sel().toString(); cmd('insertHTML', '<code>' + M.esc(t || 'Code') + '</code>\u200b'); break;
        }
        case 'codeblock': { const b = curBlock(); if (b) toCodeBlock(b, ''); break; }
        case 'link': { const u = prompt('Adresse des Links', 'https://'); if (u && u !== 'https://') cmd('createLink', u); break; }
        case 'wiki': { const t = sel().toString().trim(); if (t) insertMd('[[' + t + ']]'); else cmd('insertText', '[['); break; }
        case 'table': insertMd('| Spalte A | Spalte B |\n|----------|----------|\n| &nbsp; | &nbsp; |'); break;
        case 'hr': cmd('insertHorizontalRule'); break;
        default: return;
      }
      normalize(); updateEmpty(); onChange(); onInput();
    }

    /* ---- [[-Vorschläge ---- */
    function wikiContext() {
      const tb = textBefore(); if (!tb || mode !== 'live') return null;
      const m = tb.text.match(/\[\[([^\[\]\n|]*)$/); return m ? { q: m[1], node: tb.node, start: tb.off - m[0].length, end: tb.off } : null;
    }
    async function applyWiki(ctx, insert) {
      const node = ctx.node; let end = ctx.end;
      if (node.nodeValue.slice(end, end + 2) === ']]') end += 2;
      let a = null; try { a = await linkEl('[[' + insert + ']]'); } catch (e) { /* egal */ }
      if (!a) { const s0 = node.nodeValue; node.nodeValue = s0.slice(0, ctx.start) + '[[' + insert + ']]' + s0.slice(end); return; }
      root.focus(); replaceRange(node, ctx.start, end, a); normalize(); onChange(); onInput();
    }

    /* ---- Öffentliche Schnittstelle ---- */
    const api = {
      get mode() { return mode; },
      root, exec, insertMd, wikiContext, applyWiki,
      getBody() { return mode === 'live' ? (locked ? '' : getLive()) : ta.value; },
      setBody(text) { if (mode === 'live') return build(text); ta.value = text; return Promise.resolve(); },
      setLocked(v) { locked = !!v; if (locked) { ++token; paintLock(); } },
      ensureActive() { if (mode === 'live' && !locked) restore(); },
      focus() { if (mode === 'live') { if (!locked && ready) endCaret(); else if (!locked) { const f = () => { if (ready) endCaret(); else setTimeout(f, 60); }; f(); } } else ta.focus(); },
      setMode(m) {
        if (m === mode) return;
        if (m === 'md') { const text = api.getBody(); mode = 'md'; root.hidden = true; ta.hidden = false; ta.style.height = ''; ta.value = text; }
        else { const text = ta.value; mode = 'live'; ta.hidden = true; root.hidden = false; build(text); }
      },
    };
    ta.hidden = true;
    build(pending);
    return api;
  };
})();
