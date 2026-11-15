import { useEffect, useState } from "react";
import {
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { LoadingState } from "@termix-ssh/plugin-sdk/ui";

const TAB_ID = "incus";

interface VersionAnswer {
  ok: boolean;
  client?: string | null;
  server?: string | null;
  error?: string;
}

function BoxesIcon(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <path d="m7 16.5-4.74-2.85M7 16.5l5-3M7 16.5v5.17" />
      <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <path d="m17 16.5-5-3M17 16.5l4.74-2.85M17 16.5v5.17" />
      <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <path d="M12 8 7.26 5.15M12 8l4.74-2.85M12 13.5V8" />
    </svg>
  );
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
  // host actions filter synchronously
  let canRead = false;
  void app.hasPermission("read").then((allowed) => {
    canRead = allowed;
  });

  app.registerTab(TAB_ID, createTab(app), {
    icon: BoxesIcon,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
  });

  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: BoxesIcon,
    kind: "open",
    order: 31,
    tabType: TAB_ID,
    when: (host) => canRead && incusEnabled(host),
  });
}
