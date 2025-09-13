// フルDvorak（US配列）: 数字行 + 3行 + 制御キー
const DVORAK_NUMBER_ROW = ["`","1","2","3","4","5","6","7","8","9","0","[","]"]; // 末尾にBackspaceを付ける
const DVORAK_ROW1 = ["'", ",", ".", "p","y","f","g","c","r","l","/","=","\\"]; // 先頭にTabを付ける
const DVORAK_ROW2 = ["a","o","e","u","i","d","h","t","n","s","-"]; // 末尾にEnter
const DVORAK_ROW3 = [";","q","j","k","x","b","m","w","v","z"]; // 両端にShift

const EXTRA_KEYS = [",", ".", "-", "'", "/", "=", "\\", ";", "[", "]", "`", ...Array.from('0123456789')];

// 英文（dvorakの利点を紹介・すべて小文字）
const EXERCISES_EN = [
  "with the dvorak layout, common letters sit under strong fingers.",
  "less finger travel means less fatigue and smoother rhythm.",
  "dvorak groups vowels on the left and frequent consonants on the right.",
  "many typists report fewer mistakes and faster flow over time.",
  "practice daily to build accuracy first and then speed.",
  "typing is fun when motion feels effortless and consistent.",
];

// CLIコマンド例（できるだけ小文字）
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

// 状態
let score = 0;
let miss = 0;
let sentenceIndex = 0;
let currentText = "";
let cursor = 0; // 現在の位置
let typed = []; // 打鍵済み文字
let lastFlashEl = null; // 直近でハイライトしたキー
let shiftSticky = false;   // 仮想Shift（1打鍵で解除）
let shiftPhysical = false; // 物理Shift（押下中有効）
let mode = 'en';           // 練習モード: 'en' or 'cli'

// 要素
const textEl = document.getElementById("text");
const scoreEl = document.getElementById("score");
const missEl = document.getElementById("miss");
const messageEl = document.getElementById("message");
const keyboardEl = document.getElementById("keyboard");
const resetBtn = document.getElementById("resetBtn");
const skipBtn = document.getElementById("skipBtn");

// ユーティリティ
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const cssEscape = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

const SHIFT_MAP = {
  "1":"!","2":"@","3":"#","4":"$","5":"%","6":"^","7":"&","8":"*","9":"(","0":")",
  "[":"{","]":"}","`":"~",
  "-":"_","=":"+","/":"?","\\":"|",";":":",",":"<",".":">","'":"\""
};

const REVERSE_SHIFT_MAP = Object.fromEntries(Object.entries(SHIFT_MAP).map(([k,v])=>[v,k]));

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

// キーボード構築（Wordle風）
function buildKeyboard(){
  keyboardEl.innerHTML = "";
  // 数字列 + Backspace
  const numRow = document.createElement('div');
  numRow.className = 'row';
  DVORAK_NUMBER_ROW.forEach(k=> numRow.appendChild(makeKey(k,k)));
  numRow.appendChild(makeKey("⌫","backspace",true));
  keyboardEl.appendChild(numRow);

  // 第1行（Tab + 文字 + \）
  const r1 = document.createElement('div');
  r1.className = 'row';
  r1.appendChild(makeKey('Tab','tab',true));
  DVORAK_ROW1.forEach(k=> r1.appendChild(makeKey(k,k)));
  keyboardEl.appendChild(r1);

  // 第2行（文字 + Enter）
  const r2 = document.createElement('div');
  r2.className = 'row';
  DVORAK_ROW2.forEach(k=> r2.appendChild(makeKey(k,k)));
  r2.appendChild(makeKey('Enter','enter',true));
  keyboardEl.appendChild(r2);

  // 第3行（Shift + 文字 + Shift）
  const r3 = document.createElement('div');
  r3.className = 'row';
  r3.appendChild(makeKey('Shift','shift',true));
  DVORAK_ROW3.forEach(k=> r3.appendChild(makeKey(k,k)));
  r3.appendChild(makeKey('Shift','shift',true));
  keyboardEl.appendChild(r3);

  // スペースバー
  const spaceRow = document.createElement('div');
  spaceRow.className = 'row';
  spaceRow.appendChild(makeKey('Space','space',true));
  spaceRow.querySelector('.key').classList.add('space');
  keyboardEl.appendChild(spaceRow);
}

function makeKey(label, code, wide=false){
  const btn = document.createElement("button");
  btn.className = "key" + (wide?" wide":"");
  btn.textContent = label;
  btn.dataset.key = code;
  btn.addEventListener("click", ()=> handleVirtualKey(code));
  return btn;
}

function getKeyEl(code){
  return keyboardEl.querySelector(`[data-key="${cssEscape(code)}"]`);
}

function flashKey(code, ok){
  const el = getKeyEl(code);
  if(!el) return;
  el.classList.remove('flash-correct','flash-wrong');
  // 再描画を強制してフラッシュを確実に適用
  void el.offsetWidth;
  el.classList.add(ok?'flash-correct':'flash-wrong');
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(()=>{
    el.classList.remove('flash-correct','flash-wrong');
  }, 140);
}

function resolveOutput(code){
  if(code==='enter') return '\n';
  if(code==='space') return ' ';
  if(code==='tab') return '  ';
  if(code==='backspace') return null; // 特別扱い
  if(code==='shift'){ shiftSticky = !shiftSticky; syncShiftKeys(); return null; }
  // 1文字キー
  if(code.length===1){
    const wasShift = isShiftActive();
    if(shiftSticky && wasShift) { shiftSticky = false; syncShiftKeys(); }
    if(/[a-z]/.test(code)) return wasShift ? code.toUpperCase() : code;
    const out = wasShift && SHIFT_MAP[code] ? SHIFT_MAP[code] : code;
    return out;
  }
  return null;
}

function isShiftActive(){ return shiftSticky || shiftPhysical; }

function syncShiftKeys(){
  const active = isShiftActive();
  keyboardEl.querySelectorAll('[data-key="shift"]').forEach(el=>{
    el.classList.toggle('active', active);
  });
  updateKeyLabelsForShift();
}

function updateKeyLabelsForShift(){
  const active = isShiftActive();
  const rows = [DVORAK_NUMBER_ROW, DVORAK_ROW1, DVORAK_ROW2, DVORAK_ROW3];
  rows.forEach(row=>{
    row.forEach(base=>{
      const el = getKeyEl(base);
      if(!el) return;
      let label = base;
      if(active){
        if(SHIFT_MAP[base]) label = SHIFT_MAP[base];
        else if(/^[a-z]$/.test(base)) label = base.toUpperCase();
      }else{
        if(/^[A-Z]$/.test(label)) label = label.toLowerCase();
      }
      el.textContent = label;
    });
  });
}

// 文章表示
function renderText(){
  const before = escapeHTML(currentText.slice(0, cursor));
  const curr = escapeHTML(currentText[cursor] ?? "");
  const after = escapeHTML(currentText.slice(cursor+1));
  const html = `<span class="typed">${before}</span>` +
               `<span class="current">${curr}</span>` +
               `<span class="remaining">${after}</span>`;
  textEl.innerHTML = html;
}

// 旧タイルUIの更新関数は不要のため削除

function currentSet(){ return mode==='cli' ? EXERCISES_CLI : EXERCISES_EN; }

function pickSentence(){
  const set = currentSet();
  if(sentenceIndex===0){ shuffle(set); }
  currentText = set[sentenceIndex % set.length];
  cursor = 0;
  typed = new Array(currentText.length).fill("");
  messageEl.textContent = "";
  clearKeyFlashes();
  renderText();
}

function clearKeyFlashes(){
  keyboardEl.querySelectorAll('.key').forEach(k=>{
    k.classList.remove('flash-correct','flash-wrong','correct','present','absent');
  });
}

function handleVirtualKey(code){
  if(code === 'backspace') return onBackspace();
  const out = resolveOutput(code);
  if(out==null) return;
  if(out.length===1) return onChar(out, code);
  // 複数文字（Tabなど）は分割入力
  for(const ch of out) onChar(ch, code);
}

function onChar(input, baseCode){
  const ch = String(input);
  const expected = currentText[cursor];
  if(!expected) return;
  const equal = expected === ch;
  if(equal){
    typed[cursor] = expected;
    // 仮想/物理どちらでも基底キーに対してフラッシュ
    const keyId = (baseCode && baseCode.length) ? baseCode : ch.toLowerCase();
    if(keyId==='\n') flashKey('enter', true);
    else if(keyId===' ') flashKey('space', true);
    else if(keyId==='\t') flashKey('tab', true);
    else flashKey(keyId, true);
    cursor = clamp(cursor+1,0,currentText.length);
    renderText();
    if(cursor===currentText.length){
      score++;
      scoreEl.textContent = String(score);
      messageEl.textContent = '完了！ Enterで次へ（自動でも進みます）';
      setTimeout(()=>{ nextSentence(); }, 500);
    }
  }else{
    miss++;
    missEl.textContent = String(miss);
    const keyId = (baseCode && baseCode.length) ? baseCode : ch.toLowerCase();
    if(keyId) flashKey(keyId, false);
  }
}

// board系の関数は不要になったため削除

function onBackspace(){
  if(cursor>0){
    cursor--;
    typed[cursor] = "";
    renderText();
  }
}

function nextSentence(){
  const set = currentSet();
  sentenceIndex = (sentenceIndex+1) % set.length;
  pickSentence();
}

function resetGame(){
  score = 0; miss = 0; sentenceIndex = 0;
  scoreEl.textContent = '0'; missEl.textContent = '0';
  pickSentence();
}

// 初期化（DOM構築後）
function init(){
  buildKeyboard();
  syncShiftKeys(); // 初期ラベル同期
  resetBtn.addEventListener('click', resetGame);
  skipBtn.addEventListener('click', nextSentence);
  // モード切替
  const modeSel = document.getElementById('modeSelect');
  modeSel.addEventListener('change', ()=>{
    mode = modeSel.value;
    sentenceIndex = 0;
    pickSentence();
  });
  // 物理キーボード入力
  window.addEventListener('keydown', (e)=>{
    const key = e.key;
    if(key === 'Shift') { shiftPhysical = true; syncShiftKeys(); return; }
    if(key === 'Backspace') { e.preventDefault(); onBackspace(); return; }
    if(key === 'Enter') { e.preventDefault(); onChar('\n','enter'); return; }
    if(key === 'Tab') { e.preventDefault(); onChar(' ','tab'); onChar(' ','tab'); return; }
    if(key === ' ') { e.preventDefault(); onChar(' ','space'); return; }
    if(key.length===1) {
      let base = /^[A-Z]$/.test(key) ? key.toLowerCase() : (REVERSE_SHIFT_MAP[key] || key);
      return onChar(key, base);
    }
  });
  window.addEventListener('keyup', (e)=>{
    if(e.key === 'Shift') { shiftPhysical = false; syncShiftKeys(); }
  });
  pickSentence();
}

window.addEventListener('DOMContentLoaded', init);

// utils
function escapeHTML(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
