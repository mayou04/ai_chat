import { useEffect, useRef, useState } from "react";
import personalitiesRaw from "./assets/personalities.txt?raw";
import promptTemplateRaw from "./assets/prompt.txt?raw";
import { io, Socket } from "socket.io-client";

const socket: Socket =
  typeof window !== "undefined"
    ? io(
        import.meta.env.MODE === "development"
          ? "http://localhost:3001"
          : window.location.origin,
      )
    : ({} as Socket);

type Message = { sender: string; text: string };
// type Role = "Human" | "RealAI";

type Personality = { personality: string };

function parsePersonalities(raw: string): Personality[] {
  return raw
    .split(/---+/)
    .map((block) => {
      const personalityMatch = block.match(/Personality:\s*([\s\S]*)/);
      if (personalityMatch) {
        return {
          personality: personalityMatch[1].trim(),
        };
      }
      return null;
    })
    .filter((p): p is Personality => Boolean(p));
}

const personalities = parsePersonalities(personalitiesRaw);
function getRandomPersonality() {
  return personalities[Math.floor(Math.random() * personalities.length)];
}

// ── Timer hook ────────────────────────────────────────────────────────────────
function useCountdown(active: boolean, seconds: number, onExpire: () => void) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const onExpireRef = useRef(onExpire);
  const firedRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    let resetTimeout: number | null = null;
    if (!active) {
      resetTimeout = window.setTimeout(() => setTimeLeft(seconds), 0);
      firedRef.current = false;
      return () => {
        if (resetTimeout !== null) window.clearTimeout(resetTimeout);
      };
    }

    resetTimeout = window.setTimeout(() => setTimeLeft(seconds), 0);
    firedRef.current = false;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!firedRef.current) {
            firedRef.current = true;
            onExpireRef.current();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (resetTimeout !== null) window.clearTimeout(resetTimeout);
      clearInterval(interval);
    };
  }, [active, seconds]);

  return timeLeft;
}
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // const [role, setRole] = useState<Role | null>(null);
  const [aiPersonality, setAiPersonality] = useState<Personality | null>(null);
  const [myMsgCount, setMyMsgCount] = useState(0);
  const [partnerMsgCount, setPartnerMsgCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<
    "entry" | "waiting" | "paired" | "disconnected"
  >("entry");
  const [firstTurnId, setFirstTurnId] = useState<string | null>(null);
  const [guess, setGuess] = useState<null | "AI" | "Human">(null);
  const [guessTimedOut, setGuessTimedOut] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [partnerGuess, setPartnerGuess] = useState<null | "AI" | "Human">(null);
  const [partnerGuessTimedOut, setPartnerGuessTimedOut] = useState(false);
  const [partnerGuessKnown, setPartnerGuessKnown] = useState(false);
  const [truePartnerType, setTruePartnerType] = useState<"AI" | "Human" | null>(
    null,
  );
  const joinTimeout = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const TURN_SECONDS = 30;
  const SESSION_SECONDS = 300;
  const GUESS_SECONDS = 15;

  const effectivePartnerGuessKnown =
    truePartnerType === "AI" ? true : partnerGuessKnown;
  const effectivePartnerGuessTimedOut =
    truePartnerType === "AI" ? true : partnerGuessTimedOut;
  const effectivePartnerGuess = truePartnerType === "AI" ? null : partnerGuess;

  const conversationComplete = myMsgCount >= 5 && partnerMsgCount >= 5;
  const lastMsg = messages[messages.length - 1];
  const isFirst = firstTurnId === socket.id || firstTurnId === "player";
  const isFirstMessage = myMsgCount === 0 && partnerMsgCount === 0;

  const isMyTurn = isFirst
    ? myMsgCount === partnerMsgCount
    : myMsgCount < partnerMsgCount;

  const canSend =
    !conversationComplete &&
    myMsgCount < 5 &&
    isMyTurn &&
    (!lastMsg || lastMsg.sender !== (socket.id ?? "player"));

  const partnerTurnActive =
    status === "paired" &&
    truePartnerType === "Human" &&
    !conversationComplete &&
    !isMyTurn &&
    partnerMsgCount < 5 &&
    (!lastMsg || lastMsg.sender === (socket.id ?? "player"));

  const timerActive = status === "paired" && canSend && !conversationComplete;

  const aiTurnActive =
    status === "paired" &&
    truePartnerType === "AI" &&
    !conversationComplete &&
    !isMyTurn;

  const sessionActive = status === "paired" && !conversationComplete;

  const aiAbortRef = useRef<AbortController | null>(null);
  const aiTurnNonceRef = useRef(0);
  const aiTurnRespondedRef = useRef(false);

  const formatMmSs = (totalSeconds: number) => {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const handleTimerExpire = () => {
    const myMsg = {
      sender: socket.id ?? "player",
      text: "(Timed out)", // send whatever is in the input bar, even if empty
    };

    socket.emit("chat message", myMsg);

    if (truePartnerType === "AI") {
      setMessages((prev) => [...prev, myMsg]);
      setMyMsgCount((p) => p + 1);
    }

    setInput("");
  };

  const handleAiTimerExpire = () => {
    if (aiTurnRespondedRef.current) return;
    aiTurnRespondedRef.current = true;

    if (aiAbortRef.current) {
      aiAbortRef.current.abort();
      aiAbortRef.current = null;
    }

    const botMsg = { sender: "bot", text: "(Timed out)" };
    socket.emit("chat message", botMsg);
    setMessages((prev) => [...prev, botMsg]);
    setPartnerMsgCount((p) => p + 1);
  };

  const handleSessionExpire = () => {
    if (aiAbortRef.current) {
      aiAbortRef.current.abort();
      aiAbortRef.current = null;
    }

    const sysMsg = { sender: "system", text: "⏳ Time limit reached" };
    setMessages((prev) => [...prev, sysMsg]);
    setMyMsgCount(5);
    setPartnerMsgCount(5);
    setInput("");
  };

  const handlePartnerTurnExpire = () => {
    // No-op: partner client enforces their own timeout.
  };

  const myTurnTimeLeft = useCountdown(timerActive, TURN_SECONDS, handleTimerExpire);
  const aiTurnTimeLeft = useCountdown(aiTurnActive, TURN_SECONDS, handleAiTimerExpire);
  const partnerTurnTimeLeft = useCountdown(
    partnerTurnActive,
    TURN_SECONDS,
    handlePartnerTurnExpire,
  );
  const sessionTimeLeft = useCountdown(sessionActive, SESSION_SECONDS, handleSessionExpire);

  const turnTimeLeft =
    truePartnerType === "AI"
      ? isMyTurn
        ? myTurnTimeLeft
        : aiTurnTimeLeft
      : isMyTurn
        ? myTurnTimeLeft
        : partnerTurnTimeLeft;

  const handleForceAiPairing = () => {
    // Disconnect so the server removes us from the queue
    socket.disconnect();

    const isBotFirst = Math.random() > 0.5;
    const botFirstId = isBotFirst ? "bot" : (socket.id ?? "player");

    setStatus("paired");
    setMyMsgCount(0);
    setPartnerMsgCount(0);
    setFirstTurnId(botFirstId);
    setTruePartnerType("AI");

    setGuess(null);
    setGuessTimedOut(false);
    setShowResult(false);
    setPartnerGuess(null);
    setPartnerGuessTimedOut(false);
    setPartnerGuessKnown(false);

    // setRole("Human");
    setAiPersonality(getRandomPersonality());
  };

  const submitGuess = (nextGuess: "AI" | "Human" | null, timedOut: boolean) => {
    setGuess(nextGuess);
    setGuessTimedOut(timedOut);
    setShowResult(true);

    if (truePartnerType === "Human" && socket.connected) {
      socket.emit("submit guess", { guess: nextGuess, timedOut });
    }
  };

  const handleGuessExpire = () => {
    if (guess !== null || guessTimedOut) return;
    submitGuess(null, true);
  };

  const joinChat = () => {
    // setRole("Human");
    setStatus("waiting");
    setAiPersonality(null);

    // Server relies on this to map human queues!
    socket.emit("choose role", "Human");
    socket.emit("join chat");

    if (joinTimeout.current) clearTimeout(joinTimeout.current);

    // Increased wait to 15 seconds
    joinTimeout.current = window.setTimeout(() => {
      handleForceAiPairing();
    }, 15000);
  };

  const sendMessage = () => {
    if (input.trim() && canSend) {
      const myMsg = { sender: socket.id ?? "player", text: input };
      socket.emit("chat message", myMsg);

      if (truePartnerType === "AI") {
        setMessages((prev) => [...prev, myMsg]);
        setMyMsgCount((p) => p + 1);
      }

      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") sendMessage();
  };

  const resetToEntry = () => {
    if (joinTimeout.current) clearTimeout(joinTimeout.current);
    setMyMsgCount(0);
    setPartnerMsgCount(0);
    socket.disconnect();
    setMessages([]);
    setInput("");
    setStatus("entry");
    // setRole(null);
    setGuess(null);
    setGuessTimedOut(false);
    setShowResult(false);
    setPartnerGuess(null);
    setPartnerGuessTimedOut(false);
    setPartnerGuessKnown(false);
    setTimeout(() => socket.connect(), 100);
    setFirstTurnId(null);
  };

  const guessActive =
    status === "paired" &&
    conversationComplete &&
    !showResult &&
    guess === null &&
    !guessTimedOut;

  const guessTimeLeft = useCountdown(guessActive, GUESS_SECONDS, handleGuessExpire);

  useEffect(() => {
    socket.on("chat message", (msg: Message) => {
      if (truePartnerType === "AI") return;

      setMessages((prev) => [...prev, msg]);
      if (msg.sender === socket.id) setMyMsgCount((p) => p + 1);
      else setPartnerMsgCount((p) => p + 1);
    });

    socket.on("waiting", () => setStatus("waiting"));

    socket.on("paired", (data) => {
      if (joinTimeout.current) clearTimeout(joinTimeout.current);

      setStatus("paired");
      setMyMsgCount(0);
      setPartnerMsgCount(0);
      setFirstTurnId(data?.firstId ?? null);

      setGuess(null);
      setGuessTimedOut(false);
      setShowResult(false);
      setPartnerGuess(null);
      setPartnerGuessTimedOut(false);
      setPartnerGuessKnown(false);

      const partnerIsAI = data?.partnerType === "AI";
      setTruePartnerType(partnerIsAI ? "AI" : "Human");

      // setRole("Human");

      if (partnerIsAI) {
        setAiPersonality(getRandomPersonality());
      } else {
        setAiPersonality(null);
      }
    });

    socket.on("partner disconnected", () => setStatus("disconnected"));

    socket.on(
      "partner guess",
      (data: { guess: "AI" | "Human" | null; timedOut: boolean }) => {
        setPartnerGuessKnown(true);
        setPartnerGuess(data.guess);
        setPartnerGuessTimedOut(Boolean(data.timedOut));
      },
    );

    return () => {
      socket.off("chat message");
      socket.off("waiting");
      socket.off("paired");
      socket.off("partner disconnected");
      socket.off("partner guess");
      if (joinTimeout.current) clearTimeout(joinTimeout.current);
    };
  }, [truePartnerType]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!aiTurnActive) {
      if (aiAbortRef.current) {
        aiAbortRef.current.abort();
        aiAbortRef.current = null;
      }
      return;
    }

    // New AI turn
    aiTurnNonceRef.current += 1;
    aiTurnRespondedRef.current = false;
    if (aiAbortRef.current) aiAbortRef.current.abort();
    aiAbortRef.current = new AbortController();
  }, [aiTurnActive]);

  // ── RealAI auto-response logic ───────────────────────────────────────────
  useEffect(() => {
    if (
      status === "paired" &&
      truePartnerType === "AI" &&
      !isMyTurn &&
      !conversationComplete &&
      aiPersonality
    ) {
      const generateBotResponse = async () => {
        try {
          const turnNonce = aiTurnNonceRef.current;
          const startedAt = Date.now();
          const controller = aiAbortRef.current ?? new AbortController();
          aiAbortRef.current = controller;

          const hardTimeout = window.setTimeout(() => {
            controller.abort();
          }, TURN_SECONDS * 1000);

          // Split prompt template into base and first-message instructions
          const [basePromptRaw, firstMsgRaw = ""] = promptTemplateRaw.split(/\n\s*\n/);
          const basePrompt = basePromptRaw.replace(/\$\{personality\}/g, aiPersonality.personality);
          const firstMsg = firstMsgRaw.replace(/\$\{personality\}/g, aiPersonality.personality);

          let prompt = basePrompt;
          if (messages.length === 0) {
            // Use first-message instructions if no chat history
            prompt = `${basePrompt}\n\n${firstMsg}`;
          } else {
            const history = messages
              .map(
                (m) => `${m.sender === (socket.id ?? "player") ? "Partner" : "AI"}: ${m.text}`
              )
              .join("\n");
            prompt = `${basePrompt}\n\n${history}\nAI:`;
          }

          const res = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal: controller.signal,
          });
          const data = await res.json();
          const botText = data.text?.trim() || "(Timed out)";
          const typingDelay = Math.min(Math.max(botText.length * 40, 500), 8500);

          const elapsedMs = Date.now() - startedAt;
          const remainingMs = Math.max(0, TURN_SECONDS * 1000 - elapsedMs - 50);
          const delay = Math.min(typingDelay, remainingMs);

          window.clearTimeout(hardTimeout);

          setTimeout(() => {
            // If we already timed out / turn changed, do nothing
            if (aiTurnNonceRef.current !== turnNonce) return;
            if (aiTurnRespondedRef.current) return;
            aiTurnRespondedRef.current = true;

            const botMsg = { sender: "bot", text: botText };
            socket.emit("chat message", botMsg);

            setMessages((prev) => [...prev, botMsg]);
            setPartnerMsgCount((p) => p + 1);
          }, delay);
        } catch (err) {
          console.error("AI Generation Error:", err);
          // If we already timed out / turn changed / aborted, don't send a second message
          if (aiTurnRespondedRef.current) return;
          aiTurnRespondedRef.current = true;

          const errorMsg = {
            sender: "bot",
            text: "(Timed out)",
          };
          socket.emit("chat message", errorMsg);
          setMessages((prev) => [...prev, errorMsg]);
          setPartnerMsgCount((p) => p + 1);
        }
      };
      generateBotResponse();
    }
  }, [
    status,
    truePartnerType,
    isMyTurn,
    conversationComplete,
    messages,
    aiPersonality,
  ]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setInput(nextValue);
  };

  // UI Placeholder Logic
  let inputPlaceholder = "";
  if (conversationComplete) inputPlaceholder = "Conversation complete";
  else if (myMsgCount >= 5) inputPlaceholder = "Message limit reached";
  else if (isFirstMessage) {
    if (firstTurnId === null) inputPlaceholder = "Waiting for pairing...";
    else if (isFirst) inputPlaceholder = "You start! Type your message...";
    else inputPlaceholder = "Wait for your partner to start...";
  } else if (isMyTurn) inputPlaceholder = "Type your message...";
  else inputPlaceholder = "Wait for partner's reply...";

  // View: Entry
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
        <div
          style={{
            justifyContent: "center",
            alignItems: "center",
            display: "flex",
            minHeight: "100vh",
          }}
        >
          <div
            className="doodly-button-wrapper"
            style={{ flexDirection: "column", alignItems: "center" }}
          >
            <h1>Doodly Chatbot</h1>
            <p style={{ color: "#888", textAlign: "center", marginBottom: 24 }}>
              Chat with a stranger — human or AI?
              <br />
              You won't know until the end.
            </p>
            <button
              className="doodly-send"
              style={{
                margin: 12,
                fontSize: 22,
                width: "100%",
                padding: "14px 32px",
              }}
              onClick={joinChat}
            >
              Start Chat
            </button>
          </div>
        </div>
      </div>
    );
  }

  // View: Waiting
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
          <div style={{ margin: "32px 0" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  border: "6px solid #eee",
                  borderTop: "6px solid #2e8b57",
                  borderRadius: "50%",
                  width: 60,
                  height: 60,
                  animation: "spin 1s linear infinite",
                  marginBottom: 16,
                }}
              />
              <span style={{ color: "#888", fontSize: 18 }}>
                Finding a partner...
              </span>
            </div>
          </div>
          <button
            className="doodly-send"
            style={{ margin: 12, fontSize: 18 }}
            onClick={resetToEntry}
          >
            Cancel
          </button>
        </div>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // View: Main Chat
  return (
    <div
      className="doodly-app"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        minHeight: 0,
      }}
    >
      <header
        className="doodly-header"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          zIndex: 2,
          background: "#16171d",
          borderBottom: "1px solid #eee",
          padding: "16px 0",
        }}
      >
        <h1 style={{ margin: 0, textAlign: "center" }}>Doodly Chatbot</h1>
        {status === "paired" && !conversationComplete && (
          <div
            style={{
              position: "absolute",
              left: 24,
              top: "50%",
              transform: "translateY(-50%)",
              background: turnTimeLeft <= 3 ? "#e55" : "#2e8b57",
              color: "#fff",
              borderRadius: 999,
              padding: "4px 14px",
              fontWeight: 700,
              fontSize: 18,
              minWidth: 48,
              textAlign: "center",
              transition: "background 0.3s",
            }}
          >
            turn {turnTimeLeft}s | total {formatMmSs(sessionTimeLeft)}
          </div>
        )}
        <button
          className="doodly-send"
          style={{ position: "absolute", right: 24, top: "25%", fontSize: 18 }}
          onClick={resetToEntry}
        >
          Quit
        </button>
      </header>

      <main
        className="doodly-chat"
        style={{
          flex: 1,
          overflowY: "auto",
          marginTop: 72,
          marginBottom: 90,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {messages.map((msg, idx) => {
          const isMe = msg.sender === (socket.id ?? "player");
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
                alignItems: "center",
                margin: "8px 0",
                background: isMe ? "#2e8b57" : "#23242a",
                color: isMe ? "#fff" : "#e0e0e0",
                borderRadius: 18,
                padding: "10px 16px",
              }}
            >
              <span
                className="doodly-avatar"
                style={{
                  fontSize: 24,
                  margin: isMe ? "0 0 0 8px" : "0 8px 0 0",
                }}
              >
                {isMe ? "😁" : "🤖❓"}
              </span>
              <div className="doodly-text">{msg.text}</div>
            </div>
          );
        })}

        {status === "paired" && !conversationComplete && !isMyTurn && (
          <div
            className="doodly-bubble partner"
            style={{
              display: "flex",
              alignSelf: "flex-start",
              maxWidth: "100%",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              flexDirection: "row",
              alignItems: "center",
              margin: "8px 0",
              background: "#23242a",
              color: "#e0e0e0",
              borderRadius: 18,
              padding: "10px 16px",
            }}
          >
            <span
              className="doodly-avatar"
              style={{
                fontSize: 24,
                margin: "0 8px 0 0",
              }}
            >
              🤖❓
            </span>
            <div className="typing-dots" role="status" aria-label="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />

        {conversationComplete && (
          <div
            style={{
              textAlign: "center",
              padding: 16,
              color: "#888",
              width: "100%",
            }}
          >
            — Conversation complete —<br />
            {guessActive && (
              <>
                <div style={{ margin: "16px 0" }}>
                  Who do you think your partner was? ({guessTimeLeft}s)
                </div>
                <button
                  className="doodly-send"
                  style={{ margin: 8, fontSize: 18, minWidth: 120 }}
                  onClick={() => {
                    submitGuess("Human", false);
                  }}
                >
                  Real Human
                </button>
                <button
                  className="doodly-send"
                  style={{ margin: 8, fontSize: 18, minWidth: 120 }}
                  onClick={() => {
                    submitGuess("AI", false);
                  }}
                >
                  AI Bot
                </button>
              </>
            )}

            {showResult && (guess !== null || guessTimedOut) && (
              <div style={{ margin: "16px 0", fontSize: 20 }}>
                <div style={{ marginBottom: 10, fontSize: 16, color: "#aaa" }}>
                  You: {guessTimedOut ? "(timed out)" : guess === "AI" ? "AI Bot" : "Real Human"}
                  <br />
                  Partner:{" "}
                  {!effectivePartnerGuessKnown
                    ? "(choosing...)"
                    : effectivePartnerGuessTimedOut
                      ? "(timed out — didn’t choose)"
                      : effectivePartnerGuess === "AI"
                        ? "AI Bot"
                        : "Real Human"}
                </div>

                {truePartnerType && !guessTimedOut && guess === truePartnerType ? (
                  <span style={{ color: "#2e8b57" }}>
                    ✅ Correct! It was{" "}
                    {truePartnerType === "AI" ? "an AI Bot" : "a Real Human"}.
                  </span>
                ) : (
                  <span style={{ color: "#e88" }}>
                    ❌ Nope! It was{" "}
                    {truePartnerType === "AI" ? "an AI Bot" : "a Real Human"}.
                  </span>
                )}
                <br />
                <button
                  className="doodly-send"
                  style={{ marginTop: 16 }}
                  onClick={resetToEntry}
                >
                  Start Over
                </button>
              </div>
            )}
          </div>
        )}

        {status === "disconnected" && !conversationComplete && (
          <div
            style={{
              textAlign: "center",
              padding: 16,
              color: "#e88",
              width: "100%",
            }}
          >
            — Your partner disconnected —<br />
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

      <footer
        className="doodly-footer"
        style={{
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
          alignItems: "center",
        }}
      >
        <input
          className="doodly-input"
          type="text"
          placeholder={inputPlaceholder}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={
            !canSend || status === "disconnected" || conversationComplete
          }
          style={{ flex: 1, fontSize: 18, padding: 8 }}
        />
        <button
          className="doodly-send"
          onClick={sendMessage}
          disabled={
            !canSend || status === "disconnected" || conversationComplete
          }
          style={{ fontSize: 18, padding: "8px 18px", marginRight: "20px" }}
        >
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;
