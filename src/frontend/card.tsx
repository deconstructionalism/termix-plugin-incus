import { useEffect, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  EmptyState,
  LoadingState,
  NoticePanel,
} from "@termix-ssh/plugin-sdk/ui";
import { Boxes } from "lucide-react";

type HostSummary =
  | {
      id: number;
      name: string;
      ok: true;
      total: number;
      running: number;
      stopped: number;
      frozen: number;
      down: { name: string; project: string; status: string }[];
    }
  | { id: number; name: string; ok: false; error: string };

// running instances per host, refreshed while showing
const REFRESH_MS = 15_000;
export function createCard(app: TermixApp) {
  return function IncusHostsCard() {
    const { t } = useTranslation();
    const [hosts, setHosts] = useState<HostSummary[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      let live = true;
      const load = async () => {
        try {
          const { data } = await app.api.get<{ hosts: HostSummary[] }>(
            "/summary",
          );
          if (live) {
            setHosts(data.hosts);
            setFailed(false);
          }
        } catch {
          if (live) setFailed(true);
        }
      };
      void load();
      const timer = setInterval(() => void load(), REFRESH_MS);
      // catch up at once when the page comes back into view
      const onVisible = () => {
        if (document.visibilityState === "visible") void load();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        live = false;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }, []);

    if (failed)
      return <NoticePanel tone="destructive" title={t("tab.error")} />;
    if (!hosts) return <LoadingState compact label={t("card.loading")} />;
    if (hosts.length === 0)
      return <EmptyState icon={Boxes} title={t("card.empty")} />;
    return (
      <div className="flex flex-col text-sm">
        {hosts.map((h) => (
          <button
            key={h.id}
            type="button"
            className="flex flex-col gap-0.5 border-b border-border px-3 py-2 text-left"
            onClick={() => {
              const host = app.getHost(h.id);
              if (host) app.tabs.openTab(host as never, "incus");
            }}
          >
            <span className="flex items-center justify-between">
              <span className="font-medium">{h.name}</span>
              <span
                className={h.ok ? "text-muted-foreground" : "text-destructive"}
              >
                {h.ok
                  ? t("card.running", { running: h.running, total: h.total })
                  : t("card.failed")}
              </span>
            </span>
            {h.ok && h.down.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {h.down
                  .map(
                    (d) =>
                      `${t(`card.status.${d.status.toLowerCase()}`, { defaultValue: d.status })}: ${d.name}`,
                  )
                  .join(", ")}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  };
}
