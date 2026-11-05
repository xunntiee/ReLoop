import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/formatters";

export const TextField = ({
  description,
  label,
  list,
  max,
  min,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  description?: string;
  label: string;
  list?: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) => (
  <label className="grid gap-1.5 text-sm">
    <span className="font-medium">{label}</span>
    <Input
      list={list}
      max={max}
      min={min}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
    {description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
  </label>
);

export const NumberField = ({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) => {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitValue = (rawValue: string) => {
    const digitsOnly = rawValue.replace(/[^\d]/g, "");
    if (!digitsOnly) {
      setDraftValue("");
      return;
    }

    let nextValue = Number(digitsOnly.replace(/^0+(?=\d)/, ""));
    if (!Number.isFinite(nextValue)) nextValue = min ?? 0;
    if (typeof min === "number") nextValue = Math.max(min, nextValue);
    if (typeof max === "number") nextValue = Math.min(max, nextValue);
    const normalized = String(nextValue);
    setDraftValue(normalized);
    onChange(nextValue);
  };

  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        inputMode="numeric"
        onBlur={() => {
          if (!draftValue.trim()) {
            const fallbackValue = typeof min === "number" ? min : value;
            setDraftValue(String(fallbackValue));
            onChange(fallbackValue);
          }
        }}
        onChange={(event) => commitValue(event.currentTarget.value)}
        pattern="[0-9]*"
        step={step}
        type="text"
        value={draftValue}
      />
    </label>
  );
};

export const SelectField = ({
  description,
  disabled = false,
  label,
  onChange,
  options,
  value,
}: {
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) => (
  <label className="grid gap-1.5 text-sm">
    <span className="font-medium">{label}</span>
    <Select disabled={disabled} onValueChange={onChange} value={value}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
  </label>
);

export const TextareaField = ({
  description,
  label,
  onChange,
  placeholder,
  rows,
  value,
}: {
  description?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  value: string;
}) => (
  <label className="grid gap-1.5 text-sm">
    <span className="font-medium">{label}</span>
    <textarea
      className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-5 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={placeholder}
      rows={rows}
      value={value}
    />
    {description ? <span className="text-[11px] text-muted-foreground">{description}</span> : null}
  </label>
);

export const ToggleField = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) => (
  <label className="flex h-10 items-center gap-2 rounded-lg border px-3 text-sm">
    <input
      checked={checked}
      className="size-4 accent-foreground"
      onChange={(event) => onChange(event.currentTarget.checked)}
      type="checkbox"
    />
    <span className="font-medium">{label}</span>
  </label>
);

export const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-[5.5rem_1fr] gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="truncate font-mono text-xs">{value}</span>
  </div>
);

export const CompactFact = ({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) => (
  <div>
    <p className="text-muted-foreground text-xs">{label}</p>
    <p className="font-semibold text-base">{value}</p>
  </div>
);

export const Metric = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border bg-muted/30 px-3 py-2">
    <p className="truncate text-muted-foreground text-xs">{label}</p>
    <p className="font-semibold text-lg">{formatNumber(value)}</p>
  </div>
);
