export type AnnotationItem = { name: string; group_name: string | null; group_color: string | null };

/** Short labels keep the cause recognizable; tooltips retain the original name. */
const SHORT_LABELS: Record<string, string> = {
  "channel short before aging": "Short (before aging)",
  "channel short ba": "Short (before aging)",
  "channel short during aging": "Short (during aging)",
  "channel short aa": "Short (during aging)",
  "internal dc connection loose": "Loose DC connection",
  "relay issue": "Relay issue",
  "zigbee/nios uart": "Zigbee / UART",
  "inverter failure - other": "Inverter failure (other)",
  "zigbee failure - other": "Zigbee failure (other)",
  "dc": "DC setup",
  "ac": "AC setup",
  "grid": "Grid setup",
  "mixed connectors": "Mixed connectors",
  "unstable grid": "Unstable grid",
  "anti-islanding": "Anti-islanding",
  "gfdi fault": "GFDI fault",
  "device timeout": "Timeout",
  "inverter over temperature": "Overtemperature",
  "channel undervoltage ba": "Undervoltage (before aging)",
  "channel undervoltage aa": "Undervoltage (during aging)",
};

export function annotationShortLabel(name: string): string {
  return SHORT_LABELS[name.trim().toLowerCase()] ?? name;
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
