import { useEffect, useRef, useState } from "react";
import personalitiesRaw from "./assets/personalities.txt?raw";
import { io, Socket } from "socket.io-client";


const socket: Socket =
  typeof window !== 'undefined'
    ? io(
        import.meta.env.MODE === 'development'
          ? 'http://localhost:3001'
          : window.location.origin
      )
    : ({} as Socket);

type Message = { sender: string; text: string };
type Role = "Human" | "FakeAI" | "RealAI";

// Parse personalities from the text file
function parsePersonalities(raw: string) {
  return raw
    .split(/---+/)
    .map((block) => {
      const nameMatch = block.match(/Name:\s*(.*)/);
      const personalityMatch = block.match(/Personality:\s*([\s\S]*)/);
      if (nameMatch && personalityMatch) {
        return {
          name: nameMatch[1].trim(),
          personality: personalityMatch[1].trim(),
        };
      }
      return null;
    })
    .filter(Boolean);
}

const personalities = parsePersonalities(personalitiesRaw);

function getRandomPersonality() {
  return personalities[Math.floor(Math.random() * personalities.length)];
}

function App() {
  const [role, setRole] = useState<Role | null>(null); // Restored role state
  const [aiPersonality, setAiPersonality] = useState<any>(null);
  const [myMsgCount, setMyMsgCount] = useState(0); 
  const [partnerMsgCount, setPartnerMsgCount] = useState(0); 
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "entry" | "paired" | "disconnected"
  >("entry");
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null); 
  const chatEndRef = useRef<HTMLDivElement>(null);
  const joinTimeout = useRef<number | null>(null); // Restored to prevent cleanup errors

  useEffect(() => {
    socket.on("chat message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.sender === socket.id) {
        setMyMsgCount((prev) => prev + 1);
      } else {
        setPartnerMsgCount((prev) => prev + 1);
      }
    });
    // Removed 'waiting' event handler
    socket.on("paired", (data) => {
      setShowLoading(false);
      setStatus("paired");
      setMyMsgCount(0);
      setPartnerMsgCount(0);
      if (data && data.firstId) {
        setFirstTurnId(data.firstId);
      } else {
        setFirstTurnId(null);
      }
    });

    socket.on("partner disconnected", () => {
      setStatus("disconnected");
    });

    return () => {
      socket.off("chat message");
      socket.off("paired");
      socket.off("partner disconnected");
      if (joinTimeout.current) clearTimeout(joinTimeout.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Restored Role Selection for Join Chat
  const joinChat = (selectedRole: Role) => {
    setRole(selectedRole);
    setStatus("waiting");
    // If joining as RealAI, pick a random personality
    if (selectedRole === "RealAI") {
      setAiPersonality(getRandomPersonality());
    } else {
      setAiPersonality(null);
    }
    // Mask the role for the server
    const serverRole = selectedRole === "Human" ? "Human" : "AI";
    socket.emit("choose role", serverRole);
    socket.emit("join chat"); // Preserved in case main branch's server requires it
  };

  const conversationComplete = myMsgCount >= 5 && partnerMsgCount >= 5;
  const lastMsg = messages[messages.length - 1];
  const isFirst = firstTurnId === socket.id;
  const isFirstMessage = myMsgCount === 0 && partnerMsgCount === 0;
  const isMyTurn = (isFirstMessage && isFirst) || (!isFirstMessage && myMsgCount <= partnerMsgCount);

  const canSend =
    !conversationComplete &&
    myMsgCount < 5 &&
    isMyTurn &&
    (!lastMsg || lastMsg.sender !== socket.id);

  const sendMessage = () => {
    if (input.trim() && canSend) {
      const msg = { sender: socket.id, text: input };
      socket.emit("chat message", msg);
      setInput("");
    }
  };

  // --- RESTORED REAL AI BOT LOGIC ---
  // RealAI: Ask Gemini via backend
  useEffect(() => {
    if (status === "paired" && role === "RealAI" && canSend && aiPersonality) {
      const generateBotResponse = async () => {
        try {
          // --- AI PROMPT CREATION ---
          // Use the selected personality for the AI
          const basePrompt =
            `You are a Stony Brook University student named ${aiPersonality.name}. Your personality: ${aiPersonality.personality}. Respond like a real college student chatting online: keep it casual, use internet slang and abbreviations, but do NOT use emojis. Don't worry about perfect spelling or grammar. Keep replies short, chill, and don't give too many details.`;

          let prompt = basePrompt;
          // If there is chat history, build a prompt from the conversation so far and use the same instruction.
          if (messages.length > 0) {
            const history = messages
              .map((m) => `${m.sender === socket.id ? aiPersonality.name : "Partner"}: ${m.text}`)
              .join("\n");
            prompt = `${basePrompt}\n\n${history}\n${aiPersonality.name}:`;
          }
          // --- END AI PROMPT CREATION ---
          const res = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          const data = await res.json();
          const botText = data.text?.trim() || "Hmm...";
          // Simulate typing delay based on message length (e.g., 40ms per character, min 500ms, max 3000ms)
          const delay = Math.min(Math.max(botText.length * 40, 500), 3000);
          setTimeout(() => {
            socket.emit("chat message", { sender: socket.id, text: botText });
          }, delay);
        } catch (err) {
          console.error("AI Generation Error:", err);
        }
      };
      generateBotResponse();
    }
  }, [status, role, canSend, messages, aiPersonality]);
  // ----------------------------------

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage();
  };

  const resetToEntry = () => {
    setMyMsgCount(0);
    setPartnerMsgCount(0);
    socket.disconnect();
    setMessages([]);
    setInput("");
    setStatus("entry");
    setRole(null);
    setTimeout(() => socket.connect(), 100);
    setFirstTurnId(null);
  };

  const quitChat = () => {
    resetToEntry();
  };

  let inputPlaceholder = "";
  if (conversationComplete) inputPlaceholder = "Conversation complete";
  else if (myMsgCount >= 5) inputPlaceholder = "Message limit reached";
  else if (role === "RealAI") inputPlaceholder = "AI is thinking...";
  else if (isFirstMessage) {
    if (firstTurnId === null) inputPlaceholder = "Waiting for pairing...";
    else if (isFirst) inputPlaceholder = "You start! Type your message...";
    else inputPlaceholder = "Wait for your partner to start...";
  } else if (isMyTurn) inputPlaceholder = "Type your message...";
  else inputPlaceholder = "Wait for partner's reply...";

  if (status === "entry") {
    return (
      <div
        className="doodly-app"
        style={{
          justifyContent: "center",
          display: "flex",
          minHeight: "100vh",
        }}
      >
        <div style={{
          justifyContent: "center",
          alignItems: "center",
          display: "flex",
          minHeight: "100vh",
        }}>
          {/* Restored the 3 Role Buttons */}
          <div className="doodly-button-wrapper" style={{ flexDirection: "column", alignItems: "center" }}>
            <h1>Join the chat</h1>
            <button
              className="doodly-send"
              style={{ margin: 12, fontSize: 22, width: "100%" }}
              onClick={() => joinChat("Human")}
            >
              Join as Human
            </button>
            <button
              className="doodly-send"
              style={{ margin: 12, fontSize: 22, width: "100%" }}
              onClick={() => joinChat("FakeAI")}
            >
              Join as Fake AI
            </button>
            <button
              className="doodly-send"
              style={{ margin: 12, fontSize: 22, width: "100%" }}
              onClick={() => joinChat("RealAI")}
            >
              Join as Real AI Bot
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "waiting") {
    return (
      <div
        className="doodly-app"
        style={{
          justifyContent: "center",
          alignItems: "center",
          display: "flex",
          minHeight: "100vh",
        }}
      >
        <div style={{ textAlign: "center", width: "100%" }}>
          <h2>Waiting for a partner to join...</h2>
          <button
            className="doodly-send"
            style={{ margin: 12, fontSize: 18 }}
            onClick={resetToEntry}
          >
            Cancel
          </button>
        </div>
        <style>{`
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div className="doodly-app" style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      minHeight: 0,
    }}>
      <header className="doodly-header" style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        zIndex: 2,
        background: "#16171d",
        borderBottom: "1px solid #eee",
        padding: "16px 0 16px 0"
      }}>
        <h1 style={{ margin: 0, textAlign: "center" }}>Doodly Chatbot</h1>
        <button
          className="doodly-send"
          style={{ position: "absolute", right: 24, top: "25%", fontSize: 18 }}
          onClick={quitChat}
        >
          Quit
        </button>
      </header>
      <main className="doodly-chat" style={{
        flex: 1,
        overflowY: "auto",
        marginTop: 72,
        marginBottom: 90,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}>
        {messages.map((msg, idx) => {
          let isMe = false, isAi = false;
          if (aiMode) {
            isMe = msg.sender === "me";
            isAi = msg.sender === "gemini";
          } else {
            isMe = msg.sender === socket.id;
          }
          return (
            <div
              key={idx}
              className={`doodly-bubble ${isMe ? "me" : isAi ? "partner" : "partner"}`}
              style={{
                display: "flex",
                alignSelf: isMe ? "flex-end" : "flex-start",
                maxWidth: "100%",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
                flexDirection: isMe ? "row-reverse" : "row",
                alignItems: "center",
                margin: "8px 0",
                background: isMe ? "#2e8b57" : "#23242a",
                color: isMe ? "#fff" : "#e0e0e0",
                borderRadius: 18,
                padding: "10px 16px",
                boxShadow: isMe
                  ? "0 2px 8px rgba(46,139,87,0.08)"
                  : "0 2px 8px rgba(35,36,42,0.08)"
              }}
            >
              <span className="doodly-avatar" style={{ fontSize: 24, margin: isMe ? "0 0 0 8px" : "0 8px 0 0" }}>
                {isMe ? "😁" : isAi ? "🤖 Gemini" : "🤖❓"}
              </span>
              <div className="doodly-text">{msg.text}</div>
            </div>
          );
        })}
        {aiLoading && (
          <div style={{ textAlign: "left", color: "#888", margin: "8px 0 8px 8px" }}>
            <span style={{ fontSize: 18 }}>🤖 Gemini is typing...</span>
          </div>
        )}
        <div ref={chatEndRef} />
        {/* Conversation complete or disconnected message at the end of chat */}
        {conversationComplete && (
          <div style={{ textAlign: "center", padding: 16, color: "#888", width: "100%" }}>
            — Conversation complete —
            <br />
            <button
              className="doodly-send"
              style={{ marginTop: 10 }}
              onClick={quitChat}
            >
              Start Over
            </button>
          </div>
        )}
        {status === "disconnected" && !conversationComplete && (
          <div style={{ textAlign: "center", padding: 16, color: "#e88", width: "100%" }}>
            — Your partner disconnected —
            <br />
            <button
              className="doodly-send"
              style={{ marginTop: 10 }}
              onClick={resetToEntry}
            >
              Restart
            </button>
          </div>
        )}
      </main>
      <footer className="doodly-footer" style={{
        position: "fixed",
        left: 0,
        bottom: 0,
        width: "100%",
        background: "#16171d",
        borderTop: "1px solid #eee",
        zIndex: 2,
        padding: 12,
        display: "flex",
        gap: 8,
        alignItems: "center"
      }}>
        <input
          className="doodly-input"
          type="text"
          placeholder={inputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          // Disabled if it's the RealAI so the user can't type for the bot
          disabled={!canSend || status === "disconnected" || conversationComplete || role === "RealAI"}
          style={{ flex: 1, fontSize: 18, padding: 8 }}
        />
        <button
          className="doodly-send"
          onClick={sendMessage}
          disabled={!canSend || status === "disconnected" || conversationComplete || role === "RealAI"}
          style={{ fontSize: 18, padding: "8px 18px", marginRight: "20px"}}
        >
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;