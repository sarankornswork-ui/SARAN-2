import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Suppress unhandled cross-origin script error noise from external scripts (e.g. Spotify SDK / CDN)
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (
      event.message === "Script error." ||
      (event.filename && (event.filename.includes("scdn.co") || event.filename.includes("spotify")))
    ) {
      event.preventDefault();
      return true;
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
