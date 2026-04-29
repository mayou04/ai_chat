
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});
const apiKey = process.env.GEMINI_API_KEY;

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
let waitingSince = null;
let waitingTimeout = null;
const pairs = new Map(); // socket.id -> partner's socket.id
const socketRoles = new Map(); // socket.id -> 'Human' | 'AI'

io.on('connection', (socket) => {
    // Listen for role selection
    socket.on('choose role', (role) => {
      // role is 'Human' or 'AI' (from client masking)
      socketRoles.set(socket.id, role);
    });
  console.log('A user connected:', socket.id);

  // New generic join event with delay logic
  socket.on('join chat', () => {
    if (waitingSocket && waitingSocket.id !== socket.id) {
      // If the minimum wait time hasn't passed, delay pairing
      const now = Date.now();
      const minWait = 5000; // 5 seconds
      const extraWait = Math.floor(Math.random() * 10000); // 0-10s extra
      const elapsed = waitingSince ? now - waitingSince : 0;
      const waitTime = Math.max(minWait - elapsed, 0) + extraWait;
      const doPair = () => {
        pairs.set(socket.id, waitingSocket.id);
        pairs.set(waitingSocket.id, socket.id);
        // Randomly choose who starts
        const sockets = [socket, waitingSocket];
        const firstIdx = Math.floor(Math.random() * 2);
        const firstId = sockets[firstIdx].id;
        const secondId = sockets[1 - firstIdx].id;
        // Get roles for both sockets
        const roleA = socketRoles.get(sockets[0].id) || 'Unknown';
        const roleB = socketRoles.get(sockets[1].id) || 'Unknown';
        // Send each their partner's type
        sockets[0].emit('paired', { firstId, partnerType: roleB });
        sockets[1].emit('paired', { firstId, partnerType: roleA });
        waitingSocket = null;
        waitingSince = null;
        waitingTimeout = null;
      };
      if (waitTime > 0) {
        if (waitingTimeout) clearTimeout(waitingTimeout);
        waitingTimeout = setTimeout(doPair, waitTime);
      } else {
        doPair();
      }
    } else {
      waitingSocket = socket;
      waitingSince = Date.now();
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

  socket.on('submit guess', (payload) => {
    const partnerId = pairs.get(socket.id);
    if (partnerId && io.sockets.sockets.get(partnerId)) {
      io.sockets.sockets.get(partnerId).emit('partner guess', payload);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove from waiting
    if (waitingSocket && waitingSocket.id === socket.id) {
      waitingSocket = null;
      waitingSince = null;
      if (waitingTimeout) {
        clearTimeout(waitingTimeout);
        waitingTimeout = null;
      }
    }
    // Remove pair
    const partnerId = pairs.get(socket.id);
    if (partnerId && io.sockets.sockets.get(partnerId)) {
      io.sockets.sockets.get(partnerId).emit('partner disconnected');
      pairs.delete(partnerId);
    }
    pairs.delete(socket.id);
    socketRoles.delete(socket.id);
  });
});

// Gemini AI API endpoint for RealAI bot
app.use(express.json());
app.post('/api/gemini', async (req, res) => {
  const prompt = req.body.prompt;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[Gemini] API key missing');
    return res.status(500).json({ error: 'Gemini API key not set on server.' });
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;
    console.log('[Gemini] Requesting:', url);
    console.log('[Gemini] Prompt:', prompt);
    const geminiRes = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 1.0,
          topP: 0.95,
        },
      },
      {
        timeout: 29000,
      }
    );
    console.log('[Gemini] Response:', JSON.stringify(geminiRes.data));
    // Extract only the last non-thought part as the reply
    const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
    // Prefer the last part without thought:true, else fallback to last part
    let reply = '';
    if (parts.length > 0) {
      const nonThoughtParts = parts.filter(p => !p.thought);
      reply = (nonThoughtParts.length > 0 ? nonThoughtParts[nonThoughtParts.length - 1].text : parts[parts.length - 1].text) || '';
    }
    res.json({ text: reply });
  } catch (err) {
    let errorMsg = 'Unknown Gemini API error.';
    let errorCode = 500;
    let errorType = 'GENERIC';
    if (err.response) {
      errorCode = err.response.status;
      if (err.response.data && err.response.data.error) {
        errorType = err.response.data.error.status || 'API_ERROR';
        errorMsg = err.response.data.error.message || JSON.stringify(err.response.data);
      } else {
        errorMsg = JSON.stringify(err.response.data);
      }
      console.error('[Gemini] API error response:', errorCode, errorType, errorMsg);
      res.status(errorCode).json({ error: 'Gemini API error', code: errorCode, type: errorType, message: errorMsg });
    } else if (err.code === 'ETIMEDOUT') {
      errorType = 'TIMEOUT';
      errorMsg = 'Request to Gemini API timed out.';
      console.error('[Gemini] API timeout:', errorMsg);
      res.status(504).json({ error: 'Gemini API timeout', code: 504, type: errorType, message: errorMsg });
    } else if (err.code === 'ECONNRESET') {
      errorType = 'CONNECTION_RESET';
      errorMsg = 'Connection to Gemini API was reset.';
      console.error('[Gemini] API connection reset:', errorMsg);
      res.status(502).json({ error: 'Gemini API connection reset', code: 502, type: errorType, message: errorMsg });
    } else {
      errorMsg = String(err);
      console.error('[Gemini] API error:', errorMsg);
      res.status(500).json({ error: 'Gemini API error', code: 500, type: errorType, message: errorMsg });
    }
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
});