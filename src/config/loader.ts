/**
 * Configuration loader. Reads and validates `services.json` and (optionally)
 * `profiles.json`, then exposes a small, immutable query API over the result.
 *
 * The loader performs cross-cutting validation that a per-field validator
 * cannot: that every `dependsOn` id and every profile member refers to a real
 * service.
 */
import {
  ConfigInvalidError,
  ConfigNotFoundError,
  DependencyMissingError,
  ServiceNotFoundError,
} from '../utils/errors.js';
import { pathExists, readJsonFile } from '../utils/fs.js';
import { DependencyGraph } from '../service/dependencyGraph.js';
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
 * Read and parse a config JSON file, wrapping a malformed-JSON failure as a
 * {@link ConfigInvalidError} so every config problem — schema, references, or
 * syntax — surfaces through the same hinted, exit-code-1 path.
 */
async function readConfigJson<T>(path: string): Promise<T> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigInvalidError(
        `${path} is not valid JSON: ${error.message}`,
        error,
      );
    }
    throw error;
  }
}

/**
 * Load and validate configuration from the resolved {@link DevmanPaths}.
 *
 * `services.json` is required; `profiles.json` is optional. Validation
 * includes the dependency graph (a cycle throws {@link DependencyCycleError}
 * here, not only when `start` walks it), so `doctor` catches it too.
 */
export async function loadConfig(paths: DevmanPaths): Promise<DevmanConfig> {
  if (!(await pathExists(paths.servicesFile))) {
    throw new ConfigNotFoundError(paths.servicesFile);
  }

  const services = parseServicesDocument(
    await readConfigJson<unknown>(paths.servicesFile),
  );

  const profiles = (await pathExists(paths.profilesFile))
    ? parseProfilesDocument(await readConfigJson<unknown>(paths.profilesFile))
    : [];

  assertReferentialIntegrity(services, profiles);
  // Throws DependencyCycleError if dependsOn edges form a cycle.
  new DependencyGraph(services).startOrder();
  return new DevmanConfig(services, profiles);
}
