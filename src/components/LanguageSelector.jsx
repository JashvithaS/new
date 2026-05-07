const LANGUAGES = [
  { code: "es", name: "Spanish",    flag: "🇪🇸", voice: "nova"    },
  { code: "fr", name: "French",     flag: "🇫🇷", voice: "shimmer" },
  { code: "de", name: "German",     flag: "🇩🇪", voice: "onyx"    },
  { code: "ja", name: "Japanese",   flag: "🇯🇵", voice: "alloy"   },
  { code: "pt", name: "Portuguese", flag: "🇵🇹", voice: "echo"    },
];

export { LANGUAGES };

export default function LanguageSelector({ onSelect }) {
  return (
    <div className="lang-screen">
      <div className="lang-icon">🌍</div>
      <h2 className="lang-title">Choose your language</h2>
      <p className="lang-sub">You can only pick one per session</p>
      <div className="lang-grid">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            className="lang-card"
            onClick={() => onSelect(lang)}
          >
            <span className="lang-flag">{lang.flag}</span>
            <span className="lang-name">{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
