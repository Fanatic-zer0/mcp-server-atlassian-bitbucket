import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import { truncateForAI } from '../utils/formatter.util.js';
import { isDataCenterMode } from '../utils/transport.util.js';
import { isReadOnlyMode, createReadOnlyError } from '../utils/readonly.util.js';
import { getDefaultWorkspace } from '../utils/workspace.util.js';
import { config } from '../utils/config.util.js';
import {
	handleGet,
	handlePost,
	handleDelete,
} from '../controllers/atlassian.api.controller.js';
import {
	ListProjectsArgs,
	type ListProjectsArgsType,
	ListRepositoriesArgs,
	type ListRepositoriesArgsType,
	ListPullRequestsArgs,
	type ListPullRequestsArgsType,
	GetPullRequestArgs,
	type GetPullRequestArgsType,
	GetDiffArgs,
	type GetDiffArgsType,
	GetBranchDiffArgs,
	type GetBranchDiffArgsType,
	GetReviewsArgs,
	type GetReviewsArgsType,
	GetActivitiesArgs,
	type GetActivitiesArgsType,
	GetCommentsArgs,
	type GetCommentsArgsType,
	SearchArgs,
	type SearchArgsType,
	GetFileContentArgs,
	type GetFileContentArgsType,
	BrowseRepositoryArgs,
	type BrowseRepositoryArgsType,
	ListBranchesArgs,
	type ListBranchesArgsType,
	ListCommitsArgs,
	type ListCommitsArgsType,
	CreatePullRequestArgs,
	type CreatePullRequestArgsType,
	MergePullRequestArgs,
	type MergePullRequestArgsType,
	DeclinePullRequestArgs,
	type DeclinePullRequestArgsType,
	AddCommentArgs,
	type AddCommentArgsType,
	DeleteBranchArgs,
	type DeleteBranchArgsType,
	ApprovePullRequestArgs,
	type ApprovePullRequestArgsType,
	UnapproveePullRequestArgs,
	type UnapproveePullRequestArgsType,
} from './bitbucket.types.js';

const logger = Logger.forContext('tools/bitbucket.tools.ts');

logger.debug('Bitbucket named tools initialized');

// ─── Path builder helpers ──────────────────────────────────────────────────

/** Base path to a single repository. */
function repoBase(workspace: string, slug: string): string {
	return isDataCenterMode()
		? `/projects/${workspace}/repos/${slug}`
		: `/repositories/${workspace}/${slug}`;
}

/** Path to the PR collection or a single PR. */
function prBase(workspace: string, slug: string, id?: number): string {
	const base = repoBase(workspace, slug);
	const seg = isDataCenterMode() ? 'pull-requests' : 'pullrequests';
	return id !== undefined ? `${base}/${seg}/${id}` : `${base}/${seg}`;
}

/** Branches collection path — differs between Cloud and DC. */
function branchesBase(workspace: string, slug: string): string {
	const base = repoBase(workspace, slug);
	return isDataCenterMode() ? `${base}/branches` : `${base}/refs/branches`;
}

/** File source/browse path for reading file content. */
function filePath(workspace: string, slug: string, path: string, branch?: string): string {
	if (isDataCenterMode()) {
		// DC: /projects/{key}/repos/{slug}/browse/{path}?at={branch}
		const cleanPath = path.startsWith('/') ? path.slice(1) : path;
		return `${repoBase(workspace, slug)}/browse/${cleanPath}`;
	}
	// Cloud: /repositories/{ws}/{slug}/src/{ref}/{path}
	const ref = branch ?? 'HEAD';
	const cleanPath = path.startsWith('/') ? path.slice(1) : path;
	return `/repositories/${workspace}/${slug}/src/${ref}/${cleanPath}`;
}

/** Repository browse (directory listing) path. */
function browsePath(workspace: string, slug: string, path?: string, branch?: string): string {
	if (isDataCenterMode()) {
		const cleanPath = path ? (path.startsWith('/') ? path.slice(1) : path) : '';
		return cleanPath
			? `${repoBase(workspace, slug)}/browse/${cleanPath}`
			: `${repoBase(workspace, slug)}/browse`;
	}
	// Cloud src endpoint - ref/path optional
	const ref = branch ?? 'HEAD';
	const cleanPath = path ? (path.startsWith('/') ? path.slice(1) : path) : '';
	return cleanPath
		? `/repositories/${workspace}/${slug}/src/${ref}/${cleanPath}/`
		: `/repositories/${workspace}/${slug}/src/${ref}/`;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

type ControllerResponse = { content: string; rawResponsePath?: string | null };
type McpTextResponse = { content: Array<{ type: 'text'; text: string }> };

function toMcpResponse(result: ControllerResponse): McpTextResponse {
	return {
		content: [{ type: 'text' as const, text: truncateForAI(result.content, result.rawResponsePath) }],
	};
}

/**
 * Builds pagination query params from unified limit/start values.
 * DC passes limit+start directly; Cloud maps to pagelen+page (1-based).
 */
function buildPaginationParams(
	limit?: number,
	start?: number,
): Record<string, string> {
	const qp: Record<string, string> = {};
	if (isDataCenterMode()) {
		if (limit !== undefined) qp['limit'] = String(limit);
		if (start !== undefined) qp['start'] = String(start);
	} else {
		if (limit !== undefined) qp['pagelen'] = String(limit);
		if (limit !== undefined && start !== undefined && start > 0) {
			qp['page'] = String(Math.floor(start / limit) + 1);
		}
	}
	return qp;
}

/**
 * Applies per-file line truncation to unified diff output.
 * Preserves diff headers; shows first 60 % + last 40 % of allowed lines.
 */
function applyMaxLinesPerFile(diffContent: string, maxLines: number): string {
	if (maxLines <= 0) return diffContent;
	const sections = diffContent.split(/(?=^diff )/m);
	return sections
		.map((section) => {
			const lines = section.split('\n');
			if (lines.length <= maxLines) return section;
			const keep60 = Math.floor(maxLines * 0.6);
			const keep40 = maxLines - keep60;
			return [
				...lines.slice(0, keep60),
				`... [TRUNCATED: ${lines.length} lines total, showing first ${keep60} and last ${keep40} of ${maxLines} limit] ...`,
				...lines.slice(Math.max(keep60, lines.length - keep40)),
			].join('\n');
		})
		.join('');
}

// ─── Read-only tool handlers ───────────────────────────────────────────────

async function listProjects(args: ListProjectsArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	const path = isDataCenterMode() ? '/projects' : '/workspaces';
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function listRepositories(args: ListRepositoriesArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	if (args.query) {
		isDataCenterMode() ? (qp['name'] = args.query) : (qp['q'] = `name ~ "${args.query}"`);
	}

	// Resolve workspace: explicit arg > env default > Cloud API discovery
	let workspace = args.workspace;
	if (!workspace) {
		workspace = (await getDefaultWorkspace()) ?? undefined;
	}
	if (!workspace) {
		return {
			content: [{
				type: 'text' as const,
				text: 'Error: workspace is required. Provide it as a parameter or set BITBUCKET_DEFAULT_WORKSPACE.',
			}],
		};
	}

	const path = isDataCenterMode()
		? `/projects/${workspace}/repos`
		: `/repositories/${workspace}`;

	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function listPullRequests(args: ListPullRequestsArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	if (args.state && args.state !== 'ALL') qp['state'] = args.state;
	if (args.author) qp['author.name'] = args.author;
	if (args.direction) qp['direction'] = args.direction;

	const path = prBase(args.workspace, args.repoSlug);
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function getPullRequest(args: GetPullRequestArgsType): Promise<McpTextResponse> {
	const path = prBase(args.workspace, args.repoSlug, args.pullRequestId);
	const result = await handleGet({ path, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function getDiff(args: GetDiffArgsType): Promise<McpTextResponse> {
	const qp: Record<string, string> = {};
	if (args.contextLines !== undefined) {
		isDataCenterMode()
			? (qp['contextLines'] = String(args.contextLines))
			: (qp['context_lines'] = String(args.contextLines));
	}
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/diff`;
	// Diff is plain text — use json to avoid double-processing by TOON formatter
	const result = await handleGet({ path, queryParams: qp, outputFormat: args.outputFormat ?? 'json' });

	// Apply per-file truncation if requested (or from env)
	const envMax = config.get('BITBUCKET_DIFF_MAX_LINES_PER_FILE');
	const maxLines = args.maxLinesPerFile ?? (envMax ? parseInt(envMax, 10) : 0);
	if (maxLines > 0) {
		result.content = applyMaxLinesPerFile(result.content, maxLines);
	}
	return toMcpResponse(result);
}

async function getBranchDiff(args: GetBranchDiffArgsType): Promise<McpTextResponse> {
	const qp: Record<string, string> = {};
	if (args.contextLines !== undefined) {
		isDataCenterMode()
			? (qp['contextLines'] = String(args.contextLines))
			: (qp['context_lines'] = String(args.contextLines));
	}

	let path: string;
	if (isDataCenterMode()) {
		// DC: /projects/{key}/repos/{slug}/compare/diff?from={source}&to={target}
		path = `${repoBase(args.workspace, args.repoSlug)}/compare/diff`;
		qp['from'] = args.sourceBranch;
		if (args.targetBranch) qp['to'] = args.targetBranch;
	} else {
		// Cloud: /repositories/{ws}/{slug}/diff/{source}..{target}
		const spec = args.targetBranch
			? `${encodeURIComponent(args.sourceBranch)}..${encodeURIComponent(args.targetBranch)}`
			: encodeURIComponent(args.sourceBranch);
		path = `/repositories/${args.workspace}/${args.repoSlug}/diff/${spec}`;
	}

	const result = await handleGet({ path, queryParams: qp, outputFormat: args.outputFormat ?? 'json' });

	// Apply per-file truncation
	const envMax = config.get('BITBUCKET_DIFF_MAX_LINES_PER_FILE');
	const maxLines = args.maxLinesPerFile ?? (envMax ? parseInt(envMax, 10) : 0);
	if (maxLines > 0) {
		result.content = applyMaxLinesPerFile(result.content, maxLines);
	}
	return toMcpResponse(result);
}

async function getReviews(args: GetReviewsArgsType): Promise<McpTextResponse> {
	// Cloud: /pullrequests/{id}/participants  |  DC: /pull-requests/{id}/participants
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/participants`;
	const result = await handleGet({ path, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function getActivities(args: GetActivitiesArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	// Cloud: /pullrequests/{id}/activity  |  DC: /pull-requests/{id}/activities
	const subpath = isDataCenterMode() ? 'activities' : 'activity';
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/${subpath}`;
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function getComments(args: GetCommentsArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/comments`;
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function search(args: SearchArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);

	// When type='file', wrap the query in quotes for exact filename matching
	const rawQuery = args.type === 'file' ? `"${args.query}"` : args.query;

	let path: string;
	if (isDataCenterMode()) {
		// DC: /rest/search/1.0/search bypasses the /rest/api/1.0 auto-prefix
		path = '/rest/search/1.0/search';
		qp['searchString'] = rawQuery;
		if (args.workspace) qp['projectKey'] = args.workspace;
		if (args.repoSlug && args.workspace) qp['repositorySlug'] = args.repoSlug;
	} else {
		// Cloud: /search/code?search_query=...
		path = '/search/code';
		let q = rawQuery;
		if (args.repoSlug && args.workspace) {
			q += ` repo:${args.workspace}/${args.repoSlug}`;
		}
		qp['search_query'] = q;
	}

	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function getFileContent(args: GetFileContentArgsType): Promise<McpTextResponse> {
	const qp: Record<string, string> = {};
	if (isDataCenterMode()) {
		if (args.branch) qp['at'] = args.branch;
		if (args.limit !== undefined) qp['limit'] = String(args.limit);
		if (args.start !== undefined) qp['start'] = String(args.start);
	}
	const path = filePath(args.workspace, args.repoSlug, args.path, args.branch);
	// Return raw content — json outputFormat preserves text as-is
	const result = await handleGet({ path, queryParams: qp, outputFormat: args.outputFormat ?? 'json' });
	return toMcpResponse(result);
}

async function browseRepository(args: BrowseRepositoryArgsType): Promise<McpTextResponse> {
	const qp: Record<string, string> = {};
	if (isDataCenterMode() && args.branch) qp['at'] = args.branch;
	if (args.limit !== undefined) {
		isDataCenterMode()
			? (qp['limit'] = String(args.limit))
			: (qp['pagelen'] = String(args.limit));
	}
	const path = browsePath(args.workspace, args.repoSlug, args.path, args.branch);
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function listBranches(args: ListBranchesArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	if (args.filterText) {
		isDataCenterMode()
			? (qp['filterText'] = args.filterText)
			: (qp['q'] = `name ~ "${args.filterText}"`);
	}
	const path = branchesBase(args.workspace, args.repoSlug);
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function listCommits(args: ListCommitsArgsType): Promise<McpTextResponse> {
	const qp = buildPaginationParams(args.limit, args.start);
	if (args.branch) {
		isDataCenterMode() ? (qp['until'] = args.branch) : (qp['include'] = args.branch);
	}
	const path = `${repoBase(args.workspace, args.repoSlug)}/commits`;
	const result = await handleGet({ path, queryParams: qp, jq: args.jq, outputFormat: args.outputFormat });

	// author filtering is applied client-side by examining the response text
	if (args.author) {
		const authorLower = args.author.toLowerCase();
		try {
			const parsed = JSON.parse(result.content);
			if (parsed?.values && Array.isArray(parsed.values)) {
				parsed.values = parsed.values.filter((c: Record<string, unknown>) => {
					const a = (c.author ?? c.committer) as Record<string, string> | undefined;
					const name = (a?.name ?? a?.displayName ?? a?.emailAddress ?? '').toLowerCase();
					return name.includes(authorLower);
				});
				result.content = JSON.stringify(parsed);
			}
		} catch {
			// response is TOON or not JSON — skip client-side filtering
		}
	}

	return toMcpResponse(result);
}

// ─── Write tool handlers ───────────────────────────────────────────────────

async function createPullRequest(args: CreatePullRequestArgsType): Promise<McpTextResponse> {
	const path = prBase(args.workspace, args.repoSlug);

	let body: Record<string, unknown>;
	if (isDataCenterMode()) {
		body = {
			title: args.title,
			description: args.description ?? '',
			fromRef: {
				id: `refs/heads/${args.sourceBranch}`,
				repository: {
					slug: args.repoSlug,
					project: { key: args.workspace },
				},
			},
			toRef: {
				id: `refs/heads/${args.targetBranch}`,
				repository: {
					slug: args.repoSlug,
					project: { key: args.workspace },
				},
			},
			...(args.reviewers && args.reviewers.length > 0
				? { reviewers: args.reviewers.map((u: string) => ({ user: { name: u } })) }
				: {}),
		};
	} else {
		body = {
			title: args.title,
			description: args.description ?? '',
			source: { branch: { name: args.sourceBranch } },
			destination: { branch: { name: args.targetBranch } },
			...(args.reviewers && args.reviewers.length > 0
				? { reviewers: args.reviewers.map((u: string) => ({ uuid: u })) }
				: {}),
		};
	}

	const result = await handlePost({ path, body, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function mergePullRequest(args: MergePullRequestArgsType): Promise<McpTextResponse> {
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/merge`;

	const body: Record<string, unknown> = {};
	if (args.version !== undefined) body['version'] = args.version;
	if (args.message) body['message'] = args.message;

	if (args.strategy) {
		if (isDataCenterMode()) {
			// DC squash-like: autoSubject uses PR title+description as commit message
			if (args.strategy === 'squash') body['autoSubject'] = true;
		} else {
			// Cloud strategy: map hyphenated names to underscore API values
			const strategyMap: Record<string, string> = {
				'merge-commit': 'merge_commit',
				'squash': 'squash',
				'fast-forward': 'fast_forward',
			};
			body['merge_strategy'] = strategyMap[args.strategy] ?? 'merge_commit';
		}
	}

	const result = await handlePost({ path, body, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function declinePullRequest(args: DeclinePullRequestArgsType): Promise<McpTextResponse> {
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/decline`;

	const body: Record<string, unknown> = {};
	if (isDataCenterMode() && args.version !== undefined) body['version'] = args.version;
	if (args.message) {
		isDataCenterMode()
			? (body['comment'] = args.message)
			: (body['reason'] = args.message);
	}

	const result = await handlePost({ path, body, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function addComment(args: AddCommentArgsType): Promise<McpTextResponse> {
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/comments`;

	// Cloud uses nested content object; DC uses flat text property
	const body: Record<string, unknown> = isDataCenterMode()
		? { text: args.text }
		: { content: { raw: args.text } };

	// Threaded reply: attach parent comment ID
	if (args.parentId !== undefined) {
		body['parent'] = { id: args.parentId };
	}

	const result = await handlePost({ path, body, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function deleteBranch(args: DeleteBranchArgsType): Promise<McpTextResponse> {
	if (isDataCenterMode()) {
		// DC branch deletion uses the branch-utils sub-API with a DELETE + body
		const path = `/rest/branch-utils/1.0/projects/${args.workspace}/repos/${args.repoSlug}/branches`;
		const body = { name: `refs/heads/${args.branch}`, dryRun: false };
		const dcResult = await handlePost({ path, body });
		return toMcpResponse(dcResult);
	} else {
		// Cloud: DELETE /repositories/{ws}/{slug}/refs/branches/{encodedName}
		const encodedName = encodeURIComponent(args.branch);
		const path = `${branchesBase(args.workspace, args.repoSlug)}/${encodedName}`;
		const result = await handleDelete({ path });
		return toMcpResponse(result);
	}
}

async function approvePullRequest(args: ApprovePullRequestArgsType): Promise<McpTextResponse> {
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/approve`;
	const result = await handlePost({ path, body: {}, jq: args.jq, outputFormat: args.outputFormat });
	return toMcpResponse(result);
}

async function unapproveePullRequest(args: UnapproveePullRequestArgsType): Promise<McpTextResponse> {
	const path = `${prBase(args.workspace, args.repoSlug, args.pullRequestId)}/approve`;
	const result = await handleDelete({ path });
	return toMcpResponse(result);
}

// ─── Read-only guard helper ────────────────────────────────────────────────

function writeGuard<T>(handler: (args: T) => Promise<McpTextResponse>) {
	return async (args: T): Promise<McpTextResponse> => {
		if (isReadOnlyMode()) return createReadOnlyError();
		return handler(args);
	};
}

// ─── Tool registration ─────────────────────────────────────────────────────

function registerTools(server: McpServer): void {
	logger.debug('Registering Bitbucket named tools...');

	// ── Read-only tools ──────────────────────────────────────────────────

	server.registerTool(
		'list_projects',
		{
			title: 'List Projects / Workspaces',
			description:
				'List all Bitbucket Cloud workspaces or Bitbucket DC projects accessible with the current credentials. ' +
				'Use `jq` to reduce token costs (e.g. `"values[*].{key: key, name: name}"`). ' +
				'Paginate with `limit` (max items, default 25) and `start` (0-based offset, default 0).',
			inputSchema: ListProjectsArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await listProjects(args as ListProjectsArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'list_repositories',
		{
			title: 'List Repositories',
			description:
				'List repositories in a workspace (Cloud) or project (DC). ' +
				'`workspace` is optional — falls back to BITBUCKET_DEFAULT_WORKSPACE if not provided. ' +
				'Optional `query` filters by repository name. ' +
				'Use `jq` to reduce token costs (e.g. `"values[*].{slug: slug, name: name}"`). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: ListRepositoriesArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await listRepositories(args as ListRepositoriesArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'list_pull_requests',
		{
			title: 'List Pull Requests',
			description:
				'List pull requests for a repository. `workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Filter by `state` (OPEN, MERGED, DECLINED, ALL; default OPEN), `author` (exact username), ' +
				'and `direction` (INCOMING = PRs targeting this repo; OUTGOING = PRs from this repo; default INCOMING). ' +
				'Use `jq` to reduce token costs (e.g. `"values[*].{id: id, title: title, state: state}"`). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: ListPullRequestsArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await listPullRequests(args as ListPullRequestsArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_pull_request',
		{
			title: 'Get Pull Request',
			description:
				'Get details of a specific pull request including title, description, author, reviewers, ' +
				'source/destination branches, and status. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC).',
			inputSchema: GetPullRequestArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getPullRequest(args as GetPullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_diff',
		{
			title: 'Get Pull Request Diff',
			description:
				'Get the unified diff for a pull request showing exactly what was added, removed, or modified. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Use `contextLines` to control context around each change (default: 10). ' +
				'Use `maxLinesPerFile` to truncate large files (shows first 60 % + last 40 % of the allowed lines). ' +
				'Falls back to BITBUCKET_DIFF_MAX_LINES_PER_FILE env var if maxLinesPerFile is not provided.',
			inputSchema: GetDiffArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getDiff(args as GetDiffArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_branch_diff',
		{
			title: 'Get Branch Diff',
			description:
				'Get the unified diff between two branches to see exactly what changed. ' +
				'`sourceBranch` is the branch with your changes (e.g. "feature/my-feature"). ' +
				'`targetBranch` is the base to compare against (e.g. "main"; defaults to the repo default branch). ' +
				'Use `contextLines` to control context lines around each change (default: 10). ' +
				'Use `maxLinesPerFile` to truncate large files (shows first 60% + last 40% of the allowed lines). ' +
				'Works for both Bitbucket Cloud and Data Center.',
			inputSchema: GetBranchDiffArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getBranchDiff(args as GetBranchDiffArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_reviews',
		{
			title: 'Get Pull Request Reviews',
			description:
				'Get the review/approval status of a pull request — lists all participants, ' +
				'their roles (Author, Reviewer), and approval status (APPROVED, NEEDS_WORK, UNAPPROVED). ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC).',
			inputSchema: GetReviewsArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getReviews(args as GetReviewsArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_activities',
		{
			title: 'Get Pull Request Activity',
			description:
				'Get the full activity timeline for a pull request — includes comments, approvals, ' +
				'rescoped updates, commits added, and merge/decline events. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: GetActivitiesArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getActivities(args as GetActivitiesArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_comments',
		{
			title: 'Get Pull Request Comments',
			description:
				'Get all comments on a pull request, including inline code comments and general PR comments. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: GetCommentsArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getComments(args as GetCommentsArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'search',
		{
			title: 'Search Code',
			description:
				'Search for code and files across repositories. On Cloud uses the Bitbucket code-search API. ' +
				'On DC uses the Search Plugin API (`/rest/search/1.0/search`). Note: DC search only covers default branches. ' +
				'Use `type="file"` to match exact filenames; `type="code"` (default) for full-text search. ' +
				'Scope with `workspace` (project key) and/or `repoSlug`. ' +
				'Use `jq` to reduce token costs. Paginate with `limit` and `start`.',
			inputSchema: SearchArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await search(args as SearchArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'get_file_content',
		{
			title: 'Get File Content',
			description:
				'Retrieve the raw content of a file from a repository. ' +
				'`path` is the file path within the repository (e.g. `"src/index.ts"`). ' +
				'Optionally specify a `branch` or commit hash (defaults to the default branch). ' +
				'For large files use `limit` (max lines per request, default 100) and `start` (0-based line offset) to paginate. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC).',
			inputSchema: GetFileContentArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await getFileContent(args as GetFileContentArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'browse_repository',
		{
			title: 'Browse Repository',
			description:
				'List files and directories in a repository at a given path. ' +
				'Leave `path` empty to browse the root. Optionally specify a `branch` or tag. ' +
				'Use `limit` to control how many items are returned (default 50). ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Use `jq` to extract just file names (e.g. `"values[*].path.toString"` on Cloud or `"values[*].path.components"` on DC).',
			inputSchema: BrowseRepositoryArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await browseRepository(args as BrowseRepositoryArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'list_branches',
		{
			title: 'List Branches',
			description:
				'List branches in a repository. Optional `filterText` narrows by name (case-insensitive partial match). ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Use `jq` to reduce token costs (e.g. `"values[*].displayId"` on DC or `"values[*].name"` on Cloud). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: ListBranchesArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await listBranches(args as ListBranchesArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'list_commits',
		{
			title: 'List Commits',
			description:
				'List commits in a repository, optionally scoped to a specific branch or ref. ' +
				'Use `author` to filter by author name or email (case-insensitive partial match, applied client-side). ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'Use `jq` for token efficiency (e.g. `"values[*].{hash: hash, message: message}"`). ' +
				'Paginate with `limit` and `start`.',
			inputSchema: ListCommitsArgs.shape,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await listCommits(args as ListCommitsArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	// ── Write tools (skipped entirely in read-only mode) ─────────────────

	if (isReadOnlyMode()) {
		logger.info(
			'BITBUCKET_READ_ONLY=true — write tools are disabled and will not be registered',
		);
		return;
	}

	server.registerTool(
		'create_pull_request',
		{
			title: 'Create Pull Request',
			description:
				'Create a new pull request. `workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'`sourceBranch` is the feature branch; `targetBranch` is the destination (e.g. "main" or "master"). ' +
				'Optional `reviewers`: for Cloud, provide account IDs (UUIDs); for DC, provide usernames.',
			inputSchema: CreatePullRequestArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(createPullRequest)(args as CreatePullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'merge_pull_request',
		{
			title: 'Merge Pull Request',
			description:
				'Merge an open pull request. `workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'On DC, include `version` (from `get_pull_request`) to satisfy optimistic locking. ' +
				'Use `strategy` to choose how the merge is applied: "merge-commit" (default), "squash", or "fast-forward". ' +
				'Optional `message` overrides the default merge commit message.',
			inputSchema: MergePullRequestArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(mergePullRequest)(args as MergePullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'decline_pull_request',
		{
			title: 'Decline Pull Request',
			description:
				'Decline (reject) an open pull request. `workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'On Bitbucket DC, include `version` (from `get_pull_request`) to satisfy optimistic locking. ' +
				'Use `message` to provide a reason visible to the PR author.',
			inputSchema: DeclinePullRequestArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(declinePullRequest)(args as DeclinePullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'add_comment',
		{
			title: 'Add PR Comment',
			description:
				'Add a general comment to a pull request. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'`text` supports Markdown on Cloud; plain text on DC. ' +
				'Use `parentId` to reply to an existing comment (for threaded conversations). ' +
				'For inline code comments anchored to a specific file/line, use the raw API directly.',
			inputSchema: AddCommentArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(addComment)(args as AddCommentArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'delete_branch',
		{
			title: 'Delete Branch',
			description:
				'Delete a branch from a repository. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC). ' +
				'WARNING: This action is irreversible.',
			inputSchema: DeleteBranchArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(deleteBranch)(args as DeleteBranchArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'approve_pull_request',
		{
			title: 'Approve Pull Request',
			description:
				'Approve a pull request as the currently authenticated user. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC).',
			inputSchema: ApprovePullRequestArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(approvePullRequest)(args as ApprovePullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	server.registerTool(
		'unapprove_pull_request',
		{
			title: 'Unapprove Pull Request',
			description:
				'Remove your approval from a pull request. ' +
				'`workspace` is the workspace slug (Cloud) or project key (DC).',
			inputSchema: UnapproveePullRequestArgs.shape,
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async (args: Record<string, unknown>) => {
			try {
				return await writeGuard(unapproveePullRequest)(args as UnapproveePullRequestArgsType);
			} catch (e) {
				return formatErrorForMcpTool(e);
			}
		},
	);

	logger.debug('All Bitbucket named tools registered');
}

export default { registerTools };
