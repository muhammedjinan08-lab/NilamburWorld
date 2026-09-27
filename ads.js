/**
 * ads.js - advertising, placed only where the player has chosen to look or is already waiting:
 *
 *  Rewarded (the player chooses to watch):   Google H5 Games Ads - Ad Placement API, adBreak type 'reward'
 *    - "Watch a short ad for ₹300 cash" on the Jobs board and at the bank ATM (limited per hour)
 *    - a free helicopter flight instead of the ₹500 fee
 *    - an instant restock of a sold-out shop item
 *  Interstitials at natural pauses (never more than one every few minutes):   adBreak 'next' / 'browse'
 *    - the football full-time pause, after getting off the train, after fast travel
 *  Display units (AdSense <ins> units) in screens the player opened:
 *    - beside the character creator while the world loads
 *    - a strip at the bottom of the full map, the Jobs board and the bag
 *    - inside the ☰ panel menu on phones
 *
 * SETUP: fill in ADS_CONFIG below once Google has approved the site for AdSense and for H5 Games Ads
 * (https://adsense.google.com - apply for "H5 Games Ads" / Ad Placement API). Until then:
 *  - on localhost (or with ?adpreview=1) every placement shows a clearly-labelled PREVIEW so the flows
 *    can be tried, and preview rewards are granted;
 *  - anywhere else (e.g. the public GitHub Pages copy) ads and ad offers are hidden completely.
 * Loaded after economy.js / motors.js, before main.js.
 */

const ADS_CONFIG = {
  client: '',                 // your AdSense publisher id, e.g. 'ca-pub-0000000000000000'
  testMode: true,             // H5 Games Ads test ads (data-adbreak-test="on") - set false when live
  slots: {                    // AdSense display ad unit ids (data-ad-slot), one per placement
    start: '', map: '', jobs: '', bag: '', menu: ''
  },
  rewardCash: 300,            // cash for watching a rewarded ad
  rewardCashPerHour: 5,       // at most this many cash rewards per hour
  interstitialGapSec: 180,    // at least this long between interstitials
  firstInterstitialAfterSec: 120
};

const ADS = (() => {
  const q = new URLSearchParams(location.search);
  const live = !!ADS_CONFIG.client;
  const preview = !live && (q.get('adpreview') === '1' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) && q.get('adpreview') !== '0';
  return { live: live, preview: preview, enabled: live || preview, ready: false, playing: false, lastInterstitial: 0, startedAt: Date.now() };
})();

// ---------- Google H5 Games Ads loader ----------
window.adsbygoogle = window.adsbygoogle || [];
const adBreak = window.adBreak = window.adBreak || function (o) { window.adsbygoogle.push(o); };
const adConfig = window.adConfig = window.adConfig || function (o) { window.adsbygoogle.push(o); };
if (ADS.live) {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS_CONFIG.client);
  s.crossOrigin = 'anonymous';
  s.setAttribute('data-ad-client', ADS_CONFIG.client);
  s.setAttribute('data-ad-frequency-hint', ADS_CONFIG.interstitialGapSec + 's');
  if (ADS_CONFIG.testMode) s.setAttribute('data-adbreak-test', 'on');
  document.head.appendChild(s);
  adConfig({ preloadAdBreaks: 'on', sound: 'on', onReady: () => { ADS.ready = true; } });
}
if (ADS.enabled) document.body.classList.add('ads-on');

// ---------- Pausing the game around an ad ----------
let _adMuteWas = null;
function adPauseGame() {
  ADS.playing = true;
  if (typeof keyState !== 'undefined') for (const k in keyState) keyState[k] = false;
  if (window.touchAxis) { window.touchAxis.x = 0; window.touchAxis.y = 0; }
  if (typeof audioNodes !== 'undefined' && audioNodes && audioCtx) { _adMuteWas = audioNodes.master.gain.value; audioNodes.master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05); }
}
function adResumeGame() {
  ADS.playing = false;
  if (_adMuteWas !== null && typeof audioNodes !== 'undefined' && audioNodes && audioCtx && !state.audioMuted) audioNodes.master.gain.setTargetAtTime(_adMuteWas, audioCtx.currentTime, 0.2);
  _adMuteWas = null;
}

// ---------- Preview ads (no ad account configured yet) ----------
function previewAd(kind, seconds, done) {
  const o = document.createElement('div');
  o.className = 'ad-preview-overlay';
  o.innerHTML = '<div class="ad-preview-box"><div class="ad-preview-tag">AD PREVIEW</div><div class="ad-preview-title"></div>' +
    '<div class="ad-preview-text">A real ' + (kind === 'reward' ? 'rewarded' : 'full-screen') + ' ad from Google would play here once ADS_CONFIG (ads.js) has your AdSense id.</div>' +
    '<div class="ad-preview-count"></div><button type="button" class="btn-teleport ad-preview-close"></button></div>';
  document.body.appendChild(o);
  const title = o.querySelector('.ad-preview-title'), count = o.querySelector('.ad-preview-count'), close = o.querySelector('.ad-preview-close');
  title.textContent = kind === 'reward' ? 'Rewarded video' : 'Interstitial';
  let left = seconds, finished = false;
  const end = (viewed) => { clearInterval(t); o.remove(); adResumeGame(); done(viewed); };
  close.textContent = kind === 'reward' ? 'Skip (no reward)' : 'Close';
  close.onclick = () => end(finished || kind !== 'reward');
  const t = setInterval(() => {
    left--;
    count.textContent = left > 0 ? left + ' s' : '';
    if (left <= 0 && !finished) { finished = true; close.textContent = kind === 'reward' ? 'Collect reward' : 'Continue'; }
  }, 1000);
  count.textContent = left + ' s';
  adPauseGame();
}

// ---------- Rewarded ads ----------
// onReward runs only when the ad was actually watched; onFail(reason) otherwise.
function showRewarded(name, onReward, onFail) {
  if (!ADS.enabled || ADS.playing) { if (onFail) onFail('unavailable'); return; }
  if (ADS.preview) { previewAd('reward', 5, (viewed) => { if (viewed) onReward(); else if (onFail) onFail('dismissed'); }); return; }
  let granted = false;
  adBreak({
    type: 'reward', name: name,
    beforeAd: adPauseGame, afterAd: adResumeGame,
    beforeReward: (showAdFn) => showAdFn(),   // the player already chose to watch
    adDismissed: () => {}, adViewed: () => { granted = true; },
    adBreakDone: (info) => {
      if (granted) onReward();
      else if (onFail) onFail(info && info.breakStatus === 'dismissed' ? 'dismissed' : 'noad');
    }
  });
}
function adFailMessage(reason) {
  if (reason === 'dismissed') return 'The ad was closed before the end, so no reward this time.';
  return 'No ad is available right now - please try again in a little while.';
}

// Cash rewards are capped per hour (stored per browser)
const ADS_LS = 'nw_ads_v1';
function adCashLog() { try { return (JSON.parse(localStorage.getItem(ADS_LS) || '{}').cash || []).filter(t => Date.now() - t < 3600000); } catch (e) { return []; } }
function adCashLeft() { return ADS_CONFIG.rewardCashPerHour - adCashLog().length; }
function watchAdForCash(where) {
  if (adCashLeft() <= 0) {
    const next = Math.ceil((3600000 - (Date.now() - adCashLog()[0])) / 60000);
    triggerLandmarkPopup('📺 That\'s enough ads for now', 'You can watch another ad for cash in about ' + next + ' min. Jobs always pay!');
    return;
  }
  showRewarded('cash_' + where, () => {
    const log = adCashLog(); log.push(Date.now());
    try { localStorage.setItem(ADS_LS, JSON.stringify({ cash: log })); } catch (e) { /* private mode */ }
    earnCash(ADS_CONFIG.rewardCash);
    triggerLandmarkPopup('📺 Thanks for watching!', fmtRs(ADS_CONFIG.rewardCash) + ' cash added. ' + adCashLeft() + ' more ad rewards available this hour.');
    if (typeof _jobsOpen !== 'undefined' && _jobsOpen) renderJobs();
  }, (r) => triggerLandmarkPopup('📺 No reward', adFailMessage(r)));
}

// A small choice dialog (helicopter fee, ATM)
function adChoice(title, text, buttons) {
  closeEconModals();
  const m = document.getElementById('adchoice-modal');
  document.getElementById('adchoice-title').textContent = title;
  document.getElementById('adchoice-text').textContent = text;
  const row = document.getElementById('adchoice-buttons'); row.textContent = '';
  buttons.forEach(b => {
    const e = document.createElement('button'); e.type = 'button'; e.className = 'btn-teleport' + (b.primary ? ' primary' : '');
    e.textContent = b.label; e.disabled = !!b.disabled;
    e.onclick = () => { m.classList.remove('open'); if (b.fn) b.fn(); };
    row.appendChild(e);
  });
  if (typeof keyState !== 'undefined') for (const k in keyState) keyState[k] = false;
  m.classList.add('open');
}
function adChoiceOpen() { const m = document.getElementById('adchoice-modal'); return !!(m && m.classList.contains('open')); }

function atmWithAds() {
  const left = adCashLeft();
  adChoice('🏧 Nilambur Co-op Bank ATM', 'Your account is empty - Nilambur runs on cash, and you have ' + fmtRs(econ.cash) + '. Earn from the 💼 Jobs board, or watch a short ad for ' + fmtRs(ADS_CONFIG.rewardCash) + '.' + (left > 0 ? '' : ' (Ad rewards used up for this hour.)'), [
    { label: '▶ Watch an ad for ' + fmtRs(ADS_CONFIG.rewardCash), primary: true, disabled: left <= 0, fn: () => watchAdForCash('atm') },
    { label: '💼 Open the Jobs board', fn: () => openJobs() },
    { label: 'Close' }
  ]);
}

// Helicopter: pay the fee, or watch an ad for a free flight
function heliChoice(v, fee) {
  adChoice('🚁 Nilambur Heli Services', 'A joy ride anywhere over Nilambur. The flight fee is ' + fmtRs(fee) + ' cash (you have ' + fmtRs(econ.cash) + ') - or watch a short ad and fly free.', [
    { label: '▶ Watch an ad - fly free', primary: true, fn: () => showRewarded('free_heli', () => { v.paid = true; boardHeliNow(v); }, (r) => triggerLandmarkPopup('📺 No free flight', adFailMessage(r))) },
    { label: 'Pay ' + fmtRs(fee) + ' cash', disabled: econ.cash < fee, fn: () => { if (spendCash(fee)) { v.paid = true; boardHeliNow(v); } } },
    { label: 'Cancel' }
  ]);
}
function boardHeliNow(v) {
  if (v.occupied || state.driving) return;
  if (Math.hypot(state.playerPos.x - v.x, state.playerPos.z - v.z) > v.radius + ENTER_RANGE + 2) { triggerLandmarkPopup('🚁 Ready to fly', 'Your flight is paid - walk up to the helicopter and press E.'); return; }
  enterVehicle(v);
}

// Restock a sold-out shop item (called from economy.js's shop counter)
function restockWithAd(shop, item, after) {
  showRewarded('restock', () => {
    item.left = item.stock;
    shop.listeners.forEach(f => f(shop));
    triggerLandmarkPopup('📦 Restocked!', item.name + ' is back on the shelf - thanks for watching.');
    if (after) after();
  }, (r) => { triggerLandmarkPopup('📺 No restock', adFailMessage(r)); if (after) after(); });
}

// ---------- Interstitials at natural pauses ----------
function showInterstitial(name, type) {
  if (!ADS.enabled || ADS.playing) return;
  const now = Date.now();
  if (now - ADS.startedAt < ADS_CONFIG.firstInterstitialAfterSec * 1000) return;
  if (now - ADS.lastInterstitial < ADS_CONFIG.interstitialGapSec * 1000) return;
  if (typeof state !== 'undefined' && (state.driving || (typeof fbPlaying === 'function' && fbPlaying()))) return;   // never mid-drive or mid-match
  ADS.lastInterstitial = now;
  if (ADS.preview) { previewAd('interstitial', 3, () => {}); return; }
  adBreak({ type: type || 'next', name: name, beforeAd: adPauseGame, afterAd: adResumeGame });
}

// ---------- Display units ----------
function mountDisplayAd(el) {
  if (!ADS.enabled || el.dataset.mounted) return;
  const key = el.dataset.ad, slot = ADS_CONFIG.slots[key];
  if (ADS.live) {
    if (!slot) return;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', ADS_CONFIG.client);
    ins.setAttribute('data-ad-slot', slot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked */ }
  } else {
    const p = document.createElement('div');
    p.className = 'ad-preview-unit';
    p.textContent = 'Advertisement · preview (' + key + ')';
    el.appendChild(p);
  }
  el.dataset.mounted = '1';
  el.classList.add('mounted');
}
// AdSense needs a visible, sized container: mount each unit the first time its screen opens
function watchAdSlots() {
  if (!ADS.enabled) return;
  const tryMount = () => document.querySelectorAll('.ad-slot:not([data-mounted])').forEach(el => { if (el.offsetWidth > 0 && el.offsetParent !== null) mountDisplayAd(el); });
  new MutationObserver(tryMount).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  tryMount();
}
window.addEventListener('DOMContentLoaded', watchAdSlots);
