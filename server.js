const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// In-memory rooms: restarting the server clears all rooms.
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    players: room.players.length,
    names: room.players.map(p => p.name),
    status: room.players.length >= 2 ? "ready" : "waiting"
  };
}

io.on("connection", socket => {
  socket.on("create-room", ({ name } = {}, callback = () => {}) => {
    const cleanName = String(name || "玩家 1").trim().slice(0, 16) || "玩家 1";
    const code = makeRoomCode();
    const room = {
      code,
      players: [{ id: socket.id, name: cleanName, side: 0 }],
      paddles: { 0: 0.5, 1: 0.5 },
      createdAt: Date.now()
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.side = 0;
    callback({ ok: true, code, side: 0, room: publicRoom(room) });
    io.to(code).emit("room-update", publicRoom(room));
  });

  socket.on("join-room", ({ code, name } = {}, callback = () => {}) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return callback({ ok: false, message: "找不到這個房間，請確認代碼。" });
    if (room.players.length >= 2) return callback({ ok: false, message: "這個房間已經滿了。" });

    const cleanName = String(name || "玩家 2").trim().slice(0, 16) || "玩家 2";
    const player = { id: socket.id, name: cleanName, side: 1 };
    room.players.push(player);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.side = 1;
    callback({ ok: true, code: roomCode, side: 1, room: publicRoom(room) });
    io.to(roomCode).emit("room-update", publicRoom(room));
    io.to(roomCode).emit("match-start", {
      code: roomCode,
      players: room.players.map(p => ({ name: p.name, side: p.side }))
    });
  });

  socket.on("paddle-move", ({ y } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !Number.isInteger(socket.data.side)) return;
    room.paddles[socket.data.side] = Math.max(0.08, Math.min(0.92, Number(y) || 0.5));
    socket.to(room.code).emit("opponent-paddle", {
      side: socket.data.side,
      y: room.paddles[socket.data.side]
    });
  });

  // Side 0 is the simulation host. It publishes authoritative ball/score snapshots.
  socket.on("game-state", state => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.side !== 0 || !state) return;
    socket.to(room.code).emit("game-state", {
      ball: state.ball,
      score: state.score,
      running: !!state.running,
      paddles: room.paddles
    });
  });

  socket.on("rematch", () => {
    const room = rooms.get(socket.data.roomCode);
    if (room) io.to(room.code).emit("rematch");
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      io.to(code).emit("opponent-left", { message: "對手已離開房間。" });
      io.to(code).emit("room-update", publicRoom(room));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Ping Pong server listening on port ${PORT}`);
});
