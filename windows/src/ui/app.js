'use strict';
const $ = id => document.getElementById(id);
let state = {}, result = null, toastTimer, audio = null, speechSequence = 0;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
function bounds() {
  const box = $('chat-host').getBoundingClientRect();
  window.milo.bounds({ x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 });
}
function renderState(value) {
  state = value;
  $('zoom').textContent = Math.round(state.zoom * 100) + '%';
  $('focus').setAttribute('aria-pressed', String(state.focus));
  $('mode-label').textContent = state.focus ? '語音學習空間' : '完整網站介面';
  $('version').textContent = 'v' + state.version + ' · WINDOWS';
  $('connection').textContent = state.error ? '連線中斷' : state.loading ? '正在連線…' : '學習空間';
  $('chat-heading').textContent = state.error ? '連線暫時中斷' : '準備開始對話';
  $('chat-message').textContent = state.error || '登入 ChatGPT 後，點選網站的語音按鈕，就能開始練習英文。';
  $('dictionary-status').textContent = state.dictionary ? '● 離線字典已就緒 · 125,112 筆 KK / 100,497 筆中文' : '● 正在載入離線字典';
  $('model-state').textContent = state.preparing ? '下載 / 初始化中' : state.translationReady ? '已下載' : '首次需下載';
  $('model-dot').classList.toggle('ready', state.translationReady);
  $('model-description').textContent = state.translationReady ? '在本機翻譯，文字不會送到模型下載服務。可離線使用。' : '首次下載約 120 MB；之後在本機翻譯，不需要 API key。';
  $('download').textContent = state.preparing ? '正在準備離線模型…' : state.translationReady ? '重新檢查 / 下載模型' : '下載離線模型（約 120 MB）';
  $('download').disabled = state.preparing;
  if (!state.preparing) $('progress').hidden = true;
}
function stopSpeech() {
  speechSequence++;
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
  void window.milo.stopSpeech();
}
function renderLookup(value) {
  if (!value || value.id !== result?.id) stopSpeech();
  result = value;
  $('lookup').hidden = !value; $('welcome').hidden = !!value;
  $('translation-error').hidden = true;
  $('speech-note').textContent = '';
  if (!value) return;
  $('lookup').classList.toggle('sentence', value.kind === 'sentence');
  $('lookup-kind').textContent = value.kind === 'word' ? 'WORD EXPLORER' : 'SENTENCE EXPLORER';
  $('english').textContent = value.text;
  $('kk').hidden = value.kind !== 'word';
  $('kk').textContent = value.kk || '此單字尚未收錄 KK 音標';
  $('kk').classList.toggle('missing', !value.kk);
  $('chinese').textContent = value.chinese || (state.translationReady ? '準備離線翻譯…' : value.kind === 'word' ? '字典尚未收錄中文釋義。下載下方模型後可翻譯。' : '請先下載下方離線模型，即可翻譯整句。');
  $('definition-label').textContent = value.translated ? '本機模型翻譯 · 繁體中文' : '繁體中文';
  $('source').textContent = value.translated ? 'OPUS-MT / OpenCC · 模型翻譯可能不準確，請配合上下文閱讀。' : value.kind === 'sentence' ? '離線模型提供整句翻譯；句子不顯示 KK 音標。' : 'KK：CMUdict 美式發音轉寫；與出版社字典的標法可能不同。\n中文：ECDICT 字典釋義，不代表上下文中的唯一意思。';
}
async function speak(rate, test = false) {
  if (!result && !test) return;
  stopSpeech();
  const token = speechSequence;
  const note = text => { if (test) toast(text); else $('speech-note').textContent = text; };
  note('正在準備 Windows 朗讀…');
  try {
    const response = await (test ? window.milo.testSpeech() : window.milo.speech(result.id));
    if (token !== speechSequence || !response) return;
    if (response.error) { note(response.error); return; }
    const player = new Audio('data:audio/wav;base64,' + response.audio);
    audio = player; player.volume = 1; player.playbackRate = rate; player.preservesPitch = true;
    player.onended = () => { if (token === speechSequence) note('朗讀完成'); };
    player.onerror = () => { if (token === speechSequence) note('聲音無法播放。請檢查 Windows 音量混音器內 Milo 的音量與輸出裝置。'); };
    await player.play();
    if (token !== speechSequence) { player.pause(); return; }
    note(response.english ? '正在朗讀 · ' + response.voice : '使用 Windows 預設語音朗讀；可安裝英文語音改善發音。');
  } catch {
    if (token === speechSequence) note('聲音無法播放。請檢查 Windows 音量混音器內 Milo 的音量與輸出裝置。');
  }
}
for (const name of ['new', 'reload', 'browser', 'smaller', 'larger', 'focus', 'microphone', 'licenses']) {
  $(name).addEventListener('click', () => window.milo.action(name));
}
$('retry').addEventListener('click', () => window.milo.action('reload'));
$('search-form').addEventListener('submit', async event => {
  event.preventDefault(); $('search-error').hidden = true;
  const response = await window.milo.lookup($('search').value);
  if (response.error) { $('search-error').textContent = response.error; $('search-error').hidden = false; }
});
$('clear').addEventListener('click', () => window.milo.clear());
$('speak').addEventListener('click', () => speak(1));
$('slow').addEventListener('click', () => speak(0.5));
$('stop').addEventListener('click', stopSpeech);
$('test-speech').addEventListener('click', () => speak(1, true));
$('download').addEventListener('click', () => window.milo.prepareTranslation());
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.milo.clear(); });
window.addEventListener('beforeunload', stopSpeech);
window.milo.on(({ type, data }) => {
  if (type === 'state') renderState(data);
  if (type === 'lookup') renderLookup(data);
  if (type === 'notice') toast(data);
  if (type === 'stop-speech') stopSpeech();
  if (type === 'focus-search') { $('search').focus(); $('search').select(); }
  if (type === 'progress') {
    $('progress').hidden = false;
    const file = String(data.file || '').split('/').pop();
    $('progress').textContent = data.done ? `${file} · 已下載` : data.total ? `${file} · ${data.progress}% / ${Math.ceil(data.total / 1048576)} MB` : `${file} · 已接收 ${Math.ceil(data.loaded / 1048576)} MB`;
  }
  if (type === 'translation' && result?.id === data.id) {
    if (data.busy) $('chinese').textContent = '正在這台電腦翻譯…';
    if (data.error) { $('chinese').textContent = '翻譯暫時無法完成。'; $('translation-error').textContent = data.error; $('translation-error').hidden = false; }
  }
});
window.milo.state().then(renderState);
new ResizeObserver(bounds).observe($('chat-host'));
window.addEventListener('resize', bounds);
bounds();
