export type EnvVar = { name: string; value?: string };
export type Container = { env: EnvVar[] };
export type PodTemplate = { spec: { containers: Container[] } };
export type CronJobSpec = { jobTemplate: { spec: { template: PodTemplate } } };
export type DeploymentSpec = { template: PodTemplate };
export type ScaledObjectSpec = { triggers: Array<{ metadata: { query: string } }> };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}

const isEnvVar = (value: unknown): value is EnvVar =>
  isRecord(value) && typeof value.name === "string" && (value.value === undefined || typeof value.value === "string");

const isPodTemplate = (value: unknown): value is PodTemplate => {
  const containers = at(value, "spec", "containers");
  return Array.isArray(containers) && containers.every((container) => {
    const env = at(container, "env");
    return Array.isArray(env) && env.every(isEnvVar);
  });
};

function narrow<T>(value: unknown, is: (value: unknown) => value is T, what: string): T {
  if (!is(value)) throw new Error(`not a ${what}: ${JSON.stringify(value)?.slice(0, 200)}`);
  return value;
}

export const cronJobSpec = (value: unknown): CronJobSpec =>
  narrow(value, (v): v is CronJobSpec => isPodTemplate(at(v, "jobTemplate", "spec", "template")), "CronJob spec");

export const deploymentSpec = (value: unknown): DeploymentSpec =>
  narrow(value, (v): v is DeploymentSpec => isPodTemplate(at(v, "template")), "Deployment spec");

export const scaledObjectSpec = (value: unknown): ScaledObjectSpec =>
  narrow(
    value,
    (v): v is ScaledObjectSpec => {
      const triggers = at(v, "triggers");
      return Array.isArray(triggers) && triggers.every((trigger) => typeof at(trigger, "metadata", "query") === "string");
    },
    "ScaledObject spec",
  );
