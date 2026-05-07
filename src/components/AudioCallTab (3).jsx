import { useState, useRef, useEffect } from "react";

const GROQ_KEY = "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";

export default function AudioCallTab({ topic, language }) {
  const [messages,   setMessages]   = useState([]);
  const [textInput,  setTextInput]  = useState("");
  const [loading,    setLoading]    = useState(false);
  const [listening,  setListening]  = useState(false);
  const [speaking,   setSpeaking]   = useState(false);
  const [status,     setStatus]     = useState("Click Start Call to begin");
  const [started,    setStarted]    = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [callLog,    setCallLog]    = useState([]);

  const recognitionRef = useRef(null);
  const endRef         = useRef(null);
  const startTimeRef   = useRef(null);
  const speakingRef    = useRef(false);
  const listeningRef   = useRef(false);
  const analyserRef    = useRef(null);
  const audioCtxRef    = useRef(null);
  const streamRef      = useRef(null);
  const vadRef         = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function getTime() {
    if (!startTimeRef.current) return "00:00";
    const e = Math.floor((Date.now() - startTimeRef.current) / 1000);
    return String(Math.floor(e/60)).padStart(2,"0")+":"+String(e%60).padStart(2,"0");
  }

  // ── Setup mic + VAD ──
  async function setupMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src      = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize        = 512;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      analyserRef.current = analyser;
      return true;
    } catch(e) {
      setStatus("⚠️ Allow microphone access first!");
      return false;
    }
  }

  // ── VAD — runs every 100ms, stops Aria the MOMENT you speak ──
  function startVAD() {
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    vadRef.current = setInterval(() => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(data);
      const avg = data.reduce((a,b) => a+b, 0) / data.length;

      // If Aria is speaking and mic detects ANY sound above 8 → STOP instantly
      if (avg > 8 && speakingRef.current && !listeningRef.current) {
        window.speechSynthesis.cancel();
        speakingRef.current = false;
        setSpeaking(false);
        setStatus("🔴 Listening...");
        // Small delay then start recognition
        setTimeout(() => {
          if (!listeningRef.current) {
            try { recognitionRef.current?.start(); } catch(e) {}
          }
        }, 100);
      }
    }, 100);
  }

  function stopVAD() {
    if (vadRef.current) { clearInterval(vadRef.current); vadRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    analyserRef.current = null;
  }

  // ── Speech recognition setup ──
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang           = "en-US";
    r.interimResults = true;
    r.continuous     = false;

    r.onstart  = () => { listeningRef.current = true;  setListening(true);  setStatus("🔴 Listening..."); };
    r.onend    = () => { listeningRef.current = false; setListening(false); setStatus("🎙 Your turn — tap mic or speak"); };
    r.onerror  = (e) => { listeningRef.current = false; setListening(false); setStatus("Mic error — tap again"); };
    r.onresult = (e) => {
      const text  = Array.from(e.results).map(r=>r[0].transcript).join("");
      const final = e.results[e.results.length-1].isFinal;
      setStatus("Heard: " + text);
      if (final) { r.stop(); sendToAria(text); }
    };
    recognitionRef.current = r;
  }, []);

  // ── Start call ──
  async function startCall() {
    const ok = await setupMic();
    if (!ok) return;
    setStarted(true);
    setShowReview(false);
    setMessages([]);
    setCallLog([]);
    startTimeRef.current = Date.now();
    startVAD();
    const g = "Hi! I am Aria. Let us practice " + topic + " in " + (language?.name||"") + "! Just start speaking anytime!";
    setMessages([{ role:"aria", text:g, time:"00:00" }]);
    setCallLog([{ role:"aria", text:g, time:"00:00" }]);
    speakAria(g);
  }

  // ── End call ──
  function endCall() {
    window.speechSynthesis.cancel();
    speakingRef.current  = false;
    listeningRef.current = false;
    try { recognitionRef.current?.abort(); } catch(e) {}
    stopVAD();
    setStarted(false);
    setSpeaking(false);
    setListening(false);
    setShowReview(true);
  }

  // ── Tap mic button ──
  function toggleMic() {
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    if (listeningRef.current) {
      try { recognitionRef.current?.stop(); } catch(e) {}
    } else {
      try { recognitionRef.current?.start(); } catch(e) { setStatus("Tap again"); }
    }
  }

  // ── TTS — Aria speaks ──
  function speakAria(text) {
    window.speechSynthesis.cancel();
    const u  = new SpeechSynthesisUtterance(text);
    u.lang   = { es:"es-ES", fr:"fr-FR", de:"de-DE", ja:"ja-JP", pt:"pt-PT" }[language?.code] || "en-US";
    u.rate   = 0.88;
    speakingRef.current = true;
    setSpeaking(true);
    setStatus("🔊 Aria speaking — just talk to interrupt!");
    u.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      setStatus("🎙 Your turn — tap mic or speak");
    };
    window.speechSynthesis.speak(u);
  }

  // ── Send to Groq ──
  async function sendToAria(text) {
    if (!text.trim()) return;
    const time    = getTime();
    const userMsg = { role:"user", text, time };
    setMessages(prev=>[...prev, userMsg]);
    setCallLog(prev=>[...prev, userMsg]);
    setLoading(true);
    setStatus("💭 Aria is thinking...");
    try {
      const res = await fetch("/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+GROQ_KEY },
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile",
          max_tokens:40,
          temperature:0.7,
          messages:[
            { role:"system", content:"You are Aria, a friendly beginner language tutor. Topic: "+topic+". Student learning: "+(language?.name||"")+". Reply in ONE short sentence ONLY in "+(language?.name||"")+" with English in [brackets]. Keep it simple." },
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
      setStatus("🎙 Tap mic or type");
    }
    setLoading(false);
  }

  async function sendText() {
    if (!textInput.trim()||loading) return;
    const t = textInput.trim();
    setTextInput("");
    await sendToAria(t);
  }

  function exportLog() {
    const txt = callLog.map(m=>"["+m.time+"] "+(m.role==="aria"?"Aria":"You")+": "+m.text).join("\n");
    const a   = document.createElement("a");
    a.href    = URL.createObjectURL(new Blob([txt],{type:"text/plain"}));
    a.download= "aria-transcript.txt";
    a.click();
  }

  // ── Post-call review ──
  if (showReview) return (
    <div className="review-container">
      <div className="review-header">
        <span>📋 Post-Call Review</span>
        <span className="review-count">{callLog.length} turns</span>
      </div>
      <div className="review-messages">
        {callLog.map((m,i) => (
          <div key={i} className={"review-bubble "+m.role}>
            <div className="review-meta">
              <span className="review-role">{m.role==="aria"?"🤖 Aria":"👤 You"}</span>
              <span className="review-time">{m.time}</span>
            </div>
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

  // ── Pre-call ──
  if (!started) return (
    <div className="call-idle">
      <div className="call-avatar">🤖</div>
      <p className="call-aria-name">Aria</p>
      <p className="call-topic">Topic: <strong>{topic}</strong></p>
      <p className="call-lang">Language: <strong>{language?.name}</strong></p>
      <button className="call-start-btn" onClick={startCall}>📞 Start Call</button>
      {callLog.length > 0 && (
        <button className="review-back-btn" onClick={()=>setShowReview(true)}>📋 Last Transcript</button>
      )}
    </div>
  );

  // ── Active call ──
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
        {loading && (
          <div className="call-bubble aria">
            <span className="call-name">Aria</span>
            <p className="typing">● ● ●</p>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="call-controls">
        <p className="call-status">{status}</p>
        <div className="call-btn-row">
          <button
            className={"call-mic-btn "+(listening?"active":"")}
            onClick={toggleMic}
            disabled={loading}
          >
            {listening ? "🔴" : "🎙"}
          </button>
          {speaking && (
            <button className="call-stop-btn" onClick={()=>{ window.speechSynthesis.cancel(); speakingRef.current=false; setSpeaking(false); }}>
              ⏹ Stop
            </button>
          )}
        </div>
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={textInput}
            onChange={e=>setTextInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&sendText()}
            placeholder="Or type here..."
            disabled={loading}
          />
          <button className="chat-send" onClick={sendText} disabled={loading}>➤</button>
        </div>
        <button className="call-end-btn" onClick={endCall}>📵 End Call</button>
      </div>
    </div>
  );
}
