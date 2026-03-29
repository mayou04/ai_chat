
import { useState } from 'react';
import './App.css';

const messages = [
  { sender: 'Prompter', text: 'Hello! Who are you?' },
  { sender: 'AI', text: 'I am your friendly doodle AI!' },
  { sender: 'Prompter', text: 'Let’s chat in doodle style.' },
  { sender: 'AI', text: 'Absolutely! This UI is all about fun.' },
];

function App() {
  const [role, setRole] = useState<'AI' | 'Prompter'>('Prompter');

  return (
    <div className="doodly-app">
      <header className="doodly-header">
        <h1>Doodly Chatbot</h1>
        <div className="role-toggle">
          <span className={role === 'Prompter' ? 'active' : ''} onClick={() => setRole('Prompter')}>Prompter</span>
          <span className="divider">|</span>
          <span className={role === 'AI' ? 'active' : ''} onClick={() => setRole('AI')}>AI</span>
        </div>
      </header>
      <main className="doodly-chat">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`doodly-bubble ${msg.sender === 'AI' ? 'ai' : 'prompter'}`}
          >
            <div className="doodly-avatar">
              {msg.sender === 'AI' ? '🤖' : '🙂'}
            </div>
            <div className="doodly-text">{msg.text}</div>
          </div>
        ))}
      </main>
      <footer className="doodly-footer">
        <div className="doodly-input-placeholder">
          <span>{role === 'AI' ? 'AI' : 'Prompter'} typing…</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
