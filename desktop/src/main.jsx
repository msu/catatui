import { Component } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
// Atkinson Hyperlegible (SIL Open Font License) for the agent text. It is in the app, so it works with no network.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700-italic.css";
import "./styles.css";

// An error in a component removes the whole page (a blank window). Show the error and a Reload button instead.
class ErrorScreen extends Component {
  state = { error: undefined };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("catai render error:", error?.stack ?? error, info?.componentStack ?? ""); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <h2>catai stopped because of an error</h2>
        <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(<ErrorScreen><App /></ErrorScreen>);
