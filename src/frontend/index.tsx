import { useEffect, useState } from "react";
import {
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { LoadingState } from "@termix-ssh/plugin-sdk/ui";
import { Boxes } from "lucide-react";

const TAB_ID = "incus";

interface VersionAnswer {
  ok: boolean;
  client?: string | null;
  server?: string | null;
  error?: string;
}

export function incusEnabled(host: object | null | undefined): boolean {
  const all = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> }
  )?.pluginSettings;
  return all?.incus?.enableIncus === true;
}

function createTab(app: TermixApp) {
  return function IncusTab({ host, isVisible }: TabProps) {
    const { t } = useTranslation();
    const [version, setVersion] = useState<VersionAnswer | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (!isVisible || !host) return;
      let live = true;
      app.api
        .get<VersionAnswer>(`/hosts/${encodeURIComponent(host.id)}/version`)
        .then(({ data }) => {
          if (live) {
            setVersion(data);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
      return () => {
        live = false;
      };
    }, [isVisible, host?.id]);

    if (!host) {
      return <p className="p-4 text-sm">{t("tab.noHost")}</p>;
    }
    return (
      <div className="flex flex-col gap-2 p-4">
        <h2 className="text-lg font-semibold">{host.name}</h2>
        {failed && <p className="text-sm text-destructive">{t("tab.error")}</p>}
        {!failed && !version && <LoadingState label={t("tab.loading")} />}
        {version?.ok && (
          <p className="text-sm">
            {t("tab.version", { server: version.server ?? "?" })}
          </p>
        )}
        {version && !version.ok && (
          <p className="text-sm text-destructive">
            {t("tab.unreachable", { error: version.error ?? "" })}
          </p>
        )}
      </div>
    );
  };
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
