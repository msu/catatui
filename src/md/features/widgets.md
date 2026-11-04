# Feature: Inline Widgets

The `show_widget` tool shows a small widget inline in the chat of the desktop app, and returns the student's answer to the model. The tool is in `src/catatui/widget.ts`. The app draws the widgets in `desktop/src/widgets.jsx`.

## Decisions

- Built-in types: choice, multi, text, slider, form, and quiz (interactive), and chart and table (display only). The app draws them with its own components, so the model writes no HTML or JavaScript. They look like the app, and small models fill them in well.
- Type `html`: the model writes a small page. The app serves it at `catai-widget://frame/<id>` with a strict Content-Security-Policy (inline scripts and styles only, no network) and shows it in an iframe with `sandbox="allow-scripts"`. The page cannot reach the app or the network. It sends its answer with `catai.submit(data)` (postMessage). The tool description tells the model to use html only when no built-in type fits.
- Transport: an interactive widget is an input dialog with the title `[widget] <JSON>`. The app draws it inline (not as a dialog), and sends the answer (JSON) as the input value. A display-only widget is a notice `[widget] <JSON>`. The app ignores it, because it draws the widget from the tool call.
- The app draws each `show_widget` tool call as the widget. It is live while its request waits. After that it shows the answer from the tool result ("The student answered: <JSON>"), read-only.
- The widgets persist: the session has the tool call (the widget) and the result (the answer). An old chat shows them again.
- A quiz shows right and wrong answers, the explanations, and the score after "Check my answers". The answer to the model has the picks and the score.
- Charts use Chart.js. The height comes from the width, so a chart is never cut off. The y axis starts at 0.
- In the terminal, choice and text use the normal select and input dialogs. The other types tell the model to ask in text or to use `show_page`.

## Subtleties

- Models sometimes put HTML tags in the title. The app shows the title as text only.
- A `show_widget` call with no type (a failed call) shows as a normal tool card.
- The frame height comes from the lowest element in the page, not from the frame. A page with `height: 100%` would grow without end.
- `CATATUI_DESKTOP_FRAME_JS` runs JavaScript in the first widget frame (for tests). `CATATUI_DESKTOP_AFTER` is the wait after it (milliseconds).

## Games and other pages with no answer

- An html widget with `wait: false` returns at once. The page stays in the chat, and the student can use it. Use it for a game, a simulation, or an animation.
- A live html widget has a "Done" button. If the page never calls `catai.submit`, the student clicks Done, and the agent continues.
- In the app (RPC mode), the system prompt tells the model that the chat can show widgets and HTML pages. Without it, the model said that the chat shows only text.
