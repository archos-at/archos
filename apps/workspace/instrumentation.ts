import type { Instrumentation } from "next";

const SHUTDOWN_HOOKS_KEY = "__appShutdownHooks";

const registerShutdownHook = (hook: () => Promise<void>): void => {
  const holder = globalThis as Record<string, unknown>;
  const hooks = (holder[SHUTDOWN_HOOKS_KEY] ??= []) as Array<() => Promise<void>>;
  hooks.push(hook);
};

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { requestErrorHandler } = await import("./bff/analytics/request-error");
    await requestErrorHandler()?.(error, request, context);
  } catch (failure) {
    console.error("[posthog] could not report a request error:", failure);
  }
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { bootLine } = await import("./bff/boot");
    // eslint-disable-next-line no-console
    console.log(bootLine());
  } catch (error) {
    console.error("[boot] could not read the boot identity:", error);
  }

  try {
    const { bootstrapPlatformModelDefaults } = await import(
      "./bff/model-config/bootstrap-defaults"
    );
    await bootstrapPlatformModelDefaults();
  } catch (error) {
    console.error("[Model Config] Could not run the platform default bootstrap:", error);
  }

  registerShutdownHook(async () => {
    const { shutdownPosthogServer } = await import("./bff/analytics/posthog-server");
    await shutdownPosthogServer();
  });

  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const { initOtelTraces, shutdownOtelTraces } = await import("./observability/otel-traces.js");
  if (initOtelTraces()) registerShutdownHook(shutdownOtelTraces);

  const { initOtelLogs } = await import("./observability/otel-logs.js");
  initOtelLogs();
}
