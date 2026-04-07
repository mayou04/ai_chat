import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("http://localhost:3001");

type Message = { sender: string; text: string };

function App() {
  const [myMsgCount, setMyMsgCount] = useState(0); // Msgs sent by this client
  const [partnerMsgCount, setPartnerMsgCount] = useState(0); // Msgs sent by partner client
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "entry" | "waiting" | "paired" | "disconnected"
  >("entry");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on("chat message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      // Only increment partnerMsgCount if the message is NOT from me
      if (msg.sender !== socket.id) {
        setPartnerMsgCount((prev) => prev + 1);
      }
    });
    socket.on("waiting", () => {
      setStatus("waiting");
    });
    socket.on("paired", () => {
      setStatus("paired");
      setMyMsgCount(0);
      setPartnerMsgCount(0);
    });
    socket.on("partner disconnected", () => {
      setStatus("disconnected");
    });
    return () => {
      socket.off("chat message");
      socket.off("waiting");
      socket.off("paired");
      socket.off("partner disconnected");
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


  // Join chat handler
  const joinChat = () => {
    setStatus("waiting");
    socket.emit("join chat");
  };

  // Only allow sending if:
  // - input is not empty
  // - myMsgCount < 5
  // - myMsgCount === partnerMsgCount (my turn)
  const sendMessage = () => {
    const lastMsg = messages[messages.length - 1];
    if (
      input.trim() &&
      myMsgCount < 5 &&
      myMsgCount <= partnerMsgCount &&
      (!lastMsg || lastMsg.sender !== socket.id)
    ) {
      const msg = { sender: socket.id, text: input };
      socket.emit("chat message", msg);
      setInput("");
      setMyMsgCount((prev) => prev + 1); // increment myMsgCount immediately on send
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
  };

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
      </div>
    );
  }

  if (status === "disconnected") {
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
          <h2>Your partner disconnected.</h2>
          <button
            className="doodly-send"
            style={{ margin: 12, fontSize: 18 }}
            onClick={resetToEntry}
          >
            Restart
          </button>
        </div>
      </div>
    );
  }

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
  const canSend =
    !conversationComplete &&
    myMsgCount < 5 &&
    myMsgCount <= partnerMsgCount &&
    (!lastMsg || lastMsg.sender !== socket.id);

  let inputPlaceholder = "";
  if (conversationComplete) inputPlaceholder = "Conversation complete";
  else if (myMsgCount >= 5) inputPlaceholder = "Message limit reached";
  else if (lastMsg && lastMsg.sender === socket.id) inputPlaceholder = "Wait for partner's reply...";
  else if (myMsgCount < 5 && myMsgCount <= partnerMsgCount) inputPlaceholder = "Type your message...";
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
        background: "#fff",
        borderBottom: "1px solid #eee",
        padding: "16px 0 16px 0"
      }}>
        <h1 style={{ margin: 0, textAlign: "center" }}>Doodly Chatbot</h1>
        <button
          className="doodly-send"
          style={{ position: "absolute", right: 24, top: 24 }}
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
                alignSelf: isMe ? "flex-end" : "flex-start",
                maxWidth: "100%",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
              }}
            >
              <div className="doodly-text">{isMe ? "😁" : "🤖❓"}: {msg.text}</div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </main>
      <footer className="doodly-footer" style={{
        position: "fixed",
        left: 0,
        bottom: 0,
        width: "100%",
        background: "#fff",
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
          disabled={!canSend}
          style={{ flex: 1, fontSize: 18, padding: 8 }}
        />
        <button
          className="doodly-send"
          onClick={sendMessage}
          disabled={!canSend}
          style={{ fontSize: 18, padding: "8px 18px" }}
        >
          Send
        </button>
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
      </footer>
    </div>
  );
}

export default App;
