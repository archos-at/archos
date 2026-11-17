export interface ResourceSpec {
  requestsCpu: string;
  requestsMemory: string;
  limitsCpu: string;
  limitsMemory: string;
}

export function toResourceRequirements(r: ResourceSpec) {
  return {
    requests: { cpu: r.requestsCpu, memory: r.requestsMemory },
    limits: { cpu: r.limitsCpu, memory: r.limitsMemory },
  };
}

export function cpuMillicores(quantity: string): number {
  const trimmed = quantity.trim();
  return trimmed.endsWith("m")
    ? Number(trimmed.slice(0, -1))
    : Number(trimmed) * 1000;
}

export function memoryBytes(quantity: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(
    quantity.trim(),
  );
  if (!match) return NaN;
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Number(match[1]) * (match[2] ? multipliers[match[2]] : 1);
}

export function assertMemoryFitsLimit(tier: string, r: ResourceSpec): void {
  const requests = memoryBytes(r.requestsMemory);
  const limits = memoryBytes(r.limitsMemory);

  if (
    !Number.isFinite(requests) ||
    !Number.isFinite(limits) ||
    requests <= 0 ||
    limits <= 0
  ) {
    throw new Error(
      `${tier}: could not parse memory resources ` +
        `(requests=${r.requestsMemory}, limits=${r.limitsMemory}).`,
    );
  }

  if (limits < requests) {
    throw new Error(
      `${tier}: memory limit (${r.limitsMemory}) is below the request (${r.requestsMemory}).`,
    );
  }
}

export function assertHpaTargetIsProportional(
  tier: string,
  r: ResourceSpec,
  hpaCpuTargetPercent: number,
): void {
  const requests = cpuMillicores(r.requestsCpu);
  const limits = cpuMillicores(r.limitsCpu);

  if (!Number.isFinite(requests) || !Number.isFinite(limits) || requests <= 0) {
    throw new Error(
      `${tier}: could not parse CPU resources ` +
        `(requests=${r.requestsCpu}, limits=${r.limitsCpu}).`,
    );
  }

  if (!Number.isFinite(hpaCpuTargetPercent) || hpaCpuTargetPercent <= 0) {
    throw new Error(
      `${tier}: HPA CPU target must be a finite positive number ` +
        `(got ${hpaCpuTargetPercent}).`,
    );
  }

  const trigger = (requests * hpaCpuTargetPercent) / 100;

  const triggerFractionOfLimit = trigger / limits;
  if (triggerFractionOfLimit < 0.15) {
    throw new Error(
      `${tier}: HPA target of ${hpaCpuTargetPercent}% of ${r.requestsCpu} requests ` +
        `= ${trigger}m, only ${(triggerFractionOfLimit * 100).toFixed(1)}% of the ` +
        `${r.limitsCpu} limit. The HPA will pin to maxReplicas under any load. ` +
        `Raise the CPU request toward real steady-state usage.`,
    );
  }

  if (limits < requests) {
    throw new Error(
      `${tier}: CPU limit (${r.limitsCpu}) is below the request (${r.requestsCpu}).`,
    );
  }
}
