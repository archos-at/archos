import * as k8s from "@pulumi/kubernetes";

export function hardenedContainerSecurityContext(): k8s.types.input.core.v1.SecurityContext {
  return {
    allowPrivilegeEscalation: false,
    privileged: false,
    capabilities: { drop: ["ALL"] },
    seccompProfile: { type: "RuntimeDefault" },
  };
}

export function hardenedJobSecurityContext(): k8s.types.input.core.v1.SecurityContext {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    seccompProfile: { type: "RuntimeDefault" },
  };
}
