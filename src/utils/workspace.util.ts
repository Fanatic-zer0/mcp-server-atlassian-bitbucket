import { Logger } from './logger.util.js';
import { config } from './config.util.js';
import { isDataCenterMode } from './transport.util.js';
import atlassianWorkspacesService from '../services/vendor.atlassian.workspaces.service.js';
import { WorkspaceMembership } from '../services/vendor.atlassian.workspaces.types.js';

const workspaceLogger = Logger.forContext('utils/workspace.util.ts');

/**
 * Cache for workspace data to avoid repeated API calls
 */
let cachedDefaultWorkspace: string | null = null;
let cachedWorkspaces: WorkspaceMembership[] | null = null;

/**
 * Get the default workspace slug
 *
 * This function follows this priority:
 * 1. Use cached value if available
 * 2. Check BITBUCKET_DEFAULT_WORKSPACE environment variable
 * 3. Fetch from API and use the first workspace in the list
 *
 * @returns {Promise<string|null>} The default workspace slug or null if not available
 */
export async function getDefaultWorkspace(): Promise<string | null> {
	const methodLogger = workspaceLogger.forMethod('getDefaultWorkspace');

	// Step 1: Return cached value if available
	if (cachedDefaultWorkspace) {
		methodLogger.debug(
			`Using cached default workspace: ${cachedDefaultWorkspace}`,
		);
		return cachedDefaultWorkspace;
	}

	// Step 2: Check environment variable
	const envWorkspace = config.get('BITBUCKET_DEFAULT_WORKSPACE');
	if (envWorkspace) {
		methodLogger.debug(
			`Using default workspace from environment: ${envWorkspace}`,
		);
		cachedDefaultWorkspace = envWorkspace;
		return envWorkspace;
	}

	// Step 3: Fetch from API (Cloud only – DC has projects, not workspaces).
	// In Data Center mode the user must configure BITBUCKET_DEFAULT_WORKSPACE
	// with the project key manually.
	if (isDataCenterMode()) {
		methodLogger.debug(
			'Data Center mode: cannot auto-discover projects. ' +
				'Set BITBUCKET_DEFAULT_WORKSPACE to your Bitbucket DC project key.',
		);
		return null;
	}

	// Step 3: Fetch from API
	methodLogger.debug('No default workspace configured, fetching from API...');
	try {
		const workspaces = await getWorkspaces();

		if (workspaces.length > 0) {
			const defaultWorkspace = workspaces[0].workspace.slug;
			methodLogger.debug(
				`Using first workspace from API as default: ${defaultWorkspace}`,
			);
			cachedDefaultWorkspace = defaultWorkspace;
			return defaultWorkspace;
		} else {
			methodLogger.warn('No workspaces found in the account');
			return null;
		}
	} catch (error) {
		methodLogger.error('Failed to fetch default workspace', error);
		return null;
	}
}

/**
 * Get list of workspaces from API or cache
 *
 * @returns {Promise<WorkspaceMembership[]>} Array of workspace membership objects
 */
export async function getWorkspaces(): Promise<WorkspaceMembership[]> {
	const methodLogger = workspaceLogger.forMethod('getWorkspaces');

	if (cachedWorkspaces) {
		methodLogger.debug(
			`Using ${cachedWorkspaces.length} cached workspaces`,
		);
		return cachedWorkspaces;
	}

	try {
		const result = await atlassianWorkspacesService.list({
			pagelen: 10, // Limit to first 10 workspaces
		});

		if (result.values) {
			cachedWorkspaces = result.values;
			methodLogger.debug(`Cached ${result.values.length} workspaces`);
			return result.values;
		} else {
			return [];
		}
	} catch (error) {
		methodLogger.error('Failed to fetch workspaces list', error);
		return [];
	}
}
