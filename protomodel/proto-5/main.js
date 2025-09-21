/*
  main.js — タイプ練習の中枢ロジック
  概要:
  - Dvorak配列の仮想キーボードを生成（クリック入力対応）
  - 英文/CLIの課題文から1行分だけを画面幅にフィットさせて表示
  - 入力評価は逐次1文字: 正解=黒 / ミス=赤 / 未入力=灰
  - 物理キーボード・仮想キーボードの両方をサポート
  - 文末入力完了後は自動で次の課題へ
*/
// ===== Dvorak配列 =====
const DVORAK_NUMBER_ROW = ["`","1","2","3","4","5","6","7","8","9","0","[","]"];
const DVORAK_ROW1 = ["'", ",", ".", "p","y","f","g","c","r","l","/","=","\\"];
const DVORAK_ROW2 = ["a","o","e","u","i","d","h","t","n","s","-"];
const DVORAK_ROW3 = [";","q","j","k","x","b","m","w","v","z"];

// ===== 課題文 =====
// ===== 状態 =====
// sourceWords    : 教材本文の全単語を線形に保持
// flatText       : 実際に1行表示される文字列（画面幅に合わせて末尾カット）
// cursor         : flatText 上での現在位置（0..length）
// marks[]        : 0=未入力 / 1=正解 / -1=ミス（renderTextで色分け）
// shiftSticky    : 仮想Shiftのトグル（1打鍵で自動解除）
// shiftPhysical  : 物理Shiftの押下状態
const DEFAULT_TEXT_PATH = 'default.txt';
const DEFAULT_TEXT_FALLBACK = '## Presentation01\nBecause Japan is surrounded by the sea, and 67% of its land area is mountainous, there are numerous scenic spots in Japan.';
let currentFileName = '';

// 共通：候補単語列（教材内の本文全体を単語化）
let exercises = [];          // string[]（教材テキスト）
let sourceWords = [];        // string[]（本文の単語列）
let wordsOffset = 0;         // 現在行の先頭に対応する語インデックス
let flatText = "";          // 現在行のテキスト
let cursor = 0;              // 現在行のカーソル位置（0..length）
let marks = [];              // 0:未入力 / 1:正解 / -1:ミス
let currentWordCount = 0;    // 現在行に含まれる語数
let historyHTML = "";       // 直前に完了した行のHTML（履歴表示用）
let nextPreview1 = "";      // 次行のプレビューテキスト
let nextPreview2 = "";      // 次々行のプレビューテキスト

let typingStartTime = null;  // タイピング開始時刻（ms）
let typingEndTime = null;    // タイピング完了時刻（ms）
let totalRequiredChars = 0;  // 教材全体の入力すべき文字数（スペース含む）

// Shift系
let shiftSticky = false;
let shiftPhysical = false;

// ===== 要素 =====
const textEl = document.getElementById("text");
const keyboardEl = document.getElementById("keyboard");
const filePicker = document.getElementById("filePicker");
const fileStatus = document.getElementById("fileStatus");
const dlBtn = document.getElementById("dlBtn");

// ===== ユーティリティ =====
// clamp         : 数値の範囲制限
// cssEscape     : data属性用の安全なセレクタ化
// SHIFT_MAP     : Shift押下時の置換表
// REVERSE_SHIFT_MAP: 記号→ベースキーの逆引き
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const cssEscape = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
const SHIFT_MAP = {"1":"!","2":"@","3":"#","4":"$","5":"%","6":"^","7":"&","8":"*","9":"(","0":")","[":"{","]":"}","`":"~","-":"_","=":"+","/":"?","\\":"|",";":":",",":"<",".":">","'":"\""};
const REVERSE_SHIFT_MAP = Object.fromEntries(Object.entries(SHIFT_MAP).map(([k,v])=>[v,k]));
function escapeHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function nowMs(){
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function resetTypingMetrics(){
  typingStartTime = null;
  typingEndTime = null;
}
function ensureTypingStarted(){
  if(typingStartTime == null){
    typingStartTime = nowMs();
  }
}
function markTypingCompleted(){
  if(typingStartTime == null) return null;
  if(typingEndTime == null){
    typingEndTime = nowMs();
  }
  return typingEndTime - typingStartTime;
}
function formatDuration(ms){
  if(!(ms >= 0)) return '0秒';
  if(ms < 60000){
    const seconds = ms / 1000;
    const digits = seconds < 10 ? 2 : 1;
    const display = Number(seconds.toFixed(digits)).toString();
    return `${display}秒`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if(hours) parts.push(`${hours}時間`);
  parts.push(`${minutes}分`);
  parts.push(`${seconds}秒`);
  return parts.join('');
}
function buildCompletionSummary(){
  const elapsed = markTypingCompleted();
  if(elapsed == null) return '';
  const durationLabel = formatDuration(elapsed);
  let summary = ` 所要 ${durationLabel}`;
  if(totalRequiredChars <= 0 || elapsed <= 0){
    summary += ' / WPM算出不可';
  }else{
    const minutes = elapsed / 60000;
    const rawWpm = minutes > 0 ? (totalRequiredChars / 5) / minutes : 0;
    const rounded = Math.round(rawWpm * 10) / 10;
    summary += ` / ${rounded.toFixed(1)} WPM`;
  }
  return summary;
}

// ===== データ読み込み =====
function showStatusMessage(message){
  if(!textEl) return;
  textEl.innerHTML = `<div class="line status">${escapeHTML(message)}</div>`;
}

function parseCompiledText(raw, fallbackHeading='Text'){
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let currentHeading = "";
  let bucket = [];
  const flush = ()=>{
    if(bucket.length){
      const heading = currentHeading || fallbackHeading;
      blocks.push({ heading, lines: bucket.slice() });
    }
    bucket = [];
    currentHeading = "";
  };
  for(const rawLine of lines){
    const line = rawLine.trim();
    if(!line) continue;
    if(/^##+\s+/.test(line)){
      flush();
      currentHeading = line.replace(/^#+\s*/, '');
      continue;
    }
    bucket.push(line);
  }
  flush();
  if(!blocks.length && raw.trim().length){
    blocks.push({ heading: fallbackHeading, lines: [raw.trim()] });
  }
  return blocks
    .map(block=>({ heading: block.heading, text: block.lines.join(' ') }))
    .filter(block=>block.text.trim().length>0);
}

function wordsFromText(text){
  return text.split(/\s+/).filter(Boolean);
}

function setFileStatus(label){
  if(fileStatus) fileStatus.textContent = label;
}

function loadFromFile(file){
  if(!file){
    currentFileName = '';
    exercises = [];
    resetTypingMetrics();
    totalRequiredChars = 0;
    showStatusMessage('テキストファイルを選択してください。');
    setFileStatus('未選択');
    return;
  }
  currentFileName = file.name;
  setFileStatus(`${file.name} を読み込み中...`);
  showStatusMessage('読み込み中...');
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const text = typeof reader.result === 'string' ? reader.result : '';
      const base = file.name.replace(/\.[^.]+$/, '') || 'Text';
      const blocks = parseCompiledText(text, base);
      applyDataset(blocks);
      setFileStatus(`${file.name}`);
      if(filePicker) filePicker.value = '';
    }catch(err){
      console.error(err);
      showStatusMessage('テキストの読み込みに失敗しました。');
      setFileStatus('読み込み失敗');
      if(filePicker) filePicker.value = '';
    }
  };
  reader.onerror = ()=>{
    console.error(reader.error);
    showStatusMessage('テキストの読み込みに失敗しました。');
    setFileStatus('読み込み失敗');
    if(filePicker) filePicker.value = '';
  };
  reader.readAsText(file);
}

function loadDefaultText(){
  if(!DEFAULT_TEXT_PATH) return;
  const applyText = (text)=>{
    const base = DEFAULT_TEXT_PATH.replace(/\.[^.]+$/, '') || 'Text';
    const blocks = parseCompiledText(text, base);
    if(!blocks.length) throw new Error('Dataset is empty');
    currentFileName = DEFAULT_TEXT_PATH;
    applyDataset(blocks);
    setFileStatus(`${DEFAULT_TEXT_PATH}`);
  };

  setFileStatus(`${DEFAULT_TEXT_PATH} を読み込み中...`);
  showStatusMessage('読み込み中...');
  fetch(DEFAULT_TEXT_PATH)
    .then(res=>{
      if(!res.ok) throw new Error(`Failed to load ${DEFAULT_TEXT_PATH}`);
      return res.text();
    })
    .then(applyText)
    .catch(err=>{
      console.error(err);
      if(DEFAULT_TEXT_FALLBACK){
        try{
          applyText(DEFAULT_TEXT_FALLBACK);
          return;
        }catch(fallbackErr){
          console.error(fallbackErr);
        }
      }
      currentFileName = '';
      exercises = [];
      resetTypingMetrics();
      totalRequiredChars = 0;
      showStatusMessage('テキストファイルを選択してください。');
      setFileStatus('未選択');
    });
}

function applyDataset(blocks){
  exercises = blocks.map(b=>b.text);
  wordsOffset = 0;
  cursor = 0;
  marks = [];
  currentWordCount = 0;
  historyHTML = "";
  resetTypingMetrics();
  totalRequiredChars = 0;
  if(!exercises.length){
    showStatusMessage('英語テキストが見つかりません。');
    return;
  }
  pickSentence();
}

// ===== 仮想キーボード =====
// Dvorak配列に基づき5段（数字/第1〜3行/スペース）を生成。
// 各キーは data-key に基底コードを持ち、クリックで handleVirtualKey()。
function buildKeyboard(){
  if(!keyboardEl) return;
  keyboardEl.innerHTML = "";
  const row = (keys, head=null, tail=null)=>{
    const r = document.createElement('div'); r.className='row';
    if(head) r.appendChild(makeKey(head.label, head.code, true));
    keys.forEach(k=> r.appendChild(makeKey(k,k)));
    if(tail) r.appendChild(makeKey(tail.label, tail.code, true));
    return r;
  };
  const num = document.createElement('div'); num.className='row';
  DVORAK_NUMBER_ROW.forEach(k=>num.appendChild(makeKey(k,k)));
  num.appendChild(makeKey("⌫","backspace",true));
  keyboardEl.appendChild(num);

  keyboardEl.appendChild(row(DVORAK_ROW1,{label:'Tab',code:'tab'}));
  keyboardEl.appendChild(row(DVORAK_ROW2,null,{label:'Enter',code:'enter'}));
  keyboardEl.appendChild(row(DVORAK_ROW3,{label:'Shift',code:'shift'},{label:'Shift',code:'shift'}));

  const spaceRow=document.createElement('div'); spaceRow.className='row';
  spaceRow.appendChild(makeKey('Space','space',true)); spaceRow.querySelector('.key').classList.add('space');
  keyboardEl.appendChild(spaceRow);
}
function makeKey(label, code, wide=false){ const b=document.createElement('button'); b.className="key"+(wide?" wide":""); b.textContent=label; b.dataset.key=code; b.addEventListener('click',()=>handleVirtualKey(code)); return b; }
function getKeyEl(code){ if(!keyboardEl) return null; return keyboardEl.querySelector(`[data-key="${cssEscape(code)}"]`); }
function flashKey(code, ok){ const el=getKeyEl(code); if(!el) return; el.classList.remove('flash-correct','flash-wrong'); void el.offsetWidth; el.classList.add(ok?'flash-correct':'flash-wrong'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('flash-correct','flash-wrong'),140); }
function isShiftActive(){ return shiftSticky || shiftPhysical; }
function syncShiftKeys(){ const a=isShiftActive(); keyboardEl.querySelectorAll('[data-key="shift"]').forEach(el=>el.classList.toggle('active',a)); updateKeyLabelsForShift(); }
function updateKeyLabelsForShift(){
  const a=isShiftActive();
  [DVORAK_NUMBER_ROW, DVORAK_ROW1, DVORAK_ROW2, DVORAK_ROW3].forEach(row=>{
    row.forEach(base=>{
      const el=getKeyEl(base); if(!el) return;
      let label=base;
      if(a){ if(SHIFT_MAP[base]) label=SHIFT_MAP[base]; else if(/^[a-z]$/.test(base)) label=base.toUpperCase(); }
      else { if(/^[A-Z]$/.test(label)) label=label.toLowerCase(); }
      el.textContent=label;
    });
  });
}
function resolveOutput(code){
  // 仮想キーを出力文字に変換。'enter'は1行運用のため無効化。
  if(code==='space') return ' ';
  if(code==='tab') return '  ';
  if(code==='backspace') return null;
  if(code==='enter') return null; // 改行入力なし
  if(code==='shift'){ shiftSticky=!shiftSticky; syncShiftKeys(); return null; }
  if(code.length===1){
    const was=isShiftActive();
    if(shiftSticky && was){ shiftSticky=false; syncShiftKeys(); }
    if(/[a-z]/.test(code)) return was ? code.toUpperCase() : code;
    return was && SHIFT_MAP[code] ? SHIFT_MAP[code] : code;
  }
  return null;
}

// ===== 1行フィット（英文・CLI 共通ロジック） =====
// 目的: 現在のフォントで実測し、画面幅に収まる単語数だけを表示。
// ポイント: 既にタイプ済みの単語数は維持しつつ、末尾のみ削って合わせる。
function getKeyboardWidth(){
  if(!keyboardEl){ return Math.min(820, window.innerWidth - 16); }
  const rect = keyboardEl.getBoundingClientRect();
  const fallback = Math.min(820, window.innerWidth - 16);
  return (rect.width && rect.width > 50) ? rect.width : fallback;
}
function fitWordsToWidth(words, limitPx){
  // canvas の 2D コンテキストでテキスト幅をピクセル計測
  const cs = getComputedStyle(textEl);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`.replace(/\s+/g,' ').trim();
  const spaceW = ctx.measureText(' ').width;

  let cum = 0, count = 0;
  for(let i=0;i<words.length;i++){
    const wW = ctx.measureText(words[i]).width;
    const need = (i===0 ? wW : cum + spaceW + wW);
    if(need <= limitPx){ cum = need; count = i+1; }
    else break;
  }
  return words.slice(0, Math.max(1, count)); // 最低1語は表示
}
function fitWordsToWidthWithMinimum(words, limitPx, minimum){
  if(!words.length) return [];
  const result = fitWordsToWidth(words, limitPx);
  if(result.length >= minimum) return result;
  if(words.length) return words.slice(0, Math.min(words.length, Math.max(minimum, 1)));
  return result;
}
function minWordsToKeepForCursor(text, caret){
  // カーソルより左側に含まれる単語数（最低保持数）を計算
  const prefix = text.slice(0, caret);
  if(!prefix) return 0;
  return prefix.split(' ').length;
}
function futureWordsPool(){
  // これ以降に入力すべき語を順番通りに返す（現在行＋プレビュー用）
  return sourceWords.slice(wordsOffset);
}
function layoutThreeLines(){
  const keyboardWidth = getKeyboardWidth();
  const targetWidth = Math.max(320, Math.floor(keyboardWidth * 0.82));
  textEl.style.maxWidth = `${targetWidth}px`;
  textEl.style.width = `${targetWidth}px`;

  const poolWords = futureWordsPool();
  if(!poolWords.length){
    flatText = "";
    currentWordCount = 0;
    marks = [];
    nextPreview1 = "";
    nextPreview2 = "";
    renderText();
    return;
  }

  const oldCursor = cursor;
  const oldFlat = flatText;
  const minKeep = minWordsToKeepForCursor(oldFlat, oldCursor);

  const currentWords = fitWordsToWidthWithMinimum(poolWords, targetWidth, Math.max(1, minKeep));
  currentWordCount = currentWords.length;
  flatText = currentWords.join(' ');

  if(oldCursor > flatText.length) cursor = flatText.length;

  const prevMarks = marks;
  const rebuildMarks = ()=>{
    const arr = new Array(flatText.length).fill(0);
    for(let i=0;i<flatText.length;i++){
      if(i<cursor) arr[i] = (prevMarks[i]===-1) ? -1 : 1;
    }
    marks = arr;
  };
  rebuildMarks();

  const afterCurrent = poolWords.slice(currentWordCount);
  const preview1Words = fitWordsToWidth(afterCurrent, targetWidth);
  nextPreview1 = preview1Words.join(' ');

  const afterPreview1 = afterCurrent.slice(preview1Words.length);
  const preview2Words = fitWordsToWidth(afterPreview1, targetWidth);
  nextPreview2 = preview2Words.join(' ');

  renderText();
}

// ===== 描画（履歴＋現在＋プレビュー） =====
// flatText を1文字ずつ <span> にし、marks[] に応じてクラスを付与。
// CSS 側で `.char.correct` `.char.wrong` `.char.current` を色分け表示。
function renderText(){
  if(!textEl) return;
  let currentHtml="";
  for(let i=0;i<flatText.length;i++){
    const ch=flatText[i];
    const m=marks[i]||0;
    let cls='char';
    if(m===1) cls+=' correct';
    else if(m===-1) cls+=' wrong';
    else cls+=' pending';
    if(i===cursor) cls+=' current';
    currentHtml += `<span class="${cls}">${escapeHTML(ch)}</span>`;
  }

  const renderLine = (body, className, isHTML=false)=>{
    const content = isHTML ? body : escapeHTML(body||'');
    if(!content) return '';
    return `<div class="line ${className}">${content}</div>`;
  };

  const parts = [];
  if(historyHTML) parts.push(renderLine(historyHTML, 'history', true));
  if(currentHtml) parts.push(renderLine(currentHtml, 'current', true));
  if(nextPreview1) parts.push(renderLine(nextPreview1, 'next-line'));
  if(nextPreview2) parts.push(renderLine(nextPreview2, 'next-line'));
  if(!parts.length){
    parts.push(renderLine('すべて完了しました。', 'status'));
  }
  textEl.innerHTML = parts.join('');
  // テキスト再描画後に次キーの予告ハイライトを更新
  updateNextKeyHint();
}

// ===== 次キー予告ハイライト =====
function clearKeyHints(){
  if(!keyboardEl) return;
  keyboardEl.querySelectorAll('.key.hint, .key.hint-aux').forEach(el=>{
    el.classList.remove('hint','hint-aux');
  });
}
function hasBaseKey(code){
  return DVORAK_NUMBER_ROW.includes(code) || DVORAK_ROW1.includes(code) || DVORAK_ROW2.includes(code) || DVORAK_ROW3.includes(code) || code==='space' || code==='tab' || code==='backspace' || code==='enter' || code==='shift';
}
function computeKeyForChar(ch){
  if(ch===' ') return {code:'space', needShift:false};
  if(/^[a-z]$/.test(ch)) return {code:ch, needShift:false};
  if(/^[A-Z]$/.test(ch)) return {code:ch.toLowerCase(), needShift:true};
  // 記号: Shiftで生成される場合は逆引き、そうでなければ素の記号
  if(REVERSE_SHIFT_MAP[ch]) return {code:REVERSE_SHIFT_MAP[ch], needShift:true};
  if(hasBaseKey(ch)) return {code:ch, needShift:false};
  // 未対応文字は予告しない
  return null;
}
function updateNextKeyHint(){
  clearKeyHints();
  if(!keyboardEl) return;
  const expected = flatText[cursor];
  if(!expected) return;
  const map = computeKeyForChar(expected);
  if(!map) return;
  const mainKey = getKeyEl(map.code);
  if(mainKey) mainKey.classList.add('hint');
  if(map.needShift){
    keyboardEl.querySelectorAll('[data-key="shift"]').forEach(el=> el.classList.add('hint-aux'));
  }
}


// ===== 画像ダウンロード / 結合 / 印刷ビュー =====
function downloadFile(url, filename){
  const a=document.createElement('a');
  a.href=url; a.download=filename; a.style.display='none';
  document.body.appendChild(a); a.click(); a.remove();
}
function downloadLayouts(){
  // 単一PDFをダウンロード
  downloadFile('assets/Dvorak-keyboard-A4.pdf','Dvorak-keyboard-A4.pdf');
}

// ===== 入力処理 =====
// handleVirtualKey: 仮想キーの押下を resolve → onChar へ
// onChar         : 期待文字と比較し、正解なら前進 / ミスなら赤表示
function handleVirtualKey(code){
  if(code === 'backspace') return onBackspace();
  if(code === 'space') return handleSpaceKey('space');
  const out = resolveOutput(code);
  if(out==null) return;
  if(out.length===1) return onChar(out, code);
  for(const ch of out) onChar(ch, code);
}
function onChar(input, baseCode){
  // baseCode は仮想/物理入力の基底キーID（キーフラッシュ用）
  const expected = flatText[cursor];
  if(!expected) return;
  ensureTypingStarted();
  const ch = String(input);
  const ok = expected === ch;
  if(ok){
    marks[cursor] = 1;
    const keyId = baseCode || ch.toLowerCase();
    if(keyId===' ') flashKey('space', true); else flashKey(keyId, true);
    cursor = clamp(cursor+1,0,flatText.length);
    renderText();
    // 行末到達時の自動遷移はしない（スペース押下で進む）
  }else{
    marks[cursor] = -1;
    const keyId = baseCode || ch.toLowerCase();
    if(keyId) flashKey(keyId, false);
    renderText();
  }
}
function onBackspace(){
  // ミス表示があればまず解除。なければ1文字戻る（正解表示も解除）
  if(marks[cursor]===-1){ marks[cursor]=0; renderText(); return; }
  if(cursor>0){ cursor--; marks[cursor]=0; renderText(); }
}

function handleSpaceKey(baseCode='space'){
  if(!flatText.length){
    flashKey(baseCode, true);
    return;
  }
  ensureTypingStarted();
  if(cursor===flatText.length){
    flashKey(baseCode, true);
    return advanceLine();
  }
  const expected = flatText[cursor];
  if(expected === ' '){
    return onChar(' ', baseCode);
  }
  const nextSpace = flatText.indexOf(' ', cursor);
  const end = nextSpace === -1 ? flatText.length : nextSpace;
  let hadMistake = false;
  for(let i=cursor; i<end; i++){
    if(marks[i] !== 1){
      marks[i] = -1;
      hadMistake = true;
    }
  }
  cursor = end;
  if(nextSpace !== -1){
    if(nextSpace < marks.length) marks[nextSpace] = 1;
    cursor = Math.min(nextSpace + 1, flatText.length);
  }
  flashKey(baseCode, !hadMistake);
  if(cursor >= flatText.length){
    return advanceLine();
  }
  renderText();
}

// ===== 課題選択 =====
function currentSet(){ return exercises; }

// 「CHUNK_SIZE」件分を連結 → 単語配列化して1行フィット
function prepareSource(){
  const set = currentSet();
  if(!set.length){
    sourceWords = [];
    return;
  }
  const flattened = [];
  set.forEach(text=>{
    const words = wordsFromText(text);
    if(words.length) flattened.push(...words);
  });
  sourceWords = flattened;
  if(flattened.length){
    const totalChars = flattened.reduce((acc, word)=> acc + word.length, 0) + Math.max(flattened.length - 1, 0);
    totalRequiredChars = totalChars;
  }else{
    totalRequiredChars = 0;
  }
}
function pickSentence(){
  const set = currentSet();
  if(!set.length){
    showStatusMessage('テキストを選択してください。');
    return;
  }
  prepareSource();
  if(!sourceWords.length){
    showStatusMessage('英語行が見つかりません。');
    return;
  }
  wordsOffset = 0;
  cursor = 0;
  marks = [];
  currentWordCount = 0;
  historyHTML = "";
  layoutThreeLines();
}
function buildCurrentLineHTMLWithoutCursor(){
  // 現在行を下線なしでHTML化し、履歴表示に転用
  let html="";
  for(let i=0;i<flatText.length;i++){
    const ch=flatText[i];
    const m=marks[i]||0;
    let cls='char';
    if(m===1) cls+=' correct';
    else if(m===-1) cls+=' wrong';
    else cls+=' pending';
    // 履歴には下線を含めない
    html += `<span class=\"${cls}\">${escapeHTML(ch)}</span>`;
  }
  return html;
}
function advanceLine(){
  // 現在行を履歴に送り、残りの本文から次行を生成
  historyHTML = buildCurrentLineHTMLWithoutCursor();
  wordsOffset += currentWordCount;
  cursor = 0;
  marks = [];
  currentWordCount = 0;

  if(wordsOffset >= sourceWords.length){
    flatText = "";
    nextPreview1 = "";
    nextPreview2 = "";
    renderText();
    const summary = buildCompletionSummary();
    showStatusMessage(`入力が完了しました！${summary}`);
    return;
  }
  layoutThreeLines();
}

// ===== 初期化 =====
// 重要: リサイズ時に常に末尾だけを再調整し、途中までの進捗を保つ。
function init(){
  buildKeyboard();
  syncShiftKeys();
  if(filePicker){
    filePicker.addEventListener('change', ()=>{
      const file = filePicker.files && filePicker.files[0];
      loadFromFile(file || null);
    });
  }
  if(fileStatus){
    setFileStatus('未選択');
  }
  if(dlBtn){
    dlBtn.addEventListener('click', downloadLayouts);
  }

  // 物理キーボード
  window.addEventListener('keydown',(e)=>{
    const k=e.key;
    if(k==='Shift'){ shiftPhysical=true; syncShiftKeys(); return; }
    if(k==='Backspace'){ e.preventDefault(); onBackspace(); return; }
    if(k==='Enter'){ e.preventDefault(); return; }
    if(k==='Tab'){ e.preventDefault(); onChar(' ','tab'); onChar(' ','tab'); return; }
    if(k===' '){
      e.preventDefault();
      return handleSpaceKey('space');
    }
    if(k.length===1){
      const base = /^[A-Z]$/.test(k) ? k.toLowerCase() : (REVERSE_SHIFT_MAP[k] || k);
      return onChar(k, base);
    }
  });
  window.addEventListener('keyup',(e)=>{ if(e.key==='Shift'){ shiftPhysical=false; syncShiftKeys(); } });

  // リサイズ：常に「末尾カット」で再フィット（進捗は維持）
  let rAf = 0;
  const onResize = ()=>{
    cancelAnimationFrame(rAf);
    rAf = requestAnimationFrame(()=>{
      const typedCount = cursor;
      layoutThreeLines();
      cursor = clamp(typedCount, 0, flatText.length);
      for(let i=0;i<flatText.length;i++) marks[i] = (i < cursor) ? 1 : 0;
      renderText();
    });
  };
  window.addEventListener('resize', onResize);
  // 初期表示はレイアウト確定後に実行（キーボード幅が0になるのを回避）
  requestAnimationFrame(()=>{
    loadDefaultText();
  });
}
window.addEventListener('DOMContentLoaded', init);
