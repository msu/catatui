import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
// Atkinson Hyperlegible (SIL Open Font License) for the agent text. It is in the app, so it works with no network.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700-italic.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
