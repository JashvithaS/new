import { useState, useRef, useEffect } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const GROQ_API_KEY     = "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";
const GROQ_CHAT_URL    = "/openai/v1/chat/completions";
const GROQ_STT_URL     = "/openai/v1/audio/transcriptions";
const SILENCE_MS       = 2500;
const VOICE_THRESH     = 0.020;
const INTERRUPT_THRESH = 0.040;
const SPEAK_COOLDOWN   = 1500;
const INTERRUPT_FRAMES = 15;
const IDLE_FRAMES      = 8;
const POST_SPEAK_DELAY = 1200;
const MIN_SPEECH_MS    = 1000;
const MIN_WORDS        = 1;

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
  const [npcStatus,   setNpcStatus]   = useState("idle"); // "idle"|"listening"|"thinking"|"speaking"
  const [micError,    setMicError]    = useState("");

  // ── Audio pipeline refs ────────────────────────────────────────────────────
  const streamRef          = useRef(null);
  const audioCtxRef        = useRef(null);
  const analyserRef        = useRef(null);
  const mediaRecRef        = useRef(null);
  const audioChunksRef     = useRef([]);
  const rafRef             = useRef(null);
  const mimeTypeRef        = useRef("");
  const lastSoundRef       = useRef(Date.now());
  const speakStartRef      = useRef(0);
  const npcStatusRef       = useRef("idle");
  const listeningRef       = useRef(false);
  const hasSpokenRef       = useRef(false);
  const hasSpokenFramesRef = useRef(0);
  const idleCountRef       = useRef(0);
  const interruptCountRef  = useRef(0);
  const recordStartRef     = useRef(0);

  // ── Stable refs for values accessed inside RAF / async callbacks ───────────
  const endRef         = useRef(null);
  const messagesRef    = useRef([]);
  const turnsRef       = useRef(0);
  const questDoneRef   = useRef(false);
  const activeQuestRef = useRef(null);
  const languageRef    = useRef(language);

  useEffect(() => { messagesRef.current    = messages;     }, [messages]);
  useEffect(() => { npcStatusRef.current   = npcStatus;    }, [npcStatus]);
  useEffect(() => { turnsRef.current       = turns;        }, [turns]);
  useEffect(() => { questDoneRef.current   = questDone;    }, [questDone]);
  useEffect(() => { activeQuestRef.current = activeQuest;  }, [activeQuest]);
  useEffect(() => { languageRef.current    = language;     }, [language]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Cleanup on unmount
  useEffect(() => { return () => stopMicPipeline(); }, []);

  // ── MIC PIPELINE SETUP ────────────────────────────────────────────────────
  async function startMicPipeline() {
    setMicError("");
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
      audioCtxRef.current  = ctx;
      analyserRef.current  = analyser;
      mimeTypeRef.current  = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
        .find(t => MediaRecorder.isTypeSupported(t)) || "";
      npcStatusRef.current = "idle";
      setNpcStatus("idle");
      startMonitorLoop();
    } catch (err) {
      setMicError("Microphone access denied. Please allow mic access and try again.");
    }
  }

  function stopMicPipeline() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
      try { mediaRecRef.current.stop(); } catch (_) {}
    }
    mediaRecRef.current = null;
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch (_) {} audioCtxRef.current = null; }
    analyserRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    window.speechSynthesis.cancel();
    listeningRef.current = false;
    npcStatusRef.current = "idle";
  }

  // ── 24/7 MONITOR LOOP (requestAnimationFrame) ─────────────────────────────
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
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms    = Math.sqrt(sum / data.length);
      const status = npcStatusRef.current;

      // LISTENING: accumulate voiced frames, auto-submit after silence
      if (status === "listening" && listeningRef.current) {
        if (rms > VOICE_THRESH) {
          hasSpokenFramesRef.current++;
          if (hasSpokenFramesRef.current >= 10) hasSpokenRef.current = true;
          lastSoundRef.current = Date.now();
        }
        if (hasSpokenRef.current && rms <= VOICE_THRESH) {
          if (Date.now() - lastSoundRef.current >= SILENCE_MS) {
            if (mediaRecRef.current && mediaRecRef.current.state === "recording") {
              npcStatusRef.current = "thinking";
              listeningRef.current = false;
              mediaRecRef.current.stop();
            }
          }
        }

      // IDLE: wait for sustained voice then begin recording
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

      // SPEAKING: barge-in — user talks while NPC speaks → stop NPC, start listening
      } else if (status === "speaking") {
        const age = Date.now() - speakStartRef.current;
        if (age > SPEAK_COOLDOWN && rms > INTERRUPT_THRESH) {
          interruptCountRef.current++;
          if (interruptCountRef.current >= INTERRUPT_FRAMES) {
            interruptCountRef.current = 0;
            npcStatusRef.current = "idle";
            window.speechSynthesis.cancel();
            setNpcStatus("idle");
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

  // ── BEGIN RECORDING ───────────────────────────────────────────────────────
  function beginRecording() {
    if (!streamRef.current)                   return;
    if (listeningRef.current)                 return;
    if (npcStatusRef.current === "thinking")  return;
    if (npcStatusRef.current === "speaking")  return;
    if (questDoneRef.current)                 return;
    if (!activeQuestRef.current)              return;

    listeningRef.current        = true;
    npcStatusRef.current        = "listening";
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
        setNpcStatus("thinking");
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (!chunks.length || !streamRef.current) {
          npcStatusRef.current = "idle"; setNpcStatus("idle"); return;
        }
        const blob     = new Blob(chunks, { type: mimeType || "audio/webm" });
        const duration = Date.now() - recordStartRef.current;
        if (duration < MIN_SPEECH_MS || blob.size < 2000) {
          npcStatusRef.current = "idle"; setNpcStatus("idle"); return;
        }
        npcStatusRef.current = "thinking";
        setNpcStatus("thinking");
        try {
          const ext      = (mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
          const formData = new FormData();
          formData.append("file",     blob, "rec." + ext);
          formData.append("model",    "whisper-large-v3");
          formData.append("language", "en");
          const res  = await fetch(GROQ_STT_URL, {
            method: "POST",
            headers: { Authorization: "Bearer " + GROQ_API_KEY },
            body: formData
          });
          const json  = await res.json();
          const text  = json?.text?.trim();
          const words = text ? text.split(/\s+/).filter(w => w.length > 0).length : 0;
          if (text && words >= MIN_WORDS) {
            sendToNPC(text);
          } else {
            npcStatusRef.current = "idle"; setNpcStatus("idle");
          }
        } catch (err) {
          console.error("STT error:", err);
          npcStatusRef.current = "idle"; setNpcStatus("idle");
        }
      };

      recorder.start(250);
      setNpcStatus("listening");
    } catch (err) {
      listeningRef.current  = false;
      npcStatusRef.current  = "idle";
      setNpcStatus("idle");
    }
  }

  // ── SEND TO NPC ────────────────────────────────────────────────────────────
  async function sendToNPC(text) {
    if (!text.trim()) return;
    const quest = activeQuestRef.current;
    if (!quest) return;
    const lang     = languageRef.current;
    const newTurns = turnsRef.current + 1;
    setTurns(newTurns);
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);
    npcStatusRef.current = "thinking";
    setNpcStatus("thinking");
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 100,
          temperature: 0.8,
          messages: [
            {
              role: "system",
              content: `You are an NPC in a language learning roleplay. Scenario: ${quest.scenario}. Student is learning: ${lang?.name}. The student speaks in English. You MUST respond in ${lang?.name}. Add English translation in [brackets] after key phrases. Stay strictly in character. Keep responses to 1-3 sentences.`
            },
            ...messagesRef.current.map(m => ({ role: m.role === "npc" ? "assistant" : "user", content: m.text })),
            { role: "user", content: text }
          ]
        })
      });
      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || "Please continue!";
      setMessages(prev => [...prev, { role: "npc", text: reply }]);
      speakText(reply);
      if (newTurns >= 4 && !questDoneRef.current) {
        setQuestDone(true);
        setCompletedQuests(prev => [...prev, quest.id]);
        onXpEarned(quest.xp);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "npc", text: "Please continue!" }]);
      npcStatusRef.current = "idle"; setNpcStatus("idle");
    }
    setLoading(false);
  }

  // ── TTS with barge-in support ──────────────────────────────────────────────
  function speakText(text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = { es:"es-ES", fr:"fr-FR", de:"de-DE", ja:"ja-JP", pt:"pt-PT" }[languageRef.current?.code] || "en-US";
    u.rate  = 0.9;
    speakStartRef.current = Date.now();
    npcStatusRef.current  = "speaking";
    setNpcStatus("speaking");
    u.onend = () => {
      // Only transition if not already interrupted (barge-in sets status to "idle" first)
      if (npcStatusRef.current === "speaking") {
        npcStatusRef.current = "idle";
        setNpcStatus("idle");
        if (!questDoneRef.current) {
          setTimeout(() => beginRecording(), POST_SPEAK_DELAY);
        }
      }
    };
    window.speechSynthesis.speak(u);
  }

  // ── START QUEST ────────────────────────────────────────────────────────────
  async function startQuest(quest) {
    setActiveQuest(quest);
    activeQuestRef.current = quest;
    setMessages([]);
    setTurns(0);
    turnsRef.current     = 0;
    setQuestDone(false);
    questDoneRef.current = false;
    setMicError("");
    if (onTopicChange) onTopicChange(quest.title);
    if (onQuestChange) onQuestChange(quest);
    setLoading(true);
    await startMicPipeline();
    const lang = languageRef.current;
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 80,
          temperature: 0.8,
          messages: [{ role: "user", content: `You are an NPC starting a roleplay: "${quest.scenario}". Greet the learner in ${lang?.name}. Add English in [brackets]. 1-2 sentences only. Stay in character.` }]
        })
      });
      const data  = await res.json();
      const reply = data?.choices?.[0]?.message?.content || `Hello! Let's start: ${quest.scenario}`;
      setMessages([{ role: "npc", text: reply }]);
      speakText(reply);
    } catch (e) {
      setMessages([{ role: "npc", text: `Hello! Let's practice: ${quest.scenario}` }]);
      npcStatusRef.current = "idle"; setNpcStatus("idle");
      setTimeout(() => beginRecording(), POST_SPEAK_DELAY);
    }
    setLoading(false);
  }

  // ── EXIT QUEST ─────────────────────────────────────────────────────────────
  function exitQuest() {
    stopMicPipeline();
    setActiveQuest(null);
    activeQuestRef.current = null;
    setMessages([]);
    setNpcStatus("idle");
    if (onTopicChange) onTopicChange("Lesson 1 - Greetings");
    if (onQuestChange) onQuestChange(null);
  }

  function sendText() {
    if (!textInput.trim() || loading) return;
    const t = textInput.trim();
    setTextInput("");
    sendToNPC(t);
  }

  const statusLabel = {
    idle:      "🎙 Listening for your voice...",
    listening: "🔴 Recording — speak now",
    thinking:  "💭 NPC is thinking...",
    speaking:  "🔊 NPC speaking — talk to interrupt!",
  }[npcStatus] || "";

  const micIcon = { idle: "🎙", listening: "🔴", thinking: "💭", speaking: "🔊" }[npcStatus] || "🎙";

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
              <span className="quest-badge" style={{ background: q.color+"22", color: q.color, border: `1px solid ${q.color}44` }}>{q.difficulty}</span>
              <p className="quest-xp">+{q.xp} XP</p>
              <p className="quest-scenario">{q.scenario}</p>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="quest-active">
      <div className="quest-active-header">
        <span>{activeQuest.icon} {activeQuest.title}</span>
        <span className="quest-turns">{turns}/4 turns</span>
        <button className="quest-exit-btn" onClick={exitQuest}>✕</button>
      </div>
      {questDone && <div className="quest-complete-banner">🎉 Quest complete! +{activeQuest.xp} XP earned!</div>}
      <div className="quest-messages">
        {messages.map((m,i) => (
          <div key={i} className={`quest-bubble ${m.role}`}>
            {m.role === "npc" && <span className="quest-npc-name">{activeQuest.icon} NPC</span>}
            <p>{m.text}</p>
          </div>
        ))}
        {loading && <div className="quest-bubble npc"><span className="quest-npc-name">{activeQuest.icon} NPC</span><p className="typing">● ● ●</p></div>}
        <div ref={endRef} />
      </div>
      <div className="quest-controls">
        {micError && <p className="quest-status" style={{ color: "#f87171" }}>{micError}</p>}
        {statusLabel && <p className="quest-status">{statusLabel}</p>}
        <div className={"call-mic-btn " + (npcStatus === "listening" ? "active" : "")} style={{ cursor: "default" }}>
          {micIcon}
        </div>
        <div className="chat-input-row">
          <input className="chat-input" value={textInput} onChange={e=>setTextInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendText()} placeholder="Or type your response..." disabled={loading||questDone} />
          <button className="chat-send" onClick={sendText} disabled={loading||questDone}>➤</button>
        </div>
      </div>
    </div>
  );
}
