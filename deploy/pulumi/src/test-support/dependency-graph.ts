import * as pulumi from "@pulumi/pulumi";

export interface RecordedResource {
  type: string;
  name: string;
  dependencies: string[];
  ignoreChanges: string[];
  customTimeouts: { create: string; update: string; delete: string };
}

const urnOf = (type: string, name: string) =>
  `urn:pulumi:${pulumi.getStack()}::${pulumi.getProject()}::${type}::${name}`;

export class DependencyGraph {
  private readonly byUrn = new Map<string, RecordedResource>();

  constructor() {
    type Req = {
      getType(): string;
      getName(): string;
      getDependenciesList(): string[];
      getIgnorechangesList(): string[];
      getCustomtimeouts(): { getCreate(): string; getUpdate(): string; getDelete(): string } | undefined;
    };
    const monitor = pulumi.runtime.getMonitor() as unknown as {
      registerResource: (req: Req, ...rest: unknown[]) => unknown;
    };
    const register = monitor.registerResource.bind(monitor);
    monitor.registerResource = (req, ...rest) => {
      const type = req.getType();
      const name = req.getName();
      this.byUrn.set(urnOf(type, name), {
        type,
        name,
        dependencies: [...req.getDependenciesList()],
        ignoreChanges: [...req.getIgnorechangesList()],
        customTimeouts: {
          create: req.getCustomtimeouts()?.getCreate() ?? "",
          update: req.getCustomtimeouts()?.getUpdate() ?? "",
          delete: req.getCustomtimeouts()?.getDelete() ?? "",
        },
      });
      return register(req, ...rest);
    };
  }

  find(type: string, name: string): RecordedResource {
    const hit = this.byUrn.get(urnOf(type, name));
    if (!hit) throw new Error(`no ${type} named "${name}" was registered`);
    return hit;
  }

  closure(type: string, name: string): Set<string> {
    this.find(type, name);
    const seen = new Set<string>();
    const stack = [urnOf(type, name)];
    while (stack.length > 0) {
      const next = this.byUrn.get(stack.pop() as string);
      for (const dep of next?.dependencies ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        stack.push(dep);
      }
    }
    return seen;
  }

  waitsOn(type: string, name: string, onType: string, onName: string): boolean {
    this.find(onType, onName);
    return this.closure(type, name).has(urnOf(onType, onName));
  }
}
