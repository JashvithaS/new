import { useState, useRef, useEffect } from "react";
// const GROQ_API_KEY     = "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";

const GROQ_CHAT_URL     = "/openai/v1/chat/completions";
const GROQ_STT_URL      = "/openai/v1/audio/transcriptions";
const SILENCE_MS        = 2500;
const VOICE_THRESH      = 0.020;
const INTERRUPT_THRESH  = 0.1;
const SPEAK_COOLDOWN    = 1500;
const INTERRUPT_FRAMES  = 15;
const IDLE_FRAMES       = 8;
const POST_SPEAK_DELAY  = 1200;
const MIN_SPEECH_MS     = 1000;
const MIN_WORDS         = 1;

export default function AudioCallTab({ topic, language, isActive }) {
  const [messages,   setMessages]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [listening,  setListening]  = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [ariaStatus, setAriaStatus] = useState("idle");
  const [textInput,  setTextInput]  = useState("");
  const [micError,   setMicError]   = useState("");
  const [showReview, setShowReview] = useState(false);

  const synthRef           = useRef(window.speechSynthesis);
  const streamRef          = useRef(null);
  const mediaRecRef        = useRef(null);
  const audioChunksRef     = useRef([]);
  const audioCtxRef        = useRef(null);
  const analyserRef        = useRef(null);
  const rafRef             = useRef(null);
  const mimeTypeRef        = useRef("");
  const lastSoundRef       = useRef(Date.now());
  const speakStartRef      = useRef(0);
  const ariaStatusRef      = useRef("idle");
  const listeningRef       = useRef(false);
  const hasSpokenRef       = useRef(false);
  const hasSpokenFramesRef = useRef(0);
  const idleCountRef       = useRef(0);
  const interruptCountRef  = useRef(0);
  const recordStartRef     = useRef(0);
  const messagesRef        = useRef([]);
  const callLogRef         = useRef([]);
  const messagesEndRef     = useRef(null);

  useEffect(() => { messagesRef.current   = messages;   }, [messages]);
  useEffect(() => { ariaStatusRef.current = ariaStatus; }, [ariaStatus]);
  useEffect(() => { listeningRef.current  = listening;  }, [listening]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { return () => cleanupCall(); }, []);

  // ✅ Stop everything when user switches tabs
  useEffect(() => {
    if (isActive === false) {
      cleanupCall();
      setCallActive(false);
      setAriaStatus("idle");
      setListening(false);
      ariaStatusRef.current = "idle";
      listeningRef.current  = false;
    }
  }, [isActive]);

  function getLangCode(code) {
    return { es:"es-ES", fr:"fr-FR", de:"de-DE", ja:"ja-JP", pt:"pt-PT" }[code] || "en-US";
  }

  function cleanupCall() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      try { mediaRecRef.current.stop(); } catch(_) {}
    }
    mediaRecRef.current = null;
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch(_) {} audioCtxRef.current = null; }
    analyserRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    synthRef.current.cancel();
  }

  async function startCall() {
    setMicError("");
    setShowReview(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;
      const ctx      = new AudioContext();
      const src      = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      mimeTypeRef.current = ["audio/webm;codecs=opus","audio/webm","audio/ogg"]
        .find(t => MediaRecorder.isTypeSupported(t)) || "";
      setMessages([]);
      callLogRef.current = [];
      setCallActive(true);
      ariaStatusRef.current = "idle";
      setAriaStatus("idle");
      startMonitorLoop();
      speakAria("Hi! I am Aria. Let us practice " + topic + " in " + (language?.name||"") + ". Just speak anytime — even while I am talking!");
    } catch(err) {
      setMicError("Microphone access denied. Please allow mic and try again.");
    }
  }

  function startMonitorLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    lastSoundRef.current = Date.now();

    function tick() {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]-128)/128;
        sum += v*v;
      }
      const rms    = Math.sqrt(sum/data.length);
      const status = ariaStatusRef.current;

      if (status === "listening" && listeningRef.current) {
        if (rms > VOICE_THRESH) {
          hasSpokenFramesRef.current++;
          if (hasSpokenFramesRef.current >= 10) hasSpokenRef.current = true;
          lastSoundRef.current = Date.now();
        }
        if (hasSpokenRef.current && rms <= VOICE_THRESH) {
          if (Date.now() - lastSoundRef.current >= SILENCE_MS) {
            if (mediaRecRef.current && mediaRecRef.current.state === "recording") {
              ariaStatusRef.current = "thinking";
              listeningRef.current  = false;
              mediaRecRef.current.stop();
            }
          }
        }
      } else if (status === "idle" && !listeningRef.current) {
        if (rms > VOICE_THRESH) {
          idleCountRef.current++;
          if (idleCountRef.current >= IDLE_FRAMES) {
            idleCountRef.current = 0;
            beginRecording();
          }
        } else {
          idleCountRef.current = 0;
        }
      } else if (status === "speaking") {
        const age = Date.now() - speakStartRef.current;
        if (age > SPEAK_COOLDOWN && rms > INTERRUPT_THRESH) {
          interruptCountRef.current++;
          if (interruptCountRef.current >= INTERRUPT_FRAMES) {
            interruptCountRef.current = 0;
            ariaStatusRef.current = "idle";
            synthRef.current.cancel();
            setAriaStatus("idle");
            setTimeout(() => beginRecording(), 100);
          }
        } else {
          interruptCountRef.current = 0;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function beginRecording() {
    if (!streamRef.current)                   return;
    if (listeningRef.current)                 return;
    if (ariaStatusRef.current === "thinking") return;
    if (ariaStatusRef.current === "speaking") return;

    listeningRef.current        = true;
    ariaStatusRef.current       = "listening";
    hasSpokenRef.current        = false;
    hasSpokenFramesRef.current  = 0;
    idleCountRef.current        = 0;
    interruptCountRef.current   = 0;
    recordStartRef.current      = Date.now();

    try {
      const mimeType = mimeTypeRef.current;
      const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      mediaRecRef.current    = recorder;
      lastSoundRef.current   = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        setListening(false);
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (!chunks.length || !streamRef.current) { ariaStatusRef.current = "idle"; setAriaStatus("idle"); return; }
        const blob     = new Blob(chunks, { type: mimeType||"audio/webm" });
        const duration = Date.now() - recordStartRef.current;
        if (duration < MIN_SPEECH_MS || blob.size < 2000) { ariaStatusRef.current = "idle"; setAriaStatus("idle"); return; }
        ariaStatusRef.current = "thinking";
        setAriaStatus("thinking");
        try {
          const ext      = (mimeType||"audio/webm").includes("ogg") ? "ogg" : "webm";
          const formData = new FormData();
          formData.append("file",     blob, "rec."+ext);
          formData.append("model",    "whisper-large-v3");
          formData.append("language", "en");
          const res   = await fetch(GROQ_STT_URL, { method:"POST", headers:{ Authorization:"Bearer "+GROQ_API_KEY }, body:formData });
          const json  = await res.json();
          const text  = json?.text?.trim();
          const words = text ? text.split(/\s+/).filter(w=>w.length>0).length : 0;
          if (text && words >= MIN_WORDS) { sendToAria(text); }
          else { ariaStatusRef.current = "idle"; setAriaStatus("idle"); }
        } catch(err) { ariaStatusRef.current = "idle"; setAriaStatus("idle"); }
      };
      recorder.start(250);
      setListening(true);
      setAriaStatus("listening");
    } catch(err) { listeningRef.current=false; ariaStatusRef.current="idle"; setListening(false); setAriaStatus("idle"); }
  }

  async function sendToAria(text) {
    const history = messagesRef.current.map(m => ({ role: m.role==="aria"?"assistant":"user", content:m.text }));
    setMessages(prev => [...prev, { role:"user", text }]);
    callLogRef.current.push({ role:"user", text });
    ariaStatusRef.current = "thinking";
    setAriaStatus("thinking");
    setLoading(true);
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization:"Bearer "+GROQ_API_KEY },
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile",
          messages:[
            { role:"system", content:"You are Aria, a friendly language tutor. Topic: "+topic+". Student learning: "+(language?.name||"")+". Reply in 1-2 sentences in "+(language?.name||"")+" with English in [brackets]. Correct mistakes gently." },
            ...history,
            { role:"user", content:text }
          ],
          max_tokens:80, temperature:0.7
        })
      });
      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "Sorry, try again!";
      setMessages(prev => [...prev, { role:"aria", text:reply }]);
      callLogRef.current.push({ role:"aria", text:reply });
      speakAria(reply);
    } catch(err) { ariaStatusRef.current="idle"; setAriaStatus("idle"); }
    setLoading(false);
  }

  function speakAria(text) {
    synthRef.current.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = getLangCode(language?.code);
    u.rate  = 0.88; u.pitch = 1.05;
    speakStartRef.current = Date.now();
    ariaStatusRef.current = "speaking";
    setAriaStatus("speaking");
    u.onend = () => {
      if (ariaStatusRef.current === "speaking") {
        ariaStatusRef.current = "idle"; setAriaStatus("idle");
        setTimeout(() => beginRecording(), POST_SPEAK_DELAY);
      }
    };
    synthRef.current.speak(u);
  }

  function toggleMic() {
    if (ariaStatusRef.current === "thinking") return;
    if (listeningRef.current) {
      listeningRef.current = false;
      if (mediaRecRef.current && mediaRecRef.current.state === "recording") mediaRecRef.current.stop();
    } else {
      synthRef.current.cancel();
      ariaStatusRef.current = "idle";
      beginRecording();
    }
  }

  function endCall() {
    cleanupCall();
    setCallActive(false);
    setAriaStatus("idle");
    setListening(false);
    setShowReview(true);
  }

  async function sendTextMessage() {
    if (!textInput.trim()||loading) return;
    const t = textInput.trim();
    setTextInput("");
    await sendToAria(t);
  }

  function exportLog() {
    const txt = callLogRef.current.map(m=>(m.role==="aria"?"Aria":"You")+": "+m.text).join("\n");
    const a   = document.createElement("a");
    a.href    = URL.createObjectURL(new Blob([txt],{type:"text/plain"}));
    a.download= "aria-transcript.txt";
    a.click();
  }

  const statusLabel = {
    idle:      "🎙 Listening for your voice...",
    listening: "🔴 Recording — speak now",
    thinking:  "💭 Aria is thinking...",
    speaking:  "🔊 Aria speaking — talk to interrupt!",
  }[ariaStatus];

  if (showReview) return (
    <div className="review-container">
      <div className="review-header"><span>📋 Post-Call Review</span><span className="review-count">{callLogRef.current.length} turns</span></div>
      <div className="review-messages">
        {callLogRef.current.map((m,i) => (
          <div key={i} className={"review-bubble "+m.role}>
            <div className="review-meta"><span className="review-role">{m.role==="aria"?"🤖 Aria":"👤 You"}</span></div>
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

  if (!callActive) return (
    <div className="call-idle">
      <div className="call-avatar">🤖</div>
      <p className="call-aria-name">Aria</p>
      <p className="call-topic">Topic: <strong>{topic}</strong></p>
      <p className="call-lang">Language: <strong>{language?.name}</strong></p>
      {micError && <p style={{color:"#f87171",fontSize:"12px",textAlign:"center",padding:"0 16px"}}>{micError}</p>}
      <button className="call-start-btn" onClick={startCall}>📞 Start Call</button>
    </div>
  );

  return (
    <div className="call-active">
      <div className="call-messages">
        {messages.map((msg,i) => (
          <div key={i} className={"call-bubble "+msg.role}>
            {msg.role==="aria" && <span className="call-name">Aria</span>}
            <p>{msg.text}</p>
          </div>
        ))}
        {ariaStatus==="thinking" && <div className="call-bubble aria"><span className="call-name">Aria</span><p className="typing">● ● ●</p></div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="call-controls">
        <p className="call-status">{statusLabel}</p>
        {micError && <p style={{color:"#f87171",fontSize:"11px"}}>{micError}</p>}
        <button className={"call-mic-btn"+(listening?" active":"")} onClick={toggleMic} disabled={ariaStatus==="thinking"}>
          {listening ? "🔴" : "🎙"}
        </button>
        <button className="call-end-btn" onClick={endCall}>📵 End Call</button>
      </div>
      <div className="chat-input-row">
        <input className="chat-input" value={textInput} onChange={e=>setTextInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendTextMessage()} placeholder="Or type your message..." disabled={loading} />
        <button className="chat-send" onClick={sendTextMessage}>➤</button>
      </div>
    </div>
  );
}
