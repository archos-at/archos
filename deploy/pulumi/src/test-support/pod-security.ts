export type PodSecurityLevel = "privileged" | "baseline" | "restricted";

type Spec = Record<string, any>;

const BASELINE_CAPABILITIES = new Set([
  "AUDIT_WRITE",
  "CHOWN",
  "DAC_OVERRIDE",
  "FOWNER",
  "FSETID",
  "KILL",
  "MKNOD",
  "NET_BIND_SERVICE",
  "SETFCAP",
  "SETGID",
  "SETPCAP",
  "SETUID",
  "SYS_CHROOT",
]);

const SAFE_SYSCTLS = new Set([
  "kernel.shm_rmid_forced",
  "net.ipv4.ip_local_port_range",
  "net.ipv4.ip_unprivileged_port_start",
  "net.ipv4.tcp_syncookies",
  "net.ipv4.ping_group_range",
  "net.ipv4.ip_local_reserved_ports",
  "net.ipv4.tcp_keepalive_time",
  "net.ipv4.tcp_fin_timeout",
  "net.ipv4.tcp_keepalive_intvl",
  "net.ipv4.tcp_keepalive_probes",
]);

const SELINUX_TYPES = new Set(["", "container_t", "container_init_t", "container_kvm_t", "container_engine_t"]);

const RESTRICTED_VOLUME_KINDS = new Set([
  "configMap",
  "csi",
  "downwardAPI",
  "emptyDir",
  "ephemeral",
  "persistentVolumeClaim",
  "projected",
  "secret",
]);

const APPARMOR_ANNOTATION = "container.apparmor.security.beta.kubernetes.io/";

export function podSecurityLevel(labels: Record<string, string> | undefined): PodSecurityLevel {
  const level = labels?.["pod-security.kubernetes.io/enforce"] ?? "privileged";
  if (level !== "privileged" && level !== "baseline" && level !== "restricted") {
    throw new Error(`unknown Pod Security level "${level}"`);
  }
  return level;
}

function containersOf(pod: Spec): Spec[] {
  return [...(pod.initContainers ?? []), ...(pod.containers ?? []), ...(pod.ephemeralContainers ?? [])];
}

function baseline(pod: Spec, annotations: Record<string, string>): string[] {
  const out: string[] = [];
  const containers = containersOf(pod);
  const contexts = [{ where: "pod", sc: pod.securityContext ?? {} }, ...containers.map((c) => ({ where: c.name, sc: c.securityContext ?? {} }))];
  for (const field of ["hostNetwork", "hostPID", "hostIPC"]) if (pod[field] === true) out.push(`host namespaces: ${field}`);
  for (const { where, sc } of contexts) {
    if (sc.windowsOptions?.hostProcess === true) out.push(`hostProcess: ${where}`);
    if (sc.seccompProfile?.type === "Unconfined") out.push(`seccomp Unconfined: ${where}`);
    if (sc.appArmorProfile?.type === "Unconfined") out.push(`AppArmor Unconfined: ${where}`);
    const selinux = sc.seLinuxOptions;
    if (selinux && (!SELINUX_TYPES.has(selinux.type ?? "") || selinux.user || selinux.role)) out.push(`SELinux options: ${where}`);
  }
  for (const c of containers) {
    const sc = c.securityContext ?? {};
    if (sc.privileged === true) out.push(`privileged: ${c.name}`);
    for (const cap of sc.capabilities?.add ?? []) {
      if (!BASELINE_CAPABILITIES.has(cap)) out.push(`capability ${cap} added: ${c.name}`);
    }
    if (sc.procMount !== undefined && sc.procMount !== "Default") out.push(`procMount ${sc.procMount}: ${c.name}`);
    for (const port of c.ports ?? []) if (port.hostPort) out.push(`hostPort ${port.hostPort}: ${c.name}`);
  }
  for (const volume of pod.volumes ?? []) if (volume.hostPath) out.push(`hostPath volume: ${volume.name}`);
  for (const sysctl of pod.securityContext?.sysctls ?? []) {
    if (!SAFE_SYSCTLS.has(sysctl.name)) out.push(`sysctl ${sysctl.name}`);
  }
  for (const [key, value] of Object.entries(annotations)) {
    if (key.startsWith(APPARMOR_ANNOTATION) && value === "unconfined") out.push(`AppArmor unconfined: ${key.slice(APPARMOR_ANNOTATION.length)}`);
  }
  return out;
}

function restricted(pod: Spec): string[] {
  const out: string[] = [];
  const podSc = pod.securityContext ?? {};
  for (const volume of pod.volumes ?? []) {
    const kind = Object.keys(volume).find((key) => key !== "name");
    if (kind && !RESTRICTED_VOLUME_KINDS.has(kind)) out.push(`volume type ${kind}: ${volume.name}`);
  }
  if (podSc.runAsUser === 0) out.push("runAsUser 0: pod");
  for (const c of containersOf(pod)) {
    const sc = c.securityContext ?? {};
    if (sc.allowPrivilegeEscalation !== false) out.push(`allowPrivilegeEscalation not false: ${c.name}`);
    if ((sc.runAsNonRoot ?? podSc.runAsNonRoot) !== true) out.push(`runAsNonRoot not true: ${c.name}`);
    if (sc.runAsUser === 0) out.push(`runAsUser 0: ${c.name}`);
    const seccomp = sc.seccompProfile?.type ?? podSc.seccompProfile?.type;
    if (seccomp !== "RuntimeDefault" && seccomp !== "Localhost") out.push(`seccomp not RuntimeDefault or Localhost: ${c.name}`);
    if (!(sc.capabilities?.drop ?? []).includes("ALL")) out.push(`capabilities do not drop ALL: ${c.name}`);
    for (const cap of sc.capabilities?.add ?? []) if (cap !== "NET_BIND_SERVICE") out.push(`capability ${cap} added: ${c.name}`);
  }
  return out;
}

export function podSecurityViolations(level: PodSecurityLevel, pod: Spec, annotations: Record<string, string> = {}): string[] {
  if (level === "privileged") return [];
  const out = baseline(pod, annotations);
  return level === "restricted" ? [...out, ...restricted(pod)] : out;
}
