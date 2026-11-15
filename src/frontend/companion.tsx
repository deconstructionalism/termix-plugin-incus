import { useEffect, useState } from "react";
import {
  useTranslation,
  type CompanionProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  EmptyState,
  LoadingState,
  NoticePanel,
  StatusDot,
  statusTone,
} from "@termix-ssh/plugin-sdk/ui";
import { Boxes } from "lucide-react";
import { bytes } from "./format";
import type { ListAnswer } from "./index";

// a narrow list beside a terminal: name, state, CPU and memory
export function createCompanion(app: TermixApp) {
  return function IncusCompanion({ host, isVisible }: CompanionProps) {
    const { t } = useTranslation();
    const [answer, setAnswer] = useState<ListAnswer | null>(null);
    const [failed, setFailed] = useState(false);
    const hostId = host?.id;

    useEffect(() => {
      if (!isVisible || !hostId) return;
      let live = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tick = async () => {
        let seconds = 30;
        try {
          const { data } = await app.api.get<ListAnswer>(
            `/hosts/${encodeURIComponent(hostId)}/instances`,
          );
          if (!live) return;
          setAnswer(data);
          setFailed(false);
          if ("pollSeconds" in data) seconds = data.pollSeconds;
        } catch {
          if (live) setFailed(true);
        }
        if (live) timer = setTimeout(tick, seconds * 1000);
      };
      void tick();
      return () => {
        live = false;
        if (timer) clearTimeout(timer);
      };
    }, [isVisible, hostId]);

    if (failed)
      return <NoticePanel tone="destructive" title={t("tab.error")} />;
    if (!answer) return <LoadingState compact label={t("tab.loading")} />;
    if ("error" in answer) {
      return (
        <NoticePanel tone="destructive" title={t("tab.unreachable")}>
          {answer.error}
        </NoticePanel>
      );
    }
    const instances = (answer as Extract<ListAnswer, { ok: true }>).instances;
    return (
      <div className="flex flex-col text-xs">
        {instances.length === 0 ? (
          <EmptyState icon={Boxes} title={t("companion.empty")} />
        ) : (
          instances.map((i) => (
            <div
              key={`${i.project}/${i.name}`}
              className="flex items-center gap-2 border-b border-border px-3 py-1.5"
            >
              <StatusDot tone={statusTone(i.status.toLowerCase())} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {i.name}
              </span>
              <span className="text-muted-foreground">
                {i.cpu.percent !== null ? `${i.cpu.percent}%` : ""}
              </span>
              <span className="w-16 text-right text-muted-foreground">
                {bytes(i.memory.usage)}
              </span>
            </div>
          ))
        )}
        {host ? (
          <button
            type="button"
            className="px-3 py-2 text-left text-accent-brand"
            onClick={() => app.tabs.openTab(host as never, "incus")}
          >
            {t("companion.open")}
          </button>
        ) : null}
      </div>
    );
  };
}
