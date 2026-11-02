import { useEffect, useMemo, useState } from "react";
import type { ServiceTopology, TopologyControl } from "@sdp/shared";
import { useTheme } from "../theme-provider";
import { Btn, Field, Select, TextInput } from "./ui";

/**
 * Controls are generated from `$topology`, not hand-written per service.
 *
 * The same document that tells us `arl/rta/cmd/+/stow_dish` takes a boolean
 * also tells the form to render a button. Adding a new control to a service is
 * therefore a publisher change, not a frontend change.
 */

/**
 * A panel submits a control for a specific entity. The entity has to travel with
 * the call because controls are addressed per entity (`.../cmd/<entity>/<name>`)
 * and a panel switches the entity it is showing without remounting.
 */
export type ControlSubmit = (entity: string, control: string, value: unknown) => void | Promise<void>;

/** What a single control form calls: it already knows its entity. */
type ControlFormSubmit = (control: string, value: unknown) => void | Promise<void>;

export function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function findControl(
  topology: ServiceTopology | null,
  entity: string,
  name: string
): TopologyControl | undefined {
  return topology?.controls?.find((control) => {
    const parts = control.topic.split("/");
    const entityPart = parts[3];
    return parts[4] === name && (entityPart === "+" || entityPart === entity);
  });
}

/** Controls that make sense to expose as a single "do it" button. */
const ACTIONS = new Set([
  "start_scan",
  "pause_scan",
  "cancel_scan",
  "request_recalibration",
  "clean_reference_cell",
  "refill_pan",
  "service_anemometer",
  "start_generator",
  "stop_generator"
]);

/** Boolean controls that are genuinely on/off rather than one-shot actions. */
const TOGGLES = new Set(["enable_dish", "stow_dish", "enable_site", "load_shed", "enable_solar_array"]);

export function ControlForm({
  topology,
  entity,
  name,
  onSubmit,
  disabled,
  currentValue
}: {
  topology: ServiceTopology | null;
  entity: string;
  name: string;
  onSubmit: ControlFormSubmit;
  disabled?: boolean;
  currentValue?: unknown;
}) {
  const { theme: t } = useTheme();
  const spec = findControl(topology, entity, name);
  const valueSpec = (spec?.value ?? {}) as Record<string, unknown>;
  const type = typeof valueSpec.type === "string" ? valueSpec.type : "bool";

  const [enumValue, setEnumValue] = useState<string>(
    typeof currentValue === "string" ? currentValue : Array.isArray(valueSpec.values) ? String(valueSpec.values[0]) : ""
  );
  const [numberValue, setNumberValue] = useState<string>(
    typeof currentValue === "number"
      ? String(currentValue)
      : typeof valueSpec.min === "number"
        ? String(valueSpec.min)
        : "0"
  );
  const [timestamp, setTimestamp] = useState<string>(new Date(Date.now() + 60_000).toISOString().slice(0, 16));

  useEffect(() => {
    if (typeof currentValue === "string") setEnumValue(currentValue);
  }, [currentValue]);

  if (!spec) {
    return <span style={{ fontSize: 11, color: t.muted2 }}>{humanise(name)} is not advertised by this service.</span>;
  }

  const label = humanise(name);

  if (ACTIONS.has(name) || (type === "bool" && !TOGGLES.has(name))) {
    return (
      <Btn variant="default" onClick={() => void onSubmit(name, true)} disabled={disabled} title={spec.topic}>
        {label}
      </Btn>
    );
  }

  if (TOGGLES.has(name)) {
    const on = currentValue === true;
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <Btn variant={on ? "ok" : "default"} onClick={() => void onSubmit(name, true)} disabled={disabled}>
          On
        </Btn>
        <Btn variant={!on ? "danger" : "default"} onClick={() => void onSubmit(name, false)} disabled={disabled}>
          Off
        </Btn>
        <span style={{ fontSize: 10, color: t.muted, alignSelf: "center" }}>{label}</span>
      </div>
    );
  }

  if (type === "enum") {
    const values = Array.isArray(valueSpec.values) ? valueSpec.values.map(String) : [];
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label={label}>
          <Select
            value={enumValue}
            onChange={setEnumValue}
            options={values.map((value) => ({ value, label: humanise(value) }))}
          />
        </Field>
        <Btn variant="primary" onClick={() => void onSubmit(name, enumValue)} disabled={disabled}>
          Apply
        </Btn>
      </div>
    );
  }

  if (type === "timestamp") {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label={label}>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(event) => setTimestamp(event.target.value)}
            style={{
              background: t.panelSunken,
              border: `1px solid ${t.lineSoft}`,
              color: t.text,
              padding: "4px 6px",
              fontSize: 12
            }}
          />
        </Field>
        <Btn
          variant="primary"
          onClick={() => {
            const parsed = new Date(timestamp).getTime();
            if (!Number.isNaN(parsed)) void onSubmit(name, parsed);
          }}
          disabled={disabled}
        >
          Apply
        </Btn>
      </div>
    );
  }

  if (type === "integer" || type === "float") {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label={label} hint={valueSpec.unit ? String(valueSpec.unit) : undefined}>
          <TextInput value={numberValue} onChange={setNumberValue} type="number" mono width={92} />
        </Field>
        <Btn
          variant="primary"
          onClick={() => {
            const parsed = Number(numberValue);
            if (Number.isFinite(parsed)) void onSubmit(name, type === "integer" ? Math.round(parsed) : parsed);
          }}
          disabled={disabled}
        >
          Apply
        </Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: t.muted }}>{label}</span>
      <Btn variant="primary" onClick={() => void onSubmit(name, currentValue ?? {})} disabled={disabled}>
        Apply
      </Btn>
    </div>
  );
}

/** Everything a given entity is allowed to receive, in topology order. */
export function ControlList({
  topology,
  entity,
  onSubmit,
  disabled,
  currentValues
}: {
  topology: ServiceTopology | null;
  entity: string;
  onSubmit: ControlSubmit;
  disabled?: boolean;
  currentValues?: Record<string, unknown>;
}) {
  const { theme: t } = useTheme();

  const names = useMemo(() => {
    // A control is addressed at an entity kind as well as a name: `+/adjust_azimuth`
    // only makes sense for a dish, `+/start_scan` only for a subarray. Without
    // the kind check both lists render every control in the service.
    const kind = topology?.entities.find((candidate) => candidate.id === entity)?.kind;
    const out: string[] = [];
    for (const control of topology?.controls ?? []) {
      const parts = control.topic.split("/");
      if (parts[3] !== "+" && parts[3] !== entity) continue;
      if (kind && Array.isArray(control.entity_kinds) && !control.entity_kinds.includes(kind)) continue;
      if (!out.includes(parts[4])) out.push(parts[4]);
    }
    return out;
  }, [topology, entity]);

  if (names.length === 0) {
    return <span style={{ fontSize: 11, color: t.muted }}>No controls advertised for {entity}.</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
      {names.map((name) => (
        <ControlForm
          key={name}
          topology={topology}
          entity={entity}
          name={name}
          onSubmit={(control, value) => onSubmit(entity, control, value)}
          disabled={disabled}
          currentValue={currentValues?.[name]}
        />
      ))}
    </div>
  );
}
