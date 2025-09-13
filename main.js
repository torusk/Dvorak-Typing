// ===== Dvorak配列 =====
const DVORAK_NUMBER_ROW = ["`","1","2","3","4","5","6","7","8","9","0","[","]"];
const DVORAK_ROW1 = ["'", ",", ".", "p","y","f","g","c","r","l","/","=","\\"];
const DVORAK_ROW2 = ["a","o","e","u","i","d","h","t","n","s","-"];
const DVORAK_ROW3 = [";","q","j","k","x","b","m","w","v","z"];

// ===== 課題文 =====
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
let mode = 'en';
let sentenceIndex = 0;

// 共通：候補単語列（複数要素を連結） → 画面は1行、末尾を削ってフィット
let sourceWords = [];        // string[]
let flatText = "";          // 1行の表示テキスト（sourceWordsの先頭から）
let cursor = 0;             // flatText上のインデックス
let marks = [];             // 0:未入力 / 1:正解 / -1:ミス

// Shift系
let shiftSticky = false;
let shiftPhysical = false;

// ===== 要素 =====
const textEl = document.getElementById("text");
const messageEl = document.getElementById("message");
const keyboardEl = document.getElementById("keyboard");
const resetBtn = document.getElementById("resetBtn");
const skipBtn = document.getElementById("skipBtn");
const modeSel = document.getElementById("modeSelect");

// ===== ユーティリティ =====
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const cssEscape = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
const SHIFT_MAP = {"1":"!","2":"@","3":"#","4":"$","5":"%","6":"^","7":"&","8":"*","9":"(","0":")","[":"{","]":"}","`":"~","-":"_","=":"+","/":"?","\\":"|",";":":",",":"<",".":">","'":"\""};
const REVERSE_SHIFT_MAP = Object.fromEntries(Object.entries(SHIFT_MAP).map(([k,v])=>[v,k]));
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function escapeHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ===== 仮想キーボード =====
function buildKeyboard(){
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
function getKeyEl(code){ return keyboardEl.querySelector(`[data-key="${cssEscape(code)}"]`); }
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
function getKeyboardWidth(){
  const rect = keyboardEl.getBoundingClientRect();
  return rect.width || Math.min(820, window.innerWidth - 16);
}
function fitWordsToWidth(words, limitPx){
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
  const prefix = flatText.slice(0, cursor);
  if(!prefix) return 1;
  return prefix.split(' ').length;
}
function layoutOneLine(){
  const kbw = getKeyboardWidth();
  textEl.style.maxWidth = `${Math.floor(kbw)}px`;  // 文字サイズは変えない
  const minKeep = minWordsToKeepForCursor();
  const wordsThatFit = fitWordsToWidth(sourceWords, kbw);
  let keepCount = Math.max(minKeep, wordsThatFit.length);
  keepCount = Math.min(keepCount, sourceWords.length);

  const oldCursor = cursor;
  flatText = sourceWords.slice(0, keepCount).join(' ');
  if(oldCursor > flatText.length) cursor = flatText.length;

  const newMarks = new Array(flatText.length).fill(0);
  for(let i=0;i<Math.min(oldCursor, flatText.length); i++) newMarks[i] = 1;
  marks = newMarks;

  renderText();
}

// ===== 描画（常に1行） =====
function renderText(){
  let out="";
  for(let i=0;i<flatText.length;i++){
    const ch=flatText[i];
    const m=marks[i]||0;
    let cls='char';
    if(m===1) cls+=' correct';
    else if(m===-1) cls+=' wrong';
    else cls+=' pending';
    if(i===cursor) cls+=' current';
    out += `<span class="${cls}">${escapeHTML(ch)}</span>`;
  }
  textEl.innerHTML = out;
}

// ===== 入力処理 =====
function handleVirtualKey(code){
  if(code === 'backspace') return onBackspace();
  const out = resolveOutput(code);
  if(out==null) return;
  if(out.length===1) return onChar(out, code);
  for(const ch of out) onChar(ch, code);
}
function onChar(input, baseCode){
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
    if(cursor===flatText.length){
      messageEl.textContent = '完了！ 次の課題を読み込みます';
      setTimeout(()=>nextSentence(), 500);
    }
  }else{
    marks[cursor] = -1;
    const keyId = baseCode || ch.toLowerCase();
    if(keyId) flashKey(keyId, false);
    renderText();
  }
}
function onBackspace(){
  if(marks[cursor]===-1){ marks[cursor]=0; renderText(); return; }
  if(cursor>0){ cursor--; marks[cursor]=0; renderText(); }
}

// ===== 課題選択 =====
function currentSet(){ return mode==='cli' ? EXERCISES_CLI : EXERCISES_EN; }

// モードに関係なく「3つ分を連結 → 単語配列化」して1行フィット
function prepareSource(){
  const set = currentSet();
  if(sentenceIndex===0) shuffle(set);
  const three = [ set[(sentenceIndex+0)%set.length],
                  set[(sentenceIndex+1)%set.length],
                  set[(sentenceIndex+2)%set.length] ];
  sourceWords = three.join(' ').split(' ');
}
function pickSentence(){
  prepareSource();
  cursor = 0;
  marks = [];
  layoutOneLine();     // 1行に収める（末尾削除）
  messageEl.textContent = "";
}
function nextSentence(){
  const set = currentSet();
  sentenceIndex = (sentenceIndex+3) % set.length;
  pickSentence();
}
function resetGame(){
  sentenceIndex = 0;
  pickSentence();
}

// ===== 初期化 =====
function init(){
  buildKeyboard();
  syncShiftKeys();
  resetBtn.addEventListener('click', resetGame);
  skipBtn.addEventListener('click', nextSentence);
  modeSel.addEventListener('change', ()=>{ mode = modeSel.value; sentenceIndex=0; pickSentence(); });

  // 物理キーボード
  window.addEventListener('keydown',(e)=>{
    const k=e.key;
    if(k==='Shift'){ shiftPhysical=true; syncShiftKeys(); return; }
    if(k==='Backspace'){ e.preventDefault(); onBackspace(); return; }
    if(k==='Enter'){ e.preventDefault(); return; }
    if(k==='Tab'){ e.preventDefault(); onChar(' ','tab'); onChar(' ','tab'); return; }
    if(k===' '){ e.preventDefault(); onChar(' ','space'); return; }
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
      layoutOneLine();
      cursor = clamp(typedCount, 0, flatText.length);
      for(let i=0;i<flatText.length;i++) marks[i] = (i < cursor) ? 1 : 0;
      renderText();
    });
  };
  window.addEventListener('resize', onResize);

  pickSentence();
}
window.addEventListener('DOMContentLoaded', init);