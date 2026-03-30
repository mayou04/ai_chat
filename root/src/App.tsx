import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('http://localhost:3001');

type Message = { sender: string; text: string };

function App() {
  const [role, setRole] = useState<'AI' | 'Human' | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'entry' | 'waiting' | 'paired' | 'disconnected'>('entry');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('chat message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });
    socket.on('waiting', () => {
      setStatus('waiting');
    });
    socket.on('paired', () => {
      setStatus('paired');
    });
    socket.on('partner disconnected', () => {
      setStatus('disconnected');
    });
    return () => {
      socket.off('chat message');
      socket.off('waiting');
      socket.off('paired');
      socket.off('partner disconnected');
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const chooseRole = (chosen: 'AI' | 'Human') => {
    setRole(chosen);
    socket.emit('choose role', chosen);
  };

  const sendMessage = () => {
    if (input.trim()) {
      const msg = { sender: role as string, text: input };
      socket.emit('chat message', msg);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendMessage();
  };

  const resetToEntry = () => {
    socket.disconnect();
    setRole(null);
    setMessages([]);
    setInput('');
    setStatus('entry');
    setTimeout(() => socket.connect(), 100);
  };

  if (status === 'entry') {
    return (
      <div className="doodly-app" style={{ justifyContent: 'center', alignItems: 'center', display: 'flex', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h1>Choose your role</h1>
          <button className="doodly-send" style={{ margin: 12, fontSize: 22 }} onClick={() => chooseRole('Human')}>Enter as Human</button>
          <button className="doodly-send" style={{ margin: 12, fontSize: 22 }} onClick={() => chooseRole('AI')}>Enter as AI</button>
        </div>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="doodly-app" style={{ justifyContent: 'center', alignItems: 'center', display: 'flex', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h2>Waiting for a partner to join as {role === 'AI' ? 'Human' : 'AI'}...</h2>
          <button className="doodly-send" style={{ margin: 12, fontSize: 18 }} onClick={resetToEntry}>Cancel</button>
        </div>
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="doodly-app" style={{ justifyContent: 'center', alignItems: 'center', display: 'flex', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', width: '100%' }}>
          <h2>Your partner disconnected.</h2>
          <button className="doodly-send" style={{ margin: 12, fontSize: 18 }} onClick={resetToEntry}>Restart</button>
        </div>
      </div>
    );
  }

  const quitChat = () => {
    socket.disconnect();
    setRole(null);
    setMessages([]);
    setInput('');
    setStatus('entry');
    setTimeout(() => socket.connect(), 100); // reconnect after state reset
  };

  return (
    <div className="doodly-app">
      <header className="doodly-header" style={{ position: 'relative' }}>
        <h1>Doodly Chatbot</h1>
        <button className="doodly-send" style={{ position: 'absolute', right: 24, top: 24 }} onClick={quitChat}>Quit</button>
      </header>
      <main className="doodly-chat">
        {messages.map((msg, idx) => {
          const isMe = msg.sender === role;
          return (
            <div
              key={idx}
              className={`doodly-bubble ${isMe ? 'me' : 'partner'} ${msg.sender === 'AI' ? 'ai' : 'human'}`}
              style={{ alignSelf: isMe ? 'flex-end' : 'flex-start' }}
            >
              <div className="doodly-avatar">
                {msg.sender === 'AI' ? '🤖' : '🙂'}
              </div>
              <div className="doodly-text">{msg.text}</div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </main>
      <footer className="doodly-footer">
        <input
          className="doodly-input"
          type="text"
          placeholder={`Type as ${role}...`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="doodly-send" onClick={sendMessage}>Send</button>
      </footer>
    </div>
  );
}

export default App;
