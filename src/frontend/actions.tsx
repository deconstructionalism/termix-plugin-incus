import { useEffect, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button, useConfirm } from "@termix-ssh/plugin-sdk/ui";

export type ActionName =
  | "start"
  | "stop"
  | "restart"
  | "freeze"
  | "unfreeze"
  | "snapshot-create"
  | "snapshot-restore"
  | "snapshot-delete";

type Answer = { ok: true; summary: string } | { ok: false; error: string };

export function useInstanceAction(
  app: TermixApp,
  base: string,
  onDone: () => void,
) {
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 6_000);
    return () => clearTimeout(timer);
  }, [done]);
  const run = async (
    action: ActionName,
    input: Record<string, unknown> = {},
  ) => {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const { data } = await Promise.race([
        app.api.post<Answer>(`${base}/actions/${action}`, { input }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 180_000),
        ),
      ]);
      if ("error" in data) setError(data.error);
      else setDone(data.summary);
      onDone();
    } catch (err) {
      setError(
        err instanceof Error && err.message === "timeout"
          ? "No answer after 3 minutes. It may still finish; check the instance before trying again."
          : "request failed",
      );
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, done, run };
}

// which buttons fit a state, and which the protected list takes away
export function availableActions(
  status: string,
  isProtected: boolean,
): ActionName[] {
  const s = status.toLowerCase();
  const all: ActionName[] =
    s === "running"
      ? ["stop", "restart", "freeze"]
      : s === "frozen"
        ? ["unfreeze", "stop"]
        : s === "stopped"
          ? ["start"]
          : [];
  return isProtected
    ? all.filter((a) => a === "start" || a === "unfreeze")
    : all;
}

export function ActionBar({
  status,
  isProtected,
  busy,
  run,
}: {
  status: string;
  isProtected: boolean;
  busy: ActionName | null;
  run: (action: ActionName) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const ask = async (action: ActionName) => {
    if (action === "start" || action === "unfreeze") return run(action);
    const ok = await confirm({
      title: t(`actions.${action}.confirm`),
      description: t(`actions.${action}.description`),
      confirmLabel: t(`actions.${action}.label`),
      destructive: action === "stop",
    });
    if (ok) run(action);
  };
  const actions = availableActions(status, isProtected);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isProtected ? (
        <span className="text-xs text-muted-foreground">
          {t("actions.protected")}
        </span>
      ) : null}
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "stop" ? "destructive" : "outline"}
          disabled={busy !== null}
          onClick={() => void ask(action)}
        >
          {busy === action
            ? t("actions.working")
            : t(`actions.${action}.label`)}
        </Button>
      ))}
    </div>
  );
}
