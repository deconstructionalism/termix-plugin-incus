import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  DataTable,
  DataTableRow,
  EmptyState,
  InlineView,
  LoadingState,
  NoticePanel,
  PanelSearch,
  RefreshButton,
  Segmented,
  TabStrip,
} from "@termix-ssh/plugin-sdk/ui";
import { Activity, Lock } from "lucide-react";
import { bytes, duration } from "./format";
import { ShellPanel } from "./shell-panel";

export interface Process {
  pid: number;
  uid: number;
  innerUid: number | null;
  cpuPercent: number | null;
  rss: number;
  elapsedSeconds: number;
  threads: number;
  command: string;
}

type Failure = { ok: false; reason: string; error: string; path?: string };
export type ProcessAnswer =
  { ok: true; processes: Process[]; truncated: boolean } | Failure;
export type LogAnswer =
  | {
      ok: true;
      source: "journal" | "console";
      text: string;
      truncated: boolean;
    }
  | Failure;

interface Entry {
  key: string;
  value: string | null;
}
export interface Details {
  description: string;
  architecture: string | null;
  profiles: string[];
  config: Entry[];
  devices: { name: string; type: string; options: Entry[] }[];
  snapshots: {
    name: string;
    createdAt: string | null;
    expiresAt: string | null;
    stateful: boolean;
  }[];
  createdAt: string | null;
  lastUsedAt: string | null;
}
export type DetailsAnswer = { ok: true; details: Details } | Failure;

type Tab = "processes" | "logs" | "details" | "shell";
type Sort = "cpu" | "memory";

export function sortProcesses(list: Process[], sort: Sort): Process[] {
  return [...list].sort((a, b) =>
    sort === "memory"
      ? b.rss - a.rss
      : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || b.rss - a.rss,
  );
}

function useInstanceApi<T>(
  app: TermixApp,
  path: string,
  refreshMs: number | null,
) {
  const [answer, setAnswer] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await app.api.get<T>(path);
      setAnswer(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setAnswer(null);
    void load();
    if (!refreshMs) return;
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);
  return { answer, failed, loading, load };
}

function Problem({
  failed,
  answer,
  prefix,
}: {
  failed: boolean;
  answer: Failure | null;
  prefix: string;
}) {
  const { t } = useTranslation();
  if (failed) return <NoticePanel tone="destructive" title={t("tab.error")} />;
  if (!answer) return null;
  return (
    <NoticePanel
      tone={answer.reason === "failed" ? "destructive" : "default"}
      title={t(`${prefix}.${answer.reason}`)}
    >
      {answer.reason === "failed" ? answer.error : null}
      {answer.reason === "unreadable" ? (
        <>
          <p>{t(`${prefix}.unreadableWhy`)}</p>
          {answer.path ? (
            <p className="font-mono text-xs">{answer.path}</p>
          ) : null}
        </>
      ) : null}
    </NoticePanel>
  );
}

export function InstanceView({
  app,
  hostId,
  project,
  name,
  canShell,
  onClose,
}: {
  app: TermixApp;
  hostId: string;
  project: string;
  name: string;
  canShell: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("processes");
  const base = `/hosts/${encodeURIComponent(hostId)}/instances/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
  return (
    <InlineView
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={name}
      toolbar={
        <TabStrip
          variant="secondary"
          activeTab={tab}
          onTabChange={(id) => setTab(id as Tab)}
          tabs={[
            { id: "processes", label: t("instance.processes") },
            { id: "logs", label: t("instance.logs") },
            { id: "details", label: t("instance.details") },
            ...(canShell ? [{ id: "shell", label: t("instance.shell") }] : []),
          ]}
        />
      }
    >
      {tab === "processes" ? (
        <Processes app={app} path={`${base}/processes`} />
      ) : null}
      {tab === "logs" ? <Logs app={app} path={`${base}/logs`} /> : null}
      {tab === "shell" && canShell ? (
        <ShellPanel app={app} hostId={hostId} project={project} name={name} />
      ) : null}
      {tab === "details" ? (
        <DetailsPanel app={app} path={`${base}/details`} />
      ) : null}
    </InlineView>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 px-3 py-2">{children}</div>;
}

function Processes({ app, path }: { app: TermixApp; path: string }) {
  const { t } = useTranslation();
  const { answer, failed, loading, load } = useInstanceApi<ProcessAnswer>(
    app,
    path,
    5_000,
  );
  const [sort, setSort] = useState<Sort>("cpu");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    if (!answer || !("processes" in answer)) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? answer.processes.filter(
          (p) => p.command.toLowerCase().includes(q) || String(p.pid) === q,
        )
      : answer.processes;
    return sortProcesses(list, sort);
  }, [answer, sort, query]);

  const bar = (
    <Bar>
      <PanelSearch
        value={query}
        onChange={setQuery}
        placeholder={t("processes.search")}
        fill
      />
      <Segmented
        value={sort}
        onChange={(next) => setSort(next as Sort)}
        options={[
          { value: "cpu", label: t("processes.byCpu") },
          { value: "memory", label: t("processes.byMemory") },
        ]}
      />
      <RefreshButton
        onClick={() => void load()}
        loading={loading}
        label={t("list.refresh")}
      />
    </Bar>
  );
  if (failed || (answer && "error" in answer)) {
    return (
      <Problem
        failed={failed}
        answer={answer && "error" in answer ? answer : null}
        prefix="processes"
      />
    );
  }
  if (!answer) return <LoadingState label={t("processes.loading")} />;
  return (
    <>
      {bar}
      <p className="px-3 pb-1 text-xs text-muted-foreground">
        {t("processes.total", {
          processes: (answer as Extract<ProcessAnswer, { ok: true }>).processes
            .length,
          threads: (
            answer as Extract<ProcessAnswer, { ok: true }>
          ).processes.reduce((sum, p) => sum + p.threads, 0),
        })}
      </p>
      {(answer as Extract<ProcessAnswer, { ok: true }>).truncated ? (
        <NoticePanel tone="warning" title={t("processes.truncated")} />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Activity} title={t("processes.empty")} />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{t("processes.pid")}</th>
              <th>{t("processes.user")}</th>
              <th>{t("processes.cpu")}</th>
              <th>{t("processes.memory")}</th>
              <th>{t("processes.threads")}</th>
              <th>{t("processes.time")}</th>
              <th>{t("processes.command")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <DataTableRow key={p.pid}>
                <td className="font-mono text-xs">{p.pid}</td>
                <td className="font-mono text-xs">
                  {p.innerUid === 0
                    ? "root"
                    : (p.innerUid ?? t("processes.hostUid", { uid: p.uid }))}
                </td>
                <td>{p.cpuPercent !== null ? `${p.cpuPercent}%` : "-"}</td>
                <td>{bytes(p.rss)}</td>
                <td>{p.threads}</td>
                <td>{duration(p.elapsedSeconds)}</td>
                <td className="font-mono text-xs break-all">{p.command}</td>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

function Logs({ app, path }: { app: TermixApp; path: string }) {
  const { t } = useTranslation();
  const { answer, failed, loading, load } = useInstanceApi<LogAnswer>(
    app,
    path,
    null,
  );
  const [query, setQuery] = useState("");
  const lines = useMemo(() => {
    if (!answer || !("text" in answer)) return [];
    const all = answer.text.replace(/\n$/, "").split("\n");
    const q = query.trim().toLowerCase();
    return q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
  }, [answer, query]);
  if (failed || (answer && "error" in answer)) {
    return (
      <Problem
        failed={failed}
        answer={answer && "error" in answer ? answer : null}
        prefix="logs"
      />
    );
  }
  if (!answer) return <LoadingState label={t("logs.loading")} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Bar>
        <PanelSearch
          value={query}
          onChange={setQuery}
          placeholder={t("logs.search")}
          fill
        />
        <span className="text-xs text-muted-foreground">
          {t(
            `logs.source.${(answer as Extract<LogAnswer, { ok: true }>).source}`,
          )}
        </span>
        <RefreshButton
          onClick={() => void load()}
          loading={loading}
          label={t("list.refresh")}
        />
      </Bar>
      {lines.length === 0 || (lines.length === 1 && lines[0] === "") ? (
        <EmptyState icon={Activity} title={t("logs.empty")} />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs">
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

function Value({ entry }: { entry: Entry }) {
  const { t } = useTranslation();
  if (entry.value === null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        title={t("details.hiddenHint")}
      >
        <Lock className="h-3 w-3" />
        {t("details.hidden")}
      </span>
    );
  }
  return <span className="font-mono text-xs break-all">{entry.value}</span>;
}

function DetailsPanel({ app, path }: { app: TermixApp; path: string }) {
  const { t } = useTranslation();
  const { answer, failed } = useInstanceApi<DetailsAnswer>(app, path, null);
  if (failed || (answer && "error" in answer)) {
    return (
      <Problem
        failed={failed}
        answer={answer && "error" in answer ? answer : null}
        prefix="details"
      />
    );
  }
  if (!answer) return <LoadingState label={t("details.loading")} />;
  const d = (answer as Extract<DetailsAnswer, { ok: true }>).details;
  const section = (title: string) => (
    <h3 className="px-3 pt-4 pb-1 text-xs font-semibold uppercase text-muted-foreground">
      {title}
    </h3>
  );
  return (
    <div className="pb-4">
      {section(t("details.overview"))}
      <DataTable>
        <tbody>
          {d.description ? (
            <DataTableRow>
              <td>{t("details.description")}</td>
              <td>{d.description}</td>
            </DataTableRow>
          ) : null}
          <DataTableRow>
            <td>{t("details.profiles")}</td>
            <td>{d.profiles.join(", ") || "-"}</td>
          </DataTableRow>
          <DataTableRow>
            <td>{t("details.created")}</td>
            <td>{d.createdAt ?? "-"}</td>
          </DataTableRow>
          <DataTableRow>
            <td>{t("details.lastUsed")}</td>
            <td>{d.lastUsedAt ?? "-"}</td>
          </DataTableRow>
        </tbody>
      </DataTable>
      {section(t("details.config"))}
      <DataTable>
        <tbody>
          {d.config.map((e) => (
            <DataTableRow key={e.key}>
              <td className="font-mono text-xs">{e.key}</td>
              <td>
                <Value entry={e} />
              </td>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
      {section(t("details.devices"))}
      <DataTable>
        <tbody>
          {d.devices.map((dev) => (
            <DataTableRow key={dev.name}>
              <td className="font-mono text-xs">
                {dev.name}
                <div className="text-muted-foreground">{dev.type}</div>
              </td>
              <td>
                {dev.options.map((o) => (
                  <div key={o.key}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {o.key}:{" "}
                    </span>
                    <Value entry={o} />
                  </div>
                ))}
              </td>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
      {section(t("details.snapshots"))}
      {d.snapshots.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground">
          {t("details.noSnapshots")}
        </p>
      ) : (
        <DataTable>
          <tbody>
            {d.snapshots.map((s) => (
              <DataTableRow key={s.name}>
                <td className="font-mono text-xs">{s.name}</td>
                <td>{s.createdAt ?? "-"}</td>
                <td>
                  {s.expiresAt ? t("details.expires", { at: s.expiresAt }) : ""}
                </td>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
