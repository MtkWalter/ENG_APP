'use strict';
const $ = id => document.getElementById(id);
let state = {}, result = null, toastTimer, audio = null, speechSequence = 0;
let imageLesson = { image: null, mode: 'conversation', status: 'idle', error: '', message: '' };
let imageRequestPending = false, imageStateSeen = false;
let gameState = { status: 'idle', progress: {} }, gamePending = false, gameQuestionKey = '', gameChoicesKey = '';
let gameLettersKey = '', gamePuzzleKey = '', usedGameLetters = new Set(), gameStateSeen = false;
const imageModeDescriptions = {
  conversation: 'ChatGPT 會先描述圖片，再一次問你一個簡單問題，陪你用英文回答。',
  grammar: '從圖片中的人物與動作練句型，一次造一句，讓 ChatGPT 幫你修正並解釋。',
  quiz: '依照圖片一次出一題，先讓你回答，再說明答案，接著挑戰下一題。',
  vocabulary: '把圖片變成記憶、拼字和句型小遊戲。在右側完成題目，拿星星、解拼圖，還能餵夥伴吃點心。'
};
const imageBusy = () => imageRequestPending || ['preparing', 'uploading', 'sending'].includes(imageLesson.status) || gameState.status === 'waiting';
const selectedImageMode = () => document.querySelector('input[name="image-mode"]:checked').value;
const selectedImageCharacter = () => document.querySelector('input[name="image-character"]:checked').value;
const selectedGameStyle = () => document.querySelector('input[name="image-game-style"]:checked').value;
function showLearningTab(name) {
  for (const tab of ['dictionary', 'image']) {
    const active = tab === name;
    $(tab + '-tab').setAttribute('aria-selected', String(active));
    $(tab + '-tab').tabIndex = active ? 0 : -1;
    $(tab + '-panel').hidden = !active;
  }
}
function renderImageControls() {
  const busy = imageBusy();
  const hasImage = !!imageLesson.image;
  $('image-modes').disabled = busy;
  $('focus').disabled = busy;
  $('image-mode-description').textContent = imageModeDescriptions[selectedImageMode()];
  $('image-characters').hidden = selectedImageMode() !== 'vocabulary';
  $('image-characters').disabled = busy;
  $('image-game-styles').hidden = selectedImageMode() !== 'vocabulary';
  $('image-game-styles').disabled = busy;
  $('image-game').hidden = selectedImageMode() !== 'vocabulary' || gameState.status === 'idle';
  const character = selectedImageCharacter();
  const characterName = character === 'cinnamoroll' ? '大耳狗' : '庫洛米';
  const characterSource = '../../assets/game-' + character + '.png';
  if ($('character-preview').getAttribute('src') !== characterSource) $('character-preview').src = characterSource;
  $('character-preview').alt = characterName + '學習夥伴';
  $('character-name').textContent = characterName + '陪你闖關';
  $('image-pick').disabled = busy;
  $('image-pick').textContent = hasImage ? '更換圖片，開始學習' : '載入圖片，開始學習';
  $('image-start').disabled = busy || !hasImage;
  $('image-start').textContent = selectedImageMode() === 'vocabulary'
    ? gameState.status === 'ready' ? '重新依圖片出題' : '開始圖片遊戲'
    : imageLesson.status === 'sent' && selectedImageMode() === imageLesson.mode ? '重新開始這個模式' : '開始這個模式';
  $('image-clear').disabled = busy;
  $('image-session-actions').hidden = !hasImage;
  $('image-cancel').hidden = !busy;
  $('image-status').parentElement.dataset.busy = String(busy);
  $('image-learning-note').textContent = selectedImageMode() === 'vocabulary'
    ? '圖片會傳到目前登入的 ChatGPT，產生這張圖的遊戲題目，需要網路及可使用圖片的帳號。題目準備好後，直接在右側作答；發音使用 Windows 朗讀，不會自動評分你的聲音。'
    : '圖片會傳到目前登入的 ChatGPT 對話，需要網路及可使用圖片的帳號。對話、文法和測驗可在左側繼續回答；要練口說，可開啟 ChatGPT 語音。';
}
function renderGameControls() {
  const ready = gameState.status === 'ready';
  const answering = ready && !gameState.complete && !gameState.canNext && !gamePending;
  for (const button of $('game-choices').querySelectorAll('button')) button.disabled = !answering;
  for (const button of $('game-letters').querySelectorAll('button')) button.disabled = !answering || usedGameLetters.has(button.dataset.index);
  $('game-answer').disabled = !answering;
  $('game-submit').disabled = !answering;
  $('game-clear-answer').disabled = !answering;
  $('game-hint').disabled = !answering;
  $('game-next').hidden = !gameState.canNext || !!gameState.complete;
  $('game-next').disabled = gamePending;
  $('game-feed').disabled = !ready || !gameState.canFeed || gamePending;
  $('game-restart').disabled = !ready || gamePending;
  $('game-speak').disabled = !ready || !gameState.task || !!gameState.complete;
}
function renderGame(value) {
  if (!value || typeof value !== 'object') return;
  gameStateSeen = true;
  const previousStatus = gameState.status;
  gameState = { status: 'idle', progress: {}, ...value };
  const progress = gameState.progress || {};
  const task = gameState.task;
  const questionKey = [gameState.status, progress.completed, gameState.stage, task?.kind, task?.prompt, task?.word, gameState.canNext, gameState.complete].join('|');
  if (questionKey !== gameQuestionKey) {
    stopSpeech(); $('game-answer').value = ''; usedGameLetters.clear(); $('game-speech-note').hidden = true;
    gameQuestionKey = questionKey;
  }
  const titles = { puzzle: '益智拼圖挑戰', pet: '和夥伴一起長大', quest: '英文任務闖關' };
  $('image-game').dataset.style = ['puzzle', 'pet', 'quest'].includes(gameState.style) ? gameState.style : 'quest';
  $('game-title').textContent = gameState.theme?.title || titles[gameState.style] || titles.quest;
  $('game-status').textContent = gameState.status === 'waiting' ? 'ChatGPT 正在看圖準備題目，完成後就在這裡開始。'
    : gameState.status === 'error' ? '題目暫時沒有準備完成，請重試。'
    : gameState.complete ? '這張圖的挑戰完成了！你可以餵夥伴點心，或再玩一次。'
    : gameState.theme?.instruction || '先記住，再拼字，最後練句型。一次完成一個小挑戰。';
  $('game-error').textContent = gameState.error || gameState.message || '';
  $('game-error').hidden = gameState.status !== 'error' || !$('game-error').textContent;
  $('game-play').hidden = gameState.status !== 'ready';
  const number = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const completed = number(progress.completed), total = number(progress.total);
  $('game-stars').textContent = number(progress.stars);
  $('game-food').textContent = number(progress.food);
  $('game-energy').textContent = number(progress.petEnergy);
  $('game-food').parentElement.hidden = gameState.style !== 'pet';
  $('game-energy').parentElement.hidden = gameState.style !== 'pet';
  $('game-feed').hidden = gameState.style !== 'pet';
  $('game-progress').max = Math.max(1, total); $('game-progress').value = Math.min(completed, total);
  $('game-progress-label').textContent = `${completed} / ${total}`;
  const character = gameState.character === 'cinnamoroll' ? 'cinnamoroll' : 'kuromi';
  const characterName = character === 'cinnamoroll' ? '大耳狗' : '庫洛米';
  const characterSource = '../../assets/game-' + character + '.png';
  if ($('game-pet-image').getAttribute('src') !== characterSource) $('game-pet-image').src = characterSource;
  $('game-pet-image').alt = characterName + '學習夥伴'; $('game-pet-name').textContent = characterName;
  $('game-pet-note').textContent = gameState.style === 'pet'
    ? number(progress.petEnergy) ? `${characterName}收到 ${number(progress.petEnergy)} 份點心，一起繼續挑戰！` : '完成練習賺點心，再親手餵給夥伴。'
    : gameState.style === 'puzzle' ? '找到答案，逐步揭開夥伴的拼圖。' : '記憶、拼字、句型，陪你一關一關前進。';
  $('game-question').hidden = !!gameState.complete || !task;
  $('game-kind').textContent = ({ memory: '記憶配對', spelling: '拼字挑戰', sentence: '句型任務' })[task?.kind] || '英文挑戰';
  for (const step of $('game-stages').querySelectorAll('[data-kind]')) {
    if (step.dataset.kind === task?.kind && !gameState.complete) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  $('game-prompt').textContent = task?.prompt || '';
  $('game-word').textContent = task?.kind === 'memory' ? task.word || '' : '';
  $('game-word').hidden = task?.kind !== 'memory' || !task.word;
  $('game-meaning').textContent = task?.meaning || ''; $('game-meaning').hidden = !task?.meaning;
  $('game-phonetic').textContent = task?.phonetic || ''; $('game-phonetic').hidden = !task?.phonetic;
  $('game-hint-text').textContent = gameState.hint || ''; $('game-hint-text').hidden = !gameState.hint;
  const choices = Array.isArray(task?.choices) ? task.choices.filter(choice => typeof choice === 'string').slice(0, 8) : [];
  const choicesKey = JSON.stringify(choices);
  if (choicesKey !== gameChoicesKey) {
    $('game-choices').replaceChildren();
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice;
      button.addEventListener('click', () => gameAction(() => window.milo.answerGame(choice)));
      $('game-choices').appendChild(button);
    }
    gameChoicesKey = choicesKey;
  }
  $('game-choices').hidden = !choices.length;
  $('game-answer-form').hidden = !!choices.length;
  const letters = task?.kind === 'spelling' && Array.isArray(task.letters) ? task.letters.filter(letter => typeof letter === 'string' && /^[a-z'-]$/i.test(letter)).slice(0, 40) : [];
  const lettersKey = JSON.stringify(letters);
  if (lettersKey !== gameLettersKey) {
    $('game-letters').replaceChildren();
    letters.forEach((letter, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = letter; button.dataset.index = String(index);
      button.addEventListener('click', () => {
        if (button.disabled) return;
        usedGameLetters.add(button.dataset.index); $('game-answer').value += letter; renderGameControls();
      });
      $('game-letters').appendChild(button);
    });
    gameLettersKey = lettersKey;
  }
  $('game-letters').hidden = !letters.length;
  $('game-clear-answer').hidden = !letters.length;
  $('game-answer').placeholder = task?.kind === 'sentence' ? '填入缺少的英文單字或片語' : '聽一聽，再拼出英文單字';
  $('game-feedback').textContent = gameState.feedback?.message || '';
  $('game-feedback').hidden = !gameState.feedback?.message;
  $('game-feedback').dataset.correct = String(!!gameState.feedback?.correct);
  $('game-explanation').textContent = gameState.feedback?.explanation || '';
  $('game-explanation').hidden = !gameState.feedback?.explanation;
  $('game-example').textContent = gameState.feedback?.example ? '例句：' + gameState.feedback.example : '';
  $('game-example').hidden = !gameState.feedback?.example;
  const pieces = gameState.puzzle || {};
  const pieceTotal = Math.min(24, Math.floor(number(pieces.total)));
  const revealed = Math.min(pieceTotal, Math.floor(number(pieces.revealed)));
  const hasPuzzle = gameState.style === 'puzzle' && pieceTotal > 0;
  $('game-puzzle').hidden = !hasPuzzle;
  const puzzleKey = hasPuzzle ? `${characterSource}|${pieceTotal}|${revealed}` : '';
  // Feedback, hints and feeding do not change the picture. Keep its existing
  // tiles, and never create hidden artwork for the other two play styles.
  if (puzzleKey !== gamePuzzleKey) {
    const pieceNodes = [];
    if (hasPuzzle) {
      let columns = Math.max(1, Math.ceil(Math.sqrt(pieceTotal)));
      while (pieceTotal % columns) columns--;
      const rows = pieceTotal / columns;
      $('game-puzzle-grid').style.gridTemplateColumns = `repeat(${columns},1fr)`;
      $('game-puzzle-grid').style.gridTemplateRows = `repeat(${rows},1fr)`;
      for (let i = 0; i < pieceTotal; i++) {
        const piece = document.createElement('span'); piece.className = 'puzzle-piece'; piece.setAttribute('aria-hidden', 'true');
        if (i < revealed) {
          piece.dataset.revealed = 'true'; piece.style.backgroundImage = `url("${characterSource}")`;
          piece.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
          piece.style.backgroundPosition = `${columns === 1 ? 0 : (i % columns) * 100 / (columns - 1)}% ${rows === 1 ? 0 : Math.floor(i / columns) * 100 / (rows - 1)}%`;
        } else piece.textContent = '?';
        pieceNodes.push(piece);
      }
    }
    $('game-puzzle-grid').replaceChildren(...pieceNodes); gamePuzzleKey = puzzleKey;
  }
  $('game-puzzle-label').textContent = `已揭開 ${revealed} / ${pieceTotal} 片拼圖`;
  renderGameControls(); renderImageControls();
  if (previousStatus === 'waiting' && gameState.status === 'ready' && !$('image-panel').hidden && selectedImageMode() === 'vocabulary') {
    requestAnimationFrame(() => $('image-game').scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  }
}
async function gameAction(action) {
  if (gamePending || gameState.status !== 'ready') return;
  gamePending = true; renderGameControls();
  try { const response = await action(); if (response?.error) toast(response.error); }
  catch { toast('這個操作暫時無法完成，請再試一次。'); }
  finally { gamePending = false; renderGameControls(); }
}
function renderImageLesson(value) {
  if (!value || typeof value !== 'object') return;
  imageLesson = { image: null, mode: 'conversation', status: 'idle', error: '', message: '', ...value };
  imageStateSeen = true;
  const image = imageLesson.image;
  $('image-preview-card').hidden = !image;
  const preview = typeof image?.preview === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(image.preview) ? image.preview : '';
  if ($('image-preview').getAttribute('src') !== preview) {
    if (preview) $('image-preview').src = preview;
    else $('image-preview').removeAttribute('src');
  }
  $('image-name').textContent = image?.name || '練習圖片';
  $('image-metadata').textContent = Number.isFinite(image?.width) && Number.isFinite(image?.height) ? `${image.width} × ${image.height}` : '';
  const messages = {
    idle: image ? '圖片已載入，選好模式後即可開始。' : '準備好圖片後，按上方按鈕開始。',
    preparing: '正在準備圖片…', uploading: '正在將圖片加入 ChatGPT…',
    sending: '正在傳送圖片與學習指令…',
    sent: '學習指令已送出。請在左側查看 ChatGPT 回覆，繼續練習。',
    error: '這次操作尚未完成，請查看下方說明後重試。', cancelled: '已取消本次操作。'
  };
  $('image-status').textContent = imageLesson.message || messages[imageLesson.status] || messages.idle;
  $('image-error').textContent = imageLesson.error || '';
  $('image-error').hidden = !imageLesson.error;
  $('image-status').parentElement.dataset.error = String(!!imageLesson.error);
  renderImageControls();
}
async function imageAction(action) {
  if (imageBusy()) return;
  imageRequestPending = true; renderImageControls();
  try {
    const response = await action();
    if (response?.error) renderImageLesson({ ...imageLesson, status: 'error', error: response.error, message: '' });
  } catch {
    renderImageLesson({ ...imageLesson, status: 'error', error: '圖片學習暫時無法啟動，請重試。', message: '' });
  } finally { imageRequestPending = false; renderImageControls(); }
}
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
  if (state.imageLesson && !imageStateSeen) renderImageLesson(state.imageLesson);
  if (state.game && !gameStateSeen) renderGame(state.game);
}
function stopSpeech() {
  speechSequence++;
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
  void window.milo.stopSpeech();
}
function renderLookup(value) {
  const newSelection = !!value && value.id !== result?.id;
  if (!value || value.id !== result?.id) stopSpeech();
  result = value;
  $('lookup').hidden = !value; $('welcome').hidden = !!value;
  $('translation-error').hidden = true;
  $('speech-note').textContent = '';
  if (!value) return;
  if (newSelection) showLearningTab('dictionary');
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
async function speakGame() {
  if (gameState.status !== 'ready' || !gameState.task || gameState.complete) return;
  stopSpeech();
  const token = speechSequence;
  const note = text => { if (token === speechSequence) { $('game-speech-note').textContent = text; $('game-speech-note').hidden = false; } };
  note('正在準備 Windows 朗讀…');
  try {
    const response = await window.milo.speakGame();
    if (token !== speechSequence || !response) return;
    if (response.error) { note(response.error); return; }
    const player = new Audio('data:audio/wav;base64,' + response.audio);
    audio = player; player.volume = 1;
    player.onended = () => note('換你開口跟讀一次！');
    player.onerror = () => note('聲音無法播放，請檢查 Windows 的 Milo 音量與輸出裝置。');
    await player.play();
    if (token !== speechSequence) { player.pause(); return; }
    note('仔細聽，再跟著唸；這裡不會自動評分你的發音。');
  } catch { note('朗讀暫時無法播放，請稍後重試。'); }
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
for (const name of ['dictionary', 'image']) {
  $(name + '-tab').addEventListener('click', () => showLearningTab(name));
  $(name + '-tab').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'dictionary' : event.key === 'End' ? 'image' : name === 'dictionary' ? 'image' : 'dictionary';
    showLearningTab(next); $(next + '-tab').focus();
  });
}
$('image-learning').addEventListener('click', () => { showLearningTab('image'); $('image-pick').focus(); });
$('image-modes').addEventListener('change', renderImageControls);
$('image-characters').addEventListener('change', renderImageControls);
$('image-game-styles').addEventListener('change', renderImageControls);
$('image-pick').addEventListener('click', () => imageAction(() => window.milo.pickImage(selectedImageMode(), selectedImageCharacter(), selectedGameStyle())));
$('image-start').addEventListener('click', () => imageAction(() => window.milo.startImageLesson(selectedImageMode(), selectedImageCharacter(), selectedGameStyle())));
$('image-clear').addEventListener('click', () => imageAction(() => window.milo.clearImage()));
$('image-cancel').addEventListener('click', async () => {
  try { await window.milo.cancelImageLesson(); }
  catch { toast('暫時無法取消，請稍後重試。'); }
});
$('game-answer-form').addEventListener('submit', event => { event.preventDefault(); if (!$('game-submit').disabled) void gameAction(() => window.milo.answerGame($('game-answer').value)); });
$('game-clear-answer').addEventListener('click', () => { $('game-answer').value = ''; usedGameLetters.clear(); renderGameControls(); $('game-answer').focus(); });
$('game-hint').addEventListener('click', () => gameAction(() => window.milo.hintGame()));
$('game-next').addEventListener('click', () => gameAction(() => window.milo.nextGame()));
$('game-feed').addEventListener('click', () => gameAction(() => window.milo.feedGame()));
$('game-restart').addEventListener('click', () => gameAction(() => window.milo.restartGame(selectedGameStyle(), selectedImageCharacter())));
$('game-speak').addEventListener('click', speakGame);
$('game-stop').addEventListener('click', () => { stopSpeech(); $('game-speech-note').textContent = '已停止朗讀。'; $('game-speech-note').hidden = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.milo.clear(); });
window.addEventListener('beforeunload', stopSpeech);
window.milo.on(({ type, data }) => {
  if (type === 'state') renderState(data);
  if (type === 'lookup') renderLookup(data);
  if (type === 'notice') toast(data);
  if (type === 'stop-speech') stopSpeech();
  if (type === 'focus-search') { showLearningTab('dictionary'); $('search').focus(); $('search').select(); }
  if (type === 'image-lesson') renderImageLesson(data);
  if (type === 'game') renderGame(data);
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
