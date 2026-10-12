/* Dodoleiro — gallery admin.
   Photos are resized in the browser and committed to the repository through the GitHub API
   (one commit per "Pubblica"), so the site needs no server. */
(() => {
  'use strict';

  const OWNER = 'dodoleiro';
  const REPO = 'dodoleiro-s-website';
  const BRANCH = 'main';
  const JSON_PATH = 'gallery/gallery.json';
  const PHOTO_DIR = 'gallery/photos';
  const API = 'https://api.github.com';
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
  const TOKEN_KEY = 'dd-admin-token';
  const LARGE_EDGE = 2000;
  const THUMB_EDGE = 800;
  const VIDEO_EDGE = 960;
  const VIDEO_SECONDS = 10;
  const VIDEO_BITRATE = 2500000;

  const $ = (id) => document.getElementById(id);
  const repoPath = (p) => `/repos/${OWNER}/${REPO}${p}`;

  let token = '';
  let headSha = '';
  let savedJson = '';
  let items = [];
  const removedFiles = new Set();
  let busy = false;
  let replaceIndex = -1;
  let lastRemoved = null;
  let toastTimer = 0;

  // ------------------------------------------------------------------ GitHub API

  class ApiError extends Error {
    constructor(status, detail) {
      super(`GitHub ${status}`);
      this.status = status;
      this.detail = detail;
    }
  }

  async function gh(path, { method = 'GET', body, raw = false } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'network');
    }
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''));
    if (raw) return res.text();
    return res.status === 204 ? null : res.json();
  }

  function explain(err) {
    const s = err && err.status;
    if (s === 0) return 'Connessione assente o bloccata. Controlla internet e riprova.';
    if (s === 401) return 'Il token non è valido o è scaduto. Premi “Esci” e collegane uno nuovo.';
    if (s === 403) return 'Il token non ha il permesso di scrittura. Su GitHub, in Permissions → Contents, deve essere “Read and write”.';
    if (s === 404) return 'Non trovo il repository: il token deve avere accesso a “dodoleiro-s-website”.';
    if (s === 409 || s === 422) return 'Il sito è stato aggiornato nel frattempo. Ricarica la pagina e riprova (le foto non pubblicate andranno riaggiunte).';
    if (err && err.message === 'conflict') return 'La galleria è stata modificata da un altro dispositivo. Ricarica la pagina per vedere la versione aggiornata.';
    return 'Qualcosa è andato storto. Riprova tra poco.';
  }

  async function readGallery(ref) {
    try {
      const text = await gh(repoPath(`/contents/${JSON_PATH}?ref=${encodeURIComponent(ref)}`), { raw: true });
      const data = JSON.parse(text);
      return Array.isArray(data.photos) ? data.photos : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  // ------------------------------------------------------------------ data helpers

  function clean(p) {
    const o = { id: p.id, src: p.src, w: p.w, h: p.h, thumb: p.thumb, tw: p.tw };
    if (p.type === 'video') o.type = 'video';
    const cap = (p.caption || '').trim();
    if (cap) o.caption = cap;
    if (p.lqip) o.lqip = p.lqip;
    return o;
  }

  function serialize(list) {
    return `${JSON.stringify({ version: 1, photos: list.map(clean) }, null, 2)}\n`;
  }

  const isRepoFile = (url) => typeof url === 'string' && url.startsWith(`/${PHOTO_DIR}/`);

  function forgetFiles(p) {
    if (p._files) return; // never published: nothing to delete
    [p.src, p.thumb].forEach((u) => { if (isRepoFile(u)) removedFiles.add(u.slice(1)); });
  }

  function dirty() {
    return serialize(items) !== savedJson || removedFiles.size > 0 || items.some((p) => p._files);
  }

  function newId() {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rnd = Math.random().toString(36).slice(2, 8);
    return `${date}-${rnd}`;
  }

  // ------------------------------------------------------------------ image processing

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function scaled(img, maxEdge) {
    const iw = img.naturalWidth || img.videoWidth;
    const ih = img.naturalHeight || img.videoHeight;
    const k = Math.min(1, maxEdge / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));
    let src = img;
    let sw = iw;
    let sh = ih;
    const temps = [];
    // halve repeatedly first: one big downscale with drawImage looks soft
    while (sw > w * 2 && sh > h * 2) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw / 2);
      c.height = Math.round(sh / 2);
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, c.width, c.height);
      temps.push(c);
      src = c; sw = c.width; sh = c.height;
    }
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    temps.forEach((c) => { c.width = 0; c.height = 0; });
    return out;
  }

  const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

  async function encode(canvas, quality) {
    const webp = await toBlob(canvas, 'image/webp', quality);
    if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
    const jpg = await toBlob(canvas, 'image/jpeg', Math.min(0.92, quality + 0.04));
    if (!jpg) throw new Error('encode');
    return { blob: jpg, ext: 'jpg' };
  }

  async function processFile(file) {
    const { img, url } = await loadImage(file);
    try {
      const large = scaled(img, LARGE_EDGE);
      const thumb = scaled(img, THUMB_EDGE);
      const tiny = scaled(img, 20);
      const [L, T] = await Promise.all([encode(large, 0.82), encode(thumb, 0.78)]);
      const lqip = tiny.toDataURL('image/jpeg', 0.5);
      const id = newId();
      const item = {
        id,
        src: `/${PHOTO_DIR}/${id}.${L.ext}`,
        w: large.width,
        h: large.height,
        thumb: `/${PHOTO_DIR}/${id}-thumb.${T.ext}`,
        tw: thumb.width,
        caption: '',
        lqip,
        _files: [
          { path: `${PHOTO_DIR}/${id}.${L.ext}`, blob: L.blob },
          { path: `${PHOTO_DIR}/${id}-thumb.${T.ext}`, blob: T.blob },
        ],
        _preview: URL.createObjectURL(T.blob),
      };
      [large, thumb, tiny].forEach((c) => { c.width = 0; c.height = 0; });
      return item;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Clips: first VIDEO_SECONDS, no audio, VIDEO_EDGE px, re-encoded in the browser so they loop like a GIF.
  function videoMime() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
    const types = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return types.find((t) => window.MediaRecorder.isTypeSupported(t)) || '';
  }

  function once(el, ev) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('decode')); };
      el.addEventListener(ev, ok);
      el.addEventListener('error', bad);
    });
  }

  async function seek(v, t) {
    if (Math.abs(v.currentTime - t) < 0.01) return;
    const done = once(v, 'seeked');
    v.currentTime = t;
    await done;
  }

  const isVideoFile = (f) => (f.type || '').startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name);

  async function processVideo(file, onProgress) {
    const mime = videoMime();
    if (!mime) throw new Error('novideo');
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.className = 'work-video';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    document.body.append(v);
    try {
      const loaded = once(v, 'loadeddata');
      v.src = url;
      await loaded;
      if (!v.videoWidth || !v.videoHeight) throw new Error('decode');
      const dur = Math.min(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : VIDEO_SECONDS, VIDEO_SECONDS);
      const k = Math.min(1, VIDEO_EDGE / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(2, Math.round((v.videoWidth * k) / 2) * 2);
      const h = Math.max(2, Math.round((v.videoHeight * k) / 2) * 2);

      await seek(v, Math.min(0.4, dur / 2));
      const poster = scaled(v, THUMB_EDGE);
      const tiny = scaled(v, 20);
      const T = await encode(poster, 0.78);
      const lqip = tiny.toDataURL('image/jpeg', 0.5);
      await seek(v, 0);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, w, h);
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });
      rec.start(500);
      await new Promise((resolve, reject) => {
        let finished = false;
        const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
        const guard = setTimeout(finish, (dur + 5) * 1000);
        const frame = () => {
          if (finished) return;
          ctx.drawImage(v, 0, 0, w, h);
          if (onProgress) onProgress(Math.min(1, v.currentTime / dur));
          if (v.currentTime >= dur || v.ended) { finish(); return; }
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame);
          else requestAnimationFrame(frame);
        };
        v.addEventListener('ended', finish, { once: true });
        v.play().then(frame, (err) => { finished = true; clearTimeout(guard); reject(err); });
      });
      v.pause();
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      const type = mime.split(';')[0];
      const blob = new Blob(chunks, { type });
      if (!blob.size) throw new Error('encode');
      const ext = type === 'video/mp4' ? 'mp4' : 'webm';
      const id = newId();
      [poster, tiny, canvas].forEach((c) => { c.width = 0; c.height = 0; });
      return {
        type: 'video',
        id,
        src: `/${PHOTO_DIR}/${id}.${ext}`,
        w,
        h,
        thumb: `/${PHOTO_DIR}/${id}-thumb.${T.ext}`,
        tw: Math.round(Math.min(1, THUMB_EDGE / Math.max(w, h)) * w) || w,
        caption: '',
        lqip,
        _files: [
          { path: `${PHOTO_DIR}/${id}.${ext}`, blob },
          { path: `${PHOTO_DIR}/${id}-thumb.${T.ext}`, blob: T.blob },
        ],
        _preview: URL.createObjectURL(T.blob),
      };
    } finally {
      v.removeAttribute('src');
      v.load();
      v.remove();
      URL.revokeObjectURL(url);
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // ------------------------------------------------------------------ UI

  function show(section) {
    ['loading', 'setup', 'app'].forEach((id) => { $(id).hidden = id !== section; });
    $('bar').hidden = section !== 'app';
    $('logout').hidden = section !== 'app';
  }

  function setStatus(text, kind) {
    const el = $('status');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.className = `status${kind ? ` is-${kind}` : ''}`;
    el.textContent = '';
    if (Array.isArray(text)) text.forEach((part) => el.append(part));
    else el.textContent = text;
  }

  function toast(text, undo) {
    clearTimeout(toastTimer);
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !undo;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; lastRemoved = null; }, 6000);
  }

  function previewSrc(p) {
    if (p._preview) return p._preview;
    return p.thumb || p.src;
  }

  function render() {
    const grid = $('grid');
    grid.textContent = '';
    items.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'item';
      li.dataset.id = p.id;

      const media = document.createElement('div');
      media.className = 'item__media';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = previewSrc(p);
      if (isRepoFile(p.thumb) && !p._preview) {
        img.addEventListener('error', () => { img.src = RAW + p.thumb; }, { once: true });
      }
      const num = document.createElement('span');
      num.className = 'item__num';
      num.textContent = String(i + 1);
      media.append(img, num);
      if (p._files || p.type === 'video') {
        const badge = document.createElement('span');
        badge.className = p._files ? 'item__badge' : 'item__badge item__badge--video';
        badge.textContent = p.type === 'video' ? (p._files ? 'Nuovo video' : 'Video') : 'Nuova';
        media.append(badge);
      }

      const cap = document.createElement('input');
      cap.className = 'item__cap';
      cap.type = 'text';
      cap.maxLength = 80;
      cap.placeholder = 'Didascalia (facoltativa)';
      cap.value = p.caption || '';
      cap.setAttribute('aria-label', `Didascalia della foto ${i + 1}`);
      cap.addEventListener('input', () => { p.caption = cap.value; refresh(); });

      const actions = document.createElement('div');
      actions.className = 'item__actions';
      actions.innerHTML =
        '<button type="button" data-act="first">↑ Prima</button>' +
        '<button type="button" data-act="replace">Cambia</button>' +
        '<button type="button" data-act="delete" class="danger">Elimina</button>';
      actions.querySelector('[data-act="first"]').disabled = i === 0;

      li.append(media, cap, actions);
      grid.append(li);
    });
    refresh();
  }

  function refresh() {
    const n = items.length;
    $('count').textContent = n ? `(${n})` : '';
    $('empty').hidden = n > 0;
    const changes = dirty();
    const btn = $('publish');
    btn.disabled = !changes || busy;
    btn.textContent = changes ? 'Pubblica modifiche' : 'Tutto pubblicato ✓';
  }

  function setBusy(on, label) {
    busy = on;
    $('publish').classList.toggle('is-busy', on);
    $('add-label').classList.toggle('is-busy', on);
    $('add-input').disabled = on;
    if (on && label) $('publish').textContent = label;
    if (!on) refresh();
  }

  // ------------------------------------------------------------------ actions

  async function addFiles(files, atIndex) {
    const list = Array.from(files || []).filter((f) => isVideoFile(f) || (f.type || '').startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name));
    if (!list.length) return;
    const failed = [];
    setBusy(true);
    let done = 0;
    for (const file of list) {
      const of = list.length > 1 ? ` (${done + 1} di ${list.length})` : '';
      setStatus(`Preparo ${isVideoFile(file) ? 'il video' : 'la foto'}…${of}`);
      try {
        const item = isVideoFile(file)
          ? await processVideo(file, (x) => setStatus(`Preparo il video… ${Math.round(x * 100)}%${of} — tieni lo schermo acceso`))
          : await processFile(file);
        if (atIndex >= 0) {
          const old = items[atIndex];
          item.caption = old.caption || '';
          forgetFiles(old);
          if (old._preview) URL.revokeObjectURL(old._preview);
          items.splice(atIndex, 1, item);
        } else {
          items.push(item);
        }
      } catch (e) {
        failed.push(file.name);
      }
      done += 1;
    }
    setBusy(false);
    render();
    if (failed.length) {
      setStatus(`Non sono riuscito ad aprire: ${failed.join(', ')}. Se sono foto HEIC dell’iPhone, esportale in JPG (oppure Impostazioni › Fotocamera › Formati › “Più compatibile”). Per i video, prova da un altro browser (Safari o Chrome aggiornati).`, 'error');
    } else {
      setStatus(atIndex >= 0 ? 'Sostituita. Premi “Pubblica modifiche” per metterla online.' : `${list.length === 1 ? 'Aggiunta' : `${list.length} aggiunte`} in fondo. Premi “Pubblica modifiche” per metterle online.`);
    }
  }

  function removeAt(i) {
    const [p] = items.splice(i, 1);
    lastRemoved = { item: p, index: i, hadFiles: !p._files ? [p.src, p.thumb].filter(isRepoFile).map((u) => u.slice(1)) : [] };
    forgetFiles(p);
    render();
    toast('Foto rimossa', true);
  }

  function undoRemove() {
    if (!lastRemoved) return;
    const { item, index, hadFiles } = lastRemoved;
    hadFiles.forEach((f) => removedFiles.delete(f));
    items.splice(Math.min(index, items.length), 0, item);
    lastRemoved = null;
    $('toast').hidden = true;
    render();
  }

  function commitMessage(added, removedCount) {
    const parts = [];
    if (added) parts.push(`+${added} foto`);
    if (removedCount) parts.push(`-${removedCount} foto`);
    if (!parts.length) parts.push('ordine e didascalie');
    return `Galleria: ${parts.join(', ')}`;
  }

  async function publish() {
    if (busy || !dirty()) return;
    setBusy(true, 'Pubblico…');
    setStatus('Pubblicazione in corso… non chiudere la pagina.');
    try {
      const ref = await gh(repoPath(`/git/ref/heads/${BRANCH}`));
      const latest = ref.object.sha;
      if (latest !== headSha) {
        const remote = await readGallery(latest);
        if (serialize(remote) !== savedJson) throw new Error('conflict');
        headSha = latest;
      }
      const base = await gh(repoPath(`/git/commits/${headSha}`));
      const tree = [];

      const fresh = items.filter((p) => p._files);
      const total = fresh.reduce((n, p) => n + p._files.length, 0);
      let sent = 0;
      for (const p of fresh) {
        for (const f of p._files) {
          sent += 1;
          setStatus(`Carico le foto… ${Math.ceil(sent / 2)} di ${Math.ceil(total / 2)}`);
          const content = await blobToBase64(f.blob);
          const blob = await gh(repoPath('/git/blobs'), { method: 'POST', body: { content, encoding: 'base64' } });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
      }

      let removedCount = 0;
      if (removedFiles.size) {
        let existing = [];
        try {
          existing = await gh(repoPath(`/contents/${PHOTO_DIR}?ref=${headSha}`));
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        const paths = new Set((Array.isArray(existing) ? existing : []).map((f) => f.path));
        removedFiles.forEach((path) => {
          if (paths.has(path)) {
            tree.push({ path, mode: '100644', type: 'blob', sha: null });
            if (!path.includes('-thumb.')) removedCount += 1;
          }
        });
      }

      const json = serialize(items);
      tree.push({ path: JSON_PATH, mode: '100644', type: 'blob', content: json });

      setStatus('Salvo…');
      const newTree = await gh(repoPath('/git/trees'), { method: 'POST', body: { base_tree: base.tree.sha, tree } });
      const commit = await gh(repoPath('/git/commits'), {
        method: 'POST',
        body: { message: commitMessage(fresh.length, removedCount), tree: newTree.sha, parents: [headSha] },
      });
      await gh(repoPath(`/git/refs/heads/${BRANCH}`), { method: 'PATCH', body: { sha: commit.sha, force: false } });

      headSha = commit.sha;
      savedJson = json;
      removedFiles.clear();
      fresh.forEach((p) => { delete p._files; });
      render();
      const link = document.createElement('a');
      link.href = $('site-link').getAttribute('href');
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Apri il sito';
      setStatus(['Pubblicato ✓ Il sito si aggiorna da solo in circa un minuto. ', link], 'ok');
    } catch (e) {
      setStatus(explain(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ setup / boot

  async function connect(candidate) {
    token = candidate;
    // read access
    await gh(repoPath(''));
    // write access: an unreferenced blob is harmless and proves "Contents: Read and write"
    await gh(repoPath('/git/blobs'), { method: 'POST', body: { content: 'ok', encoding: 'utf-8' } });
  }

  async function loadApp() {
    show('loading');
    const ref = await gh(repoPath(`/git/ref/heads/${BRANCH}`));
    headSha = ref.object.sha;
    const list = await readGallery(headSha);
    items = list.map((p) => ({ ...p }));
    savedJson = serialize(items);
    removedFiles.clear();
    show('app');
    render();
  }

  function bind() {
    $('token-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = $('token').value.trim();
      const err = $('setup-error');
      err.hidden = true;
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(value)) {
        err.textContent = 'Il codice non sembra giusto: deve iniziare con “github_pat_”. Copialo di nuovo da GitHub.';
        err.hidden = false;
        return;
      }
      const btn = $('token-save');
      btn.disabled = true;
      btn.textContent = 'Controllo…';
      try {
        await connect(value);
        try { localStorage.setItem(TOKEN_KEY, value); } catch (x) { /* private mode: keep for this session */ }
        $('token').value = '';
        await loadApp();
      } catch (x) {
        token = '';
        err.textContent = explain(x);
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Salva e continua';
      }
    });

    $('logout').addEventListener('click', () => {
      if (dirty() && !window.confirm('Hai modifiche non pubblicate. Uscire comunque?')) return;
      try { localStorage.removeItem(TOKEN_KEY); } catch (x) { /* ignore */ }
      token = '';
      items = [];
      removedFiles.clear();
      savedJson = serialize([]);
      setStatus('');
      show('setup');
    });

    $('add-input').addEventListener('change', (e) => {
      const files = e.target.files;
      addFiles(files, -1).finally(() => { e.target.value = ''; });
    });

    $('replace-input').addEventListener('change', (e) => {
      const files = e.target.files;
      const at = replaceIndex;
      replaceIndex = -1;
      if (at >= 0 && files && files[0]) addFiles([files[0]], at).finally(() => { e.target.value = ''; });
    });

    $('grid').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || busy) return;
      const li = btn.closest('.item');
      const i = items.findIndex((p) => p.id === li.dataset.id);
      if (i < 0) return;
      const act = btn.dataset.act;
      if (act === 'delete') removeAt(i);
      else if (act === 'first') { items.unshift(items.splice(i, 1)[0]); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (act === 'replace') { replaceIndex = i; $('replace-input').click(); }
    });

    $('publish').addEventListener('click', publish);
    $('toast-undo').addEventListener('click', undoRemove);

    window.addEventListener('beforeunload', (e) => {
      if (dirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    if (window.Sortable) {
      window.Sortable.create($('grid'), {
        animation: 180,
        delay: 180,
        delayOnTouchOnly: true,
        touchStartThreshold: 6,
        filter: 'input, button',
        preventOnFilter: false,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: () => {
          const order = Array.from($('grid').children).map((li) => li.dataset.id);
          items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
          render();
        },
      });
    }
  }

  async function boot() {
    bind();
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }
    if (!token) { show('setup'); return; }
    try {
      await loadApp();
    } catch (e) {
      show('setup');
      const err = $('setup-error');
      err.textContent = explain(e);
      err.hidden = false;
    }
  }

  boot();
})();
