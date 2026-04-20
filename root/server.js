
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

// Endpoint to list available Gemini models
app.get('/api/gemini-listmodels', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  res.setHeader('Content-Type', 'application/json');
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not set on server.' });
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await axios.get(url, { responseType: 'json' });
    res.status(200).json(response.data);
  } catch (err) {
    if (err.response && err.response.data) {
      res.status(500).json({ error: 'Gemini API error', details: err.response.data });
    } else {
      res.status(500).json({ error: 'Gemini API error', details: String(err) });
    }
  }
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
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    console.log('[Gemini] Response:', JSON.stringify(geminiRes.data));
    const text = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ text });
  } catch (err) {
    if (err.response) {
      console.error('[Gemini] API error response:', err.response.status, err.response.data);
      res.status(500).json({ error: 'Gemini API error', details: err.response.data });
    } else {
      console.error('[Gemini] API error:', err);
      res.status(500).json({ error: 'Gemini API error', details: String(err) });
    }
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
});

app.use(express.json());

app.post('/api/gemini', async (req, res) => {
  const prompt = req.body.prompt;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not set on server.' });
  }
  try {
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    const text = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ text });
  } catch (err) {
    console.error('Gemini API error:', err?.response?.data || err);
    res.status(500).json({ error: 'Gemini API error' });
  }
});

// Endpoint to list available Gemini models for debugging
app.get('/api/gemini-models', async (req, res) => {
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not set on server.' });
  }
  try {
    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    res.json(response.data);
  } catch (err) {
    console.error('Gemini ListModels error:', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to list Gemini models.' });
  }
});