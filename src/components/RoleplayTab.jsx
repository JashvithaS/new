import { useState, useRef, useEffect, useCallback } from "react";



const GROQ_KEY = "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"; // 🔴 paste your gsk_... key here

const QUESTS = [
  { id: "cafe",      icon: "☕", title: "Café Order",      difficulty: "Beginner",     xp: 50,  color: "#6fcf97", scenario: "Order a drink and pastry at a café" },
  { id: "dir",       icon: "🗺️", title: "Ask Directions",  difficulty: "Beginner",     xp: 75,  color: "#6fcf97", scenario: "Ask how to get to the train station" },
  { id: "hotel",     icon: "🏨", title: "Hotel Check-in",  difficulty: "Intermediate", xp: 100, color: "#f0c060", scenario: "Check in and request a room upgrade" },
  { id: "market",    icon: "🛒", title: "Market Haggling", difficulty: "Intermediate", xp: 125, color: "#f0c060", scenario: "Negotiate prices at a street market" },
  { id: "interview", icon: "💼", title: "Job Interview",   difficulty: "Advanced",     xp: 200, color: "#f87171", scenario: "Self-introduce and answer interview questions" },
];

export default function RoleplayTab({ topic, language, onXpEarned, completedQuests, setCompletedQuests, onTopicChange, onQuestChange }) {
  const [activeQuest, setActiveQuest] = useState(null);
  const [messages,    setMessages]    = useState([]);
  const [textInput,   setTextInput]   = useState("");
  const [loading,     setLoading]     = useState(false);
  const [turns,       setTurns]       = useState(0);
  const [questDone,   setQuestDone]   = useState(false);
  const [listening,   setListening]   = useState(false);
  const [status,      setStatus]      = useState("");
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const endRef         = useRef(null);
  const messagesRef    = useRef([]);

  // Keep messagesRef in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendToNPC = useCallback(async (text) => {
    if (!text.trim() || !activeQuest) return;
    const newTurns = turns + 1;
    setTurns(newTurns);
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);
    setStatus("NPC is responding...");

    try {
      const res = await fetch("/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GROQ_KEY
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 100,
          temperature: 0.8,
          messages: [
            {
              role: "system",
              content: `You are an NPC in a language learning roleplay.
Scenario: ${activeQuest.scenario}.
Student is learning: ${language?.name}.
The student speaks in English. You MUST respond in ${language?.name}.
Add English translation in [brackets] after key phrases.
Stay strictly in character. Keep responses to 1-3 sentences.`
            },
            ...messagesRef.current.map(m => ({
              role: m.role === "npc" ? "assistant" : "user",
              content: m.text
            })),
            { role: "user", content: text }
          ]
        })
      });

      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "Please continue!";
      setMessages(prev => [...prev, { role: "npc", text: reply }]);
      speakText(reply);

      if (newTurns >= 4 && !questDone) {
        setQuestDone(true);
        setCompletedQuests(prev => [...prev, activeQuest.id]);
        onXpEarned(activeQuest.xp);
      }
    } catch(e) {
      setMessages(prev => [...prev, { role: "npc", text: "Please continue!" }]);
    }
    setLoading(false);
    setStatus("");
  }, [activeQuest, turns, questDone, language]);

  // Setup speech — recreate when activeQuest changes
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    // Clean up old instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch(e) {}
    }

    const r          = new SR();
    r.lang           = "en-US";
    r.interimResults = true;
    r.continuous     = false;

    r.onstart = () => {
      isListeningRef.current = true;
      setListening(true);
      setStatus("🔴 Listening... speak now");
    };

    r.onend = () => {
      isListeningRef.current = false;
      setListening(false);
      setStatus("");
    };

    r.onerror = (e) => {
      isListeningRef.current = false;
      setListening(false);
      setStatus("Mic error: " + e.error);
      setTimeout(() => setStatus(""), 2000);
    };

    r.onresult = (e) => {
      const text  = Array.from(e.results).map(r => r[0].transcript).join("");
      const final = e.results[e.results.length - 1].isFinal;
      setStatus("Heard: " + text);
      if (final) {
        r.stop();
        if (text.trim()) sendToNPC(text.trim());
      }
    };

    recognitionRef.current = r;

    return () => {
      try { r.abort(); } catch(e) {}
    };
  }, [activeQuest, sendToNPC]);

  function toggleMic() {
    const r = recognitionRef.current;
    if (!r) { setStatus("Speech not supported — use Chrome"); return; }
    if (isListeningRef.current) {
      r.stop();
    } else {
      try {
        r.start();
      } catch(e) {
        setStatus("Tap again to retry");
        setTimeout(() => setStatus(""), 2000);
      }
    }
  }

  function speakText(text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = { es:"es-ES", fr:"fr-FR", de:"de-DE", ja:"ja-JP", pt:"pt-PT" }[language?.code] || "en-US";
    u.rate  = 0.9;
    window.speechSynthesis.speak(u);
  }

  async function startQuest(quest) {
    setActiveQuest(quest);
    setMessages([]);
    setTurns(0);
    setQuestDone(false);
    setStatus("");
    if (onTopicChange) onTopicChange(quest.title);
    if (onQuestChange) onQuestChange(quest);

    setLoading(true);
    try {
      const res = await fetch("/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 80,
          temperature: 0.8,
          messages: [{
            role: "user",
            content: `You are an NPC starting a roleplay: "${quest.scenario}". 
Greet the learner in ${language?.name}. Add English in [brackets]. 1-2 sentences only. Stay in character.`
          }]
        })
      });
      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || `Hello! Let's start: ${quest.scenario}`;
      setMessages([{ role: "npc", text: reply }]);
      speakText(reply);
    } catch(e) {
      setMessages([{ role: "npc", text: `Hello! Let's practice: ${quest.scenario}` }]);
    }
    setLoading(false);
  }

  function exitQuest() {
    window.speechSynthesis.cancel();
    if (recognitionRef.current) try { recognitionRef.current.abort(); } catch(e) {}
    setActiveQuest(null);
    setMessages([]);
    if (onTopicChange) onTopicChange("Lesson 1 - Greetings");
    if (onQuestChange) onQuestChange(null);
  }

  function sendText() {
    if (!textInput.trim() || loading) return;
    const t = textInput.trim();
    setTextInput("");
    sendToNPC(t);
  }

  // ── Quest catalog ──
  if (!activeQuest) return (
    <div className="quest-container">
      <p className="quest-header-text">Choose a quest to practice {language?.name}</p>
      <div className="quest-grid">
        {QUESTS.map(q => {
          const done = completedQuests?.includes(q.id);
          return (
            <div key={q.id} className={`quest-card ${done ? "done" : ""}`} onClick={() => !done && startQuest(q)}>
              <div className="quest-card-top">
                <span className="quest-icon">{q.icon}</span>
                {done && <span className="quest-check">✓</span>}
              </div>
              <p className="quest-title">{q.title}</p>
              <span className="quest-badge" style={{ background: q.color + "22", color: q.color, border: `1px solid ${q.color}44` }}>
                {q.difficulty}
              </span>
              <p className="quest-xp">+{q.xp} XP</p>
              <p className="quest-scenario">{q.scenario}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Active quest ──
  return (
    <div className="quest-active">
      <div className="quest-active-header">
        <span>{activeQuest.icon} {activeQuest.title}</span>
        <span className="quest-turns">{turns}/4 turns</span>
        <button className="quest-exit-btn" onClick={exitQuest}>✕</button>
      </div>

      {questDone && (
        <div className="quest-complete-banner">
          🎉 Quest complete! +{activeQuest.xp} XP earned!
        </div>
      )}

      <div className="quest-messages">
        {messages.map((m, i) => (
          <div key={i} className={`quest-bubble ${m.role}`}>
            {m.role === "npc" && <span className="quest-npc-name">{activeQuest.icon} NPC</span>}
            <p>{m.text}</p>
          </div>
        ))}
        {loading && (
          <div className="quest-bubble npc">
            <span className="quest-npc-name">{activeQuest.icon} NPC</span>
            <p className="typing">● ● ●</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="quest-controls">
        {status && <p className="quest-status">{status}</p>}
        <button
          className={"call-mic-btn " + (listening ? "active" : "")}
          onClick={toggleMic}
          disabled={loading || questDone}
        >
          {listening ? "🔴" : "🎙"}
        </button>
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendText()}
            placeholder="Type your response..."
            disabled={loading || questDone}
          />
          <button className="chat-send" onClick={sendText} disabled={loading || questDone}>➤</button>
        </div>
      </div>
    </div>
  );
}
