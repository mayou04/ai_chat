import { useEffect, useRef, useState } from "react";
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

function App() {
  const [myMsgCount, setMyMsgCount] = useState(0); // Msgs sent by this client
  const [partnerMsgCount, setPartnerMsgCount] = useState(0); // Msgs sent by partner client
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "entry" | "paired" | "disconnected"
  >("entry");
  const joinTimeout = useRef<number | null>(null);
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null); // Who starts
  const [showLoading, setShowLoading] = useState(false); // Loading screen for finding partner
  const chatEndRef = useRef<HTMLDivElement>(null);

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


  // Join chat handler
  const joinChat = () => {
    setShowLoading(true);
    joinTimeout.current = window.setTimeout(() => {
      socket.emit("join chat");
      joinTimeout.current = null;
    }, 5000); // 5 second artificial delay
  };

  const cancelJoin = () => {
    setShowLoading(false);
    setStatus("entry");
    if (joinTimeout.current) {
      clearTimeout(joinTimeout.current);
      joinTimeout.current = null;
    }
  };

  // Only allow sending if:
  // - input is not empty
  // - myMsgCount < 5
  // - my turn (see below)
  const sendMessage = () => {
    const lastMsg = messages[messages.length - 1];
    const isFirst = firstTurnId === socket.id;
    // Only the chosen starter can send the very first message
    const isFirstMessage = myMsgCount === 0 && partnerMsgCount === 0;
    // After the first message, alternate turns: you can send if you've sent less or equal messages than your partner
    const isMyTurn = (isFirstMessage && isFirst) || (!isFirstMessage && myMsgCount <= partnerMsgCount);
    if (
      input.trim() &&
      myMsgCount < 5 &&
      isMyTurn &&
      (!lastMsg || lastMsg.sender !== socket.id)
    ) {
      const msg = { sender: socket.id, text: input };
      socket.emit("chat message", msg);
      setInput("");
    }
  };

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
    setTimeout(() => socket.connect(), 100);
    setFirstTurnId(null);
  };

  if (status === "entry" || showLoading) {
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
          {showLoading ? (
            <div style={{ textAlign: "center" }}>
              <div className="doodly-loading-spinner" style={{ margin: 24 }}>
                <svg width="48" height="48" viewBox="0 0 48 48" style={{ animation: "spin 1s linear infinite" }}>
                  <circle cx="24" cy="24" r="20" stroke="#888" strokeWidth="4" fill="none" strokeDasharray="100" strokeDashoffset="60" />
                </svg>
              </div>
              <h2>Looking for a partner...</h2>
              <button
                className="doodly-send"
                style={{ margin: 12, fontSize: 18 }}
                onClick={cancelJoin}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="doodly-button-wrapper">
              <h1>Join the chat</h1>
              <button
                className="doodly-send"
                style={{ margin: 12, fontSize: 22 }}
                onClick={joinChat}
              >
                Join Chat
              </button>
            </div>
          )}
        </div>
        <style>{`
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // Removed 'waiting' state UI

  const quitChat = () => {
    setMyMsgCount(0);
    setPartnerMsgCount(0);
    socket.disconnect();
    setMessages([]);
    setInput("");
    setStatus("entry");
    setTimeout(() => socket.connect(), 100); // reconnect after state reset
  };

  const conversationComplete = myMsgCount >= 5 && partnerMsgCount >= 5;

  const lastMsg = messages[messages.length - 1];
  // Determine if it's my turn:
  const isFirst = firstTurnId === socket.id;

  const isFirstMessage = myMsgCount === 0 && partnerMsgCount === 0;
  const isMyTurn = (isFirstMessage && isFirst) || (!isFirstMessage && myMsgCount <= partnerMsgCount);
  const canSend =
    !conversationComplete &&
    myMsgCount < 5 &&
    isMyTurn &&
    (!lastMsg || lastMsg.sender !== socket.id);

  let inputPlaceholder = "";
  if (conversationComplete) inputPlaceholder = "Conversation complete";
  else if (myMsgCount >= 5) inputPlaceholder = "Message limit reached";
  else if (isFirstMessage) {
    if (firstTurnId === null) inputPlaceholder = "Waiting for pairing...";
    else if (isFirst) inputPlaceholder = "You start! Type your message...";
    else inputPlaceholder = "Wait for your partner to start...";
  } else if (isMyTurn) inputPlaceholder = "Type your message...";
  else inputPlaceholder = "Wait for partner's reply...";

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
          const isMe = msg.sender === socket.id;
          return (
            <div
              key={idx}
              className={`doodly-bubble ${isMe ? "me" : "partner"}`}
              style={{
                display: "flex",
                alignSelf: isMe ? "flex-end" : "flex-start",
                maxWidth: "100%",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
                flexDirection: isMe ? "row-reverse" : "row",
                alignItems: "center"
              }}
            >
              <span className="doodly-avatar" style={{ fontSize: 24, margin: isMe ? "0 0 0 8px" : "0 8px 0 0" }}>
                {isMe ? "😁" : "🤖❓"}
              </span>
              <div className="doodly-text">{msg.text}</div>
            </div>
          );
        })}
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
          disabled={!canSend || status === "disconnected" || conversationComplete}
          style={{ flex: 1, fontSize: 18, padding: 8 }}
        />
        <button
          className="doodly-send"
          onClick={sendMessage}
          disabled={!canSend || status === "disconnected" || conversationComplete}
          style={{ fontSize: 18, padding: "8px 18px", marginRight: "20px"}}
        >
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;
