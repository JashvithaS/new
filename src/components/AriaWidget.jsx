import { useState } from "react";
import TabBar             from "./TabBar";
import AudioCallTab       from "./AudioCallTab";
import RoleplayTab        from "./RoleplayTab";
import ApiKeyInput        from "./ApiKeyInput";
import LanguageSelector   from "./LanguageSelector";
import ContextualChatBar  from "./ContextualChatBar";
import "./AriaWidget.css";

export default function AriaWidget({ topic = "General", onTopicChange }) {
  const [activeTab,       setActiveTab]       = useState("audio");
  const [apiKey,          setApiKey]          = useState("");
  const [language,        setLanguage]        = useState(null);
  const [xp,              setXp]              = useState(0);
  const [completedQuests, setCompletedQuests] = useState([]);
  const [activeQuest,     setActiveQuest]     = useState(null);

  function handleXpEarned(amount) { setXp(prev => prev + amount); }

  // Scope changes based on active tab + active quest
  const chatScope = activeTab === "quests" && activeQuest
    ? `${activeQuest.title} quest — ${activeQuest.scenario}`
    : activeTab === "audio"
    ? `Audio call lesson — ${topic}`
    : `Roleplay quests — ${topic}`;

  const chatScopeLabel = activeTab === "quests" && activeQuest
    ? activeQuest.title
    : activeTab === "audio"
    ? "Audio Call"
    : "Roleplay Quests";

  if (!apiKey) {
    return (
      <div className="aria-widget">
        <div className="aria-header">
          <span className="aria-logo">🌐 Aria</span>
          <span className="aria-topic-pill">{topic}</span>
        </div>
        <ApiKeyInput onKeySubmit={(key) => setApiKey(key)} />
      </div>
    );
  }

  if (!language) {
    return (
      <div className="aria-widget">
        <div className="aria-header">
          <span className="aria-logo">🌐 Aria</span>
          <span className="aria-topic-pill">{topic}</span>
        </div>
        <LanguageSelector onSelect={(lang) => setLanguage(lang)} />
      </div>
    );
  }

  return (
    <div className="aria-widget">
      <div className="aria-header">
        <span className="aria-logo">🌐 Aria</span>
        <span className="aria-topic-pill">{topic}</span>
        <div className="aria-header-right">
          <span className="aria-xp-badge">⚡ {xp} XP</span>
          <span className="aria-lang-badge">{language.flag} {language.name}</span>
          <button className="aria-key-reset" title="Reset" onClick={() => { setApiKey(""); setLanguage(null); setXp(0); setCompletedQuests([]); }}>🔄</button>
        </div>
      </div>

      <div className="aria-xp-bar-wrap">
        <div className="aria-xp-bar" style={{ width: `${Math.min((xp / 500) * 100, 100)}%` }} />
      </div>

      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="aria-tab-content">
  <div style={{ display: activeTab === "audio" ? "block" : "none" }}>
    <AudioCallTab topic={topic} language={language} isActive={activeTab === "audio"} />
  </div>
  <div style={{ display: activeTab === "quests" ? "block" : "none" }}>
    <RoleplayTab
            topic={topic}
            language={language}
            onXpEarned={handleXpEarned}
            completedQuests={completedQuests}
            setCompletedQuests={setCompletedQuests}
            onTopicChange={onTopicChange}
            onQuestChange={setActiveQuest}
          />
        </div>

        {/* Contextual Chat Bar — always at bottom */}
        <ContextualChatBar
          scope={chatScope}
          scopeLabel={chatScopeLabel}
        />
      </div>
    </div>
  );
}
