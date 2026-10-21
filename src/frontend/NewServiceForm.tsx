import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  FieldPair,
  FormFooter,
  NumberField,
  PanelShell,
  SelectField,
  SwitchRow,
  TextAreaField,
  TextField,
} from "@termix-ssh/plugin-sdk/ui";
import type { NewServiceInput } from "../shared/types";
import { createService, errorMessage } from "./api";

const EMPTY: NewServiceInput = {
  name: "",
  description: "",
  execStart: "",
  type: "simple",
  user: "",
  group: "",
  workingDirectory: "",
  environment: [],
  restart: "on-failure",
  restartSec: 5,
  after: "network.target",
  wantedBy: "multi-user.target",
  enable: true,
  start: true,
  onCalendar: "",
};

export function NewServiceForm({
  hostId,
  onClose,
  onCreated,
}: {
  hostId: number;
  onClose: () => void;
  onCreated: (unit: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<NewServiceInput>(EMPTY);
  const [env, setEnv] = useState("");
  const [timer, setTimer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof NewServiceInput>(
    key: K,
    value: NewServiceInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { units } = await createService(hostId, {
        ...form,
        onCalendar: timer ? form.onCalendar : "",
        environment: env
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      toast.success(t("create.done", { unit: units.join(", ") }));
      onCreated(units[0]);
    } catch (e) {
      setError(errorMessage(e, t("create.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelShell
      icon={<Plus className="size-4" />}
      title={t("create.title")}
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
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          dirty={!!form.name && !!form.execStart}
          saveLabel={t("create.save")}
          status={
            error ? (
              <span className="text-destructive">{error}</span>
            ) : undefined
          }
        />
      }
      scroll
      className="gap-2 p-2.5"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 pb-6">
        <FieldPair>
          <TextField
            label={t("create.name")}
            value={form.name}
            onChange={(v) => set("name", v)}
            placeholder="my-app"
            hint={t("create.nameHint")}
            mono
          />
          <TextField
            label={t("create.description")}
            value={form.description}
            onChange={(v) => set("description", v)}
            placeholder={t("create.descriptionPlaceholder")}
          />
        </FieldPair>
        <TextField
          label={t("create.command")}
          value={form.execStart}
          onChange={(v) => set("execStart", v)}
          placeholder="/usr/bin/node /opt/my-app/server.js"
          hint={t("create.commandHint")}
          mono
        />
        <FieldPair>
          <TextField
            label={t("create.user")}
            value={form.user}
            onChange={(v) => set("user", v)}
            placeholder="root"
            mono
          />
          <TextField
            label={t("create.group")}
            value={form.group}
            onChange={(v) => set("group", v)}
            mono
          />
        </FieldPair>
        <TextField
          label={t("create.folder")}
          value={form.workingDirectory}
          onChange={(v) => set("workingDirectory", v)}
          placeholder="/opt/my-app"
          mono
        />
        <TextAreaField
          label={t("create.environment")}
          value={env}
          onChange={setEnv}
          placeholder={"NODE_ENV=production\nPORT=3000"}
          hint={t("create.environmentHint")}
          rows={3}
          mono
        />
        <SwitchRow
          label={t("create.timer")}
          description={t("create.timerHint")}
          checked={timer}
          onChange={setTimer}
        />
        {timer ? (
          <TextField
            label={t("create.schedule")}
            value={form.onCalendar}
            onChange={(v) => set("onCalendar", v)}
            placeholder="*-*-* 03:00:00"
            hint={t("create.scheduleHint")}
            mono
          />
        ) : (
          <>
            <FieldPair>
              <SelectField<NewServiceInput["type"]>
                label={t("create.type")}
                value={form.type}
                onChange={(v) => set("type", v)}
                options={(
                  ["simple", "exec", "forking", "oneshot", "notify"] as const
                ).map((value) => ({
                  value,
                  label: t(`create.types.${value}`),
                }))}
              />
              <SelectField<NewServiceInput["restart"]>
                label={t("create.restart")}
                value={form.restart}
                onChange={(v) => set("restart", v)}
                options={(
                  ["on-failure", "always", "on-abnormal", "no"] as const
                ).map((value) => ({
                  value,
                  label: t(`create.restarts.${value}`),
                }))}
              />
            </FieldPair>
            <FieldPair>
              <NumberField
                label={t("create.restartSec")}
                value={form.restartSec}
                onChange={(v) => set("restartSec", v)}
                min={0}
                max={3600}
              />
              <TextField
                label={t("create.after")}
                value={form.after}
                onChange={(v) => set("after", v)}
                hint={t("create.afterHint")}
                mono
              />
            </FieldPair>
          </>
        )}
        <SwitchRow
          label={t("create.enable")}
          description={t("create.enableHint")}
          checked={form.enable}
          onChange={(v) => set("enable", v)}
        />
        <SwitchRow
          label={t("create.start")}
          checked={form.start}
          onChange={(v) => set("start", v)}
        />
      </div>
    </PanelShell>
  );
}
