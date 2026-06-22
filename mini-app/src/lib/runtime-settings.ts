import type { AlertConfig } from '@/types';

const runtimeSettings: Partial<AlertConfig> = {};

export function getRuntimeSettings(defaults: AlertConfig): AlertConfig {
  return {
    ...defaults,
    ...runtimeSettings,
  };
}

export function updateRuntimeSettings(settings: Partial<AlertConfig>) {
  Object.assign(runtimeSettings, settings);
}
