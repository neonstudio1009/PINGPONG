(() => {
  const $ = id => document.getElementById(id);
  const screens = ["lobby", "onlineSetup", "waitingRoom", "gameScreen"];
  const socket = typeof io === "function" ? io({ autoConnect: false }) : null;
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");

  let mode = "solo";
  let roomCode = "";
  let mySide = 0;
  let myName = "你";
  let opponentName = "電腦";
  let roomPlayers = [];
  let connected = false;
  let matchStarted = false;
  let running = false;
  let gameOver = false;
  let soundOn = false;
  let animationId = 0;
  let lastTime = 0;
  let publishTimer = 0;
  const winningScore = 7;
  const game = {
    width: 960, height: 540,
    paddleH: 94, paddleW: 13,
    leftY: 270, rightY: 270,
    ball: { x: 480, y: 270, vx: 330, vy: 130, r: 9 },
    score: [0, 0]
  };

  function showScreen(id) {
    screens.forEach(s => $(s).classList.toggle("active", s === id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2300);
  }
  function showError(message) { $("setupError").textContent = message || ""; }
  function connectSocket() {
    if (!socket) { showError("目前無法載入連線模組，請重新整理網頁。"); return false; }
    if (socket.connected) { connected = true; return true; }
    socket.connect();
    return true;
  }
  function resetGame() {
    game.leftY = game.height / 2;
    game.rightY = game.height / 2;
    game.score = [0, 0];
    game.ball = { x: game.width / 2, y: game.height / 2, vx: 330 * (Math.random() > .5 ? 1 : -1), vy: (Math.random() * 180 - 90), r: 9 };
    running = false;
    gameOver = false;
    $("leftScore").textContent = "0";
    $("rightScore").textContent = "0";
    $("courtOverlay").classList.remove("hidden");
    $("overlayTitle").textContent = "準備開打？";
    $("overlayText").textContent = mode === "online" ? "雙方都準備好後，開始比賽。" : "移動滑鼠或手指，控制你的球拍。";
    $("startGameBtn").textContent = "開始比賽　→";
    $("startGameBtn").disabled = false;
    draw();
  }
  function setupGame(nextMode) {
    mode = nextMode;
    $("gameModeLabel").textContent = mode === "solo" ? "SOLO MATCH" : "ONLINE MATCH";
    $("leftPlayerName").textContent = mySide === 0 ? myName : opponentName;
    $("rightPlayerName").textContent = mode === "solo" ? "電腦" : (mySide === 0 ? (opponentName || "對手") : myName);
    $("gameHint").textContent = `先得到 ${winningScore} 分獲勝`;
    $("soundToggle").textContent = `音效：${soundOn ? "開" : "關"}`;
    showScreen("gameScreen");
    resizeCanvas();
    resetGame();
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(canvas.width / game.width, 0, 0, canvas.height / game.height, 0, 0);
    draw();
  }
  function draw() {
    const w = game.width, h = game.height;
    ctx.clearRect(0, 0, w, h);
    // Court and subtle lighting
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#183e58"); gradient.addColorStop(1, "#102a43");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(5,13,25,.12)";
    for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 1, h);
    ctx.strokeStyle = "rgba(222,240,255,.65)"; ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.beginPath(); ctx.moveTo(w/2, 18); ctx.lineTo(w/2, h-18); ctx.stroke();
    ctx.strokeStyle = "rgba(222,240,255,.23)"; ctx.lineWidth = 1;
    ctx.setLineDash([8, 11]); ctx.beginPath(); ctx.moveTo(w/2, 18); ctx.lineTo(w/2, h-18); ctx.stroke(); ctx.setLineDash([]);
    // Net
    ctx.fillStyle = "rgba(5,12,22,.45)"; ctx.fillRect(w/2-3, 18, 6, h-36);
    ctx.strokeStyle = "rgba(211,229,255,.22)";
    for (let y = 24; y < h-18; y += 12) { ctx.beginPath(); ctx.moveTo(w/2-5,y); ctx.lineTo(w/2+5,y); ctx.stroke(); }
    // Paddles
    drawPaddle(35, game.leftY, "#d6ff6b");
    drawPaddle(w-35, game.rightY, "#7aa7ff");
    // Ball glow and ball
    const b = game.ball;
    ctx.beginPath(); ctx.arc(b.x, b.y, 19, 0, Math.PI*2); ctx.fillStyle = "rgba(255,232,157,.11)"; ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fillStyle = "#ffe9a1"; ctx.fill();
    ctx.beginPath(); ctx.arc(b.x-2, b.y-3, 3, 0, Math.PI*2); ctx.fillStyle = "#fff9dd"; ctx.fill();
  }
  function drawPaddle(x, y, color) {
    const h = game.paddleH, w = game.paddleW;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 17;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x-w/2, y-h/2, w, h, 7); ctx.fill();
    ctx.restore();
  }
  function setPaddleFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const y = Math.max(game.paddleH/2+18, Math.min(game.height-game.paddleH/2-18, (event.clientY - rect.top) / rect.height * game.height));
    if (mode === "solo" || mySide === 0) game.leftY = y;
    else game.rightY = y;
    if (mode === "online" && socket && socket.connected) {
      socket.emit("paddle-move", { y: y / game.height });
    }
    draw();
  }
  canvas.addEventListener("pointermove", event => { if (running) setPaddleFromPointer(event); });
  canvas.addEventListener("pointerdown", event => { if (running) { canvas.setPointerCapture?.(event.pointerId); setPaddleFromPointer(event); } });
  window.addEventListener("resize", resizeCanvas);

  function startGame() {
    if (mode === "online" && !matchStarted) {
      toast("請等待兩位玩家都加入房間。"); return;
    }
    game.ball = { x: game.width/2, y: game.height/2, vx: 330 * (Math.random() > .5 ? 1 : -1), vy: Math.random()*160-80, r: 9 };
    if (mode === "online" && mySide === 1) game.ball.vx = -Math.abs(game.ball.vx);
    running = true; gameOver = false; lastTime = performance.now();
    $("courtOverlay").classList.add("hidden");
    cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(loop);
  }
  function loop(time) {
    if (!running) return;
    const dt = Math.min((time - lastTime) / 1000 || 0, 0.025);
    lastTime = time;
    if (mode === "solo" || (mode === "online" && mySide === 0)) updatePhysics(dt);
    if (mode === "solo") updateAI(dt);
    if (mode === "online" && mySide === 0) {
      publishTimer += dt;
      if (publishTimer >= 1/30 && socket && socket.connected) {
        publishTimer = 0;
        socket.emit("game-state", { ball: game.ball, score: game.score, running, paddles: {0: game.leftY/game.height, 1: game.rightY/game.height} });
      }
    }
    draw();
    animationId = requestAnimationFrame(loop);
  }
  function updateAI(dt) {
    const target = game.ball.x > game.width * .43 ? game.ball.y : game.height/2;
    const maxStep = 255 * dt;
    game.rightY += Math.max(-maxStep, Math.min(maxStep, target-game.rightY));
    game.rightY = Math.max(game.paddleH/2+18, Math.min(game.height-game.paddleH/2-18, game.rightY));
  }
  function updatePhysics(dt) {
    const b = game.ball;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y-b.r < 18 || b.y+b.r > game.height-18) { b.vy *= -1; b.y = Math.max(18+b.r, Math.min(game.height-18-b.r, b.y)); }
    const leftX = 35, rightX = game.width-35;
    if (b.vx < 0 && b.x-b.r <= leftX+game.paddleW/2 && Math.abs(b.y-game.leftY) < game.paddleH/2+b.r) {
      b.x = leftX+game.paddleW/2+b.r; b.vx = Math.abs(b.vx)*1.045;
      b.vy += (b.y-game.leftY)*3.2;
    } else if (b.vx > 0 && b.x+b.r >= rightX-game.paddleW/2 && Math.abs(b.y-game.rightY) < game.paddleH/2+b.r) {
      b.x = rightX-game.paddleW/2-b.r; b.vx = -Math.abs(b.vx)*1.045;
      b.vy += (b.y-game.rightY)*3.2;
    }
    b.vy = Math.max(-520, Math.min(520, b.vy));
    if (b.x < 0) pointScored(1);
    if (b.x > game.width) pointScored(0);
  }
  function pointScored(winner) {
    game.score[winner]++;
    $("leftScore").textContent = game.score[0];
    $("rightScore").textContent = game.score[1];
    if (game.score[winner] >= winningScore) {
      running = false; gameOver = true;
      const localWon = mode === "solo" ? winner === 0 : winner === mySide;
      $("overlayTitle").textContent = localWon ? "漂亮，拿下勝利！" : "這局結束了";
      $("overlayText").textContent = `${game.score[0]} : ${game.score[1]}　${localWon ? "打得好！" : "再來一局，扳回一城。"}`;
      $("startGameBtn").textContent = "再玩一局　→";
      $("courtOverlay").classList.remove("hidden");
      if (mode === "online" && socket && socket.connected) socket.emit("game-state", { ball: game.ball, score: game.score, running: false });
    } else {
      game.ball = { x: game.width/2, y: game.height/2, vx: 330*(winner===0?1:-1), vy: Math.random()*180-90, r: 9 };
    }
  }

  $("soloBtn").addEventListener("click", () => { mode = "solo"; mySide = 0; myName = "你"; opponentName = "電腦"; setupGame("solo"); });
  $("onlineBtn").addEventListener("click", () => { showError(""); showScreen("onlineSetup"); });
  $("backToLobby").addEventListener("click", () => showScreen("lobby"));
  $("homeBrand").addEventListener("click", e => { e.preventDefault(); leaveRoom(); showScreen("lobby"); });
  $("createRoomBtn").addEventListener("click", () => {
    showError("");
    myName = $("createName").value.trim() || "玩家 1";
    if (!connectSocket()) return;
    $("createRoomBtn").disabled = true;
    socket.emit("create-room", { name: myName }, result => {
      $("createRoomBtn").disabled = false;
      if (!result || !result.ok) return showError(result?.message || "建立房間失敗，請再試一次。");
      roomCode = result.code; mySide = result.side; mode = "online";
      $("displayRoomCode").textContent = roomCode;
      $("hostName").textContent = myName;
      $("guestName").textContent = "等待玩家加入…";
      $("guestStatus").textContent = "WAITING FOR PLAYER";
      $("guestReady").textContent = "···";
      $("startMatchBtn").disabled = true;
      $("startMatchBtn").textContent = "等待對手加入　→";
      $("waitingHint").textContent = "房間已建立，等待另一位玩家加入。";
      showScreen("waitingRoom");
    });
  });
  $("joinRoomBtn").addEventListener("click", () => {
    showError("");
    myName = $("joinName").value.trim() || "玩家 2";
    const code = $("roomCode").value.trim().toUpperCase();
    if (code.length !== 5) return showError("請輸入 5 個字元的房間代碼。");
    if (!connectSocket()) return;
    $("joinRoomBtn").disabled = true;
    socket.emit("join-room", { code, name: myName }, result => {
      $("joinRoomBtn").disabled = false;
      if (!result || !result.ok) return showError(result?.message || "加入房間失敗，請再試一次。");
      roomCode = result.code; mySide = result.side; mode = "online";
      showScreen("waitingRoom");
      $("displayRoomCode").textContent = roomCode;
      $("hostName").textContent = result.room.names[0] || "主場玩家";
      $("guestName").textContent = myName;
      $("guestStatus").textContent = "CONNECTED";
      $("guestReady").textContent = "✓";
      $("waitingHint").textContent = "已加入房間，等待比賽開始。";
      $("startMatchBtn").disabled = false;
      $("startMatchBtn").textContent = "進入球場　→";
    });
  });
  $("copyCodeBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(roomCode); toast("房間代碼已複製！"); }
    catch { toast("你的房間代碼是 " + roomCode); }
  });
  $("startMatchBtn").addEventListener("click", () => {
    if (!matchStarted && mySide === 0) { toast("請先等待朋友加入。"); return; }
    setupGame("online");
    $("leftPlayerName").textContent = mySide === 0 ? myName : opponentName;
    $("rightPlayerName").textContent = mySide === 0 ? opponentName : myName;
    $("overlayTitle").textContent = "對手已就位";
    $("overlayText").textContent = "雙方已連線，準備好就開始比賽。";
  });
  $("startGameBtn").addEventListener("click", () => {
    if (gameOver && mode === "online" && socket && socket.connected) socket.emit("rematch");
    startGame();
  });
  $("exitGame").addEventListener("click", () => { running = false; cancelAnimationFrame(animationId); if (mode === "online") leaveRoom(); showScreen("lobby"); });
  $("leaveWaiting").addEventListener("click", () => { leaveRoom(); showScreen("onlineSetup"); });
  $("soundToggle").addEventListener("click", () => { soundOn = !soundOn; $("soundToggle").textContent = `音效：${soundOn ? "開" : "關"}`; toast(soundOn ? "音效設定已開啟（音效功能尚未加入）" : "音效已關閉"); });
  function leaveRoom() {
    if (socket && socket.connected) socket.disconnect();
    roomCode = ""; matchStarted = false; running = false;
    if (socket) socket.connect(); // prepare for the next room
  }

  if (socket) {
    socket.on("connect", () => { connected = true; });
    socket.on("connect_error", () => {
      connected = false;
      if ($("onlineSetup").classList.contains("active")) showError("連不上遊戲伺服器。請確認伺服器已啟動，或檢查 Render 部署網址。");
    });
    socket.on("room-update", room => {
      roomPlayers = room.names || [];
      if ($("waitingRoom").classList.contains("active")) {
        $("hostName").textContent = roomPlayers[0] || "主場玩家";
        if (roomPlayers.length >= 2) {
          $("guestName").textContent = roomPlayers[1];
          $("guestStatus").textContent = "CONNECTED";
          $("guestReady").textContent = "✓";
          $("waitingHint").textContent = "兩位玩家都已連線，可以進入球場。";
          $("startMatchBtn").disabled = false;
          $("startMatchBtn").textContent = "進入球場　→";
          matchStarted = true;
        }
      }
    });
    socket.on("match-start", data => {
      matchStarted = true;
      roomPlayers = data.players || [];
      opponentName = roomPlayers.find(p => p.side !== mySide)?.name || "對手";
      if ($("waitingRoom").classList.contains("active")) {
        $("hostName").textContent = roomPlayers[0]?.name || "主場玩家";
        $("guestName").textContent = roomPlayers[1]?.name || "對手";
        $("guestStatus").textContent = "CONNECTED";
        $("guestReady").textContent = "✓";
        $("waitingHint").textContent = "對手已加入！點擊下方按鈕進入球場。";
        $("startMatchBtn").disabled = false;
        $("startMatchBtn").textContent = "進入球場　→";
      }
      toast("對手已加入房間！");
    });
    socket.on("opponent-paddle", data => {
      if (data.side === 0) game.leftY = data.y * game.height;
      else game.rightY = data.y * game.height;
      if (!running) draw();
    });
    socket.on("game-state", state => {
      if (mode !== "online" || mySide === 0) return;
      if (state.ball) game.ball = state.ball;
      if (state.score) {
        game.score = state.score;
        $("leftScore").textContent = state.score[0];
        $("rightScore").textContent = state.score[1];
      }
      if (state.paddles) {
        game.leftY = state.paddles[0] * game.height;
        game.rightY = state.paddles[1] * game.height;
      }
      if (!state.running && running) {
        running = false;
        $("overlayTitle").textContent = "這局結束了";
        $("overlayText").textContent = `${game.score[0]} : ${game.score[1]}`;
        $("startGameBtn").textContent = "再玩一局　→";
        $("courtOverlay").classList.remove("hidden");
      }
      draw();
    });
    socket.on("opponent-left", data => {
      running = false; matchStarted = false;
      toast(data?.message || "對手已離開房間。");
      if ($("gameScreen").classList.contains("active")) {
        $("courtOverlay").classList.remove("hidden");
        $("overlayTitle").textContent = "對手離線了";
        $("overlayText").textContent = "返回大廳或建立新的房間，再找朋友來玩吧。";
      }
    });
    socket.on("rematch", () => {
      if (mode === "online" && mySide === 1 && $("gameScreen").classList.contains("active")) {
        game.score = [0,0]; $("leftScore").textContent = "0"; $("rightScore").textContent = "0";
        game.ball = { x: game.width/2, y: game.height/2, vx: -330, vy: Math.random()*160-80, r: 9 };
        $("overlayTitle").textContent = "新的一局";
        $("overlayText").textContent = "準備好就開始吧。";
        $("courtOverlay").classList.remove("hidden");
      }
    });
  }

  resizeCanvas();
  // Draw a clean preview before the player enters a match.
  draw();
})();
