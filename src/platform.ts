import { invoke } from "@tauri-apps/api/core";

export type HealthStatus = {
  service: string;
  version: string;
};

export async function checkBackendHealth(): Promise<HealthStatus> {
  return invoke<HealthStatus>("health_check");
}
