import * as pulumi from "@pulumi/pulumi";
import { cpuMillicores } from "./resources";

export const CPU_REQUEST_FLOOR_MILLICORES = 10;

export function cpuRequestScale(): number {
  const raw = new pulumi.Config().get("cpuRequestScale");
  if (raw === undefined || raw.trim() === "") return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new Error(`grid-oib:cpuRequestScale must be a number above 0 and at most 1 (got "${raw}").`);
  }
  return scale;
}

export function cpuRequest(quantity: string): string {
  const scale = cpuRequestScale();
  if (scale === 1) return quantity;
  const millicores = cpuMillicores(quantity);
  if (!Number.isFinite(millicores) || millicores <= 0) {
    throw new Error(`cpuRequest: could not parse the CPU request "${quantity}".`);
  }
  const floor = Math.min(millicores, CPU_REQUEST_FLOOR_MILLICORES);
  return `${Math.max(floor, Math.ceil(millicores * scale))}m`;
}

type Requested = { readonly requests: Readonly<Record<string, string>> };
type WithScaledCpu<T extends Requested> = Omit<T, "requests"> & { requests: { [K in keyof T["requests"]]: string } };

export function scaledCpuRequest<T extends Requested>(resources: T): WithScaledCpu<T> {
  const { cpu } = resources.requests;
  if (cpu === undefined) return resources as WithScaledCpu<T>;
  return { ...resources, requests: { ...resources.requests, cpu: cpuRequest(cpu) } } as WithScaledCpu<T>;
}

export function cpuUtilizationTarget(percent: number): number {
  const scale = cpuRequestScale();
  return scale === 1 ? percent : Math.round(percent / scale);
}
