// Inline widgets from the show_widget tool (src/catatui/widget.ts).
// - While the tool waits, the widget is live: the answer goes back as the value of the input dialog (JSON).
// - After that, and in an old chat, the widget shows the answer from the tool result, read-only.
// Built-in types use the app's own components. "html" is the model's page in a sandboxed frame (see main.js).

import { ArcElement, BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, LineController, LineElement, PieController, PointElement, Tooltip } from "chart.js";
import { useEffect, useRef, useState } from "react";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, PieController, ArcElement, CategoryScale, LinearScale, Legend, Tooltip);

const api = window.catatui;
// MSU colors first, then other colors that are easy to tell apart.
const COLORS = ["#002f87", "#d4a017", "#1a7f37", "#c62828", "#6f42c1", "#0b7a8f", "#e36209", "#5a5a5a"];

// spec: the show_widget arguments. answer: the saved answer, or undefined. onSubmit: only while it is live.
export function Widget({ spec, answer, onSubmit }) {
  const live = !!onSubmit && answer === undefined;
  const body = (() => {
    switch (spec.type) {
      case "choice": return <Choice spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "multi": return <Multi spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "text": return <TextAnswer spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "slider": return <Slider spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "form": return <Form spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "quiz": return <Quiz spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      case "chart": return <ChartView spec={spec} />;
      case "table": return <Table spec={spec} />;
      case "html": return <HtmlFrame spec={spec} answer={answer} live={live} onSubmit={onSubmit} />;
      default: return <p className="muted">catai cannot show a widget of type "{spec.type}".</p>;
    }
  })();
  return (
    <div className={`widget widget-${spec.type} ${live ? "live" : ""}`}>
      {/* Models sometimes put HTML tags in the title. Show the text only. */}
      <div className="widget-title">{String(spec.title ?? "").replace(/<[^>]*>/g, "").trim()}</div>
      <div className="widget-body">{body}</div>
      {!live && answer === undefined && !["chart", "table"].includes(spec.type) && <div className="widget-note">No answer.</div>}
    </div>
  );
}

function Choice({ spec, answer, live, onSubmit }) {
  const picked = answer?.choice;
  return (
    <div className="widget-options">
      {(spec.options ?? []).map((o) => (
        <button key={o} className={`btn ${picked === o ? "primary" : ""}`} disabled={!live} onClick={() => onSubmit({ choice: o })}>{o}</button>
      ))}
    </div>
  );
}

function Multi({ spec, answer, live, onSubmit }) {
  const [sel, setSel] = useState(answer?.choices ?? []);
  const toggle = (o) => setSel((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
  return (
    <>
      {(spec.options ?? []).map((o) => (
        <label key={o} className="widget-check"><input type="checkbox" disabled={!live} checked={sel.includes(o)} onChange={() => toggle(o)} /> {o}</label>
      ))}
      {live && <div className="widget-actions"><button className="btn primary" onClick={() => onSubmit({ choices: sel })}>Submit</button></div>}
    </>
  );
}

function TextAnswer({ spec, answer, live, onSubmit }) {
  const [t, setT] = useState(answer?.text ?? "");
  const Field = spec.multiline ? "textarea" : "input";
  return (
    <>
      <Field className="input-field" rows={spec.multiline ? 4 : undefined} value={t} disabled={!live} placeholder={spec.placeholder}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (live && e.key === "Enter" && !e.shiftKey && !spec.multiline) onSubmit({ text: t }); }} />
      {live && <div className="widget-actions"><button className="btn primary" onClick={() => onSubmit({ text: t })} disabled={!t.trim()}>Submit</button></div>}
    </>
  );
}

function Slider({ spec, answer, live, onSubmit }) {
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const [v, setV] = useState(answer?.value ?? spec.value ?? min);
  return (
    <>
      <div className="widget-slider">
        <span className="muted">{min}</span>
        <input type="range" min={min} max={max} step={spec.step ?? 1} value={v} disabled={!live} onChange={(e) => setV(Number(e.target.value))} />
        <span className="muted">{max}</span>
        <strong>{v}{spec.unit ? ` ${spec.unit}` : ""}</strong>
      </div>
      {live && <div className="widget-actions"><button className="btn primary" onClick={() => onSubmit({ value: v })}>Submit</button></div>}
    </>
  );
}

function Form({ spec, answer, live, onSubmit }) {
  const [vals, setVals] = useState(answer ?? {});
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));
  return (
    <>
      <div className="widget-form">
        {(spec.fields ?? []).map((f) => (
          <label key={f.name} className="widget-field">
            <span>{f.label}</span>
            {f.kind === "choice" ? (
              <select disabled={!live} value={vals[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                <option value="" disabled>Select...</option>
                {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.kind === "checkbox" ? (
              <input type="checkbox" disabled={!live} checked={!!vals[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            ) : (
              <input className="input-field" type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} disabled={!live}
                value={vals[f.name] ?? ""} onChange={(e) => set(f.name, f.kind === "number" ? Number(e.target.value) : e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {live && <div className="widget-actions"><button className="btn primary" onClick={() => onSubmit(vals)}>Submit</button></div>}
    </>
  );
}

// A quiz: the student picks an answer for each question. After Submit, each question shows right or wrong,
// and the explanation. The answer to the model has the choices and the score.
function Quiz({ spec, answer, live, onSubmit }) {
  const qs = spec.questions ?? [];
  const [picks, setPicks] = useState(answer?.picks ?? qs.map(() => undefined));
  const done = answer !== undefined;
  const score = picks.filter((p, i) => p === qs[i]?.answer).length;
  return (
    <>
      {qs.map((q, i) => (
        <div key={i} className="quiz-q">
          <div className="quiz-question">{i + 1}. {q.question}</div>
          {q.options.map((o, j) => {
            const mark = done ? (j === q.answer ? "right" : picks[i] === j ? "wrong" : "") : "";
            return (
              <label key={j} className={`widget-check quiz-opt ${mark}`}>
                <input type="radio" name={`q${i}-${spec.title}`} disabled={!live} checked={picks[i] === j}
                  onChange={() => setPicks((p) => p.map((x, k) => (k === i ? j : x)))} /> {o}
                {mark === "right" && <span className="quiz-mark">✓</span>}
                {mark === "wrong" && <span className="quiz-mark">✗</span>}
              </label>
            );
          })}
          {done && q.explain && <div className="quiz-explain">{q.explain}</div>}
        </div>
      ))}
      {done && <div className="quiz-score">Score: {score} of {qs.length}</div>}
      {live && (
        <div className="widget-actions">
          <button className="btn primary" disabled={picks.some((p) => p === undefined)}
            onClick={() => onSubmit({ picks, score, of: qs.length, answers: qs.map((q, i) => ({ question: q.question, picked: q.options[picks[i]], correct: picks[i] === q.answer })) })}>
            Check my answers
          </button>
        </div>
      )}
    </>
  );
}

function ChartView({ spec }) {
  const canvas = useRef(null);
  useEffect(() => {
    const pie = spec.chart_type === "pie";
    const chart = new Chart(canvas.current, {
      type: spec.chart_type ?? "bar",
      data: {
        labels: spec.labels ?? [],
        datasets: (spec.series ?? []).map((s, i) => ({
          label: s.name, data: s.values,
          backgroundColor: pie ? (spec.labels ?? []).map((_l, j) => COLORS[j % COLORS.length]) : COLORS[i % COLORS.length],
          borderColor: pie ? "#fff" : COLORS[i % COLORS.length],
          tension: 0.25,
        })),
      },
      options: {
        // The height comes from the width (2:1), so the chart never gets cut off.
        responsive: true, maintainAspectRatio: true, aspectRatio: pie ? 1.6 : 2, animation: false,
        layout: { padding: 4 },
        scales: pie ? undefined : { y: { beginAtZero: true } },
        plugins: { legend: { display: pie || (spec.series ?? []).length > 1 } },
      },
    });
    return () => chart.destroy();
  }, [JSON.stringify(spec)]);
  return <div className="widget-chart"><canvas ref={canvas} /></div>;
}

function Table({ spec }) {
  return (
    <div className="widget-table">
      <table>
        <thead><tr>{(spec.columns ?? []).map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{(spec.rows ?? []).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// The model's own page, in a sandboxed frame (no network, no app access). It answers with catai.submit(data).
function HtmlFrame({ spec, answer, live, onSubmit }) {
  const [url, setUrl] = useState(undefined);
  const [height, setHeight] = useState(240);
  const frame = useRef(null);
  useEffect(() => { api.widgetFrame(spec.html ?? "").then(setUrl); }, [spec.html]);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.cataiWidget) return;
      if (e.data.height) setHeight(Math.min(600, Math.max(80, e.data.height + 4)));
      if ("data" in e.data && live) onSubmit(e.data.data ?? null);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [live, onSubmit]);
  return (
    <>
      {url && <iframe ref={frame} className="widget-frame" src={url} sandbox="allow-scripts" title={spec.title} style={{ height }} />}
      {answer !== undefined && <div className="widget-note">Answer: {JSON.stringify(answer)}</div>}
    </>
  );
}
