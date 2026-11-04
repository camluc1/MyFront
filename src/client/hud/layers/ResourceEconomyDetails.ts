import type { ResourceEconomyInfo } from "@openfront/engine-api/game/GameTypes";
import { html, nothing } from "lit";
import { translateText } from "../../Utils";
export function resourceEconomyReason(info?: ResourceEconomyInfo): string {
  return info?.reason
    ? translateText(`resource_economy.reason.${info.reason}`)
    : "";
}
export function resourceEconomyLines(info?: ResourceEconomyInfo): string[] {
  if (!info) return [];
  const t = translateText;
  const number = (value: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
      value,
    );
  const lines: string[] = [];
  if (info.resource) {
    lines.push(
      `${t(`resource_economy.resource.${info.resource}`)} · ${t("resource_economy.quality")} ${info.quality}/4`,
    );
    lines.push(
      `${t("resource_economy.production")}: ${number(info.level ? info.currentPerCycle : info.productionPerCycle)} ${t("resource_economy.cycle")}`,
    );
    if (
      info.level &&
      info.reason !== "max_level" &&
      info.reason !== "exhausted"
    )
      lines.push(
        `${t("resource_economy.next")}: ${number(info.nextPerCycle)} (+${number(info.upgradeGainPerCycle)}) ${t("resource_economy.cycle")}`,
      );
    lines.push(
      info.renewable
        ? t("resource_economy.renewable")
        : info.remainingCycles === 0
          ? t("resource_economy.exhausted")
          : `${t("resource_economy.reserves")}: ${number(info.remainingCycles ?? 0)} ${t("resource_economy.cycles")}`,
    );
    if (info.railway !== "not_applicable")
      lines.push(t(`resource_economy.railway.${info.railway}`));
  }
  return lines;
}
export function renderResourceEconomy(info?: ResourceEconomyInfo) {
  if (!info) return nothing;
  return html`<div
    data-resource-economy
    class="rounded-md border border-sky-400/30 bg-slate-950/95 p-2 text-xs text-slate-100 text-left space-y-1"
  >
    ${resourceEconomyLines(info).map((line) => html`<div>${line}</div>`)}
    ${info.reason ? html`<div class="text-amber-300" role="status">${resourceEconomyReason(info)}</div>` : nothing}
  </div>`;
}
