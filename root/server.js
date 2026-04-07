import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Generic pairing logic
let waitingSocket = null;
const pairs = new Map(); // socket.id -> partner's socket.id

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // New generic join event
  socket.on('join chat', () => {
    if (waitingSocket && waitingSocket.id !== socket.id) {
      // Pair with waiting user
      pairs.set(socket.id, waitingSocket.id);
      pairs.set(waitingSocket.id, socket.id);
      socket.emit('paired');
      waitingSocket.emit('paired');
      waitingSocket = null;
    } else {
      waitingSocket = socket;
      socket.emit('waiting');
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
    if (waitingSocket && waitingSocket.id === socket.id) waitingSocket = null;
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