import {
  Activity, AlarmClockOff, ArrowDownToLine, BatteryLow, Cable, CircleHelp, CircuitBoard,
  ClockAlert, Cpu, MessageSquare, Network, PlugZap, PowerOff, Radio,
  ShieldAlert, ThermometerSun, Unplug, Waves, Zap, ZapOff,
  type LucideIcon,
} from "lucide-react";

export type AnnotationItem = { name: string; group_name: string | null; group_color: string | null };

/** Stable symbols for current categories and their historical names. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "unknown": CircleHelp,
  "channel short before aging": ZapOff,
  "channel short ba": ZapOff,
  "channel short during aging": ClockAlert,
  "channel short aa": ClockAlert,
  "internal dc connection loose": Unplug,
  "relay issue": CircuitBoard,
  "zigbee/nios uart": Network,
  "inverter failure - other": Cpu,
  "zigbee failure - other": Radio,
  "dc": Zap,
  "ac": Waves,
  "grid": PlugZap,
  "mixed connectors": Cable,
  "unstable grid": Activity,
  "anti-islanding": PowerOff,
  "gfdi fault": ShieldAlert,
  "device timeout": AlarmClockOff,
  "inverter over temperature": ThermometerSun,
  "channel undervoltage ba": ArrowDownToLine,
  "channel undervoltage aa": BatteryLow,
};

export function annotationIcon(name: string): LucideIcon {
  return CATEGORY_ICONS[name.trim().toLowerCase()] ?? MessageSquare;
}

export function annotationColour(item: AnnotationItem): string {
  if (item.group_color && /^#[\da-f]{6}$/i.test(item.group_color)) return item.group_color;
  if (item.group_name === "Setup Issue") return "#f59e0b";
  if (item.group_name === "Manufacturing Defect / Inverter Failure") return "#dc2626";
  return "#6b7280";
}

/** Fallback for old cached responses; new API rows retain structured names. */
export function tableAnnotationItems(
  items: AnnotationItem[] | undefined,
  text: string | null,
  options: AnnotationItem[],
): AnnotationItem[] {
  const values = items ?? (text && text !== "-" ? text.split("; ").map(label => {
    const setup = label.startsWith("Setup Issue - ");
    const name = setup ? label.slice("Setup Issue - ".length) : label;
    return options.find(option => option.name === name) ?? {
      name, group_name: setup ? "Setup Issue" : null, group_color: null,
    };
  }) : []);
  // Keep deterministic order and collapse duplicates, as the old STRING_AGG did.
  return [...new Map(values.map(item => [JSON.stringify([item.name, item.group_name]), item])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}
