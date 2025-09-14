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
// EXERCISES_EN: Dvorakの説明文（小文字中心）
// EXERCISES_CLI: よく使うコマンド例（小文字中心）
const EXERCISES_EN = [
  "with the dvorak layout, common letters sit under strong fingers.",
  "less finger travel means less fatigue and smoother rhythm.",
  "dvorak groups vowels on the left and frequent consonants on the right.",
  "many typists report fewer mistakes and faster flow over time.",
  "practice daily to build accuracy first and then speed.",
  "typing is fun when motion feels effortless and consistent.",
];

const EXERCISES_CLI = [
  "git status",
  "git commit -m \"update docs\"",
  "ls -la",
  "grep -rin \"fix\" .",
  "docker compose up -d",
  "npm run build",
  "python3 -m http.server 8000",
  "curl -s https://example.com/",
];

// ===== 状態 =====
// mode           : 'en'（英文）| 'cli'（コマンド）
// sentenceIndex  : 出題の進行位置（3文ずつ進める）
// sourceWords    : 出題候補（複数文を空白で連結→単語配列）
// flatText       : 実際に1行表示される文字列（画面幅に合わせて末尾カット）
// cursor         : flatText 上での現在位置（0..length）
// marks[]        : 0=未入力 / 1=正解 / -1=ミス（renderTextで色分け）
// shiftSticky    : 仮想Shiftのトグル（1打鍵で自動解除）
// shiftPhysical  : 物理Shiftの押下状態
let mode = 'en';
let sentenceIndex = 0;

// 共通：候補単語列（複数文を連結） → 画面は3行表示（行1がタイピング対象）
let sourceWords = [];        // string[]
let wordsOffset = 0;         // 現在の行1が始まる語インデックス
let flatText = "";          // 行1の表示テキスト
let cursor = 0;             // 行1内のカーソル位置（0..length）
let marks = [];             // 0:未入力 / 1:正解 / -1:ミス（行1のみ）
let lineWordCounts = [0,0,0]; // 行1〜行3の語数（行送り時に使用）
let nextPreview1 = "";     // 次の行（行2）の表示キャッシュ
let nextPreview2 = "";     // 次の行（行3）の表示キャッシュ

// Shift系
let shiftSticky = false;
let shiftPhysical = false;

// ===== 要素 =====
const textEl = document.getElementById("text");
const keyboardEl = document.getElementById("keyboard");
const modeSel = document.getElementById("modeSelect");
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
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function escapeHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
  return rect.width || Math.min(820, window.innerWidth - 16);
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
  if(!prefix) return 1;
  return prefix.split(' ').length;
}
function futureWordsPool(){
  // 現在の残り語＋次セットの先読み語を結合（常に3行分確保）
  const remain = sourceWords.slice(wordsOffset);
  const set = currentSet();
  const nextThree = [
    set[(sentenceIndex+3)%set.length],
    set[(sentenceIndex+4)%set.length],
    set[(sentenceIndex+5)%set.length],
  ].join(' ').split(' ');
  return remain.concat(nextThree);
}
function layoutThreeLines(){
  // 画面幅に収まる単語で行1〜行3を構成（行1は既入力語数を維持）
  const kbw = getKeyboardWidth();
  textEl.style.maxWidth = `${Math.floor(kbw)}px`;

  const pool = futureWordsPool();
  const minKeep = minWordsToKeepForCursor();

  let off = 0;
  // 行1
  const fit1 = fitWordsToWidth(pool.slice(off), kbw);
  let c1 = Math.max(minKeep, fit1.length);
  c1 = Math.min(c1, Math.max(1, pool.length));
  const oldCursor = cursor;
  flatText = pool.slice(off, off + c1).join(' ');
  if(oldCursor > flatText.length) cursor = flatText.length;
  const newMarks = new Array(flatText.length).fill(0);
  for(let i=0;i<Math.min(oldCursor, flatText.length); i++) newMarks[i] = 1;
  marks = newMarks;
  off += c1;

  // 行2
  let c2 = 0, line2 = "";
  if(off < pool.length){
    const fit2 = fitWordsToWidth(pool.slice(off), kbw);
    c2 = Math.min(fit2.length, pool.length - off);
    line2 = pool.slice(off, off + c2).join(' ');
    off += c2;
  }

  // 行3
  let c3 = 0, line3 = "";
  if(off < pool.length){
    const fit3 = fitWordsToWidth(pool.slice(off), kbw);
    c3 = Math.min(fit3.length, pool.length - off);
    line3 = pool.slice(off, off + c3).join(' ');
    off += c3;
  }

  lineWordCounts = [c1, c2, c3];
  nextPreview1 = line2; nextPreview2 = line3;
  renderText(line2, line3);
}

// ===== 描画（常に1行） =====
// flatText を1文字ずつ <span> にし、marks[] に応じてクラスを付与。
// CSS 側で `.char.correct` `.char.wrong` `.char.current` を色分け表示。
function renderText(next1="", next2=""){
  if(!textEl) return;
  let line1="";
  for(let i=0;i<flatText.length;i++){
    const ch=flatText[i];
    const m=marks[i]||0;
    let cls='char';
    if(m===1) cls+=' correct';
    else if(m===-1) cls+=' wrong';
    else cls+=' pending';
    if(i===cursor) cls+=' current';
    line1 += `<span class="${cls}">${escapeHTML(ch)}</span>`;
  }
  const n1 = escapeHTML(next1||"");
  const n2 = escapeHTML(next2||"");
  textEl.innerHTML = `<div class="line current">${line1}</div>`+
                     (n1?`<div class="line next-line">${n1}</div>`:``)+
                     (n2?`<div class="line next-line">${n2}</div>`:``);
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
  if(code === 'space' && cursor===flatText.length){ return advanceLine(); }
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
    renderText(nextPreview1, nextPreview2);
    // 行末到達時の自動遷移はしない（スペース押下で進む）
  }else{
    marks[cursor] = -1;
    const keyId = baseCode || ch.toLowerCase();
    if(keyId) flashKey(keyId, false);
    renderText(nextPreview1, nextPreview2);
  }
}
function onBackspace(){
  // ミス表示があればまず解除。なければ1文字戻る（正解表示も解除）
  if(marks[cursor]===-1){ marks[cursor]=0; renderText(nextPreview1, nextPreview2); return; }
  if(cursor>0){ cursor--; marks[cursor]=0; renderText(nextPreview1, nextPreview2); }
}

// ===== 課題選択 =====
function currentSet(){ return mode==='cli' ? EXERCISES_CLI : EXERCISES_EN; }

// モードに関係なく「3つ分を連結 → 単語配列化」して1行フィット
// 複数文を用いることで1行に十分な密度を確保する。
function prepareSource(){
  const set = currentSet();
  if(sentenceIndex===0) shuffle(set);
  const three = [ set[(sentenceIndex+0)%set.length],
                  set[(sentenceIndex+1)%set.length],
                  set[(sentenceIndex+2)%set.length] ];
  sourceWords = three.join(' ').split(' ');
}
function pickSentence(){
  // 出題の初期化。レイアウト確定後に message を消す。
  prepareSource();
  wordsOffset = 0;
  cursor = 0;
  marks = [];
  layoutThreeLines();   // 3行に分割して表示
}
function nextSentence(){
  const set = currentSet();
  sentenceIndex = (sentenceIndex+3) % set.length;
  pickSentence();
}

function advanceLine(){
  // 行1を消化して次へ。バッファ末尾なら次セットへ。
  const consume = lineWordCounts[0] || 0;
  wordsOffset += consume;
  cursor = 0; marks = [];
  if(wordsOffset >= sourceWords.length){
    nextSentence();
  }else{
    layoutThreeLines();
  }
}

// ===== 初期化 =====
// 重要: リサイズ時に常に末尾だけを再調整し、途中までの進捗を保つ。
function init(){
  buildKeyboard();
  syncShiftKeys();
  if(modeSel){
    modeSel.addEventListener('change', ()=>{ mode = modeSel.value; sentenceIndex=0; pickSentence(); });
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
      if(cursor===flatText.length) return advanceLine();
      return onChar(' ','space');
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
      renderText(nextPreview1, nextPreview2);
    });
  };
  window.addEventListener('resize', onResize);
  pickSentence();
}
window.addEventListener('DOMContentLoaded', init);
