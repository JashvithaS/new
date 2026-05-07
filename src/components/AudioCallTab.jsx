import { useState, useRef, useEffect } from "react";

const GROQ_KEY = "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";

export default function AudioCallTab({ topic, language }) {
  const [messages,   setMessages]   = useState([]);
  const [textInput,  setTextInput]  = useState("");
  const [loading,    setLoading]    = useState(false);
  const [mode,       setMode]       = useState("idle"); // idle | listening | thinking | speaking
  const [started,    setStarted]    = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [callLog,    setCallLog]    = useState([]);

  const recognitionRef = useRef(null);
  const endRef         = useRef(null);
  const startTimeRef   = useRef(null);
  const modeRef        = useRef("idle");
  const loadingRef     = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function setModeAll(m) { modeRef.current = m; setMode(m); }

  function getTime() {
    if (!startTimeRef.current) return "00:00";
    const e = Math.floor((Date.now() - startTimeRef.current) / 1000);
    return String(Math.floor(e/60)).padStart(2,"0")+":"+String(e%60).padStart(2,"0");
  }

  // ── Setup continuous recognition with echo cancellation ──
  function setupRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r          = new SR();
    r.lang           = "en-US";
    r.continuous     = true;   // Keep listening always!
    r.interimResults = true;

    r.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      const text   = result[0].transcript.trim();
      const final  = result.isFinal;

      // If Aria is speaking → INTERRUPT immediately on any speech
      if (modeRef.current === "speaking") {
        window.speechSynthesis.cancel();
        setModeAll("listening");
      }

      if (final && text && !loadingRef.current) {
        processUserSpeech(text);
      }
    };

    r.onerror = (e) => {
      if (e.error === "no-speech") return; // ignore silence
      if (e.error === "aborted")   return;
      console.log("Speech error:", e.error);
    };

    r.onend = () => {
      // Auto-restart if call is active
      if (modeRef.current !== "idle") {
        setTimeout(() => {
          try { r.start(); } catch(e) {}
        }, 200);
      }
    };

    return r;
  }

  async function startCall() {
    setStarted(true);
    setShowReview(false);
    setMessages([]);
    setCallLog([]);
    startTimeRef.current = Date.now();

    const r = setupRecognition();
    recognitionRef.current = r;
    setModeAll("listening");
    try { r?.start(); } catch(e) {}

    const g = "Hi! I am Aria. Let us practice " + topic + " in " + (language?.name||"") + "! Just start speaking!";
    setMessages([{ role:"aria", text:g, time:"00:00" }]);
    setCallLog([{ role:"aria", text:g, time:"00:00" }]);
    speakAria(g);
  }

  function endCall() {
    window.speechSynthesis.cancel();
    try { recognitionRef.current?.abort(); } catch(e) {}
    recognitionRef.current = null;
    setModeAll("idle");
    setStarted(false);
    setShowReview(true);
    loadingRef.current = false;
  }

  async function processUserSpeech(text) {
    loadingRef.current = true;
    await sendToAria(text);
    loadingRef.current = false;
  }

  function speakAria(text) {
    window.speechSynthesis.cancel();
    const u  = new SpeechSynthesisUtterance(text);
    u.lang   = { es:"es-ES", fr:"fr-FR", de:"de-DE", ja:"ja-JP", pt:"pt-PT" }[language?.code] || "en-US";
    u.rate   = 0.88;
    setModeAll("speaking");
    u.onend  = () => { setModeAll("listening"); };
    window.speechSynthesis.speak(u);
  }

  async function sendToAria(text) {
    const time    = getTime();
    const userMsg = { role:"user", text, time };
    setMessages(prev=>[...prev, userMsg]);
    setCallLog(prev=>[...prev, userMsg]);
    setModeAll("thinking");
    setLoading(true);

    try {
      const res = await fetch("/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+GROQ_KEY },
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile",
          max_tokens:40,
          temperature:0.7,
          messages:[
            { role:"system", content:"You are Aria, a beginner language tutor. Topic: "+topic+". Language: "+(language?.name||"")+". Reply in ONE short sentence in "+(language?.name||"")+" with English in [brackets]." },
            { role:"user", content:text }
          ]
        })
      });
      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "Try again!";
      const ariaMsg = { role:"aria", text:reply, time:getTime() };
      setMessages(prev=>[...prev, ariaMsg]);
      setCallLog(prev=>[...prev, ariaMsg]);
      speakAria(reply);
    } catch(err) {
      setModeAll("listening");
    }
    setLoading(false);
  }

  async function sendText() {
    if (!textInput.trim()||loading) return;
    const t = textInput.trim();
    setTextInput("");
    loadingRef.current = true;
    await sendToAria(t);
    loadingRef.current = false;
  }

  function exportLog() {
    const txt = callLog.map(m=>"["+m.time+"] "+(m.role==="aria"?"Aria":"You")+": "+m.text).join("\n");
    const a   = document.createElement("a");
    a.href    = URL.createObjectURL(new Blob([txt],{type:"text/plain"}));
    a.download= "aria-transcript.txt";
    a.click();
  }

  const statusText = {
    idle:      "Click Start Call",
    listening: "🎙 Listening — speak anytime",
    thinking:  "💭 Aria is thinking...",
    speaking:  "🔊 Aria speaking — talk to interrupt!",
  }[mode];

  if (showReview) return (
    <div className="review-container">
      <div className="review-header"><span>📋 Post-Call Review</span><span className="review-count">{callLog.length} turns</span></div>
      <div className="review-messages">
        {callLog.map((m,i) => (
          <div key={i} className={"review-bubble "+m.role}>
            <div className="review-meta"><span className="review-role">{m.role==="aria"?"🤖 Aria":"👤 You"}</span><span className="review-time">{m.time}</span></div>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <div className="review-actions">
        <button className="review-export-btn" onClick={exportLog}>📥 Export .txt</button>
        <button className="review-new-btn" onClick={startCall}>📞 New Call</button>
      </div>
    </div>
  );

  if (!started) return (
    <div className="call-idle">
      <div className="call-avatar">🤖</div>
      <p className="call-aria-name">Aria</p>
      <p className="call-topic">Topic: <strong>{topic}</strong></p>
      <p className="call-lang">Language: <strong>{language?.name}</strong></p>
      <button className="call-start-btn" onClick={startCall}>📞 Start Call</button>
      {callLog.length > 0 && <button className="review-back-btn" onClick={()=>setShowReview(true)}>📋 Last Transcript</button>}
    </div>
  );

  return (
    <div className="call-active">
      <div className="call-messages">
        {messages.map((m,i) => (
          <div key={i} className={"call-bubble "+m.role}>
            {m.role==="aria" && <span className="call-name">Aria</span>}
            <p>{m.text}</p>
            <span className="call-time">{m.time}</span>
          </div>
        ))}
        {mode==="thinking" && (
          <div className="call-bubble aria">
            <span className="call-name">Aria</span>
            <p className="typing">● ● ●</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="call-controls">
        <div className={"call-mode-orb " + mode}>
          {mode==="speaking"  ? "🔊" :
           mode==="listening" ? "🎙" :
           mode==="thinking"  ? "💭" : "⭕"}
        </div>
        <p className="call-status">{statusText}</p>

        {mode==="speaking" && (
          <button className="call-stop-btn" onClick={()=>{ window.speechSynthesis.cancel(); setModeAll("listening"); }}>
            ⏹ Stop Aria
          </button>
        )}

        <div className="chat-input-row">
          <input
            className="chat-input"
            value={textInput}
            onChange={e=>setTextInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&sendText()}
            placeholder="Or type here..."
            disabled={mode==="thinking"}
          />
          <button className="chat-send" onClick={sendText} disabled={mode==="thinking"}>➤</button>
        </div>
        <button className="call-end-btn" onClick={endCall}>📵 End Call</button>
      </div>
    </div>
  );
}