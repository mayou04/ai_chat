import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Pairing logic
let waitingHuman = null;
let waitingAI = null;
const pairs = new Map(); // socket.id -> partner's socket.id

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('choose role', (role) => {
    socket.data.role = role;
    if (role === 'Human') {
      if (waitingAI) {
        // Pair with waiting AI
        pairs.set(socket.id, waitingAI.id);
        pairs.set(waitingAI.id, socket.id);
        socket.emit('paired', { partner: 'AI' });
        waitingAI.emit('paired', { partner: 'Human' });
        waitingAI = null;
      } else {
        waitingHuman = socket;
        socket.emit('waiting');
      }
    } else if (role === 'AI') {
      if (waitingHuman) {
        // Pair with waiting Human
        pairs.set(socket.id, waitingHuman.id);
        pairs.set(waitingHuman.id, socket.id);
        socket.emit('paired', { partner: 'Human' });
        waitingHuman.emit('paired', { partner: 'AI' });
        waitingHuman = null;
      } else {
        waitingAI = socket;
        socket.emit('waiting');
      }
    }
  });

  socket.on('chat message', (msg) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId && io.sockets.sockets.get(partnerId)) {
      io.sockets.sockets.get(partnerId).emit('chat message', msg);
      socket.emit('chat message', msg); // echo back to sender
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove from waiting
    if (waitingHuman && waitingHuman.id === socket.id) waitingHuman = null;
    if (waitingAI && waitingAI.id === socket.id) waitingAI = null;
    // Remove pair
    const partnerId = pairs.get(socket.id);
    if (partnerId && io.sockets.sockets.get(partnerId)) {
      io.sockets.sockets.get(partnerId).emit('partner disconnected');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
  });
});

server.listen(3001, () => {
  console.log('Socket.io server running on http://localhost:3001');
});