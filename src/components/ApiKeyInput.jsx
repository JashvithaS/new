import { useState } from "react";

export default function ApiKeyInput({ onKeySubmit }) {
  const [key, setKey]       = useState("");
  const [show, setShow]     = useState(false);
  const [error, setError]   = useState("");

  function handleSubmit() {
    if (!key.trim()) {
      setError("Please enter your OpenAI API key.");
      return;
    }
    if (!key.startsWith("sk-")) {
      setError("Key should start with sk-  — check and try again.");
      return;
    }
    setError("");
    onKeySubmit(key.trim());
  }

  return (
    <div className="apikey-screen">
      <div className="apikey-icon">🔑</div>
      <h2 className="apikey-title">Enter your OpenAI API Key</h2>
      <p className="apikey-sub">
        Your key is stored only in memory — never saved to any server.
      </p>

      <div className="apikey-input-row">
        <input
          className="apikey-input"
          type={show ? "text" : "password"}
          placeholder="sk-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <button
          className="apikey-toggle"
          onClick={() => setShow(!show)}
          title={show ? "Hide" : "Show"}
        >
          {show ? "🙈" : "👁"}
        </button>
      </div>

      {error && <p className="apikey-error">{error}</p>}

      <button className="apikey-btn" onClick={handleSubmit}>
        Unlock Aria →
      </button>

      <p className="apikey-hint">
        Get a key at{" "}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          platform.openai.com
        </a>
      </p>
    </div>
  );
}
