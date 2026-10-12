const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 실제 게임 코드를 격리된 환경에서 실행합니다. 시간과 난수를 제어해 재현합니다.
function loadGame(randomValues = [0]) {
  const timers = new Map();
  const listeners = new Map();
  const scoreElement = { textContent: "" };
  const levelElement = { textContent: "" };
  const previewCalls = [];
  const previewContext = {
    fillRect(x, y, width, height) {
      previewCalls.push({ x, y, width, height, color: this.fillStyle });
    },
  };
  const messages = [];
  const context = { fillRect() {}, strokeRect() {}, fillText(text) { messages.push(text); } };
  const math = Object.create(Math);
  let randomIndex = 0;
  math.random = () => randomValues[randomIndex++] ?? 0;
  const sandbox = {
    Math: math,
    document: {
      getElementById(id) {
        if (id === "score") return scoreElement;
        if (id === "level") return levelElement;
        if (id === "next-board") return {
          width: 120, height: 120, getContext: () => previewContext,
        };
        if (id === "restart-button") return {
          addEventListener(type, handler) {
            assert.equal(type, "click");
            assert.equal(listeners.has("restart:click"), false);
            listeners.set("restart:click", handler);
          },
        };
        assert.equal(id, "game-board");
        return { width: 300, height: 600, getContext: () => context };
      },
      addEventListener(type, handler) {
        assert.equal(listeners.has(type), false);
        listeners.set(type, handler);
      },
    },
    setInterval(callback, ms) {
      assert.equal(timers.size, 0, "하강 타이머는 하나만 유지해야 합니다.");
      timers.set(1, { callback, ms });
      return 1;
    },
    clearInterval(id) { timers.delete(id); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../script.js"), "utf8"), sandbox);
  return {
    run: (code) => vm.runInContext(code, sandbox),
    snapshot: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, sandbox)),
    timers,
    scoreElement,
    levelElement,
    previewCalls,
    messages,
    restart: () => listeners.get("restart:click")(),
    key(key, repeat = false) {
      let prevented = false;
      listeners.get("keydown")({ key, repeat, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

test("500ms 자동 하강은 한 칸만 이동하며 바닥에서 고정·생성한다", () => {
  const game = loadGame();
  assert.equal(game.timers.size, 1);
  assert.equal(game.timers.get(1).ms, 500);
  game.timers.get(1).callback();
  assert.equal(game.run("currentPiece.y"), 1);
  game.run("currentPiece.y = 19; dropPiece()");
  assert.deepEqual(game.snapshot("board[19]"), [0, 0, 0, "I", "I", "I", "I", 0, 0, 0]);
  assert.deepEqual(game.snapshot("[currentPiece.x, currentPiece.y]"), [3, 0]);
});

test("7종 블록의 상하좌우 경계와 빈 칸·고정 블록 충돌을 검사한다", () => {
  const game = loadGame();
  for (const type of ["I", "O", "T", "S", "Z", "J", "L"]) {
    game.run(`currentPiece = {type: '${type}', shape: TETROMINOES.${type}.shape.map(row => [...row]), x: 0, y: 0}`);
    assert.equal(game.run("hasCollision(board, currentPiece)"), false);
    assert.equal(game.run("hasCollision(board, currentPiece, -1, 0)"), true);
    assert.equal(game.run("hasCollision(board, currentPiece, 10 - currentPiece.shape[0].length, 0)"), false);
    assert.equal(game.run("hasCollision(board, currentPiece, 11 - currentPiece.shape[0].length, 0)"), true);
    assert.equal(game.run("hasCollision(board, currentPiece, 0, -1)"), true);
    assert.equal(game.run("hasCollision(board, currentPiece, 0, 20 - currentPiece.shape.length)"), false);
    assert.equal(game.run("hasCollision(board, currentPiece, 0, 21 - currentPiece.shape.length)"), true);
  }
  game.run("currentPiece = { type: 'T', shape: TETROMINOES.T.shape, x: 3, y: 0 }; board[0][3] = 'O'");
  assert.equal(game.run("hasCollision(board, currentPiece)"), false);
  game.run("board[0][4] = 'O'");
  assert.equal(game.run("hasCollision(board, currentPiece)"), true);
  const before = game.snapshot("{board, currentPiece}");
  assert.equal(game.run("lockPiece(board, currentPiece)"), false);
  assert.deepEqual(game.snapshot("{board, currentPiece}"), before);
});

test("7종 모두 네 번 회전하면 복원되고 원본 모양을 보존한다", () => {
  const game = loadGame();
  for (const type of ["I", "O", "T", "S", "Z", "J", "L"]) {
    const original = game.snapshot(`TETROMINOES.${type}.shape`);
    game.run(`currentPiece = {type: '${type}', shape: TETROMINOES.${type}.shape.map(row => [...row]), x: 3, y: 3}; for (let i = 0; i < 4; i++) rotatePiece()`);
    assert.deepEqual(game.snapshot("currentPiece.shape"), original);
    assert.deepEqual(game.snapshot(`TETROMINOES.${type}.shape`), original);
  }
});

test("벽·바닥·블록에 막힌 회전과 이동은 상태를 유지한다", () => {
  const game = loadGame();
  for (const setup of [
    "currentPiece = { type: 'I', shape: [[1],[1],[1],[1]], x: 9, y: 0 }",
    "currentPiece = { type: 'I', shape: [[1,1,1,1]], x: 3, y: 19 }",
    "currentPiece = { type: 'I', shape: [[1,1,1,1]], x: 3, y: 0 }; board[1][3] = 'O'",
  ]) {
    game.run(setup);
    const before = game.snapshot("currentPiece");
    game.run("rotatePiece()");
    assert.deepEqual(game.snapshot("currentPiece"), before);
  }
  game.run("board.forEach(row => row.fill(0)); currentPiece.x = 0");
  const before = game.snapshot("currentPiece");
  game.key("ArrowLeft");
  assert.deepEqual(game.snapshot("currentPiece"), before);
});

test("키보드 이동·회전·Soft Drop과 스크롤 차단이 동작한다", () => {
  const game = loadGame();
  assert.equal(game.key("ArrowLeft"), true);
  assert.equal(game.run("currentPiece.x"), 2);
  game.key("ArrowRight");
  assert.equal(game.run("currentPiece.x"), 3);
  game.key("ArrowUp");
  assert.deepEqual(game.snapshot("currentPiece.shape"), [[1], [1], [1], [1]]);
  game.key("ArrowDown");
  assert.equal(game.run("currentPiece.y"), 1);
  assert.equal(game.key("a"), false);
});

test("Hard Drop은 장애물 위에서 즉시 고정하고 반복 스페이스 입력을 무시한다", () => {
  const game = loadGame();
  game.run("board[10][3] = 'O'");
  assert.equal(game.key(" "), true);
  assert.deepEqual(game.snapshot("board[9].slice(3, 7)"), ["I", "I", "I", "I"]);
  assert.equal(game.run("board[10][3]"), "O");
  assert.equal(game.run("currentPiece.y"), 0);
  const before = game.snapshot("{board, currentPiece}");
  game.key(" ", true);
  assert.deepEqual(game.snapshot("{board, currentPiece}"), before);
});

test("0~4줄 및 떨어진 완성 줄을 제거하고 행 순서·높이·독립성을 유지한다", () => {
  const game = loadGame();
  for (const rows of [[], [19], [18, 19], [17, 18, 19], [16, 17, 18, 19], [16, 19]]) {
    game.run(`board.forEach(row => row.fill(0)); board[15][0] = 'T'; for (const y of ${JSON.stringify(rows)}) board[y].fill('I')`);
    assert.equal(game.run("clearCompletedLines(board)"), rows.length);
    assert.equal(game.run("board.length"), 20);
    assert.equal(game.run("board.every(row => row.length === 10)"), true);
    assert.equal(game.run("new Set(board).size"), 20);
    assert.equal(game.run(`board[${15 + rows.length}][0]`), "T");
    assert.equal(game.run("board.filter(row => row.every(cell => cell !== 0)).length"), 0);
  }
});

test("고정 후 1~4줄 점수를 누적하고 우측 점수에 즉시 반영한다", () => {
  const game = loadGame();
  let total = 0;
  const points = [0, 100, 300, 500, 800];
  for (let count = 1; count <= 4; count++) {
    game.run(`board.forEach(row => row.fill(0)); for (let y = 20 - ${count}; y < 20; y++) { board[y].fill('J'); board[y][4] = 0; } currentPiece = {type: 'I', shape: [[1],[1],[1],[1]], x: 4, y: 16}; dropPiece()`);
    total += points[count];
    assert.equal(game.run("score"), total);
    assert.equal(game.scoreElement.textContent, String(total));
    assert.equal(game.run("currentPiece.y"), 0);
  }
});

test("라인 제거 후 생성 공간을 검사하고 상단이 막히면 안전하게 멈춘다", () => {
  const game = loadGame();
  game.run("board[0][3] = 'J'; board[19].fill('L'); board[19][6] = 0; currentPiece = {type: 'I', shape: [[1],[1],[1],[1]], x: 6, y: 16}; dropPiece()");
  assert.equal(game.run("isGameOver"), false);
  assert.equal(game.run("board[1][3]"), "J");
  assert.equal(game.run("score"), 100);
  game.run("board.forEach(row => row.fill(0)); board[0][3] = 'O'; currentPiece = {type: 'I', shape: [[1,1,1,1]], x: 3, y: 19}; dropPiece()");
  assert.equal(game.run("isGameOver"), true);
  assert.equal(game.run("currentPiece"), null);
  assert.equal(game.timers.size, 0);
  assert.equal(game.messages.at(-1), "게임 오버");
  const before = game.snapshot("{board, score}");
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]) game.key(key);
  game.run("dropPiece()");
  assert.deepEqual(game.snapshot("{board, score}"), before);
});

test("진행 중 반복 재시작해도 보드·점수를 초기화하고 타이머를 하나만 유지한다", () => {
  const game = loadGame();
  for (let i = 0; i < 10; i++) {
    game.run("board[19][0] = 'T'; score = 800; currentPiece.y = 5");
    game.restart();
    assert.equal(game.run("board.every(row => row.every(cell => cell === 0))"), true);
    assert.equal(game.run("score"), 0);
    assert.equal(game.scoreElement.textContent, "0");
    assert.equal(game.run("isGameOver"), false);
    assert.equal(game.run("currentPiece.y"), 0);
    assert.equal(game.timers.size, 1);
    game.timers.get(1).callback();
    assert.equal(game.run("currentPiece.y"), 1);
  }
});

test("게임 오버 후 버튼으로 새 게임을 시작하고 키보드 조작이 다시 동작한다", () => {
  const game = loadGame();
  game.run("board[0][3] = 'O'; currentPiece.y = 19; score = 300; dropPiece()");
  assert.equal(game.run("isGameOver"), true);
  assert.equal(game.timers.size, 0);
  game.restart();
  assert.equal(game.run("isGameOver"), false);
  assert.equal(game.run("currentPiece.y"), 0);
  assert.equal(game.run("board.flat().every(cell => cell === 0)"), true);
  assert.equal(game.scoreElement.textContent, "0");
  assert.equal(game.timers.size, 1);
  game.key("ArrowRight");
  game.key("ArrowDown");
  assert.deepEqual(game.snapshot("[currentPiece.x, currentPiece.y]"), [4, 1]);
});

test("미리보기 블록이 실제 다음 블록이 되고 새 후보와 독립적으로 유지된다", () => {
  const game = loadGame([0, 2 / 7, 1 / 7]);
  assert.equal(game.run("currentPiece.type"), "I");
  assert.equal(game.run("nextPiece.type"), "T");
  const previewed = game.snapshot("nextPiece");
  game.key(" ");
  assert.deepEqual(game.snapshot("currentPiece"), previewed);
  assert.equal(game.run("nextPiece.type"), "O");
  const nextBefore = game.snapshot("nextPiece");
  game.key("ArrowUp");
  assert.deepEqual(game.snapshot("nextPiece"), nextBefore);
  assert.equal(game.run("TETROMINOES.T.shape[0].length"), 3);
});

test("7종 미리보기는 원래 색으로 네 칸을 캔버스 중앙에 그리고 상태를 보존한다", () => {
  const game = loadGame();
  for (const type of ["I", "O", "T", "S", "Z", "J", "L"]) {
    game.run(`nextPiece = {type: '${type}', shape: TETROMINOES.${type}.shape.map(row => [...row]), x: 3, y: 0}`);
    const before = game.snapshot("{board, currentPiece, nextPiece, score, level}");
    game.previewCalls.length = 0;
    game.run("draw()");
    const cells = game.previewCalls.slice(1);
    assert.equal(cells.length, 4);
    assert.ok(cells.every(cell => cell.color === game.run(`TETROMINOES.${type}.color`)));
    assert.ok(cells.every(cell => cell.x >= 0 && cell.y >= 0 && cell.x + cell.width <= 120 && cell.y + cell.height <= 120));
    const minX = Math.min(...cells.map(cell => cell.x));
    const maxX = Math.max(...cells.map(cell => cell.x + cell.width));
    const minY = Math.min(...cells.map(cell => cell.y));
    const maxY = Math.max(...cells.map(cell => cell.y + cell.height));
    assert.equal((minX + maxX) / 2, 60);
    assert.equal((minY + maxY) / 2, 60);
    assert.deepEqual(game.snapshot("{board, currentPiece, nextPiece, score, level}"), before);
  }
});

test("1000점 경계에서 레벨·속도를 갱신하고 재시작하면 기본 속도로 복원한다", () => {
  const game = loadGame();
  for (const [score, expected] of [[0, 1], [999, 1], [1000, 2], [1999, 2], [2000, 3]]) {
    assert.equal(game.run(`getLevel(${score})`), expected);
  }
  assert.equal(game.run("getDropInterval(1)"), 500);
  assert.equal(game.run("getDropInterval(2)"), 460);
  assert.equal(game.run("getDropInterval(3)"), 420);
  assert.equal(game.run("getDropInterval(100)"), 100);
  game.run("score = 900; board[19].fill('J'); board[19].fill(0, 3, 7); currentPiece.y = 19; dropPiece()");
  assert.equal(game.run("score"), 1000);
  assert.equal(game.run("level"), 2);
  assert.equal(game.levelElement.textContent, "2");
  assert.equal(game.timers.size, 1);
  assert.equal(game.timers.get(1).ms, 460);
  game.restart();
  assert.equal(game.run("level"), 1);
  assert.equal(game.levelElement.textContent, "1");
  assert.equal(game.scoreElement.textContent, "0");
  assert.equal(game.timers.get(1).ms, 500);
  assert.equal(game.run("nextPiece.y"), 0);
});

test("라인 삭제로 레벨이 올라도 다음 블록 생성이 막히면 타이머를 중단한다", () => {
  const game = loadGame();
  game.run("score = 900; board[0][3] = 'O'; board[19].fill('J'); board[19].fill(0, 3, 7); currentPiece.y = 19; nextPiece = { type: 'T', shape: TETROMINOES.T.shape.map(row => [...row]), x: 3, y: 0 }; dropPiece()");
  assert.equal(game.run("level"), 2);
  assert.equal(game.run("isGameOver"), true);
  assert.equal(game.timers.size, 0);
  assert.equal(game.run("currentPiece"), null);
});

test("실제 난수 선택 경로로 7종 모두 생성되고 상단 중앙에 배치된다", () => {
  const types = ["I", "O", "T", "S", "Z", "J", "L"];
  for (let index = 0; index < types.length; index++) {
    const game = loadGame([index / 7, index / 7]);
    assert.equal(game.run("currentPiece.type"), types[index]);
    assert.equal(game.run("nextPiece.type"), types[index]);
    assert.equal(game.run("currentPiece.shape.flat().filter(cell => cell === 1).length"), 4);
    assert.equal(game.run("currentPiece.x === Math.floor((10 - currentPiece.shape[0].length) / 2) && currentPiece.y === 0"), true);
    assert.equal(game.run("hasCollision(board, currentPiece)"), false);
    assert.equal(game.run("currentPiece.shape.some((row, index) => row === nextPiece.shape[index])"), false);
  }
});

test("7종 각각 키 입력으로 이동·회전·Soft Drop·Hard Drop 후 정확히 고정된다", () => {
  for (let index = 0; index < 7; index++) {
    const game = loadGame([index / 7, index / 7]);
    const initial = game.snapshot("currentPiece");
    game.key("ArrowLeft");
    assert.equal(game.run("currentPiece.x"), initial.x - 1);
    game.key("ArrowRight");
    assert.equal(game.run("currentPiece.x"), initial.x);
    for (let rotation = 0; rotation < 4; rotation++) game.key("ArrowUp");
    assert.deepEqual(game.snapshot("currentPiece.shape"), initial.shape);
    game.key("ArrowDown");
    assert.equal(game.run("currentPiece.y"), 1);
    game.timers.get(1).callback();
    assert.equal(game.run("currentPiece.y"), 2);
    game.key(" ");
    assert.equal(game.run("board.flat().filter(cell => cell !== 0).length"), 4);
    assert.equal(game.run(`board.flat().filter(cell => cell === '${initial.type}').length`), 4);
    assert.equal(game.run("board[19].some(cell => cell !== 0)"), true);
    assert.equal(game.run("currentPiece.y"), 0);
    assert.equal(game.run("score"), 0);
  }
});

test("점수 0에서 실제 키 조작으로 4줄을 동시에 삭제하면 정확히 800점이다", () => {
  const game = loadGame();
  // 하단 네 줄의 같은 열에 빈 칸을 만들고, 생성된 I 블록을 회전해 채웁니다.
  game.run("for (let y = 16; y < 20; y++) { board[y].fill('J'); board[y][3] = 0; }");
  game.key("ArrowUp");
  game.key(" ");
  assert.equal(game.run("score"), 800);
  assert.equal(game.scoreElement.textContent, "800");
  assert.equal(game.run("board.length"), 20);
  assert.equal(game.run("board.flat().every(cell => cell === 0)"), true);
  assert.equal(game.run("currentPiece.y"), 0);
  assert.equal(game.run("isGameOver"), false);
  // 줄을 지우지 않은 다음 고정에는 점수를 추가하지 않습니다.
  game.key(" ");
  assert.equal(game.run("score"), 800);
  assert.equal(game.scoreElement.textContent, "800");
});
