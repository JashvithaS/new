export default function TabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: "audio",  label: "🎙 Audio Call"     },
    { id: "quests", label: "🎯 Roleplay Quests" },
  ];
  return (
    <div className="aria-tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`aria-tab ${activeTab === tab.id ? "aria-tab--active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
