import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileCode } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Alert,
  Button,
  FormFooter,
  PanelShell,
  Segmented,
  TextAreaField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { EditTarget, UnitFileView, VerifyResult } from "../shared/types";
import {
  deleteUnit,
  errorMessage,
  getUnitFile,
  saveUnitFile,
  verifyUnitFile,
} from "./api";

export function UnitEditor({
  hostId,
  unit,
  canEdit,
  onClose,
  onDeleted,
}: {
  hostId: number;
  unit: string;
  canEdit: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<UnitFileView | null>(null);
  const [failed, setFailed] = useState("");
  const [target, setTarget] = useState<EditTarget>("override");
  const [text, setText] = useState("");
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const original = view
    ? target === "override"
      ? view.override
      : view.fragment
    : "";

  const load = useCallback(async () => {
    try {
      const next = await getUnitFile(hostId, unit);
      setView(next);
      setFailed("");
      return next;
    } catch (e) {
      setFailed(errorMessage(e, t("editor.loadFailed")));
      return null;
    }
  }, [hostId, unit, t]);

  useEffect(() => {
    void load().then((next) => {
      if (!next) return;
      const startTarget: EditTarget = next.local ? "unit" : "override";
      setTarget(startTarget);
      setText(startTarget === "unit" ? next.fragment : next.override);
    });
  }, [load]);

  const switchTarget = (next: EditTarget) => {
    if (!view) return;
    setTarget(next);
    setCheck(null);
    setText(
      next === "unit"
        ? view.fragment
        : view.override || `[Service]\n# ${t("editor.overrideTemplate")}\n`,
    );
  };

  const verify = async () => {
    setChecking(true);
    try {
      setCheck(await verifyUnitFile(hostId, unit, target, text));
    } catch (e) {
      toast.error(errorMessage(e, t("editor.checkFailed")));
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveUnitFile(hostId, unit, target, text);
      toast.success(t("editor.saved", { unit }));
      setCheck(null);
      const next = await load();
      if (next) setText(target === "unit" ? next.fragment : next.override);
    } catch (e) {
      const message = errorMessage(e, t("editor.saveFailed"));
      setCheck({ ok: false, output: message });
      toast.error(t("editor.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("editor.deleteTitle", { unit }),
      description: t("editor.deleteDesc"),
      confirmLabel: t("editor.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteUnit(hostId, unit);
      toast.success(t("editor.deleted", { unit }));
      onDeleted();
    } catch (e) {
      toast.error(errorMessage(e, t("editor.deleteFailed")));
    }
  };

  const editable = canEdit && !!view?.writable;
  const path =
    target === "override" ? view?.overridePath : `/etc/systemd/system/${unit}`;

  return (
    <PanelShell
      icon={<FileCode className="size-4" />}
      title={<span className="font-mono">{unit}</span>}
      status={path}
      leading={
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          title={t("common.back")}
          aria-label={t("common.back")}
        >
          <ArrowLeft className="size-4" />
        </Button>
      }
      toolbar={
        view ? (
          <Segmented<EditTarget>
            value={target}
            onChange={switchTarget}
            options={[
              { value: "override", label: t("editor.override") },
              { value: "unit", label: t("editor.fullFile") },
            ]}
          />
        ) : undefined
      }
      footer={
        editable ? (
          <FormFooter
            onCancel={onClose}
            onSave={() => void save()}
            saving={saving}
            dirty={text !== original}
            saveLabel={t("editor.save")}
            onDelete={view?.local ? () => void remove() : undefined}
            deleteLabel={t("editor.delete")}
            extra={
              <Button
                variant="outline"
                size="sm"
                disabled={checking}
                onClick={() => void verify()}
              >
                {checking ? t("editor.checking") : t("editor.check")}
              </Button>
            }
          />
        ) : undefined
      }
      scroll
      className="gap-2 p-2.5"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 pb-6">
        {failed && <p className="text-sm text-destructive">{failed}</p>}
        {view && (
          <>
            <p className="text-xs text-muted-foreground">
              {target === "override"
                ? t("editor.overrideHint")
                : view.local
                  ? t("editor.localHint")
                  : t("editor.vendorHint", { path: view.fragmentPath })}
            </p>
            {!view.writable && (
              <Alert className="rounded-none text-xs">
                {t("editor.notWritable")}
              </Alert>
            )}
            <TextAreaField
              label={
                target === "override"
                  ? t("editor.override")
                  : t("editor.fullFile")
              }
              value={text}
              onChange={(value) => {
                setText(value);
                setCheck(null);
              }}
              rows={18}
              mono
              disabled={!editable}
            />
            {check && (
              <div
                className={`border p-2 text-xs ${check.ok ? "border-green-500/40" : "border-destructive/50"}`}
              >
                <p className={check.ok ? "text-green-500" : "text-destructive"}>
                  {check.ok ? t("editor.checkOk") : t("editor.checkBad")}
                </p>
                {check.output && (
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
                    {check.output}
                  </pre>
                )}
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-muted-foreground">
                {t("editor.combined")}
              </summary>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[11px]">
                {view.combined}
              </pre>
            </details>
          </>
        )}
      </div>
    </PanelShell>
  );
}
