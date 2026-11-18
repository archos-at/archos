import * as pulumi from "@pulumi/pulumi";

export function backendImage(c: { images: ImagesConfig }): string {
  return c.images.backend ?? `${c.images.registry}/grid-oib-backend:${c.images.tag}`;
}

export function frontendImage(c: { images: ImagesConfig }): string {
  return c.images.frontend ?? `${c.images.registry}/grid-oib-frontend:${c.images.tag}`;
}

export function webImage(c: { images: ImagesConfig }): string {
  return c.images.web ?? `${c.images.registry}/grid-oib-web:${c.images.tag}`;
}

export function appPullPolicy(c: { images: ImagesConfig }, image: string): string {
  return c.images.pullPolicyOverride ?? pullPolicyFor(image);
}

export function pullPolicyFor(image: string): string {
  if (image.includes("@sha256:")) return "IfNotPresent"; // digest-pinned = immutable
  const tag = image.split("/").pop()?.split(":")[1];
  return tag === undefined || tag === "latest" ? "Always" : "IfNotPresent";
}

export interface ImagesConfig {
  registry: string;
  tag: string;
  backend?: string;
  frontend?: string;
  web?: string;
  pullPolicyOverride?: string;
  pullCredentials?: { username: string; password: pulumi.Output<string> };
}

export function loadImages(cfg: pulumi.Config): ImagesConfig {
  const imageTag = cfg.get("imageTag") ?? "latest";
  const registryUsername = cfg.get("registryUsername");
  const registryPassword = cfg.getSecret("registryPassword");
  if ((registryUsername === undefined) !== (registryPassword === undefined)) {
    throw new Error(
      "grid-oib:registryUsername and grid-oib:registryPassword must be set together (or neither).",
    );
  }
      return {
    registry: cfg.get("imageRegistry") ?? "ghcr.io/archos-at",
    tag: imageTag,
    backend: cfg.get("backendImage"),
    frontend: cfg.get("frontendImage"),
    web: cfg.get("webImage"),
    pullPolicyOverride: cfg.get("imagePullPolicy"),
    pullCredentials:
      registryUsername && registryPassword
        ? { username: registryUsername, password: registryPassword }
        : undefined,
  };
}
