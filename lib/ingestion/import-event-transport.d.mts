import type { DispatchEvent } from './import-events.ts';
export function validDispatchEvent(value: unknown): boolean;
export function transportConfigured(env?: NodeJS.ProcessEnv): boolean;
export function sendImportEvent(event: DispatchEvent, env?: NodeJS.ProcessEnv): Promise<void>;
