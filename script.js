"use strict";

// 보드 좌표는 픽셀이 아닌 칸 단위로 관리합니다. x는 열, y는 행입니다.
const BOARD_COLUMNS = 10;
const BOARD_ROWS = 20;
const DROP_INTERVAL_MS = 500; // 약 0.5초마다 한 칸 내려갑니다.
const LINE_SCORES = [0, 100, 300, 500, 800];
const SCORE_PER_LEVEL = 1000;
const SPEED_STEP_MS = 40; // 레벨마다 40ms씩 줄여 서서히 빨라집니다.
const MIN_DROP_INTERVAL_MS = 100; // 지나치게 빨라지지 않도록 하한을 둡니다.

// 각 행을 새 배열로 만들어 한 칸의 변경이 다른 행에 영향을 주지 않게 합니다.
// 0은 빈 칸입니다. 이후 고정된 블록을 저장할 때는 종류 이름(I, O 등)을 사용합니다.
const board = Array.from({ length: BOARD_ROWS }, () =>
  Array(BOARD_COLUMNS).fill(0)
);

// 모양 배열에서 1은 블록이 차지하는 칸, 0은 모양 내부의 빈 칸입니다.
// 각 테트로미노는 정확히 네 칸이며, 종류마다 다른 색상을 사용합니다.
const TETROMINOES = {
  I: {
    shape: [[1, 1, 1, 1]],
    color: "#00cfe8", // 하늘색
  },
  O: {
    shape: [
      [1, 1],
      [1, 1],
    ],
    color: "#ffd447", // 노란색
  },
  T: {
    shape: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    color: "#b56cff", // 보라색
  },
  S: {
    shape: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    color: "#5ed65e", // 초록색
  },
  Z: {
    shape: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    color: "#ff5b65", // 빨간색
  },
  J: {
    shape: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    color: "#4d85ff", // 파란색
  },
  L: {
    shape: [
      [0, 0, 1],
      [1, 1, 1],
    ],
    color: "#ff9b3d", // 주황색
  },
};

// 종류를 무작위로 선택하고, 원본을 복사한 새 블록을 상단 중앙에 만듭니다.
function createPiece() {
  const types = Object.keys(TETROMINOES);
  const type = types[Math.floor(Math.random() * types.length)];
  const shape = TETROMINOES[type].shape.map((row) => [...row]);
  return {
    type,
    shape,
    x: Math.floor((BOARD_COLUMNS - shape[0].length) / 2),
    y: 0,
  };
}

let currentPiece = null;
let nextPiece = null;
let isGameOver = false;
let dropTimer = null;
let score = 0;
let level = 1;

function getLevel(totalScore) {
  return Math.floor(totalScore / SCORE_PER_LEVEL) + 1;
}

function getDropInterval(levelNumber) {
  return Math.max(
    MIN_DROP_INTERVAL_MS,
    DROP_INTERVAL_MS - (levelNumber - 1) * SPEED_STEP_MS
  );
}

// 속도 변경과 재시작 모두 이전 타이머를 해제한 뒤 하나만 등록합니다.
function startDropTimer() {
  clearInterval(dropTimer);
  dropTimer = setInterval(dropPiece, getDropInterval(level));
}

// 지정한 위치의 충돌 여부만 확인하며 보드와 블록을 변경하지 않습니다.
// 보드를 인수로 받아 화면과 독립적으로 경계와 블록 겹침을 테스트할 수 있습니다.
function hasCollision(grid, piece, nextX = piece.x, nextY = piece.y) {
  for (let offsetY = 0; offsetY < piece.shape.length; offsetY += 1) {
    for (let offsetX = 0; offsetX < piece.shape[offsetY].length; offsetX += 1) {
      // 모양 내부의 빈 칸은 충돌 판정에서 제외합니다.
      if (piece.shape[offsetY][offsetX] === 0) continue;

      const x = nextX + offsetX;
      const y = nextY + offsetY;
      // 배열을 읽기 전에 상하좌우 경계를 검사해 범위 밖 접근을 방지합니다.
      if (x < 0 || x >= BOARD_COLUMNS || y < 0 || y >= BOARD_ROWS) {
        return true;
      }
      if (grid[y][x] !== 0) return true;
    }
  }
  return false;
}

// 현재 위치가 유효한지 확인한 뒤 네 칸을 종류 이름으로 보드에 기록합니다.
function lockPiece(grid, piece) {
  if (hasCollision(grid, piece)) return false;

  piece.shape.forEach((row, offsetY) => {
    row.forEach((cell, offsetX) => {
      if (cell === 1) grid[piece.y + offsetY][piece.x + offsetX] = piece.type;
    });
  });
  return true;
}

// 완성되지 않은 행만 남깁니다. 인접하거나 떨어진 여러 줄도 함께 제거합니다.
// 지워진 행 수만큼 상단에 서로 독립된 빈 행을 넣어 보드 높이를 유지합니다.
function clearCompletedLines(grid) {
  const remainingRows = grid.filter((row) => row.some((cell) => cell === 0));
  const clearedCount = grid.length - remainingRows.length;
  const emptyRows = Array.from({ length: clearedCount }, () =>
    Array(BOARD_COLUMNS).fill(0)
  );
  // 기존 board 참조는 유지하면서 내용을 교체합니다.
  grid.splice(0, grid.length, ...emptyRows, ...remainingRows);
  return clearedCount;
}

// 새 블록의 생성 공간이 막히면 중단해 기존 블록이 덮어써지지 않게 합니다.
function stopGame() {
  isGameOver = true;
  currentPiece = null;
  clearInterval(dropTimer);
  dropTimer = null;
}

// 진행 중과 게임 종료 후 모두 같은 초기화 경로를 사용합니다.
function restartGame() {
  // 먼저 이전 타이머를 해제해 여러 번 클릭해도 하강 루프는 하나만 유지합니다.
  clearInterval(dropTimer);
  dropTimer = null;
  board.forEach((row) => row.fill(0));
  score = 0;
  level = 1;
  isGameOver = false;
  currentPiece = createPiece();
  nextPiece = createPiece();
  draw();
  startDropTimer();
}

// 블록이 더 내려갈 수 없을 때 한 턴을 마무리합니다.
// 고정 → 줄 제거·점수 → 다음 블록 → 레벨 순서를 한곳에서 관리합니다.
function finishPieceTurn() {
  if (!lockPiece(board, currentPiece)) {
    stopGame();
    return;
  }

  // 줄을 먼저 정리해야 새 블록의 생성 공간을 정확히 검사할 수 있습니다.
  const clearedCount = clearCompletedLines(board);
  score += LINE_SCORES[clearedCount];
  if (hasCollision(board, nextPiece)) {
    stopGame();
  } else {
    // 미리 보여 준 블록을 그대로 활성 블록으로 넘기고 다음 후보를 뽑습니다.
    currentPiece = nextPiece;
    nextPiece = createPiece();
  }

  const newLevel = getLevel(score);
  if (newLevel !== level) {
    level = newLevel;
    // 게임 오버와 동시에 레벨이 올라도 중단한 타이머를 재시작하지 않습니다.
    if (!isGameOver) startDropTimer();
  }
}

// 타이머와 Soft Drop의 진입점입니다. 이동 여부를 결정한 뒤 화면을 갱신합니다.
function dropPiece() {
  if (isGameOver || currentPiece === null) return;

  if (!hasCollision(board, currentPiece, currentPiece.x, currentPiece.y + 1)) {
    currentPiece.y += 1;
  } else {
    // 아래가 막혔다면 현재 위치를 유지한 채 고정합니다.
    finishPieceTurn();
  }
  draw();
}

// 좌우 이동은 목적지가 비어 있을 때만 적용합니다.
function movePiece(direction) {
  if (isGameOver || currentPiece === null) return;
  const nextX = currentPiece.x + direction;
  if (!hasCollision(board, currentPiece, nextX, currentPiece.y)) {
    currentPiece.x = nextX;
    draw();
  }
}

// 행과 열을 바꾸고 행의 순서를 뒤집어 시계 방향으로 90도 회전합니다.
// 새 배열을 반환하므로 기존 모양과 원본 정의는 변경되지 않습니다.
// 직사각형인 I(1×4), T(2×3) 등도 회전 후 크기가 올바르게 바뀝니다.
function rotateShapeClockwise(shape) {
  return Array.from({ length: shape[0].length }, (_, y) =>
    Array.from({ length: shape.length }, (_, x) =>
      shape[shape.length - 1 - x][y]
    )
  );
}

function rotatePiece() {
  if (isGameOver || currentPiece === null) return;
  const rotatedShape = rotateShapeClockwise(currentPiece.shape);
  const candidate = { ...currentPiece, shape: rotatedShape };

  // 벽이나 고정 블록과 겹치면 회전을 취소합니다. 위치 보정은 하지 않습니다.
  if (!hasCollision(board, candidate)) {
    currentPiece.shape = rotatedShape;
    draw();
  }
}

// 아래쪽의 마지막 유효한 위치까지 이동한 뒤 즉시 고정합니다.
function hardDrop() {
  if (isGameOver || currentPiece === null) return;
  while (!hasCollision(board, currentPiece, currentPiece.x, currentPiece.y + 1)) {
    currentPiece.y += 1;
  }
  // 이미 아래가 막혔으므로 기존 고정·새 블록 생성 절차를 그대로 사용합니다.
  dropPiece();
}

function handleKeyDown(event) {
  const actions = {
    ArrowLeft: () => movePiece(-1),
    ArrowRight: () => movePiece(1),
    ArrowDown: dropPiece, // 누르거나 길게 누를 때 한 칸씩 빠르게 하강합니다.
    ArrowUp: rotatePiece,
    " ": hardDrop,
  };
  // 일반 문자 키는 무시하고 게임 조작 키의 페이지 스크롤만 막습니다.
  if (!Object.hasOwn(actions, event.key)) return;
  event.preventDefault();
  if (isGameOver) return;

  // 스페이스바를 계속 누르고 있어도 새 블록까지 연속 고정하지 않습니다.
  if (event.key === " " && event.repeat) return;
  actions[event.key]();
}

// index.html의 defer 속성 덕분에 캔버스가 만들어진 뒤 이 코드가 실행됩니다.
const canvas = document.getElementById("game-board");
const context = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const levelElement = document.getElementById("level");
const nextCanvas = document.getElementById("next-board");
const nextContext = nextCanvas.getContext("2d");
const CELL_WIDTH = canvas.width / BOARD_COLUMNS;
const CELL_HEIGHT = canvas.height / BOARD_ROWS;

// 한 칸을 그립니다. 가장자리 여백은 아래쪽 격자선이 보이도록 남깁니다.
function drawCell(x, y, color) {
  context.fillStyle = color;
  context.fillRect(
    x * CELL_WIDTH + 1,
    y * CELL_HEIGHT + 1,
    CELL_WIDTH - 2,
    CELL_HEIGHT - 2
  );
}

// 크기가 다른 7종 모양을 미리보기 캔버스의 가운데에 맞춰 그립니다.
// CSS로 캔버스 표시 크기가 변해도 내부 좌표와 상태는 바꾸지 않습니다.
function drawNext() {
  nextContext.fillStyle = "#000";
  nextContext.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (nextPiece === null) return;

  const cellSize = 24;
  const offsetX = (nextCanvas.width - nextPiece.shape[0].length * cellSize) / 2;
  const offsetY = (nextCanvas.height - nextPiece.shape.length * cellSize) / 2;
  nextContext.fillStyle = TETROMINOES[nextPiece.type].color;
  nextPiece.shape.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell === 1) {
        nextContext.fillRect(
          offsetX + x * cellSize + 1,
          offsetY + y * cellSize + 1,
          cellSize - 2,
          cellSize - 2
        );
      }
    });
  });
}

// 배경, 격자, 이미 고정된 블록을 순서대로 그립니다.
function drawBoard() {
  // 다시 호출해도 이전 그림이 남지 않도록 전체를 검은색으로 덮습니다.
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // 빈 보드에서도 10×20칸을 구분할 수 있도록 얇은 격자를 표시합니다.
  context.strokeStyle = "#282828";
  context.lineWidth = 1;
  for (let y = 0; y < BOARD_ROWS; y += 1) {
    for (let x = 0; x < BOARD_COLUMNS; x += 1) {
      context.strokeRect(
        x * CELL_WIDTH + 0.5,
        y * CELL_HEIGHT + 0.5,
        CELL_WIDTH - 1,
        CELL_HEIGHT - 1
      );

      // 고정 블록 데이터가 생기면 해당 종류의 색으로 그립니다.
      if (board[y][x] !== 0) {
        drawCell(x, y, TETROMINOES[board[y][x]].color);
      }
    }
  }
}

function drawCurrentPiece() {
  // 현재 블록은 보드에 기록하지 않고 별도로 겹쳐 그립니다.
  // 모양 배열의 빈 칸(0)은 그리지 않습니다.
  if (currentPiece !== null) {
    currentPiece.shape.forEach((row, offsetY) => {
      row.forEach((cell, offsetX) => {
        if (cell === 1) {
          drawCell(
            currentPiece.x + offsetX,
            currentPiece.y + offsetY,
            TETROMINOES[currentPiece.type].color
          );
        }
      });
    });
  }
}

function drawGameOver() {
  // 상단이 막혀 게임이 중단되면 이유를 화면에 표시합니다.
  if (isGameOver) {
    context.fillStyle = "rgba(0, 0, 0, 0.7)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.font = "bold 28px sans-serif";
    context.textAlign = "center";
    context.fillText("게임 오버", canvas.width / 2, canvas.height / 2);
  }
}

// 외부에서 사용하는 그리기 진입점입니다. 상태 변경 없이 화면만 갱신합니다.
// 보드 위에 활성 블록을 그리고 종료 안내를 마지막에 겹치는 순서를 유지합니다.
function draw() {
  scoreElement.textContent = String(score);
  levelElement.textContent = String(level);
  drawNext();
  drawBoard();
  drawCurrentPiece();
  drawGameOver();
}

// 최초 화면을 표시한 뒤 자동 하강과 키보드 조작을 시작합니다.
// 리스너는 초기화 시 한 번만 등록하며 draw()에서는 등록하지 않습니다.
document.addEventListener("keydown", handleKeyDown);
document.getElementById("restart-button").addEventListener("click", restartGame);
restartGame();
