import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Set Content Security Policy header for all responses
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
  next();
});

// Serve static files from dist in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  // Universal handler for React SPA (Express 5 compatible)
  app.use((req, res, next) => {
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/socket.io') &&
      !req.path.startsWith('/api') // adjust/remove if you have API routes
    ) {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
      next();
    }
  });
}

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
      // Randomly choose who starts
      const sockets = [socket, waitingSocket];
      const firstIdx = Math.floor(Math.random() * 2);
      const firstId = sockets[firstIdx].id;
      const secondId = sockets[1 - firstIdx].id;
      // Emit paired with info about who starts
      sockets[0].emit('paired', { firstId });
      sockets[1].emit('paired', { firstId });
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
});