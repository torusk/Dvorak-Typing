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
const CHUNK_SIZE = 3; // 画面表示に使用するセット数

// ===== 状態 =====
// sentenceIndex  : 出題の進行位置（CHUNK_SIZE単位で進める）
// sourceWords    : 出題候補（複数文を空白で連結→単語配列）
// flatText       : 実際に1行表示される文字列（画面幅に合わせて末尾カット）
// cursor         : flatText 上での現在位置（0..length）
// marks[]        : 0=未入力 / 1=正解 / -1=ミス（renderTextで色分け）
// shiftSticky    : 仮想Shiftのトグル（1打鍵で自動解除）
// shiftPhysical  : 物理Shiftの押下状態
let sentenceIndex = 0;
let currentFileName = '';

// 共通：候補単語列（複数文を連結） → 画面は3行表示（常に2行目が入力中）
let exercises = [];          // string[]（教材テキスト）
let sourceWords = [];        // string[]（現在チャンクの単語列）
let wordsOffset = 0;         // 現在の「2行目（入力中）」が始まる語インデックス
let flatText = "";          // 2行目（入力中）のテキスト
let cursor = 0;              // 2行目のカーソル位置（0..length）
let marks = [];              // 0:未入力 / 1:正解 / -1:ミス（2行目のみ）
let line1WordCount = 0;      // 現在の1行目（activeRow=1）の語数
let line2WordCount = 0;      // 現在の2行目（activeRow=2）の語数
let historyHTML = "";       // 1行目に表示する直前の完成行（HTMLスナップショット）
let nextPreview1 = "";      // 2行目（プレビュー）のテキスト（activeRow=1時）
let nextPreview1Words = 0;   // 2行目プレビューの語数（1→2行目移行直後に固定採用）
let nextPreview2 = "";      // 3行目（プレビュー）のテキスト
let nextPreview2Words = 0;   // 3行目プレビューの語数
let activeRow = 1;           // 1=初回は1行目から入力 / 2=以後は常に2行目入力
let centeredMode = false;    // 一度2行目に入ったら以後は2行目を現在行に
let adoptNextAsCurrent = 0;  // 0:通常 1:旧nextPreview1を現在行に 2:旧nextPreview2を現在行に

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

function applyDataset(blocks){
  exercises = blocks.map(b=>b.text);
  sentenceIndex = 0;
  wordsOffset = 0;
  cursor = 0;
  marks = [];
  activeRow = 1;
  centeredMode = false;
  adoptNextAsCurrent = 0;
  historyHTML = "";
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
function minWordsToKeepForCursor(){
  // カーソルより左側に含まれる単語数（最低保持数）を計算
  const prefix = flatText.slice(0, cursor);
  // 新しい行の先頭では 0 語保持（再出現を防止）
  if(!prefix) return 0;
  return prefix.split(' ').length;
}
function futureWordsPool(){
  // 現在の残り語＋次セットの先読み語を結合（常に3行分確保）
  const remainWords = sourceWords.slice(wordsOffset);
  const set = currentSet();
  const extraWords = [];
  if(set.length){
    const start = sentenceIndex + CHUNK_SIZE;
    for(let i=0;i<CHUNK_SIZE;i++){
      const idx = start + i;
      if(idx >= set.length) break;
      extraWords.push(...wordsFromText(set[idx]));
    }
  }
  return remainWords.concat(extraWords);
}
function layoutThreeLines(){
  // 画面幅に収まる単語で現在行とプレビューを構成
  const keyboardWidth = getKeyboardWidth();
  const targetWidth = Math.max(320, Math.floor(keyboardWidth * 0.82));
  textEl.style.maxWidth = `${targetWidth}px`;
  textEl.style.width = `${targetWidth}px`;

  const poolWords = futureWordsPool();
  const minKeep = minWordsToKeepForCursor();

  const oldCursor = cursor;
  const rebuildMarks = ()=>{
    const arr = new Array(flatText.length).fill(0);
    for(let i=0;i<Math.min(oldCursor, flatText.length); i++) arr[i] = 1;
    marks = arr;
  };

  if(activeRow===1){
    const fit1 = fitWordsToWidth(poolWords, targetWidth);
    const poolLength = poolWords.length || 1;
    line1WordCount = Math.min(Math.max(minKeep, fit1.length), Math.max(1, poolLength));
    flatText = poolWords.slice(0, line1WordCount).join(' ');
    if(oldCursor > flatText.length) cursor = flatText.length;
    rebuildMarks();

    const after1Words = poolWords.slice(line1WordCount);

    let c2 = 0; let line2 = "";
    if(after1Words.length){
      const fit2 = fitWordsToWidth(after1Words, targetWidth);
      c2 = Math.min(fit2.length, after1Words.length);
      line2 = after1Words.slice(0, c2).join(' ');
    }
    nextPreview1 = line2;
    nextPreview1Words = c2;

    const after2Words = after1Words.slice(c2);
    let c3 = 0; let line3 = "";
    if(after2Words.length){
      const fit3 = fitWordsToWidth(after2Words, targetWidth);
      c3 = Math.min(fit3.length, after2Words.length);
      line3 = after2Words.slice(0, c3).join(' ');
    }
    nextPreview2 = line3;
    nextPreview2Words = c3;
  }else{
    const poolLength = poolWords.length || 1;
    if(adoptNextAsCurrent===1){
      line2WordCount = Math.min(nextPreview1Words||0, Math.max(1, poolLength));
      flatText = nextPreview1 || poolWords.slice(0, line2WordCount).join(' ');
      adoptNextAsCurrent = 0; nextPreview1Words = 0;
    }else if(adoptNextAsCurrent===2){
      line2WordCount = Math.min(nextPreview2Words||0, Math.max(1, poolLength));
      flatText = nextPreview2 || poolWords.slice(0, line2WordCount).join(' ');
      adoptNextAsCurrent = 0;
      const after2bWords = poolWords.slice(line2WordCount);
      let c3b = 0; let line3b = "";
      if(after2bWords.length){
      const fit3b = fitWordsToWidth(after2bWords, targetWidth);
        c3b = Math.min(fit3b.length, after2bWords.length);
        line3b = after2bWords.slice(0, c3b).join(' ');
      }
      nextPreview2 = line3b; nextPreview2Words = c3b;
    }else{
      const fit2 = fitWordsToWidth(poolWords, targetWidth);
      const prefer = nextPreview1Words || 0;
      line2WordCount = Math.min(Math.max(prefer>0?prefer:minKeep, fit2.length), Math.max(1, poolLength));
      flatText = poolWords.slice(0, line2WordCount).join(' ');
      nextPreview1Words = 0;
      const after2 = poolWords.slice(line2WordCount);
      let c3 = 0; let line3 = "";
      if(after2.length){
      const fit3 = fitWordsToWidth(after2, targetWidth);
        c3 = Math.min(fit3.length, after2.length);
        line3 = after2.slice(0, c3).join(' ');
      }
      nextPreview2 = line3; nextPreview2Words = c3;
    }

    if(oldCursor > flatText.length) cursor = flatText.length;
    rebuildMarks();

    const afterCurrentWords = poolWords.slice(line2WordCount);
    let c2 = 0; let line2 = "";
    if(afterCurrentWords.length){
      const fitNext = fitWordsToWidth(afterCurrentWords, targetWidth);
      c2 = Math.min(fitNext.length, afterCurrentWords.length);
      line2 = afterCurrentWords.slice(0, c2).join(' ');
    }
    nextPreview1 = line2;
    nextPreview1Words = c2;

    const after3Words = afterCurrentWords.slice(c2);
    let c3 = 0; let line3 = "";
    if(after3Words.length){
      const fit3 = fitWordsToWidth(after3Words, targetWidth);
      c3 = Math.min(fit3.length, after3Words.length);
      line3 = after3Words.slice(0, c3).join(' ');
    }
    nextPreview2 = line3;
    nextPreview2Words = c3;
  }
  renderText();
}

// ===== 描画（常に1行） =====
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

  if(activeRow===1){
    const parts = [];
    parts.push(renderLine(currentHtml, 'current', true));
    if(nextPreview1) parts.push(renderLine(nextPreview1, 'next-line'));
    if(nextPreview2) parts.push(renderLine(nextPreview2, 'next-line'));
    textEl.innerHTML = parts.join('');
  }else{
    const parts = [];
    if(historyHTML) parts.push(renderLine(historyHTML, 'history', true));
    parts.push(renderLine(currentHtml, 'current', true));
    if(nextPreview2) parts.push(renderLine(nextPreview2, 'next-line'));
    textEl.innerHTML = parts.join('');
  }
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
  if(sentenceIndex >= set.length){
    sentenceIndex = 0;
  }
  const chunk = [];
  for(let i=0;i<CHUNK_SIZE;i++){
    const idx = sentenceIndex + i;
    if(idx >= set.length) break;
    chunk.push(set[idx]);
  }
  if(!chunk.length){
    chunk.push(set[0]);
    sentenceIndex = 0;
  }
  sourceWords = [];
  chunk.forEach((text)=>{
    sourceWords.push(...wordsFromText(text));
  });
  if(!sourceWords.length){
    sentenceIndex = (sentenceIndex + CHUNK_SIZE < set.length) ? sentenceIndex + CHUNK_SIZE : 0;
    prepareSource();
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
  // 履歴は原則保持（案A）。初回のみ空にする。
  if(!centeredMode){
    historyHTML = "";
  }
  // 初回のみ1行目から。2行目に入ったことがあれば以後は2行目固定
  activeRow = centeredMode ? 2 : 1;
  layoutThreeLines();   // 3行に分割して表示
}
function nextSentence(){
  const set = currentSet();
  if(!set.length) return;
  sentenceIndex += CHUNK_SIZE;
  if(sentenceIndex >= set.length){
    sentenceIndex = 0;
  }
  pickSentence();
}

function buildCurrentLineHTMLWithoutCursor(){
  // 2行目（現在行）を、下線（current）なしでHTML化して履歴用に保存
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
  // activeRowに応じて処理: 1行目→2行目へ移行（スクロールなし）、以降は2行目完了でスクロール
  historyHTML = buildCurrentLineHTMLWithoutCursor();
  if(activeRow===1){
    // 1行目分だけ語を消費し、以後は常に2行目で入力
    wordsOffset += (line1WordCount || 0);
    activeRow = 2;
    centeredMode = true;
    adoptNextAsCurrent = 1; // 旧nextPreview1をそのまま現在行に
  }else{
    // 2行目分を消費して次へ（行送り）
    wordsOffset += (line2WordCount || 0);
    adoptNextAsCurrent = 2; // 旧nextPreview2をそのまま現在行に
  }
  cursor = 0; marks = [];
  if(wordsOffset >= sourceWords.length){ nextSentence(); }
  else { layoutThreeLines(); }
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
    showStatusMessage('テキストファイルを選択してください。');
  });
}
window.addEventListener('DOMContentLoaded', init);
