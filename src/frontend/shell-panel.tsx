import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { NoticePanel } from "@termix-ssh/plugin-sdk/ui";

type State =
  | { kind: "connecting" }
  | { kind: "open"; shell: string }
  | { kind: "closed" }
  | { kind: "error"; message: string };

export function ShellPanel({
  app,
  hostId,
  project,
  name,
}: {
  app: TermixApp;
  hostId: string;
  project: string;
  name: string;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>({ kind: "connecting" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!box.current) return;
    let ws: WebSocket | null = null;
    let gone = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current);
    fit.fit();
    setState({ kind: "connecting" });

    const send = (message: unknown) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const input = term.onData((data) => send({ type: "input", data }));
    const observer = new ResizeObserver(() => {
      fit.fit();
      send({ type: "resize", data: { cols: term.cols, rows: term.rows } });
    });
    observer.observe(box.current);

    void app.wsUrl("/console").then((target) => {
      if (gone || !target) {
        if (!target) setState({ kind: "error", message: t("shell.noSocket") });
        return;
      }
      ws = new WebSocket(target.url, target.protocols);
      ws.onopen = () =>
        send({
          type: "connect",
          data: { hostId, project, name, cols: term.cols, rows: term.rows },
        });
      ws.onmessage = (event) => {
        let message: {
          type?: string;
          data?: string;
          shell?: string;
          message?: string;
        };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "output" && message.data) term.write(message.data);
        else if (message.type === "connected") {
          setState({ kind: "open", shell: message.shell ?? "" });
          term.focus();
        } else if (message.type === "closed") setState({ kind: "closed" });
        else if (message.type === "error")
          setState({ kind: "error", message: message.message ?? "" });
      };
      ws.onclose = () =>
        setState((s) => (s.kind === "error" ? s : { kind: "closed" }));
    });

    return () => {
      gone = true;
      send({ type: "disconnect" });
      ws?.close();
      observer.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [hostId, project, name, round]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.kind === "error" ? (
        <NoticePanel tone="destructive" title={t("shell.error")}>
          {state.message}
        </NoticePanel>
      ) : null}
      {state.kind === "closed" ? (
        <NoticePanel
          title={t("shell.closed")}
          action={
            <button
              type="button"
              className="border border-border px-3 py-1 text-sm"
              onClick={() => setRound((n) => n + 1)}
            >
              {t("shell.reconnect")}
            </button>
          }
        />
      ) : null}
      <div
        ref={box}
        className="min-h-0 flex-1 bg-black p-2"
        style={{ minHeight: 320 }}
      />
    </div>
  );
}
