'use strict';
/** Inhalte: Einträge, Anhänge, Suche, Auswertungen, Live-Updates. */
const { clampInt, isDate } = require('../lib/util');
const { parseMultipart } = require('../lib/web');

module.exports = ({ r, fail, readRaw }) => {
  r.post('/api/upload', async (req, res) => {
    const raw = await readRaw(req, 100 * 1024 * 1024);
    const { files } = parseMultipart(raw, req.headers['content-type']);
    const file = files[0];
    if (!file || !file.data.length) throw fail('Keine Datei');
    res.json(req.vault.saveAttachment(file.filename, file.data));
  }, { raw: true });
  r.get('/api/attachments', (req, res) => res.json(req.vault.listAttachments()));

  r.get('/api/items', (req, res) => res.json([...req.vault.index.values()].map((i) => req.vault.summary(i))));
  r.get('/api/item/:type/:slug', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    res.json(req.vault.itemDetail(it));
  });
  r.post('/api/render', (req, res) => res.json({ html: req.vault.renderMd(String((req.body || {}).body || '')) }));
  r.post('/api/render-blocks', (req, res) => {
    const bl = Array.isArray((req.body || {}).blocks) ? req.body.blocks.slice(0, 400) : [];
    res.json({ html: bl.map((b) => req.vault.renderMd(String(b || ''), !!req.body.edit)) });
  });
  r.post('/api/item/:type', (req, res) => {
    if (!['person', 'journal', 'note'].includes(req.params.type)) throw fail('Unbekannter Typ');
    const b = { ...(req.body || {}) };
    if (req.params.type === 'journal' && b.meta && b.meta.date) { b.date = b.date || String(b.meta.date).slice(0, 10); b.meta = { ...b.meta }; delete b.meta.date; }
    res.json(req.vault.createItem(req.params.type, b));
  });
  r.put('/api/item/:type/:slug', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    res.json(req.vault.updateItem(it, req.body || {}));
  });
  r.post('/api/item/:type/:slug/convert', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    const b = req.body || {};
    res.json(req.vault.convertItem(it, String(b.to || ''), b.date ? String(b.date) : null));
  });
  r.delete('/api/item/:type/:slug', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    req.vault.deleteItem(it);
    res.json({ ok: true });
  });

  /* Familie: abgeleitete Verwandte und Baumdaten */
  r.get('/api/family', (req, res) => res.json(require('../lib/family').forest(req.vault)));
  r.get('/api/family/:slug', (req, res) => {
    const it = req.vault.getItem('person', req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    const q = req.query || {};
    res.json(require('../lib/family').relatives(req.vault, it.slug, { up: q.up, down: q.down, wide: q.wide === '1' }));
  });
  r.get('/api/family', (req, res) => res.json(require('../lib/family').overview(req.vault)));

  r.get('/api/map', (req, res) => res.json(req.vault.mapPoints()));

  /* Versionsverlauf */
  r.get('/api/history/:type/:slug', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    res.json(req.vault.history.list(it.type, it.slug));
  });
  r.get('/api/history/:type/:slug/:id', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    const raw = req.vault.history.read(it.type, it.slug, req.params.id);
    if (raw === null) throw fail('Version nicht gefunden', 404);
    const { parseFM, dumpFM } = require('../lib/util');
    const { meta, body } = parseFM(raw);
    res.json({ id: req.params.id, meta, body, current: { meta: it.meta, body: it.body } });
  });
  r.post('/api/history/:type/:slug/:id/restore', (req, res) => {
    const it = req.vault.getItem(req.params.type, req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    res.json(req.vault.restoreVersion(it, req.params.id));
  });

  /* Tagebuch-Kurzbefehle */
  r.post('/api/journal/append', (req, res) => {
    const { text, date } = req.body || {};
    if (!text || !String(text).trim()) throw fail('Text fehlt');
    res.json({ ok: true, slug: req.vault.appendJournal(text, date) });
  });
  r.post('/api/journal/mood', (req, res) => {
    const { date, mood, energy } = req.body || {};
    const patch = {};
    if (mood !== undefined) patch.mood = clampInt(mood, 1, 5);
    if (energy !== undefined) patch.energy = clampInt(energy, 1, 5);
    res.json({ ok: true, slug: req.vault.patchJournalMeta(date, patch) });
  });
  r.post('/api/journal/song', (req, res) => {
    const { date, song, song_url: songUrl } = req.body || {};
    const url = String(songUrl || '').trim();
    if (url && !/^https?:\/\//i.test(url)) throw fail('Der Link muss mit http:// oder https:// beginnen');
    res.json({ ok: true, slug: req.vault.patchJournalMeta(date, { song: String(song || '').trim().slice(0, 200), song_url: url.slice(0, 500) }) });
  });
  r.get('/api/songs', (req, res) => res.json(req.vault.songs()));

  /* Suche & Auswertungen */
  r.get('/api/search', (req, res) => {
    const q = req.query;
    const f = { type: ['person', 'journal', 'note'].includes(q.type) ? q.type : '', tag: q.tag || '', person: q.person || '', from: isDate(q.from) ? q.from : '', to: isDate(q.to) ? q.to : '', moodMin: clampInt(q.moodMin, 1, 5) || '', moodMax: clampInt(q.moodMax, 1, 5) || '' };
    res.json(req.vault.search(q.q, f));
  });
  r.get('/api/dashboard', (req, res) => res.json(req.vault.dashboard()));
  r.get('/api/mood', (req, res) => res.json(req.vault.moodRange(req.query.from, req.query.to)));
  r.get('/api/mood/insights', (req, res) => res.json(req.vault.insights()));
  r.get('/api/graph', (req, res) => res.json(req.vault.graph()));
  r.get('/api/people/overview', (req, res) => res.json(req.vault.peopleOverview()));

  /* Live-Updates (Server-Sent Events): meldet Änderungen an den Dateien */
  r.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 4000\n\n');
    req.socket.setTimeout(0);
    const v = req.vault;
    const onChange = () => res.write('event: change\ndata: {}\n\n');
    v.on('change', onChange);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { v.off('change', onChange); clearInterval(ping); });
  });
};
