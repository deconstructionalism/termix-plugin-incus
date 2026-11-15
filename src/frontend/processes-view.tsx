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
} from "@termix-ssh/plugin-sdk/ui";
import { Activity } from "lucide-react";
import { bytes, duration } from "./format";

export interface Process {
  pid: number;
  uid: number;
  innerUid: number | null;
  cpuPercent: number | null;
  rss: number;
  elapsedSeconds: number;
  command: string;
}

export type ProcessAnswer =
  | { ok: true; processes: Process[]; truncated: boolean }
  | { ok: false; reason: "no-agent" | "stopped" | "failed"; error: string };

type Sort = "cpu" | "memory";
const REFRESH_MS = 5_000;

export function sortProcesses(list: Process[], sort: Sort): Process[] {
  return [...list].sort((a, b) =>
    sort === "memory"
      ? b.rss - a.rss
      : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || b.rss - a.rss,
  );
}

export function ProcessesView({
  app,
  hostId,
  project,
  name,
  onClose,
}: {
  app: TermixApp;
  hostId: string;
  project: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<ProcessAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("cpu");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await app.api.get<ProcessAnswer>(
        `/hosts/${encodeURIComponent(hostId)}/instances/${encodeURIComponent(project)}/${encodeURIComponent(name)}/processes`,
      );
      setAnswer(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [hostId, project, name]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

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

  let body;
  if (failed) {
    body = <NoticePanel tone="destructive" title={t("tab.error")} />;
  } else if (!answer) {
    body = <LoadingState label={t("processes.loading")} />;
  } else if ("error" in answer) {
    body = (
      <NoticePanel
        tone={answer.reason === "failed" ? "destructive" : "default"}
        title={t(`processes.${answer.reason}`)}
      >
        {answer.reason === "failed" ? answer.error : null}
      </NoticePanel>
    );
  } else if (rows.length === 0) {
    body = <EmptyState icon={Activity} title={t("processes.empty")} />;
  } else {
    body = (
      <>
        {answer.truncated ? (
          <NoticePanel tone="warning" title={t("processes.truncated")} />
        ) : null}
        <DataTable>
          <thead>
            <tr>
              <th>{t("processes.pid")}</th>
              <th>{t("processes.user")}</th>
              <th>{t("processes.cpu")}</th>
              <th>{t("processes.memory")}</th>
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
                <td>{duration(p.elapsedSeconds)}</td>
                <td className="font-mono text-xs break-all">{p.command}</td>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </>
    );
  }

  return (
    <InlineView
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("processes.title", { name })}
      actions={
        <RefreshButton
          onClick={() => void load()}
          loading={loading}
          label={t("list.refresh")}
        />
      }
      toolbar={
        <>
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
        </>
      }
    >
      {body}
    </InlineView>
  );
}
