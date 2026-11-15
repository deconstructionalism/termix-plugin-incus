import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  DataTable,
  DataTableRow,
  EmptyState,
  LoadingState,
  Meter,
  NoticePanel,
  PanelSearch,
  PanelShell,
  RefreshButton,
  StatusBadge,
  statusTone,
} from "@termix-ssh/plugin-sdk/ui";
import { Boxes } from "lucide-react";
import { bytes, limitBytes, percentOf } from "./format";
import { InstanceView } from "./instance-view";

const TAB_ID = "incus";

export interface Instance {
  name: string;
  project: string;
  type: "container" | "virtual-machine";
  status: string;
  image: string | null;
  addresses: { family: string; address: string; interface: string }[];
  cpu: { percent: number | null; limit: string | null };
  memory: { usage: number | null; limit: string | null };
  disks: { device: string; usage: number | null; total: number | null }[];
  processes: number | null;
  agent: boolean | null;
}

export type ListAnswer =
  | {
      ok: true;
      instances: Instance[];
      pollSeconds: number;
      protected: string[];
      // what this user may do on this host, decided by the server
      shell: boolean;
      operate: boolean;
    }
  | { ok: false; error: string };

export function incusEnabled(host: object | null | undefined): boolean {
  const all = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> }
  )?.pluginSettings;
  return all?.incus?.enableIncus === true;
}

export function matches(instance: Instance, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    instance.name,
    instance.project,
    instance.status,
    instance.image ?? "",
    ...instance.addresses.map((a) => a.address),
  ].some((value) => value.toLowerCase().includes(q));
}

function createTab(app: TermixApp) {
  return function IncusTab({ host, isVisible }: TabProps) {
    const { t } = useTranslation();
    const [answer, setAnswer] = useState<ListAnswer | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<{ project: string; name: string } | null>(
      null,
    );
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hostId = host?.id;

    const load = useCallback(async () => {
      if (!hostId) return null;
      setLoading(true);
      try {
        const { data } = await app.api.get<ListAnswer>(
          `/hosts/${encodeURIComponent(hostId)}/instances`,
        );
        setAnswer(data);
        setFailed(false);
        return "pollSeconds" in data ? data.pollSeconds : null;
      } catch {
        setFailed(true);
        return null;
      } finally {
        setLoading(false);
      }
    }, [hostId]);

    useEffect(() => {
      if (!isVisible || !hostId) return;
      let live = true;
      const tick = async () => {
        const seconds = await load();
        if (live) timer.current = setTimeout(tick, (seconds ?? 30) * 1000);
      };
      void tick();
      return () => {
        live = false;
        if (timer.current) clearTimeout(timer.current);
      };
    }, [isVisible, hostId, load]);

    const instances = useMemo(
      () =>
        answer && "instances" in answer
          ? answer.instances.filter((i) => matches(i, query))
          : [],
      [answer, query],
    );
    const projects = useMemo(
      () =>
        answer?.ok ? new Set(answer.instances.map((i) => i.project)).size : 0,
      [answer],
    );

    if (!host) {
      return <NoticePanel title={t("tab.noHost")} />;
    }

    let body;
    if (failed) {
      body = <NoticePanel tone="destructive" title={t("tab.error")} />;
    } else if (!answer) {
      body = <LoadingState label={t("tab.loading")} />;
    } else if ("error" in answer) {
      body = (
        <NoticePanel tone="destructive" title={t("tab.unreachable")}>
          {answer.error}
        </NoticePanel>
      );
    } else if (instances.length === 0) {
      body = (
        <EmptyState
          icon={Boxes}
          title={query ? t("list.noMatch") : t("list.empty")}
        />
      );
    } else {
      body = (
        <DataTable>
          <thead>
            <tr>
              <th>{t("list.name")}</th>
              <th>{t("list.state")}</th>
              <th>{t("list.address")}</th>
              <th>{t("list.cpu")}</th>
              <th>{t("list.memory")}</th>
              <th>{t("list.disk")}</th>
              <th title={t("list.tasksHint")}>{t("list.tasks")}</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <InstanceRow
                key={`${i.project}/${i.name}`}
                instance={i}
                showProject={projects > 1}
                onOpen={() => setOpen({ project: i.project, name: i.name })}
              />
            ))}
          </tbody>
        </DataTable>
      );
    }

    return (
      <PanelShell
        title={host.name}
        actions={
          <RefreshButton
            onClick={() => void load()}
            loading={loading}
            label={t("list.refresh")}
          />
        }
        toolbar={
          <PanelSearch
            value={query}
            onChange={setQuery}
            placeholder={t("list.search")}
            fill
          />
        }
      >
        {body}
        {open && hostId ? (
          <InstanceView
            app={app}
            hostId={hostId}
            project={open.project}
            name={open.name}
            status={
              (answer && "instances" in answer
                ? answer.instances.find(
                    (i) => i.project === open.project && i.name === open.name,
                  )?.status
                : undefined) ?? ""
            }
            canOperate={!!answer && "operate" in answer && answer.operate}
            isProtected={
              !!answer &&
              "protected" in answer &&
              answer.protected.includes(open.name)
            }
            onChanged={() => void load()}
            canShell={
              !!answer &&
              "shell" in answer &&
              answer.shell &&
              !answer.protected.includes(open.name)
            }
            onClose={() => setOpen(null)}
          />
        ) : null}
      </PanelShell>
    );
  };
}

function InstanceRow({
  instance: i,
  showProject,
  onOpen,
}: {
  instance: Instance;
  showProject: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const noAgent = i.agent === false;
  const address =
    i.addresses.find((a) => a.family === "inet") ?? i.addresses[0] ?? null;
  const memoryLimit = limitBytes(i.memory.limit);
  const root = i.disks.find((d) => d.device === "root") ?? i.disks[0] ?? null;
  const dash = <span className="text-muted-foreground">-</span>;
  const missing = noAgent ? (
    <span className="text-muted-foreground">{t("list.noAgent")}</span>
  ) : (
    dash
  );
  return (
    <DataTableRow onClick={onOpen} title={t("list.open")}>
      <td>
        <div className="font-medium">{i.name}</div>
        <div className="text-xs text-muted-foreground">
          {[
            i.type === "virtual-machine" ? t("list.vm") : t("list.container"),
            showProject ? i.project : null,
            i.image,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </td>
      <td>
        <StatusBadge tone={statusTone(i.status.toLowerCase())}>
          {i.status}
        </StatusBadge>
      </td>
      <td className="font-mono text-xs">{address?.address ?? missing}</td>
      <td>{i.cpu.percent !== null ? `${i.cpu.percent}%` : dash}</td>
      <td>
        {i.memory.usage !== null ? (
          <div className="flex flex-col gap-1">
            <span>
              {bytes(i.memory.usage)}
              {memoryLimit ? ` / ${bytes(memoryLimit)}` : ""}
            </span>
            {memoryLimit ? (
              <Meter percent={percentOf(i.memory.usage, memoryLimit)} />
            ) : null}
          </div>
        ) : (
          missing
        )}
      </td>
      <td>
        {root && root.usage !== null ? (
          <span>
            {bytes(root.usage)}
            {root.total ? ` / ${bytes(root.total)}` : ""}
          </span>
        ) : root ? (
          <span className="text-muted-foreground">{t("list.notReported")}</span>
        ) : (
          dash
        )}
      </td>
      <td>{i.processes ?? missing}</td>
    </DataTableRow>
  );
}

export function activate(app: TermixApp): void {
  app.registerTab(TAB_ID, createTab(app), {
    icon: Boxes,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
  });

  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: Boxes,
    kind: "open",
    order: 31,
    tabType: TAB_ID,
    when: (host) => incusEnabled(host),
  });
}
