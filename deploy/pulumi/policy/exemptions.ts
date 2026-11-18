export const UPSTREAM_SOAK_EXEMPT: Record<string, string> = {
  "rabbitmq-cluster-operator":
    "Reconciles RabbitmqCluster objects and serves nothing (deploy/pulumi/src/platform/rabbitmq.ts); " +
    "the brokers keep serving while it restarts.",
};
