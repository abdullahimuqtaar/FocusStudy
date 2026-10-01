/* =========================================================
   FocusStudy – script.js

   1. Constants           6. Timer logic (start, pause, finish)
   2. Saved state         7. Dialogs and toast
   3. Small helpers       8. Rendering each page
   4. Theme               9. Event listeners
   5. Sound + alerts     10. Start-up
   ========================================================= */

(() => {
  'use strict';

  /* ---------- 1. Constants ---------- */

  const STORAGE_KEY = 'focusstudy.v1';
  const BASE_TITLE = 'FocusStudy – Study Smarter. Focus Longer. Learn Better.';
  const VIEWS = ['home', 'study', 'progress', 'history', 'tips', 'settings'];
  const HERO_PRESETS = [25, 30, 40, 45, 60];
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 240;

  const MODES = {
    quick:    { label: 'Quick Focus',    minutes: 25 },
    standard: { label: 'Standard Focus', minutes: 30 },
    deep:     { label: 'Deep Focus',     minutes: 40 },
    long:     { label: 'Long Focus',     minutes: 60 },
    custom:   { label: 'Custom Session', minutes: null }
  };

  const MOTIVATION = [
    'Excellent work! One focused session completed.',
    'Keep going. Small consistent sessions create big results.',
    'You showed discipline today. Come back for your next session.',
    'Steady effort beats last-minute cramming. Nice session.',
    'Focus is a skill, and you just practiced it.'
  ];

  const REST_MESSAGE = 'Take a short break. Stretch, drink water, and rest your eyes.';

  /* ---------- 2. Saved state ---------- */

  const DEFAULT_SETTINGS = {
    studyMinutes: 25,
    breakMinutes: 'auto',   // 'auto' or a number of minutes
    dailyTarget: 120,
    sound: true,
    notifications: true,
    theme: 'system',        // 'system' | 'light' | 'dark'
    autoBreak: false,
    autoNext: false
  };

  const DEFAULT_DRAFT = { subject: '', goal: '', mode: 'quick', customMinutes: 50 };

  function loadState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* ignore */ }
    if (!saved || typeof saved !== 'object') saved = {};

    const settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
    const draft = Object.assign({}, DEFAULT_DRAFT, saved.draft);
    const sessions = Array.isArray(saved.sessions) ? saved.sessions : [];

    // Only keep a saved timer if it looks valid
    let timer = saved.timer;
    const validTimer = timer && (timer.phase === 'study' || timer.phase === 'break') &&
      (timer.status === 'running' || timer.status === 'paused') && Number(timer.totalMs) > 0;
    if (!validTimer) timer = null;

    return { settings, draft, sessions, timer };
  }

  let state = loadState();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  /* ---------- 3. Small helpers ---------- */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // Builds an element safely. Text is always added with textContent, never as HTML.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === false || value == null) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    children.flat().forEach(child => { if (child != null) node.append(child); });
    return node;
  }

  const pad = n => String(n).padStart(2, '0');
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  function dateKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function keyToDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }

  function formatDate(key) {
    const d = keyToDate(key);
    const options = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return d.toLocaleDateString(undefined, options);
  }

  // 135 -> "2 hours 15 minutes"
  function formatLong(minutes) {
    minutes = Math.round(minutes);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const parts = [];
    if (h) parts.push(plural(h, 'hour'));
    if (m || !h) parts.push(plural(m, 'minute'));
    return parts.join(' ');
  }

  // 90000 ms -> "01:30"
  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
  }

  function clampMinutes(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : NaN;
  }

  /* ---------- 4. Theme ---------- */

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function resolvedTheme() {
    const t = state.settings.theme;
    return t === 'system' ? (systemDark.matches ? 'dark' : 'light') : t;
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  /* ---------- 5. Sound + browser notifications ---------- */

  let audioCtx = null;

  // Browsers only allow sound after a click, so we unlock it on the first interaction.
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* sound is optional */ }
  }

  function playChime() {
    if (!state.settings.sound || !audioCtx) return;
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = now + i * 0.22;
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.8);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.85);
    });
  }

  function askNotificationPermission() {
    if (state.settings.notifications && 'Notification' in window && Notification.permission === 'default') {
      const result = Notification.requestPermission(() => updateNotifyHint());  // older Safari uses a callback
      if (result && result.then) result.then(updateNotifyHint);
    }
  }

  function sendNotification(title, body) {
    if (!state.settings.notifications) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) { /* some browsers block this */ }
    }
  }

  function alertUser(title, body) {
    playChime();
    sendNotification(title, body);
  }

  /* ---------- 6. Timer logic ---------- */

  // state.timer is null when nothing is running. Otherwise:
  // { phase: 'study' | 'break', status: 'running' | 'paused',
  //   totalMs, remainingMs, endsAt, subject, goal, ... }
  // While running we store the exact end time, so the countdown stays accurate
  // even if the tab is in the background or the page is refreshed.

  function remainingMs(t) {
    return t.status === 'running' ? Math.max(0, t.endsAt - Date.now()) : t.remainingMs;
  }
  function elapsedMs(t) { return t.totalMs - remainingMs(t); }

  function getMinutes() {
    const d = state.draft;
    return d.mode === 'custom' ? clampMinutes(d.customMinutes) : MODES[d.mode].minutes;
  }

  // Choose a preset mode if the length matches one, otherwise use a custom length.
  function selectMinutes(minutes) {
    const key = ['quick', 'standard', 'deep', 'long'].find(k => MODES[k].minutes === minutes);
    state.draft.mode = key || 'custom';
    if (!key) state.draft.customMinutes = minutes;
  }

  // Recommended break for a session length
  function recommendedBreak(minutes) {
    if (minutes <= 25) return { minutes: 5, label: '5 minutes' };
    if (minutes <= 30) return { minutes: 5, label: '5–10 minutes' };
    if (minutes <= 45) return { minutes: 10, label: '10 minutes' };
    return { minutes: 15, label: '10–15 minutes' };
  }

  function breakInfo(studyMinutes) {
    const setting = state.settings.breakMinutes;
    if (setting === 'auto') return recommendedBreak(studyMinutes);
    const n = Number(setting);
    return { minutes: n, label: plural(n, 'minute') };
  }

  function beginTimer(phase, minutes, extra) {
    const total = minutes * 60000;
    state.timer = Object.assign({
      phase, status: 'running', totalMs: total, remainingMs: total, endsAt: Date.now() + total
    }, extra);
    save();
    renderFocus();
  }

  function startStudy(minutes, subject, goal) {
    unlockAudio();
    askNotificationPermission();
    beginTimer('study', minutes, { subject, goal, plannedMinutes: minutes });
  }

  function startBreak(minutes, study, sessionId, announceDone) {
    beginTimer('break', minutes, {
      subject: study.subject, goal: study.goal,
      nextMinutes: study.plannedMinutes, sessionId, announceDone: !!announceDone
    });
  }

  function startFromSetup() {
    const errorBox = $('#start-error');
    const minutes = getMinutes();
    if (!Number.isFinite(minutes)) {
      errorBox.textContent = 'Enter a session length between ' + MIN_MINUTES + ' and ' + MAX_MINUTES + ' minutes.';
      $('#custom-input').focus();
      return;
    }
    errorBox.textContent = '';
    const subject = state.draft.subject.trim() || 'General study';
    const goal = state.draft.goal.trim();
    save();
    startStudy(minutes, subject, goal);
  }

  function togglePause() {
    const t = state.timer;
    if (!t) return;
    if (t.status === 'running') {
      t.remainingMs = remainingMs(t);
      t.status = 'paused';
      t.endsAt = null;
    } else {
      t.status = 'running';
      t.endsAt = Date.now() + t.remainingMs;
    }
    save();
    renderFocus();
  }

  function addSession(info) {
    const session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: dateKey(new Date()),
      ts: Date.now(),
      subject: info.subject,
      goal: info.goal,
      minutes: info.minutes,
      status: info.status,        // 'completed' or 'ended'
      goalDone: false
    };
    state.sessions.push(session);
    return session;
  }

  // Called when a countdown reaches zero
  function finishPhase() {
    const t = state.timer;
    if (!t) return;
    state.timer = null;

    if (t.phase === 'study') {
      const session = addSession({ subject: t.subject, goal: t.goal, minutes: t.plannedMinutes, status: 'completed' });
      save();
      renderFocus();
      renderAll();
      alertUser('Great job!', 'You completed your study session.');

      const brk = breakInfo(t.plannedMinutes);
      if (state.settings.autoBreak) startBreak(brk.minutes, t, session.id, true);
      else showCompleteDialog(t, session, brk);
    } else {
      save();
      renderFocus();
      alertUser('Break is over', 'Ready for another session?');
      if (state.settings.autoNext) startStudy(t.nextMinutes, t.subject, t.goal);
      else showBreakOverDialog(t);
    }
  }

  // Reset throws the session away without saving it
  function resetSession() {
    const t = state.timer;
    if (!t) return;
    const doReset = () => {
      state.timer = null;
      save();
      renderFocus();
      go('study');
      toast('Timer reset. Nothing was saved.');
    };
    const minutesDone = Math.floor(elapsedMs(t) / 60000);
    if (t.phase === 'study' && minutesDone >= 1) {
      openDialog({
        title: 'Reset this session?',
        text: 'Your ' + plural(minutesDone, 'minute') + ' so far will not be saved.',
        actions: [
          { label: 'Keep studying', kind: 'btn-primary' },
          { label: 'Reset session', kind: 'btn-danger', onClick: doReset }
        ]
      });
    } else {
      doReset();
    }
  }

  // Skip ends the current session or break early
  function skipSession() {
    const t = state.timer;
    if (!t) return;

    if (t.phase === 'break') {
      state.timer = null;
      save();
      renderFocus();
      showBreakOverDialog(t);
      return;
    }

    const minutes = Math.round(elapsedMs(t) / 60000);
    state.timer = null;
    if (minutes >= 1) {
      addSession({ subject: t.subject, goal: t.goal, minutes, status: 'ended' });
      toast('Session ended early. ' + plural(minutes, 'minute') + ' saved.');
    } else {
      toast('Session skipped. It was under a minute, so nothing was saved.');
    }
    save();
    renderFocus();
    renderAll();
    go('study');
  }

  // Runs four times a second so the display never drifts
  function tick() {
    const t = state.timer;
    if (!t) return;
    if (t.status === 'running' && Date.now() >= t.endsAt) finishPhase();
    else updateClock();
  }

  /* ---------- 7. Dialogs and toast ---------- */

  const dialog = $('#dialog');

  function openDialog({ title, text, extra, actions }) {
    const body = $('#dialog-body');
    body.replaceChildren(el('h2', { id: 'dialog-title', text: title }));
    if (text) body.append(el('p', { class: 'dialog-text', text }));
    [].concat(extra || []).forEach(node => body.append(node));

    const row = el('div', { class: 'dialog-actions' });
    actions.forEach(action => {
      const button = el('button', { type: 'button', class: 'btn ' + (action.kind || 'btn-quiet'), text: action.label });
      button.addEventListener('click', () => {
        dialog.close();
        if (action.onClick) action.onClick();
      });
      row.append(button);
    });
    body.append(row);
    dialog.showModal();
  }

  function goalCheckbox(session) {
    const id = 'goal-done-' + session.id;
    const input = el('input', { type: 'checkbox', id });
    input.checked = !!session.goalDone;
    input.addEventListener('change', () => {
      session.goalDone = input.checked;
      save();
      renderAll();
    });
    return el('label', { class: 'check-row', for: id }, input, el('span', { text: 'I reached my goal: ' + session.goal }));
  }

  function showCompleteDialog(t, session, brk) {
    const completedCount = state.sessions.filter(s => s.status === 'completed').length;
    const message = MOTIVATION[(completedCount - 1 + MOTIVATION.length) % MOTIVATION.length];

    const extra = [el('p', { class: 'dialog-summary', text: plural(t.plannedMinutes, 'minute') + ' of ' + t.subject })];
    if (session.goal) extra.push(goalCheckbox(session));
    extra.push(el('div', { class: 'dialog-rest' },
      el('strong', { text: REST_MESSAGE }),
      el('span', { text: 'Recommended break: ' + brk.label })
    ));

    openDialog({
      title: 'Great job! You completed your study session.',
      text: message,
      extra,
      actions: [
        { label: 'Start ' + brk.minutes + '-minute break', kind: 'btn-primary', onClick: () => startBreak(brk.minutes, t, session.id, false) },
        { label: 'Study again', kind: 'btn-outline', onClick: () => startStudy(t.plannedMinutes, t.subject, t.goal) },
        { label: 'Finish for now', onClick: () => go('progress') }
      ]
    });
  }

  function showBreakOverDialog(t) {
    openDialog({
      title: 'Ready for another session?',
      text: 'Your break is done. Start another ' + plural(t.nextMinutes, 'minute') + ' session on ' + t.subject + ', or call it a day.',
      actions: [
        { label: 'Start another session', kind: 'btn-primary', onClick: () => startStudy(t.nextMinutes, t.subject, t.goal) },
        { label: "I'm done for today", onClick: () => go('progress') }
      ]
    });
  }

  let toastTimer = null;
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-visible'), 3500);
  }

  /* ---------- 8. Rendering ---------- */

  // --- Router: each page is a <section data-view="..."> shown by the URL hash ---
  function currentViewFromHash() {
    const name = location.hash.replace('#', '');
    return VIEWS.includes(name) ? name : 'home';
  }

  function go(name) {
    if (location.hash === '#' + name) showView(name);
    else location.hash = '#' + name;
  }

  function showView(name) {
    VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
    $$('[data-view-link]').forEach(link => {
      if (link.dataset.viewLink === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    renderAll();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderHome();
    renderStudy();
    renderProgress();
    renderHistory();
    renderSettings();
  }

  // Updates a text input without disturbing someone who is typing in it
  function syncInput(input, value) {
    if (document.activeElement !== input) input.value = value;
  }

  function previewClock(minutes) {
    return Number.isFinite(minutes) ? pad(minutes) + ':00' : '--:--';
  }

  function modeLabelFor(minutes) {
    const key = ['quick', 'standard', 'deep', 'long'].find(k => MODES[k].minutes === minutes);
    return key ? MODES[key].label : 'Custom Session';
  }

  // --- Home ---
  function renderHome() {
    const minutes = getMinutes();
    const heroCustomOpen = ui.heroCustom || !HERO_PRESETS.includes(minutes);

    $$('#hero-chips .chip').forEach(chip => {
      const isCustomChip = chip.hasAttribute('data-custom');
      const pressed = isCustomChip ? heroCustomOpen : (!heroCustomOpen && Number(chip.dataset.minutes) === minutes);
      chip.setAttribute('aria-pressed', String(pressed));
    });

    $('#hero-custom').hidden = !heroCustomOpen;
    syncInput($('#hero-custom-input'), Number.isFinite(clampMinutes(state.draft.customMinutes)) ? state.draft.customMinutes : '');
    $('#hero-time').textContent = previewClock(minutes);
    $('#hero-mode').textContent = Number.isFinite(minutes) ? modeLabelFor(minutes) : 'Custom Session';
  }

  // --- Study setup ---
  function recommendFor(goalText) {
    const text = goalText.toLowerCase();
    const hard = /\b(difficult|hard|harder|complex|tough|challenging|exam\w*|test\w*|midterm\w*|finals?|essay\w*|project\w*|thesis|assignment\w*|problem sets?|deep)\b/;
    const small = /\b(small|quick|short|brief|review\w*|revis\w*|flashcards?|vocab\w*|recap|summar\w*|glance|warm[- ]?up)\b/;
    const medium = /\b(chapter\w*|lesson\w*|unit\w*|notes?|read\w*|practice|homework|lecture\w*)\b/;

    if (hard.test(text)) return { minutes: 40, text: 'Try a 40–60 minute session with a short break.' };
    if (small.test(text)) return { minutes: 25, text: 'Try a 25-minute focus session.' };
    if (medium.test(text)) return { minutes: 30, text: 'Try a 30–40 minute session.' };
    return { minutes: 30, text: 'Try a 30-minute session. Adjust it if your goal feels bigger or smaller.' };
  }

  function renderRecommendation() {
    const goal = state.draft.goal.trim();
    const text = $('#rec-text');
    const useButton = $('#rec-use');
    const examples = $('#goal-examples');

    if (goal.length < 3) {
      text.textContent = 'Describe your goal and we will suggest a session length.';
      useButton.hidden = true;
      examples.hidden = false;
      return;
    }
    const rec = recommendFor(goal);
    text.textContent = rec.text;
    useButton.textContent = 'Use ' + rec.minutes + ' minutes';
    useButton.dataset.minutes = rec.minutes;
    useButton.hidden = getMinutes() === rec.minutes;
    examples.hidden = true;
  }

  function renderStudy() {
    const d = state.draft;
    syncInput($('#subject-input'), d.subject);
    syncInput($('#goal-input'), d.goal);

    $$('input[name="mode"]').forEach(radio => { radio.checked = radio.value === d.mode; });
    $('#custom-row').hidden = d.mode !== 'custom';
    syncInput($('#custom-input'), Number.isFinite(clampMinutes(d.customMinutes)) ? d.customMinutes : '');

    const minutes = getMinutes();
    $('#preview-time').textContent = previewClock(minutes);
    $('#preview-mode').textContent = d.mode === 'custom' ? 'Custom Session' : MODES[d.mode].label;
    $('#preview-break').textContent = Number.isFinite(minutes)
      ? 'Recommended break afterwards: ' + breakInfo(minutes).label
      : 'Enter a length between ' + MIN_MINUTES + ' and ' + MAX_MINUTES + ' minutes.';

    // Remember subjects the student has used before
    const options = $('#subject-options');
    const used = [...new Set(state.sessions.map(s => s.subject))].slice(-12);
    options.replaceChildren(...used.map(name => el('option', { value: name })));

    renderRecommendation();
  }

  // --- Progress ---
  function sessionsOn(key) { return state.sessions.filter(s => s.date === key); }
  function sumMinutes(list) { return list.reduce((total, s) => total + s.minutes, 0); }

  function computeStreak() {
    const days = new Set(state.sessions.filter(s => s.status === 'completed').map(s => s.date));
    let cursor = new Date();
    if (!days.has(dateKey(cursor))) cursor = addDays(cursor, -1);   // streak survives until today ends
    let streak = 0;
    while (days.has(dateKey(cursor))) { streak++; cursor = addDays(cursor, -1); }
    return streak;
  }

  function renderProgress() {
    const today = new Date();
    const todayKey = dateKey(today);
    const todayMinutes = sumMinutes(sessionsOn(todayKey));

    // Last 7 days (today included)
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = addDays(today, -i);
      week.push({ key: dateKey(day), label: day.toLocaleDateString(undefined, { weekday: 'short' }), minutes: sumMinutes(sessionsOn(dateKey(day))) });
    }
    const weekMinutes = week.reduce((total, d) => total + d.minutes, 0);

    const target = Math.max(10, Number(state.settings.dailyTarget) || 120);
    $('#stat-today').textContent = formatLong(todayMinutes);
    $('#today-meter').style.width = Math.min(100, (todayMinutes / target) * 100) + '%';
    $('#stat-today-note').textContent = todayMinutes === 0
      ? 'Nothing yet today. Your daily target is ' + formatLong(target) + '.'
      : todayMinutes >= target ? 'Daily target of ' + formatLong(target) + ' reached.'
      : formatLong(target - todayMinutes) + ' to go for your ' + formatLong(target) + ' target.';

    $('#stat-week').textContent = formatLong(weekMinutes);

    const completed = state.sessions.filter(s => s.status === 'completed');
    const completedToday = completed.filter(s => s.date === todayKey).length;
    $('#stat-sessions').textContent = completed.length;
    $('#stat-sessions-note').textContent = plural(completedToday, 'session') + ' today';

    const streak = computeStreak();
    $('#stat-streak').textContent = plural(streak, 'day');
    $('#stat-streak-note').textContent = streak === 0
      ? 'Finish a session today to start a streak.'
      : completedToday > 0 ? 'Come back tomorrow to keep it going.' : 'Finish a session today to keep it alive.';

    const withGoal = state.sessions.filter(s => s.goal);
    const goalsDone = withGoal.filter(s => s.goalDone);
    $('#stat-goals').textContent = goalsDone.length;
    $('#stat-goals-note').textContent = 'of ' + plural(withGoal.length, 'goal') + ' set';

    // Bar chart
    const maxMinutes = Math.max(30, ...week.map(d => d.minutes));
    $('#week-bars').replaceChildren(...week.map(d => {
      const col = el('div', {
        class: 'bar-col' + (d.key === todayKey ? ' is-today' : ''),
        role: 'img',
        'aria-label': d.label + ': ' + formatLong(d.minutes)
      },
        el('span', { class: 'bar-val', text: d.minutes ? d.minutes + 'm' : '' }),
        el('div', { class: 'bar-area' }, el('div', { class: 'bar', style: '--h:' + Math.round((d.minutes / maxMinutes) * 100) + '%' })),
        el('span', { class: 'bar-day', text: d.label })
      );
      return col;
    }));

    // Subjects studied
    const bySubject = new Map();
    state.sessions.forEach(s => {
      const key = s.subject.trim().toLowerCase();
      const entry = bySubject.get(key) || { name: s.subject, minutes: 0 };
      entry.minutes += s.minutes;
      bySubject.set(key, entry);
    });
    const subjects = [...bySubject.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
    const topMinutes = subjects.length ? subjects[0].minutes : 1;
    const subjectList = $('#subject-stats');
    if (!subjects.length) subjectList.replaceChildren(el('li', { class: 'empty-note', text: 'Subjects you study will appear here.' }));
    else subjectList.replaceChildren(...subjects.map(s => el('li', {},
      el('div', { class: 'subject-row' }, el('span', { text: s.name }), el('span', { text: formatLong(s.minutes) })),
      el('div', { class: 'subject-bar', 'aria-hidden': 'true' }, el('span', { style: 'width:' + Math.round((s.minutes / topMinutes) * 100) + '%' }))
    )));

    // Recent goals reached
    const recentGoals = goalsDone.slice(-5).reverse();
    const goalList = $('#goal-list');
    if (!recentGoals.length) goalList.replaceChildren(el('li', { class: 'empty-note', text: 'After a session, tick "I reached my goal" and it will show up here.' }));
    else goalList.replaceChildren(...recentGoals.map(s => el('li', {}, el('span', { text: s.goal }), el('span', { text: formatDate(s.date) }))));
  }

  // --- History ---
  function renderHistory() {
    const list = state.sessions.slice().reverse().slice(0, 200);
    $('#history-empty').hidden = list.length > 0;
    $('#history-wrap').hidden = list.length === 0;
    $('#clear-history').hidden = list.length === 0;

    $('#history-body').replaceChildren(...list.map(s => {
      const subjectCell = el('div', { class: 'cell-main' }, el('span', { class: 'subject-name', text: s.subject }));
      if (s.goal) subjectCell.append(el('span', { class: 'goal-line', text: 'Goal: ' + s.goal }));
      if (s.goalDone) subjectCell.append(el('span', { class: 'tag tag-ok', text: 'Goal reached' }));

      return el('tr', {},
        el('td', { 'data-label': 'Date', text: formatDate(s.date) }),
        el('td', { 'data-label': 'Subject' }, subjectCell),
        el('td', { 'data-label': 'Duration', text: s.minutes + ' min' }),
        el('td', { 'data-label': 'Status' }, el('span', { class: 'tag' + (s.status === 'completed' ? ' tag-ok' : ''), text: s.status === 'completed' ? 'Completed' : 'Ended early' }))
      );
    }));
  }

  // --- Settings ---
  function updateNotifyHint() {
    const hint = $('#notify-hint');
    if (!('Notification' in window)) hint.textContent = 'This browser does not support notifications.';
    else if (Notification.permission === 'denied') hint.textContent = 'Notifications are blocked. Allow them in your browser\u2019s site settings.';
    else hint.textContent = 'Show a message when a timer ends, even in another tab.';
  }

  function renderSettings() {
    const s = state.settings;
    syncInput($('#set-study'), s.studyMinutes);
    syncInput($('#set-target'), s.dailyTarget);
    $('#set-break').value = String(s.breakMinutes);
    $('#set-sound').checked = s.sound;
    $('#set-notify').checked = s.notifications;
    $('#set-autobreak').checked = s.autoBreak;
    $('#set-autonext').checked = s.autoNext;
    $$('input[name="theme"]').forEach(radio => { radio.checked = radio.value === s.theme; });
    updateNotifyHint();
  }

  // --- Focus mode (full-screen overlay) ---
  function renderFocus() {
    const t = state.timer;
    const focus = $('#focus');
    const wasHidden = focus.hidden;
    focus.hidden = !t;
    document.body.classList.toggle('is-focusing', !!t);
    $('#site-header').inert = !!t;
    $('#main').inert = !!t;

    if (!t) { document.title = BASE_TITLE; return; }

    const isBreak = t.phase === 'break';
    focus.dataset.phase = t.phase;
    focus.dataset.status = t.status;

    $('#focus-phase').textContent = t.status === 'paused' ? 'Paused' : (isBreak ? 'Break' : 'Focus session');
    $('#focus-subject').textContent = isBreak ? 'Time to rest' : t.subject;

    const goalLine = $('#focus-goal');
    goalLine.textContent = !isBreak && t.goal ? 'Today\u2019s goal: ' + t.goal : '';
    goalLine.hidden = isBreak || !t.goal;

    const message = $('#focus-message');
    message.textContent = isBreak ? (t.announceDone ? 'Great job! You completed your study session. ' : '') + REST_MESSAGE : '';
    message.hidden = !isBreak;

    // During a break, offer the "I reached my goal" tick if it was not answered yet
    const goalDone = $('#focus-goal-done');
    goalDone.replaceChildren();
    const finished = isBreak && t.sessionId ? state.sessions.find(s => s.id === t.sessionId) : null;
    if (finished && finished.goal) goalDone.append(goalCheckbox(finished));

    $('#pause-btn').textContent = t.status === 'running' ? 'Pause' : 'Resume';
    $('#focus-extra').hidden = t.status !== 'paused';
    $('#reset-btn').hidden = isBreak;
    $('#skip-btn').textContent = isBreak ? 'Skip break' : 'Skip session';

    updateClock();
    if (wasHidden) $('#pause-btn').focus();
  }

  function updateClock() {
    const t = state.timer;
    if (!t) return;
    const left = remainingMs(t);
    const percent = Math.min(100, Math.max(0, (1 - left / t.totalMs) * 100));
    const text = formatClock(left);

    $('#focus-time').textContent = text;
    $('#focus-arc').style.strokeDashoffset = String(100 - percent);
    $('#focus-progress').textContent = Math.round(percent) + '% complete';
    $('#focus-ring').setAttribute('aria-valuenow', String(Math.round(percent)));
    document.title = text + ' · ' + (t.phase === 'break' ? 'Break' : t.subject) + ' – FocusStudy';
  }

  /* ---------- 9. Event listeners ---------- */

  const ui = { heroCustom: false };   // things that are not worth saving

  function bindEvents() {
    // Hero: quick length chips
    $('#hero-chips').addEventListener('click', event => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      if (chip.hasAttribute('data-custom')) {
        ui.heroCustom = true;
        state.draft.mode = 'custom';
        save();
        renderAll();
        $('#hero-custom-input').focus();
      } else {
        ui.heroCustom = false;
        selectMinutes(Number(chip.dataset.minutes));
        save();
        renderAll();
      }
    });
    $('#hero-custom-input').addEventListener('input', event => {
      state.draft.mode = 'custom';
      state.draft.customMinutes = event.target.value === '' ? NaN : Number(event.target.value);
      save();
      renderHome();
      renderStudy();
    });

    // Study setup
    $('#setup-form').addEventListener('submit', event => event.preventDefault());
    $('#subject-input').addEventListener('input', event => { state.draft.subject = event.target.value; save(); });
    $('#goal-input').addEventListener('input', event => { state.draft.goal = event.target.value; save(); renderStudy(); });
    $('#subject-chips').addEventListener('click', event => {
      const chip = event.target.closest('[data-subject]');
      if (!chip) return;
      state.draft.subject = chip.dataset.subject;
      save();
      renderStudy();
    });
    $('#goal-examples').addEventListener('click', event => {
      const chip = event.target.closest('[data-goal]');
      if (!chip) return;
      state.draft.goal = chip.dataset.goal;
      save();
      renderStudy();
    });
    $$('input[name="mode"]').forEach(radio => radio.addEventListener('change', () => {
      state.draft.mode = radio.value;
      ui.heroCustom = false;
      save();
      renderAll();
      if (radio.value === 'custom') $('#custom-input').focus();
    }));
    $('#custom-input').addEventListener('input', event => {
      state.draft.customMinutes = event.target.value === '' ? NaN : Number(event.target.value);
      $('#start-error').textContent = '';
      save();
      renderStudy();
      renderHome();
    });
    $('#rec-use').addEventListener('click', event => {
      ui.heroCustom = false;
      selectMinutes(Number(event.currentTarget.dataset.minutes));
      save();
      renderAll();
    });
    $('#start-btn').addEventListener('click', startFromSetup);

    // Focus mode controls
    $('#pause-btn').addEventListener('click', togglePause);
    $('#reset-btn').addEventListener('click', resetSession);
    $('#skip-btn').addEventListener('click', skipSession);

    // Theme button in the header
    $('#theme-toggle').addEventListener('click', () => {
      state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
      save();
      applyTheme();
      renderSettings();
    });
    systemDark.addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });

    // Settings
    $('#set-study').addEventListener('input', event => {
      const minutes = clampMinutes(event.target.value);
      if (!Number.isFinite(minutes)) return;
      state.settings.studyMinutes = minutes;
      selectMinutes(minutes);
      ui.heroCustom = false;
      save();
      renderStudy();
      renderHome();
    });
    $('#set-target').addEventListener('input', event => {
      const value = Math.round(Number(event.target.value));
      if (!(value >= 10 && value <= 1000)) return;
      state.settings.dailyTarget = value;
      save();
      renderProgress();
    });
    $('#set-break').addEventListener('change', event => {
      state.settings.breakMinutes = event.target.value === 'auto' ? 'auto' : Number(event.target.value);
      save();
      renderStudy();
    });
    $('#set-sound').addEventListener('change', event => {
      state.settings.sound = event.target.checked;
      save();
      if (event.target.checked) { unlockAudio(); playChime(); }   // quick preview
    });
    $('#set-notify').addEventListener('change', event => {
      state.settings.notifications = event.target.checked;
      save();
      askNotificationPermission();
      updateNotifyHint();
    });
    $('#set-autobreak').addEventListener('change', event => { state.settings.autoBreak = event.target.checked; save(); });
    $('#set-autonext').addEventListener('change', event => { state.settings.autoNext = event.target.checked; save(); });
    $$('input[name="theme"]').forEach(radio => radio.addEventListener('change', () => {
      state.settings.theme = radio.value;
      save();
      applyTheme();
    }));

    // Clearing data
    $('#clear-history').addEventListener('click', () => {
      openDialog({
        title: 'Clear your study history?',
        text: 'This removes every saved session and resets your stats. It cannot be undone.',
        actions: [
          { label: 'Keep my history', kind: 'btn-primary' },
          { label: 'Clear history', kind: 'btn-danger', onClick: () => { state.sessions = []; save(); renderAll(); toast('History cleared.'); } }
        ]
      });
    });
    $('#reset-data').addEventListener('click', () => {
      openDialog({
        title: 'Erase all FocusStudy data?',
        text: 'Your history, stats and settings will be deleted from this browser. It cannot be undone.',
        actions: [
          { label: 'Keep my data', kind: 'btn-primary' },
          { label: 'Erase everything', kind: 'btn-danger', onClick: () => {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            state = loadState();
            ui.heroCustom = false;
            applyTheme();
            renderFocus();
            renderAll();
            toast('All data erased.');
          } }
        ]
      });
    });

    // Navigation + sound unlock
    window.addEventListener('hashchange', () => showView(currentViewFromHash()));
    document.addEventListener('pointerdown', unlockAudio, { once: true });
  }

  /* ---------- 10. Start-up ---------- */

  function init() {
    applyTheme();
    bindEvents();

    // If the timer ran out while the page was closed, finish it now
    const t = state.timer;
    if (t && t.status === 'running' && Date.now() >= t.endsAt) {
      showView(currentViewFromHash());
      finishPhase();
    } else {
      showView(currentViewFromHash());
      renderFocus();
    }

    setInterval(tick, 250);
  }

  init();
})();