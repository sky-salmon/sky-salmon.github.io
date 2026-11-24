/* sky-salmon — 樂譜 page, 「轉譜」 drawer: a piano recording becomes a Sky sheet (assets/js/transcribe.js).
 * A restricted feature, "transcribe": open to everyone, approved accounts or listed emails as the admins set it in
 * admin.html → 權限 (access.js asks). The recording is read in the browser; nothing is uploaded.
 * The sheet goes into the songbook through window.CandleMusic (music.js). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, ms) => window.Site && window.Site.toast && window.Site.toast(m, ms);
  const HERE = document.currentScript.src;
  const body = $('#tr-body');
  if (!body) return;
  const FINGERS = [[1, '1 指'], [2, '2 指'], [3, '3 指'], [4, '4 指'], [0, '不限']];
  const SENS = [['low', '低'], ['mid', '中'], ['high', '高']];
  const SIMPLE = [[0, '完整'], [1, '適中'], [2, '精簡']];
  // measured on 34 piano test clips with known notes (computer-rendered with human timing and pedal, from clean to a
  // soft, roomy, mp3'd home recording; 30 with a known tune), by 靈敏度: tune = how well the tune comes out (F1 of its
  // notes, %); noise = the share of the sheet's notes that aren't in the piece (%), by finger count
  const ACC = { low: { tune: 91, noise: { 1: 5, 2: 3, 3: 3, 4: 3, 0: 3 } }, mid: { tune: 93, noise: { 1: 5, 2: 4, 3: 5, 4: 5, 0: 5 } },
    high: { tune: 92, noise: { 1: 7, 2: 7, 3: 8, 4: 8, 0: 8 } } };
  const LAYERS = { 1: '只有旋律', 2: '旋律＋低音＋伴奏，同時最多 2 個鍵', 3: '旋律＋低音＋伴奏，同時最多 3 個鍵', 4: '旋律＋低音＋伴奏，同時最多 4 個鍵', 0: '旋律＋低音＋伴奏，不限同時按幾個' };
  let gate = { code: 'loading' }, busy = false, mod = null;
  // job: the file being read and what came out of it; opts: what the visitor picked
  let job = null;
  const opts = { fingers: 2, nudge: 0, quantize: false, sensitivity: 'mid', simplify: 1 };
  let sheet = null;

  async function checkGate() {
    if (!window.Access || !window.Access.enabled) { gate = { code: 'offline' }; render(); return; }
    gate = { code: 'loading' }; render();
    gate = await window.Access.check('transcribe');
    render();
  }
  async function gateAct(kind) {
    busy = true; render();
    try {
      if (kind === 'signin') await window.Access.signIn();
      if (kind === 'apply') await window.Access.request();
    } catch (e) { console.warn('transcribe access', e); }
    busy = false;
    await checkGate();
  }

  function lockHTML() {
    const who = gate.email ? `<b>${esc(gate.email)}</b>` : '';
    const btn = (act, label, primary) => `<button type="button" class="btn${primary ? ' btn-primary' : ''}" data-tr-g="${act}"${busy ? ' disabled' : ''}>${label}</button>`;
    const html = {
      loading: '<p class="hint">確認權限中…</p>',
      signin: `<p>音檔轉樂譜目前只開放給站長開通的人。用 Google 登入並送出申請；或請站長把你的 Email 加進名單。</p>${btn('signin', '用 Google 登入', true)}`,
      apply: `<p>這個帳號（${who}）還沒申請音檔轉樂譜。</p>${btn('apply', '送出申請', true)}`,
      pending: `<p>已送出申請（${who}），站長核准後按「重新檢查」就能用。</p>${btn('retry', '重新檢查')}`,
      denied: `<p>這個帳號（${who}）的申請沒有通過。</p>`,
      noperm: `<p>這個帳號（${who}）已核准，但還沒開通音檔轉樂譜。</p>${btn('retry', '重新檢查')}`,
      offline: `<p>連不到 Google 服務，暫時無法確認權限。</p>${btn('retry', '再試一次')}`
    }[gate.code] || '';
    return `<div class="tr-lock">${html}</div>`;
  }
  function pickHTML() {
    return `<div class="dropzone mu-drop" id="tr-zone" role="button" tabindex="0" aria-describedby="tr-help">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6.2l10-2.2v11.4"/><circle cx="6.6" cy="18" r="2.4"/><circle cx="16.6" cy="15.4" r="2.4"/></svg>
        <span><b>選擇或拖放鋼琴錄音</b><small id="tr-help">mp3 / m4a / wav / mp4，8 分鐘以內</small></span>
      </div>
      <input type="file" id="tr-file" accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.mp4,.mov" hidden>
      <p class="hint">鋼琴獨奏、旋律清楚的錄音效果最好；有人聲或鼓的原曲會比較亂。檔案只在你的瀏覽器裡處理，不會上傳。</p>
      <p class="hint tr-acc">準確度參考：用 34 段已知每個音的鋼琴測試錄音試過（從乾淨的到像在家用手機錄的都有），旋律約 <b>${ACC.mid.tune}%</b> 抓對，2 指樂譜裡多出來的雜音約 ${ACC.mid.noise[2]}%。辨識門檻會依錄音自動調整。測試錄音是電腦合成的；有人聲或其他樂器的原曲通常會差一些。</p>`;
  }
  function workHTML() {
    const pct = Math.round((job.progress || 0) * 100);
    return `<p class="tr-file mono">${esc(job.name)}</p>
      <div class="tr-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <p class="hint">${esc(job.stage)}${job.stage === '辨識音符中' ? ` ${pct}%` : ''}</p>`;
  }
  function seg(name, items, current) {
    return `<div class="mu-seg tr-seg" role="group">${items.map(([v, label]) => `<button type="button" data-tr-${name}="${v}" aria-pressed="${String(v) === String(current)}">${label}</button>`).join('')}</div>`;
  }
  function rollSVG(notes) {
    if (!notes.length) return '';
    const span = Math.max(4000, notes[notes.length - 1][0] + 500), W = 300, H = 92;
    const dots = notes.map(([t, k]) => `<rect class="dot" x="${(4 + (t / span) * (W - 8)).toFixed(1)}" y="${(4 + (14 - k) * 5.8).toFixed(1)}" width="2.6" height="3.4" rx="1"/>`).join('');
    return `<svg class="tr-roll" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><rect class="bg" x="0" y="0" width="${W}" height="${H}" rx="8"/>${dots}</svg>`;
  }
  function resultHTML() {
    const i = sheet.info, n = sheet.notes.length;
    const shiftTxt = i.shift === 0 ? '不用移調' : `移調 ${i.shift > 0 ? '+' : ''}${i.shift} 半音`;
    return `<p class="tr-file mono">${esc(job.name)}</p>
      <p class="tr-sum">聽到 <b>${i.total}</b> 個音，其中旋律 <b>${i.tune}</b> 個${job.raw.out.sure < 0.85 ? '（錄音偏輕柔，已自動放寬辨識）' : ''}。原曲約為 <b>${esc(i.keyName)}</b>，${shiftTxt}後放進光遇的 15 個鍵。</p>
      <h3 class="mu-d-label">手指數 <small>同一時間最多按幾個鍵</small></h3>${seg('fingers', FINGERS, opts.fingers)}
      <p class="hint tr-acc"><b>${LAYERS[opts.fingers]}</b>。測試錄音上旋律約 ${ACC[opts.sensitivity].tune}% 抓對、雜音約 ${ACC[opts.sensitivity].noise[opts.fingers]}%${opts.sensitivity === 'high' ? '（「高」會多聽出雜音，錄音小聲、漏了很多音時再用）' : ''}。</p>
      <h3 class="mu-d-label">精簡度 <small>光遇每個鍵都一樣大聲，原曲輕輕帶過的伴奏會變吵</small></h3>${seg('simple', SIMPLE, opts.simplify)}
      <p class="hint">${['伴奏全部保留。', '保留和旋律一起按的和聲與低音；旋律音之間的伴奏，每個空檔只留最重要的一個。', '只留和旋律一起按的和聲與低音，中間的伴奏都拿掉。'][opts.simplify]}</p>
      <h3 class="mu-d-label">移調</h3>
      <div class="tr-row"><button type="button" class="btn" data-tr-nudge="-1" aria-label="降半音">−</button>
        <span class="tr-shift">${opts.nudge ? `自動 ${opts.nudge > 0 ? '+' : ''}${opts.nudge}` : '自動（升降音最少）'}</span>
        <button type="button" class="btn" data-tr-nudge="1" aria-label="升半音">＋</button></div>
      <h3 class="mu-d-label">節奏</h3>${seg('quantize', [[0, '照原本的時間'], [1, `對齊拍子<small>約 ${sheet.bpm} BPM</small>`]], opts.quantize ? 1 : 0)}
      <h3 class="mu-d-label">靈敏度 <small>越高聽到越多音，也越容易多出雜音</small></h3>${seg('sens', SENS, opts.sensitivity)}
      ${rollSVG(sheet.notes)}
      <p class="hint">${n} 個音、${i.steps} 個時間點${i.snapped ? `；旋律有 ${i.snapped} 個升降音吸附到旁邊的鍵` : ''}${i.folded ? `；${i.folded} 個旋律音超出兩個八度，移了八度` : ''}${i.dropped ? `；${i.dropped} 個伴奏音在黑鍵上或旋律下方放不下，略過` : ''}${i.ghosts ? `；去掉 ${i.ghosts} 個泛音` : ''}。</p>
      <label class="field tr-name"><span>樂譜名稱</span><input class="input" id="tr-name" maxlength="60" value="${esc(job.title)}"></label>
      <div class="tr-actions"><button type="button" class="btn btn-primary" data-tr-act="preview"${n ? '' : ' disabled'}>試聽</button>
        <button type="button" class="btn" data-tr-act="save"${n ? '' : ' disabled'}>存進樂譜庫</button>
        <button type="button" class="text-link" data-tr-act="again">換一個檔案</button></div>`;
  }
  function render() {
    if (!gate.ok) { body.innerHTML = lockHTML(); return; }
    body.innerHTML = !job ? pickHTML() : job.raw ? resultHTML() : job.error ? `<p class="status is-error">${esc(job.error)}</p>${pickHTML()}` : workHTML();
    const zone = $('#tr-zone'), file = $('#tr-file');
    if (zone && window.Site && window.Site.bindDropzone) window.Site.bindDropzone(zone, file, f => start(f));
    else if (zone) { zone.addEventListener('click', () => file.click()); file.addEventListener('change', () => file.files[0] && start(file.files[0])); }
  }
  // the model ran once (job.raw.out); 靈敏度 re-reads its notes, everything else only re-arranges them
  async function reread() { job.raw.notes = await mod.notesFrom(job.raw.out, opts.sensitivity); }
  function rebuild() {
    const auto = mod.toSky(job.raw.notes, { fingers: opts.fingers }).info.autoShift;
    sheet = mod.toSky(job.raw.notes, { fingers: opts.fingers, quantize: opts.quantize, transpose: auto + opts.nudge, simplify: opts.simplify });
  }
  async function start(file) {
    if (!file) return;
    job = { name: file.name, title: file.name.replace(/\.[^.]+$/, '').slice(0, 60), stage: '讀取音檔中', progress: 0 };
    opts.nudge = 0; render();
    try {
      if (!mod) mod = await import(new URL('transcribe.js', HERE).href);
      const pcm = await mod.decodeToMono(file);
      job.stage = '載入辨識模型中'; render();
      let last = 0;
      job.raw = await mod.transcribeAudio(pcm, p => {
        job.stage = '辨識音符中'; job.progress = p;
        const now = performance.now(); if (now - last > 200) { last = now; render(); }
      });
      if (opts.sensitivity !== 'mid') await reread();
      if (!job.raw.notes.length) throw Object.assign(new Error('empty'), { code: 'empty' });
      rebuild(); render();
    } catch (e) {
      console.warn('transcribe', e);
      job = { name: file.name, error: e.code === 'too-long' ? '這個檔案超過 8 分鐘，請先剪短再試。'
        : e.code === 'empty' ? '這段錄音裡沒有聽到音符。' : e.name === 'EncodingError' || /decode/i.test(e.message || '') ? '讀不了這個檔案的聲音，換成 mp3、m4a 或 wav 再試。'
          : '辨識失敗了，請再試一次（或換一個瀏覽器）。' };
      render();
    }
  }
  function song() {
    return { name: ($('#tr-name') || {}).value || job.title, bpm: sheet.bpm, author: '音檔轉譜', notes: sheet.notes };
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.trG) { if (!busy) gateAct(d.trG); return; }
    if (!job || !job.raw) return;
    if (d.trFingers !== undefined) opts.fingers = +d.trFingers;
    else if (d.trNudge) opts.nudge = Math.max(-11, Math.min(11, opts.nudge + +d.trNudge));
    else if (d.trQuantize !== undefined) opts.quantize = d.trQuantize === '1';
    else if (d.trSimple !== undefined) opts.simplify = +d.trSimple;
    else if (d.trSens) { opts.sensitivity = d.trSens; reread().then(() => { rebuild(); render(); }); return; }
    else if (d.trAct === 'again') { job = null; sheet = null; render(); return; }
    else if (d.trAct === 'preview') { window.CandleMusic.preview(song()); return; }
    else if (d.trAct === 'save') { const s = window.CandleMusic.addSong(song()); toast(s ? `已存入樂譜庫：「${s.name}」` : '存不進樂譜庫'); return; }
    else return;
    const name = ($('#tr-name') || {}).value; if (name != null) job.title = name;
    rebuild(); render();
  });

  window.TranscribeUI = { open() { if (!gate.ok) checkGate(); } };
  if (window.FIREBASE_EMULATOR) window.__transcribeTest = { start, state: () => ({ gate, job: job && { stage: job.stage, error: job.error, raw: !!job.raw }, sheet, opts }) };
})();
