/** Barrel re-export for the configuration module. */
export { resolvePaths } from './paths.js';
export type { DevmanPaths, ResolvePathsOptions } from './paths.js';
export { DevmanConfig, loadConfig } from './loader.js';
export {
  parseServicesDocument,
  parseProfilesDocument,
  parseServiceDefinition,
} from './validate.js';
