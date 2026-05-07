import { useState, useRef, useEffect } from "react";

const GROQ_KEY = "YOUR_GROQ_KEY_HERE"; // 🔴 paste your gsk_... key here

export default function ContextualChatBar({ scope, scopeLabel }) {
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const endRef = useRef(null);

  // Reset chat when scope changes (tab or quest changes)
  useEffect(() => {
    setMessages([]);
    setInput("");
    setExpanded(false);
  }, [scope]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendQuestion() {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: question }]);
    setLoading(true);

    try {
      const res = await fetch("/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + GROQ_KEY
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 120,
          temperature: 0.6,
          messages: [
            {
              role: "system",
              content: `You are a helpful language learning assistant scoped ONLY to: "${scope}".
You can ONLY answer questions directly related to this specific lesson or topic.
Keep answers to 2-4 sentences.
If the question is outside this scope, respond EXACTLY with: "I can only help with questions about this specific lesson."
Do not discuss grammar from other lessons, vocabulary from other topics, or anything unrelated to: "${scope}".`
            },
            ...messages.map(m => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.text
            })),
            { role: "user", content: question }
          ]
        })
      });

      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "I can only help with questions about this specific lesson.";
      setMessages(prev => [...prev, { role: "assistant", text: reply }]);
    } catch(e) {
      setMessages(prev => [...prev, { role: "assistant", text: "Something went wrong. Try again!" }]);
    }
    setLoading(false);
  }

  return (
    <div className="chatbar-wrap">
      {/* Toggle button */}
      <button className="chatbar-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="chatbar-toggle-left">
          💬 Ask About This Lesson
        </span>
        <span className="chatbar-scope-pill">{scopeLabel}</span>
        <span className="chatbar-arrow">{expanded ? "▼" : "▲"}</span>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="chatbar-panel">
          <div className="chatbar-messages">
            {messages.length === 0 && (
              <p className="chatbar-empty">Ask anything about <strong>{scopeLabel}</strong></p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chatbar-bubble ${m.role}`}>
                {m.role === "assistant" && <span className="chatbar-name">Aria</span>}
                <p>{m.text}</p>
              </div>
            ))}
            {loading && (
              <div className="chatbar-bubble assistant">
                <span className="chatbar-name">Aria</span>
                <p className="typing">● ● ●</p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="chatbar-input-row">
            <input
              className="chatbar-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendQuestion()}
              placeholder={`Ask about ${scopeLabel}...`}
              disabled={loading}
            />
            <button className="chatbar-send" onClick={sendQuestion} disabled={loading}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}
