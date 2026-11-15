import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  LoadingState,
  NoticePanel,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import { lineDiff } from "./format";

type ConfigAnswer =
  | { ok: true; yaml: string; version: string; protected: boolean }
  | { ok: false; error: string; conflict?: boolean };
type Result =
  | { ok: true; summary: string }
  | { ok: false; error: string; conflict?: boolean };

const input =
  "h-8 min-w-0 flex-1 border border-border bg-transparent px-2 font-mono text-xs";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-border px-3 py-3">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ManagePanel({
  app,
  base,
  name,
  status,
  isProtected,
  onChanged,
  onGone,
}: {
  app: TermixApp;
  base: string;
  name: string;
  status: string;
  isProtected: boolean;
  onChanged: () => void;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [config, setConfig] = useState<ConfigAnswer | null>(null);
  const [draft, setDraft] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [copyName, setCopyName] = useState("");
  const [copySnapshots, setCopySnapshots] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const stopped = status === "Stopped";

  const load = useCallback(async () => {
    setConfig(null);
    setReviewing(false);
    try {
      const { data } = await app.api.get<ConfigAnswer>(`${base}/config`);
      setConfig(data);
      if ("yaml" in data) setDraft(data.yaml);
    } catch {
      setConfig({ ok: false, error: t("tab.error") });
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const diff = useMemo(
    () => (config && "yaml" in config ? lineDiff(config.yaml, draft) : []),
    [config, draft],
  );
  const changed = diff.some((l) => l.kind !== "same");
  // a fixed address in the instance's own devices comes along with a clone
  const fixedAddress =
    !!config &&
    "yaml" in config &&
    /^\s+ipv[46]\.address:\s*\S/m.test(config.yaml);

  const call = async (
    request: () => Promise<{ data: Result }>,
    after?: (r: Extract<Result, { ok: true }>) => void,
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await request();
      if ("error" in data) setMessage({ ok: false, text: data.error });
      else {
        setMessage({ ok: true, text: data.summary });
        after?.(data as Extract<Result, { ok: true }>);
      }
      onChanged();
    } catch {
      setMessage({ ok: false, text: t("actions.failed") });
    } finally {
      setBusy(false);
    }
  };

  const apply = () =>
    call(
      () =>
        app.api.put<Result>(`${base}/config`, {
          yaml: draft,
          version: config && "version" in config ? config.version : "",
        }),
      () => void load(),
    );

  const remove = async () => {
    const ok = await confirm({
      title: t("manage.delete.confirm", { name }),
      description: t("manage.delete.description"),
      confirmLabel: t("manage.delete.label"),
    });
    if (ok) {
      await call(
        () =>
          app.api.post<Result>(`${base}/manage/delete`, {
            confirm: deleteName,
          }),
        () => onGone(),
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {message ? (
        <NoticePanel
          tone={message.ok ? "default" : "destructive"}
          title={message.text}
        />
      ) : null}

      <Section title={t("manage.config.title")}>
        {!config ? (
          <LoadingState compact label={t("manage.config.loading")} />
        ) : "error" in config ? (
          <NoticePanel tone="destructive" title={config.error} />
        ) : isProtected ? (
          <>
            <p className="text-xs text-muted-foreground">
              {t("manage.protected")}
            </p>
            <pre className="overflow-auto font-mono text-xs">{config.yaml}</pre>
          </>
        ) : reviewing ? (
          <>
            <pre className="min-h-0 flex-1 overflow-auto font-mono text-xs">
              {diff.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.kind === "added"
                      ? "text-green-500"
                      : l.kind === "removed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {l.kind === "added"
                    ? "+ "
                    : l.kind === "removed"
                      ? "- "
                      : "  "}
                  {l.text}
                </div>
              ))}
            </pre>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !changed}
                onClick={() => void apply()}
              >
                {busy ? t("actions.working") : t("manage.config.apply")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReviewing(false)}
              >
                {t("manage.config.back")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("manage.config.hint")}
            </p>
            <textarea
              className="min-h-[320px] w-full border border-border bg-transparent p-2 font-mono text-xs"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!changed}
                onClick={() => setReviewing(true)}
              >
                {t("manage.config.review")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t("manage.config.reload")}
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title={t("manage.copy.title")}>
        <p className="text-xs text-muted-foreground">{t("manage.copy.hint")}</p>
        {fixedAddress ? (
          <NoticePanel tone="warning" title={t("manage.copy.fixedAddress")} />
        ) : null}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={copySnapshots}
            onChange={(e) => setCopySnapshots(e.target.checked)}
          />
          {t("manage.copy.snapshots")}
        </label>
        <div className="flex gap-2">
          <input
            className={input}
            placeholder={t("manage.copy.name")}
            value={copyName}
            onChange={(e) => setCopyName(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !copyName}
            onClick={() =>
              void call(() =>
                app.api.post<Result>(`${base}/manage/copy`, {
                  newName: copyName,
                  snapshots: copySnapshots,
                }),
              )
            }
          >
            {t("manage.copy.label")}
          </Button>
        </div>
      </Section>

      {isProtected ? null : (
        <>
          <Section title={t("manage.rename.title")}>
            {stopped ? null : (
              <p className="text-xs text-muted-foreground">
                {t("manage.stopFirst")}
              </p>
            )}
            <div className="flex gap-2">
              <input
                className={input}
                placeholder={t("manage.newName")}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !renameName || !stopped}
                onClick={() =>
                  void call(
                    () =>
                      app.api.post<Result>(`${base}/manage/rename`, {
                        newName: renameName,
                      }),
                    () => onGone(),
                  )
                }
              >
                {t("manage.rename.label")}
              </Button>
            </div>
          </Section>

          <Section title={t("manage.delete.title")}>
            <p className="text-xs text-muted-foreground">
              {stopped
                ? t("manage.delete.typeName", { name })
                : t("manage.stopFirst")}
            </p>
            <div className="flex gap-2">
              <input
                className={input}
                placeholder={name}
                value={deleteName}
                onChange={(e) => setDeleteName(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || deleteName !== name || !stopped}
                onClick={() => void remove()}
              >
                {t("manage.delete.label")}
              </Button>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
