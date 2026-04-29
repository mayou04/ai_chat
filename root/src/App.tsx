import { useEffect, useRef, useState } from "react";
import "./App.css";
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
  const aiMatchTimeout = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const TURN_SECONDS = 20;
  const SESSION_SECONDS = 300;
  const GUESS_SECONDS = 15;
  const AI_MATCH_DELAY_MS_MIN = 5000;
  const AI_MATCH_DELAY_MS_MAX = 10000;

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

  const myTurnTimeLeft = useCountdown(
    timerActive,
    TURN_SECONDS,
    handleTimerExpire,
  );
  const aiTurnTimeLeft = useCountdown(
    aiTurnActive,
    TURN_SECONDS,
    handleAiTimerExpire,
  );
  const partnerTurnTimeLeft = useCountdown(
    partnerTurnActive,
    TURN_SECONDS,
    handlePartnerTurnExpire,
  );
  const sessionTimeLeft = useCountdown(
    sessionActive,
    SESSION_SECONDS,
    handleSessionExpire,
  );

  const turnTimeLeft =
    truePartnerType === "AI"
      ? isMyTurn
        ? myTurnTimeLeft
        : aiTurnTimeLeft
      : isMyTurn
        ? myTurnTimeLeft
        : partnerTurnTimeLeft;

  const finalizeAiPairingNow = () => {
    if (joinTimeout.current) clearTimeout(joinTimeout.current);
    joinTimeout.current = null;
    if (aiMatchTimeout.current) clearTimeout(aiMatchTimeout.current);
    aiMatchTimeout.current = null;

    // Disconnect so the server removes us from the queue (and we run locally)
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

  const startAiMatchWithDelay = () => {
    if (joinTimeout.current) clearTimeout(joinTimeout.current);
    joinTimeout.current = null;

    if (aiMatchTimeout.current) clearTimeout(aiMatchTimeout.current);
    aiMatchTimeout.current = null;

    // Show waiting UI briefly before switching into AI mode.
    setStatus("waiting");
    setAiPersonality(null);

    const delay =
      AI_MATCH_DELAY_MS_MIN +
      Math.floor(Math.random() * (AI_MATCH_DELAY_MS_MAX - AI_MATCH_DELAY_MS_MIN + 1));

    const timeoutId = window.setTimeout(() => {
      if (aiMatchTimeout.current !== timeoutId) return;
      finalizeAiPairingNow();
    }, delay);
    aiMatchTimeout.current = timeoutId;
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
    // True 50/50 behavior: decide up-front whether this session is vs AI or vs Human.
    const shouldMatchWithAi = Math.random() < 0.5;
    if (shouldMatchWithAi) {
      startAiMatchWithDelay();
      return;
    }

    // setRole("Human");
    setStatus("waiting");
    setAiPersonality(null);

    // Server relies on this to map human queues!
    socket.emit("choose role", "Human");
    socket.emit("join chat");

    if (joinTimeout.current) clearTimeout(joinTimeout.current);
    joinTimeout.current = null;

    // If we can't find a human partner in time, fall back to AI.
    const timeoutId = window.setTimeout(() => {
      // If this timeout is no longer the active one, we already paired/canceled.
      if (joinTimeout.current !== timeoutId) return;
      startAiMatchWithDelay();
    }, 30000);
    joinTimeout.current = timeoutId;
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
    joinTimeout.current = null;
    if (aiMatchTimeout.current) clearTimeout(aiMatchTimeout.current);
    aiMatchTimeout.current = null;
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

  const guessTimeLeft = useCountdown(
    guessActive,
    GUESS_SECONDS,
    handleGuessExpire,
  );

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
      joinTimeout.current = null;
      if (aiMatchTimeout.current) clearTimeout(aiMatchTimeout.current);
      aiMatchTimeout.current = null;

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
      joinTimeout.current = null;
      if (aiMatchTimeout.current) clearTimeout(aiMatchTimeout.current);
      aiMatchTimeout.current = null;
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

          // Build prompt from the full template every turn.
          // The template itself contains the first-message instruction; we just add history when it exists.
          const template = promptTemplateRaw.replace(
            /\$\{personality\}/g,
            aiPersonality.personality,
          );

          // Many templates end with a trailing "AI:"; normalize so we can append our own turn marker.
          const instructions = template.replace(/\s*AI:\s*$/i, "").trimEnd();

          let prompt = `${instructions}\n\nAI:`;
          if (messages.length > 0) {
            const history = messages
              .map(
                (m) =>
                  `${m.sender === (socket.id ?? "player") ? "Partner" : "AI"}: ${m.text}`,
              )
              .join("\n");
            prompt = `${instructions}\n\n${history}\nAI:`;
          }

          const res = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal: controller.signal,
          });
          const data = await res.json();
          const botText = data.text?.trim() || "(Timed out)";
          const typingDelay = Math.min(
            Math.max(botText.length * 40, 500),
            8500,
          );

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
      <div className="doodly-app doodly-screen">
        <div className="doodly-screen__inner">
          <div className="doodly-button-wrapper doodly-button-wrapper--col">
            <h1>Imitation Game</h1>
            <p className="doodly-entry-subtitle">
              This is a guessing game, try to guess if your partner is a real human
              or an AI, while trying to not be guessed yourself!
              <br />
              <br />
              You have 5 messages each, and 5 minutes total. After the
              conversation, you’ll both guess each other’s identity. Good luck!
            </p>
            <button
              className="doodly-send doodly-send--start"
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
      <div className="doodly-app doodly-screen">
        <div className="doodly-waiting">
          <h2>Waiting for a partner to join...</h2>
          <div className="doodly-waiting__section">
            <div className="doodly-waiting__stack">
              <div className="doodly-spinner" />
              <span className="doodly-waiting__hint">Finding a partner...</span>
            </div>
          </div>
          <button
            className="doodly-send doodly-send--cancel"
            onClick={resetToEntry}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // View: Main Chat
  return (
    <div className="doodly-app doodly-app--full">
      <header className="doodly-header">
        {/* 1. Timer Section */}
        <div className="doodly-header__side">
          {status === "paired" && !conversationComplete && (
            <div
              className={
                turnTimeLeft <= 3
                  ? "doodly-timer-badge doodly-timer-badge--danger"
                  : "doodly-timer-badge"
              }
            >
              {turnTimeLeft}s | {formatMmSs(sessionTimeLeft)}
            </div>
          )}
        </div>

        {/* 2. Title Section */}
        <h1 className="doodly-header__title">Chatbot</h1>

        {/* 3. Button Section */}
        <div className="doodly-header__side doodly-header__side--right">
          <button
            className="doodly-send doodly-send--quit"
            onClick={resetToEntry}
          >
            Quit
          </button>
        </div>
      </header>

      <main className="doodly-chat">
        {messages.map((msg, idx) => {
          const isMe = msg.sender === (socket.id ?? "player");
          return (
            <div
              key={idx}
              className={`doodly-bubble ${isMe ? "me" : "partner"}`}
            >
              <span className="doodly-avatar">{isMe ? "😁" : "🤖❓"}</span>
              <div className="doodly-text">{msg.text}</div>
            </div>
          );
        })}

        {status === "paired" && !conversationComplete && !isMyTurn && (
          <div className="doodly-bubble partner doodly-bubble--typing">
            <span className="doodly-avatar">🤖❓</span>
            <div className="typing-dots" role="status" aria-label="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />

        {conversationComplete && (
          <div className="doodly-center-panel">
            — Conversation complete —<br />
            {guessActive && (
              <>
                <div className="doodly-guess-question">
                  Who do you think your partner was? ({guessTimeLeft}s)
                </div>
                <button
                  className="doodly-send doodly-send--guess"
                  onClick={() => {
                    submitGuess("Human", false);
                  }}
                >
                  Real Human
                </button>
                <button
                  className="doodly-send doodly-send--guess"
                  onClick={() => {
                    submitGuess("AI", false);
                  }}
                >
                  AI Bot
                </button>
              </>
            )}
            {showResult && (guess !== null || guessTimedOut) && (
              <div className="doodly-result">
                <div className="doodly-result__meta">
                  You:{" "}
                  {guessTimedOut
                    ? "(timed out)"
                    : guess === "AI"
                      ? "AI Bot"
                      : "Real Human"}
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

                {truePartnerType &&
                !guessTimedOut &&
                guess === truePartnerType ? (
                  <span className="doodly-result__correct">
                    ✅ Correct! It was{" "}
                    {truePartnerType === "AI" ? "an AI Bot" : "a Real Human"}.
                  </span>
                ) : (
                  <span className="doodly-result__wrong">
                    ❌ Nope! It was{" "}
                    {truePartnerType === "AI" ? "an AI Bot" : "a Real Human"}.
                  </span>
                )}
                <br />
                <button
                  className="doodly-send"
                  data-variant="start-over"
                  onClick={resetToEntry}
                >
                  Start Over
                </button>
              </div>
            )}
          </div>
        )}

        {status === "disconnected" && !conversationComplete && (
          <div className="doodly-center-panel doodly-center-panel--error">
            — Your partner disconnected —<br />
            <button
              className="doodly-send"
              data-variant="restart"
              onClick={resetToEntry}
            >
              Restart
            </button>
          </div>
        )}
      </main>

      <footer className="doodly-footer">
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
        />
        <button
          className="doodly-send"
          onClick={sendMessage}
          disabled={
            !canSend || status === "disconnected" || conversationComplete
          }
          data-variant="send"
        >
          Send
        </button>
      </footer>
    </div>
  );
}

export default App;
