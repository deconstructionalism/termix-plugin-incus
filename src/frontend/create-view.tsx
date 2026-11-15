import { useEffect, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button, InlineView, NoticePanel } from "@termix-ssh/plugin-sdk/ui";

type Result = { ok: true; summary: string } | { ok: false; error: string };

const field =
  "h-8 w-full border border-border bg-transparent px-2 font-mono text-xs";

export function CreateView({
  app,
  hostId,
  onDone,
  onClose,
}: {
  app: TermixApp;
  hostId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [image, setImage] = useState("images:alpine/3.21");
  const [profiles, setProfiles] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>(["default"]);
  const [vm, setVm] = useState(false);
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void app.api
      .get<{ ok: boolean; profiles?: string[] }>(
        `/hosts/${encodeURIComponent(hostId)}/profiles`,
      )
      .then(({ data }) => {
        const list = data.profiles ?? [];
        setProfiles(list);
        setPicked((p) => p.filter((x) => list.includes(x)));
      })
      .catch(() => setProfiles([]));
  }, [hostId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await app.api.post<Result>(
        `/hosts/${encodeURIComponent(hostId)}/instances`,
        { name, image, profiles: picked, vm, start },
      );
      if ("error" in data) setError(data.error);
      else {
        onDone();
        onClose();
      }
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      setError(message ?? t("actions.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InlineView
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("manage.create.title")}
    >
      <div className="flex flex-col gap-3 p-3 text-sm">
        {error ? <NoticePanel tone="destructive" title={error} /> : null}
        <label className="flex flex-col gap-1">
          {t("manage.create.name")}
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          {t("manage.create.image")}
          <input
            className={field}
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t("manage.create.imageHint")}
          </span>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend>{t("manage.create.profiles")}</legend>
          {(profiles ?? []).map((p) => (
            <label
              key={p}
              className="flex items-center gap-2 font-mono text-xs"
            >
              <input
                type="checkbox"
                checked={picked.includes(p)}
                onChange={(e) =>
                  setPicked((now) =>
                    e.target.checked ? [...now, p] : now.filter((x) => x !== p),
                  )
                }
              />
              {p}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={vm}
            onChange={(e) => setVm(e.target.checked)}
          />
          {t("manage.create.vm")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={start}
            onChange={(e) => setStart(e.target.checked)}
          />
          {t("manage.create.start")}
        </label>
        <div>
          <Button
            disabled={busy || !name || !image}
            onClick={() => void create()}
          >
            {busy ? t("actions.working") : t("manage.create.create")}
          </Button>
        </div>
      </div>
    </InlineView>
  );
}
