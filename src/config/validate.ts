/**
 * Hand-rolled, dependency-free validation for the configuration documents.
 *
 * A schema library would work too, but a focused validator keeps the runtime
 * dependency surface small (per the project principles) and produces error
 * messages tailored to devman's domain. Each function narrows `unknown` into a
 * fully-typed, normalised value or throws {@link ConfigInvalidError}.
 */
import { ConfigInvalidError } from '../utils/errors.js';
import type {
  HealthCheckConfig,
  ProfileDefinition,
  RestartConfig,
  RestartPolicy,
  ServiceDefinition,
} from '../types/index.js';

/** Default restart configuration when a service omits `restart`. */
const DEFAULT_RESTART: RestartConfig = {
  policy: 'on-failure',
  maxRetries: 5,
  delayMs: 1000,
};

const RESTART_POLICIES: readonly RestartPolicy[] = ['no', 'on-failure', 'always'];
const HEALTH_TYPES = ['process', 'http', 'tcp'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ConfigInvalidError(message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`Field "${field}" must be a non-empty string.`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(`Field "${field}" must be an array of strings.`);
  }
  return value as string[];
}

function optionalStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) fail(`Field "${field}" must be an object.`);
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== 'string') {
      fail(`Environment variable "${field}.${key}" must be a string.`);
    }
    out[key] = val;
  }
  return out;
}

function parseRestart(value: unknown, serviceId: string): RestartConfig {
  if (value === undefined) return DEFAULT_RESTART;
  if (!isRecord(value)) fail(`"${serviceId}.restart" must be an object.`);

  const policy = value.policy ?? DEFAULT_RESTART.policy;
  if (!RESTART_POLICIES.includes(policy as RestartPolicy)) {
    fail(
      `"${serviceId}.restart.policy" must be one of: ${RESTART_POLICIES.join(', ')}.`,
    );
  }
  const maxRetries = value.maxRetries ?? DEFAULT_RESTART.maxRetries;
  if (typeof maxRetries !== 'number' || maxRetries < 0) {
    fail(`"${serviceId}.restart.maxRetries" must be a non-negative number.`);
  }
  const delayMs = value.delayMs ?? DEFAULT_RESTART.delayMs;
  if (typeof delayMs !== 'number' || delayMs < 0) {
    fail(`"${serviceId}.restart.delayMs" must be a non-negative number.`);
  }
  return { policy: policy as RestartPolicy, maxRetries, delayMs };
}

function parseHealthCheck(
  value: unknown,
  serviceId: string,
): HealthCheckConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`"${serviceId}.healthCheck" must be an object.`);
  const type = value.type;
  if (!HEALTH_TYPES.includes(type as (typeof HEALTH_TYPES)[number])) {
    fail(
      `"${serviceId}.healthCheck.type" must be one of: ${HEALTH_TYPES.join(', ')}.`,
    );
  }
  const check: HealthCheckConfig = {
    type: type as HealthCheckConfig['type'],
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.port === 'number' ? { port: value.port } : {}),
    ...(typeof value.intervalMs === 'number'
      ? { intervalMs: value.intervalMs }
      : {}),
    ...(typeof value.timeoutMs === 'number'
      ? { timeoutMs: value.timeoutMs }
      : {}),
  };
  return check;
}

/** Validate and normalise a single service definition. */
export function parseServiceDefinition(value: unknown): ServiceDefinition {
  if (!isRecord(value)) fail('Each service must be an object.');
  const id = requireString(value.id, 'service.id');
  const healthCheck = parseHealthCheck(value.healthCheck, id);

  return {
    id,
    name: typeof value.name === 'string' && value.name ? value.name : id,
    cwd: typeof value.cwd === 'string' && value.cwd ? value.cwd : '.',
    command: requireString(value.command, `${id}.command`),
    args: optionalStringArray(value.args, `${id}.args`),
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    dependsOn: optionalStringArray(value.dependsOn, `${id}.dependsOn`),
    env: optionalStringRecord(value.env, `${id}.env`),
    restart: parseRestart(value.restart, id),
    ...(healthCheck ? { healthCheck } : {}),
  };
}

/**
 * Validate the top-level `services.json` document. Accepts either an array of
 * services or an object with a `services` array.
 */
export function parseServicesDocument(value: unknown): ServiceDefinition[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.services)
      ? value.services
      : fail('services.json must be an array or an object with a "services" array.');

  const services = list.map(parseServiceDefinition);
  const seen = new Set<string>();
  for (const service of services) {
    if (seen.has(service.id)) {
      fail(`Duplicate service id: "${service.id}".`);
    }
    seen.add(service.id);
  }
  return services;
}

/**
 * Validate the top-level `profiles.json` document. Accepts either a mapping of
 * `{ profileId: string[] }` or an object with a `profiles` array.
 */
export function parseProfilesDocument(value: unknown): ProfileDefinition[] {
  if (value === undefined) return [];
  if (isRecord(value) && !Array.isArray(value.profiles)) {
    return Object.entries(value).map(([id, services]) => ({
      id,
      services: optionalStringArray(services, `profiles.${id}`),
    }));
  }
  if (isRecord(value) && Array.isArray(value.profiles)) {
    return value.profiles.map((entry): ProfileDefinition => {
      if (!isRecord(entry)) fail('Each profile must be an object.');
      return {
        id: requireString(entry.id, 'profile.id'),
        services: optionalStringArray(entry.services, 'profile.services'),
      };
    });
  }
  return fail('profiles.json must be an object mapping profile ids to service ids.');
}
