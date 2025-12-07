/*
  Dvorak Typing Game v3 (Refactored)
  Optimized for speed and maintainability.
*/

// ==========================================
// 1. Constants & Utilities
// ==========================================
const KEY_LAYOUT = {
  num: ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "[", "]"],
  row1: ["'", ",", ".", "p", "y", "f", "g", "c", "r", "l", "/", "=", "\\"],
  row2: ["a", "o", "e", "u", "i", "d", "h", "t", "n", "s", "-"],
  row3: [";", "q", "j", "k", "x", "b", "m", "w", "v", "z"],
};

const SHIFT_MAP = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  "[": "{", "]": "}", "`": "~", "-": "_", "=": "+", "/": "?", "\\": "|", ";": ":", ",": "<", ".": ">", "'": "\""
};
const REVERSE_SHIFT_MAP = Object.fromEntries(Object.entries(SHIFT_MAP).map(([k, v]) => [v, k]));

const UTILS = {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
  escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  now: () => (performance && performance.now) ? performance.now() : Date.now(),
};

// ==========================================
// 2. Typing Logic (Model)
// ==========================================
class TypingEngine {
  constructor() {
    this.sourceWords = [];     // 全単語リスト
    this.wordOffset = 0;       // 現在行の開始単語インデックス
    this.currentText = "";     // 現在行の文字列（表示用）
    this.cursor = 0;           // 現在行内のカーソル位置
    this.status = [];          // 各文字の状態 (0:pending, 1:correct, -1:error)

    this.startTime = null;
    this.endTime = null;
    this.totalChars = 0;

    // Config
    this.minWordsPerLine = 1;
  }

  reset() {
    this.sourceWords = [];
    this.wordOffset = 0;
    this.currentText = "";
    this.cursor = 0;
    this.status = [];
    this.resetTimer();
  }

  loadText(text) {
    // 簡易的なパース処理
    const cleanBox = [];
    const lines = text.split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('#')) return; // ignore headers for now or handle differently
      const words = trimmed.split(/\s+/).filter(Boolean);
      cleanBox.push(...words);
    });

    this.sourceWords = cleanBox;
    this.totalChars = this.sourceWords.join(' ').length;
    this.wordOffset = 0;
    this.prepareNextLine(0); // 初期ロード時は幅計算前なので仮設定
  }

  // 画面幅（ピクセル）から、今の行に収まる単語数を決定して状態を更新する
  // ※この処理はUI側から渡される「1文字幅」や「Canvas計測」に依存するため、
  //  実際の分割ロジックは外部から inject したり、計算結果を受け取る形にする。
  setLineData(wordsForLine) {
    if (!wordsForLine || wordsForLine.length === 0) {
      // 完了状態または空
      this.currentText = "";
      this.status = [];
      return;
    }

    const newText = wordsForLine.join(' ');

    // カーソル位置の保持・補正ロジック
    // リサイズなどでテキストが変わっても、打った文字数分は維持したい
    // ただし、新しいテキストが短い場合は切り詰める
    const prevCursor = this.cursor;

    this.currentText = newText;
    this.status = new Array(this.currentText.length).fill(0);

    // 既存の入力状態を復元（可能な範囲で）
    // NOTE: 厳密な復元より、カーソル位置までの「正解」扱いがシンプルで良い
    // リサイズ時は「打ち直し」ではなく「そのまま継続」が望ましいため、
    // 単純に cursor 位置までを previousStatus からコピーするか、
    // あるいは全て未入力に戻すか。
    // ここではシンプルに「カーソル位置は維持、ただし範囲外は切り捨て」とし、
    // 状態はResetされる（再判定はUI側で行うか、ここでAutoFillするか）
    // MonkeyType風のサクサク感のため、リサイズ時は一旦未入力(pending)に戻る実装とするが、
    // 既に入力済みの文字数を cursor が持っているので、その分を Correct として埋める

    this.cursor = Math.min(prevCursor, this.currentText.length);
    for (let i = 0; i < this.cursor; i++) {
      this.status[i] = 1; // 簡易的に正解扱い（リサイズ時の挙動）
    }
  }

  // 入力処理: 戻り値でUI更新に必要な情報を返す
  inputChar(char) {
    if (!this.currentText) return { type: 'ignore' };
    if (this.cursor >= this.currentText.length) {
      // 行末での入力 -> スペースなら次へ、それ以外は無視またはミス
      // ここでは行送りを待つ
      if (char === 'space') return { type: 'next-line' };
      return { type: 'ignore' };
    }

    this.startTimerIfNeeded();

    const expected = this.currentText[this.cursor];
    const isCorrect = (char === expected);

    if (isCorrect) {
      this.status[this.cursor] = 1;
      this.cursor++;
      return { type: 'correct', index: this.cursor - 1 };
    } else {
      this.status[this.cursor] = -1;
      // カーソルは進めない（Dvorak-Typingの仕様：ミス時はその場で赤くなる）
      // MonkeyTypeは進むモードもあるが、既存仕様を踏襲
      return { type: 'wrong', index: this.cursor };
    }
  }

  backspace() {
    if (this.cursor === 0) return { type: 'ignore' };

    // 今の場所がミス表示(-1)なら、それを消すだけ
    if (this.status[this.cursor] === -1) {
      this.status[this.cursor] = 0;
      return { type: 'delete', index: this.cursor };
    }

    // 1行戻る
    this.cursor--;
    this.status[this.cursor] = 0;
    return { type: 'delete', index: this.cursor };
  }

  inputSpace() {
    if (!this.currentText) {
      // 次の行へ行けるかチェック
      return { type: 'next-line' };
    }

    this.startTimerIfNeeded();

    // 行末にいる場合 -> 改行
    if (this.cursor >= this.currentText.length) {
      return { type: 'next-line' };
    }

    const expected = this.currentText[this.cursor];

    if (expected === ' ') {
      this.status[this.cursor] = 1;
      this.cursor++;
      return { type: 'correct', index: this.cursor - 1 };
    }

    // スペースじゃない場所でスペース -> 単語スキップ機能 (MonkeyType behavior)
    // 現在の単語の終わり（次のスペース or 行末）までをミス扱いにして飛ばす
    let nextSpaceIdx = this.currentText.indexOf(' ', this.cursor);
    if (nextSpaceIdx === -1) nextSpaceIdx = this.currentText.length;

    // 現在位置から単語末尾までミスで埋める
    for (let i = this.cursor; i < nextSpaceIdx; i++) {
      this.status[i] = -1;
    }

    // 次の単語の頭（スペースの次）へ
    // スペースそのものは Correct 扱いにして飛ばすか？ -> 元の実装は「次のスペースまで飛ぶ」。
    // ここでは「スペースの次の文字」にカーソルを置きたい。
    // なので nextSpaceIdx の位置（=スペース）を Correct にして、その次へ

    if (nextSpaceIdx < this.currentText.length) {
      this.status[nextSpaceIdx] = 1; // スペース自体は正解扱い（スキップ成功）
      this.cursor = nextSpaceIdx + 1;
    } else {
      this.cursor = this.currentText.length;
    }

    return { type: 'skip-word', startIndex: this.cursor }; // UI側は全再描画推奨
  }

  startTimerIfNeeded() {
    if (this.startTime === null) {
      this.startTime = UTILS.now();
    }
  }

  resetTimer() {
    this.startTime = null;
    this.endTime = null;
  }

  getCompletionStats() {
    if (!this.startTime) return null;
    const now = this.endTime || UTILS.now();
    const elapsedSec = (now - this.startTime) / 1000;
    const wpm = (elapsedSec > 0) ? (this.totalChars / 5) / (elapsedSec / 60) : 0;
    return { time: elapsedSec, wpm: wpm };
  }
}

// ==========================================
// 3. UI / Renderer
// ==========================================
class TypingUI {
  constructor(engine) {
    this.engine = engine;
    this.textEl = document.getElementById('text');
    this.keyboardEl = document.getElementById('keyboard');
    this.statusEl = document.getElementById('fileStatus');
    this.msgEl = null; // Status message overlay if needed

    // DOM Cache
    this.charSpans = [];
    this.predictionSpans = []; // 予測変換や次行表示用

    // Keyboard key map (code -> element)
    this.keyElements = new Map();
    this.shiftActive = false;
    this.shiftSticky = false;

    this.initKeyboard();
  }

  initKeyboard() {
    this.keyboardEl.innerHTML = '';

    const createRow = (keys, opts = {}) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'row';
      keys.forEach(k => {
        const btn = document.createElement('button');
        const isObj = (typeof k === 'object');
        const label = isObj ? k.label : k;
        const code = isObj ? k.code : k;
        const wide = isObj ? k.wide : false;

        btn.className = `key ${wide ? 'wide' : ''}`;
        btn.textContent = label;
        btn.dataset.key = code;

        // Click Handler
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Focus維持
          this.handleVirtualKey(code);
        });

        rowDiv.appendChild(btn);
        this.keyElements.set(code, btn);
      });
      return rowDiv;
    };

    // Build Rows
    const rNum = KEY_LAYOUT.num.slice();
    rNum.push({ label: '⌫', code: 'backspace', wide: true });
    this.keyboardEl.appendChild(createRow(rNum));

    const r1 = [{ label: 'Tab', code: 'tab', wide: false }, ...KEY_LAYOUT.row1];
    this.keyboardEl.appendChild(createRow(r1));

    const r2 = [...KEY_LAYOUT.row2, { label: 'Enter', code: 'enter', wide: true }];
    this.keyboardEl.appendChild(createRow(r2));

    const r3 = [{ label: 'Shift', code: 'shift', wide: true }, ...KEY_LAYOUT.row3, { label: 'Shift', code: 'shift', wide: true }];
    this.keyboardEl.appendChild(createRow(r3));

    const rSpace = document.createElement('div');
    rSpace.className = 'row';
    const spBtn = document.createElement('button');
    spBtn.className = 'key space';
    spBtn.dataset.key = 'space';
    spBtn.textContent = 'Space';
    spBtn.addEventListener('mousedown', (e) => { e.preventDefault(); this.handleVirtualKey('space'); });
    rSpace.appendChild(spBtn);
    this.keyboardEl.appendChild(rSpace);
    this.keyElements.set('space', spBtn);
  }

  // --- Rendering Functions ---

  // 全再構築（行が変わった時やリサイズ時）
  renderAll() {
    if (!this.engine.currentText) {
      this.textEl.innerHTML = `<div class="line status">Press any key to start... <br> or Select Text File</div>`;
      return;
    }

    // 1. History (One previous line implementation skipped for simplicity, or just show text)
    // 2. Current Line
    const currentLineDiv = document.createElement('div');
    currentLineDiv.className = 'line current';

    this.charSpans = [];

    for (let i = 0; i < this.engine.currentText.length; i++) {
      const char = this.engine.currentText[i];
      const span = document.createElement('span');
      span.textContent = char;

      // Initial Class
      const state = this.engine.status[i]; // 0, 1, -1
      let cls = 'char';
      if (state === 1) cls += ' correct';
      else if (state === -1) cls += ' wrong';

      if (i === this.engine.cursor) cls += ' current';

      span.className = cls;
      currentLineDiv.appendChild(span);
      this.charSpans.push(span);
    }

    // 3. Next Line Preview (計算して表示)
    //    パフォーマンスのため、ここはシンプルにテキストで出す
    const nextPreviewDiv = document.createElement('div');
    nextPreviewDiv.className = 'line next-line';
    const restWords = this.engine.sourceWords.slice(this.engine.wordOffset + this.getCurrentLineWordCount());
    const previewText = restWords.slice(0, 15).join(' '); // 簡易プレビュー
    nextPreviewDiv.textContent = previewText;

    this.textEl.innerHTML = '';
    // History could go here
    this.textEl.appendChild(currentLineDiv);
    this.textEl.appendChild(nextPreviewDiv);

    this.updateKeyHints();
  }

  // 部分更新（タイピング時） - 最速パス
  updateCursorAndChar(prevIndex, needsFullRefresh) {
    if (needsFullRefresh) {
      this.renderAll();
      return;
    }

    // 前のカーソル位置の装飾を消す
    if (prevIndex >= 0 && prevIndex < this.charSpans.length) {
      this.updateCharStyle(prevIndex);
      // Remove 'current' from previous
      this.charSpans[prevIndex].classList.remove('current');
    }

    // 新しいカーソル位置
    const curr = this.engine.cursor;
    if (curr < this.charSpans.length) {
      this.charSpans[curr].classList.add('current');
    }

    this.updateKeyHints();
  }

  updateCharStyle(index) {
    if (index < 0 || index >= this.charSpans.length) return;
    const span = this.charSpans[index];
    const state = this.engine.status[index];

    // Reset basic classes
    span.className = 'char';
    if (state === 1) span.classList.add('correct');
    else if (state === -1) span.classList.add('wrong');
    // 'current' は呼び出し元で制御
  }

  // キーボードの光る演出（正解/不正解）
  flashKey(code, isCorrect) {
    // Dvorak Layerの処理：大文字入力時などはShiftも光らせると親切だが、まずはBaseKey
    let el = this.keyElements.get(code);
    // Shift文字の場合、BaseKeyを探す
    if (!el && code.length === 1) {
      const lower = code.toLowerCase();
      el = this.keyElements.get(lower);
      // 記号逆引き
      if (!el) {
        const base = REVERSE_SHIFT_MAP[code];
        if (base) el = this.keyElements.get(base);
      }
    }

    if (el) {
      // アニメーション再発火テクニック
      el.classList.remove('flash-correct', 'flash-wrong');
      void el.offsetWidth; // Reflow
      el.classList.add(isCorrect ? 'flash-correct' : 'flash-wrong');

      // Timeout cleanup (CSS animation time is usually < 200ms)
      setTimeout(() => {
        el.classList.remove('flash-correct', 'flash-wrong');
      }, 200);
    }
  }

  updateKeyHints() {
    // 全キーのヒント解除
    this.keyElements.forEach(el => el.classList.remove('hint', 'hint-aux'));

    const char = this.engine.currentText[this.engine.cursor];
    if (!char) {
      if (this.engine.currentText && this.engine.cursor >= this.engine.currentText.length) {
        // Space needed for next line
        const sp = this.keyElements.get('space');
        if (sp) sp.classList.add('hint');
      }
      return;
    }

    // 文字に対応するキーを探す
    let targetCode = char;
    let needShift = false;

    if (targetCode === ' ') targetCode = 'space';
    else if (/[A-Z]/.test(char)) {
      targetCode = char.toLowerCase();
      needShift = true;
    } else if (REVERSE_SHIFT_MAP[char]) {
      targetCode = REVERSE_SHIFT_MAP[char];
      needShift = true;
    }

    const el = this.keyElements.get(targetCode);
    if (el) el.classList.add('hint');

    if (needShift) {
      const shifts = this.keyboardEl.querySelectorAll('[data-key="shift"]');
      shifts.forEach(s => s.classList.add('hint-aux'));
    }
  }

  refreshKeyboardLabels() {
    // Shift状態に応じてラベル書き換え
    this.keyElements.forEach((btn, code) => {
      if (code === 'shift') {
        btn.classList.toggle('active', this.shiftActive);
        return;
      }
      if (code.length > 1) return; // space, enter, etc

      let label = code;
      if (this.shiftActive) {
        if (SHIFT_MAP[code]) label = SHIFT_MAP[code];
        else label = code.toUpperCase();
      } else {
        label = code; // default is lowercase in definition
      }
      btn.textContent = label;
    });
  }

  // --- Handlers ---
  handleVirtualKey(code) {
    if (code === 'shift') {
      this.toggleShift();
      return;
    }

    // 物理キーボードのエミュレーション
    // Shift+文字 の解決
    let inputChar = code;
    if (code === 'space') inputChar = ' ';
    else if (code === 'tab') inputChar = '  '; // まぁTabは使わないが
    else if (code === 'enter') return; // Ignore
    else if (code === 'backspace') {
      this.app.triggerBackspace();
      return;
    } else {
      // 文字キー
      if (this.shiftActive) {
        if (SHIFT_MAP[code]) inputChar = SHIFT_MAP[code];
        else inputChar = code.toUpperCase();

        if (!this.shiftSticky) {
          this.shiftActive = false;
          this.refreshKeyboardLabels();
        }
      }
    }

    if (inputChar) {
      this.app.triggerInput(inputChar, code); // code for flashing
    }
  }

  toggleShift(forceState = null) {
    if (forceState !== null) this.shiftActive = forceState;
    else {
      this.shiftActive = !this.shiftActive;
      this.shiftSticky = this.shiftActive; // クリック時はStickyにする
    }
    this.refreshKeyboardLabels();
  }
}

// ==========================================
// 4. Main Application
// ==========================================
class App {
  constructor() {
    this.engine = new TypingEngine();
    this.ui = new TypingUI(this.engine);
    this.ui.app = this; // Link back

    this.initEvents();
    this.loadDefaultText();
  }

  initEvents() {
    // Physical Keyboard
    window.addEventListener('keydown', e => {
      if (e.key === 'Shift') {
        this.ui.toggleShift(true);
        return;
      }

      // Prevent browser defaults for game keys
      if (e.key === ' ' || e.key === 'Backspace' || e.key === 'Tab') {
        // e.preventDefault(); // ここで止めるとブラウザUI操作ができなくなるので要注意だが、GameエリアFocus時のみにするか？
        // 今回は全画面Gameなので止める
        if (e.target.tagName !== 'INPUT') e.preventDefault();
      }

      if (e.key === 'Backspace') {
        this.triggerBackspace();
        return;
      }

      if (e.key === ' ') {
        this.triggerInput(' ', 'space');
        return;
      }

      // Ignore modifier keys alone
      if (e.key.length > 1 && e.key !== 'Enter') return;

      // 文字入力
      // Dvorak配列かどうかはOS依存だが、このアプリは「出力された文字」を見る
      // キーボードの光る場所は「その文字が出るUS-Dvorakの位置」を探して光らせる
      this.triggerInput(e.key);
    });

    window.addEventListener('keyup', e => {
      if (e.key === 'Shift') {
        this.ui.toggleShift(false);
      }
    });

    // File Picker
    const picker = document.getElementById('filePicker');
    if (picker) {
      picker.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => this.startNewSession(reader.result);
          reader.readAsText(file);
          picker.blur();
        }
      });
    }

    // Resize Handling
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.recalculateLayout(), 100);
    });
  }

  loadDefaultText() {
    // 1. まず内蔵テキストで即初期化（file://等でfetchが失敗しても動くように）
    const fallback = "The quick brown fox jumps over the lazy dog. Dvorak typing is efficient and comfortable.";
    this.startNewSession(fallback);

    // 2. 外部ファイルを読みに行き、成功すれば上書き
    fetch('default.txt')
      .then(r => {
        if (!r.ok) throw new Error('Network response was not ok');
        return r.text();
      })
      .then(text => this.startNewSession(text))
      .catch(err => {
        console.warn("Could not load default.txt (likely due to CORS/file protocol). Using fallback.", err);
        // フォールバックは既に表示済みなので何もしない
      });
  }

  startNewSession(fullText) {
    this.engine.reset();
    this.engine.loadText(fullText);
    this.recalculateLayout();
  }

  recalculateLayout() {
    // Wait for style calculation
    requestAnimationFrame(() => {
      // Measure width
      const kbd = document.getElementById('keyboard');
      if (!kbd) return;
      const containerWidth = kbd.getBoundingClientRect().width || 800;
      const effectiveWidth = Math.max(300, containerWidth * 0.95);

      // Calculate how many words fit
      // Simple canvas measurement
      const ctx = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(document.getElementById('text'));
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

      const words = this.engine.sourceWords;
      const offset = this.engine.wordOffset;
      let widthSum = 0;
      let count = 0;
      const spaceW = ctx.measureText(' ').width;

      for (let i = offset; i < words.length; i++) {
        const w = ctx.measureText(words[i]).width;
        const userCheck = (count === 0) ? w : (widthSum + spaceW + w);
        if (userCheck < effectiveWidth) {
          widthSum = userCheck;
          count++;
        } else {
          break;
        }
      }
      if (count === 0 && offset < words.length) count = 1; // At least one word

      const wordsForLine = words.slice(offset, offset + count);
      this.engine.setLineData(wordsForLine);

      this.ui.renderAll();
    });
  }

  // Actions
  triggerInput(char, keyIdHint = null) {
    const prevCursor = this.engine.cursor;

    let res;
    if (char === ' ') {
      res = this.engine.inputSpace();
    } else {
      res = this.engine.inputChar(char);
    }

    // Flash Key Logic
    let codeToFlash = keyIdHint;
    if (!codeToFlash) {
      // 逆引きして光らせるキーを決める
      // charそのもの or lowerCase
      codeToFlash = char;
    }

    if (res.type === 'correct') {
      this.ui.flashKey(codeToFlash, true);
      this.ui.updateCursorAndChar(prevCursor, false);
    } else if (res.type === 'wrong') {
      this.ui.flashKey(codeToFlash, false);
      this.ui.updateCursorAndChar(prevCursor, false);
    } else if (res.type === 'skip-word') {
      this.ui.flashKey('space', true);
      this.ui.updateCursorAndChar(prevCursor, true); // Full refresh for safety
    } else if (res.type === 'next-line') {
      this.advanceLine();
    }
  }

  triggerBackspace() {
    const prevCursor = this.engine.cursor;
    const res = this.engine.backspace();
    if (res.type === 'delete') {
      // カーソル位置が変わってるので、prevCursorのスタイルも戻す必要あり
      this.ui.updateCursorAndChar(prevCursor, false);
    }
  }

  advanceLine() {
    const added = this.engine.currentText.split(' ').filter(Boolean).length;
    this.engine.wordOffset += added;

    if (this.engine.wordOffset >= this.engine.sourceWords.length) {
      // Finished
      const stats = this.engine.getCompletionStats();
      const msg = `Complete! Time: ${stats.time.toFixed(1)}s, WPM: ${stats.wpm.toFixed(1)}`;
      document.getElementById('text').innerHTML = `<div class="line status">${msg}</div><div class="line status" style="font-size:0.6em; margin-top:20px;">Reload or Select File to Restart</div>`;
      return;
    }

    this.recalculateLayout(); // Next line
  }
}

// 5. Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
