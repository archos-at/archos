import * as k8s from "@pulumi/kubernetes";
import { DeployConfig } from '../config'
import { logicalName } from "../names";

export function makeProvider(cfg: DeployConfig): k8s.Provider {
  return new k8s.Provider(logicalName("grid-k8s"), {
    kubeconfig: cfg.kubeconfig,
    enableServerSideApply: true,
    enableConfigMapMutable: true,
  });
}
