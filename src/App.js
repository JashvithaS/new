import { useState } from "react";
import AriaWidget from "./components/AriaWidget";

export default function App() {
  const [topic, setTopic] = useState("Lesson 1 - Greetings");

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <AriaWidget topic={topic} onTopicChange={setTopic} />
    </div>
  );
}
