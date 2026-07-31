/**
 * Configuration loader. Reads and validates `services.json` and (optionally)
 * `profiles.json`, then exposes a small, immutable query API over the result.
 *
 * The loader performs cross-cutting validation that a per-field validator
 * cannot: that every `dependsOn` id and every profile member refers to a real
 * service.
 */
import {
  ConfigNotFoundError,
  DependencyMissingError,
  ServiceNotFoundError,
} from '../utils/errors.js';
import { pathExists, readJsonFile } from '../utils/fs.js';
import type { DevmanPaths } from './paths.js';
import { parseProfilesDocument, parseServicesDocument } from './validate.js';
import type { ProfileDefinition, ServiceDefinition } from '../types/index.js';

/**
 * Immutable, validated view of the configuration. Construct via
 * {@link loadConfig}; the constructor assumes inputs are already validated.
 */
export class DevmanConfig {
  private readonly serviceById: ReadonlyMap<string, ServiceDefinition>;
  private readonly profileById: ReadonlyMap<string, ProfileDefinition>;

  constructor(
    services: readonly ServiceDefinition[],
    profiles: readonly ProfileDefinition[],
  ) {
    this.serviceById = new Map(services.map((s) => [s.id, s]));
    this.profileById = new Map(profiles.map((p) => [p.id, p]));
  }

  /** All services in declaration order. */
  get services(): readonly ServiceDefinition[] {
    return [...this.serviceById.values()];
  }

  /** All profiles in declaration order. */
  get profiles(): readonly ProfileDefinition[] {
    return [...this.profileById.values()];
  }

  /** Whether a service id is known. */
  has(id: string): boolean {
    return this.serviceById.has(id);
  }

  /** Get a service by id or throw {@link ServiceNotFoundError}. */
  getService(id: string): ServiceDefinition {
    const service = this.serviceById.get(id);
    if (!service) throw new ServiceNotFoundError(id);
    return service;
  }

  /** IDs of enabled services, preserving declaration order. */
  enabledServiceIds(): string[] {
    return this.services.filter((s) => s.enabled).map((s) => s.id);
  }

  /**
   * Resolve a profile id to its service ids, or throw if unknown. Unknown
   * profile ids surface as {@link ServiceNotFoundError} for a consistent CLI
   * experience.
   */
  resolveProfile(id: string): string[] {
    const profile = this.profileById.get(id);
    if (!profile) throw new ServiceNotFoundError(id);
    return [...profile.services];
  }
}

/**
 * Validate that every dependency and profile member references a real service.
 * Runs after per-field validation, so all ids are already well-formed strings.
 */
function assertReferentialIntegrity(
  services: readonly ServiceDefinition[],
  profiles: readonly ProfileDefinition[],
): void {
  const ids = new Set(services.map((s) => s.id));
  for (const service of services) {
    for (const dep of service.dependsOn) {
      if (!ids.has(dep)) throw new DependencyMissingError(service.id, dep);
    }
  }
  for (const profile of profiles) {
    for (const member of profile.services) {
      if (!ids.has(member)) {
        throw new DependencyMissingError(`profile:${profile.id}`, member);
      }
    }
  }
}

/**
 * Load and validate configuration from the resolved {@link DevmanPaths}.
 *
 * `services.json` is required; `profiles.json` is optional.
 */
export async function loadConfig(paths: DevmanPaths): Promise<DevmanConfig> {
  if (!(await pathExists(paths.servicesFile))) {
    throw new ConfigNotFoundError(paths.servicesFile);
  }

  const services = parseServicesDocument(
    await readJsonFile<unknown>(paths.servicesFile),
  );

  const profiles = (await pathExists(paths.profilesFile))
    ? parseProfilesDocument(await readJsonFile<unknown>(paths.profilesFile))
    : [];

  assertReferentialIntegrity(services, profiles);
  return new DevmanConfig(services, profiles);
}
