import { z } from 'zod';

// ─── Shared building blocks ────────────────────────────────────────────────

const OutputFormat = z
	.enum(['toon', 'json'])
	.optional()
	.describe('"toon" (default, 30-60% fewer tokens) or "json"');

const JqFilter = z
	.string()
	.optional()
	.describe(
		'JMESPath expression to filter/transform the response. Strongly recommended to reduce token costs. Example: "values[*].{id: id, title: title}"',
	);

const PaginationFields = {
	limit: z
		.number()
		.int()
		.min(1)
		.max(1000)
		.optional()
		.describe('Maximum number of results to return (default: 25, max: 1000)'),
	start: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Start index for pagination (0-based offset, default: 0)'),
};

/** Cloud: workspace slug. DC: project key. */
const WorkspaceField = z
	.string()
	.min(1)
	.describe(
		'Workspace slug (Bitbucket Cloud) or project key (Bitbucket DC). Example: "myteam" (Cloud) or "MYPROJ" (DC)',
	);

const RepoSlugField = z
	.string()
	.min(1)
	.describe('Repository slug. Example: "my-api"');

const PrIdField = z
	.number()
	.int()
	.positive()
	.describe('Pull request ID (numeric)');

// ─── Read-only tools ───────────────────────────────────────────────────────

/** list_projects — list Cloud workspaces or DC projects */
export const ListProjectsArgs = z.object({
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ListProjectsArgsType = z.infer<typeof ListProjectsArgs>;

/** list_repositories */
export const ListRepositoriesArgs = z.object({
	workspace: WorkspaceField.optional().describe(
		'Workspace slug (Cloud) or project key (DC). Falls back to BITBUCKET_DEFAULT_WORKSPACE env var.',
	),
	query: z
		.string()
		.optional()
		.describe('Filter repositories by name / query string'),
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ListRepositoriesArgsType = z.infer<typeof ListRepositoriesArgs>;

/** list_pull_requests */
export const ListPullRequestsArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	state: z
		.enum(['OPEN', 'MERGED', 'DECLINED', 'ALL'])
		.optional()
		.describe('Filter by PR state (default: OPEN)'),
	author: z
		.string()
		.optional()
		.describe('Filter by author username (exact match)'),
	direction: z
		.enum(['INCOMING', 'OUTGOING'])
		.optional()
		.describe('Filter direction: INCOMING (targeting your branch) or OUTGOING (from your branch)'),
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ListPullRequestsArgsType = z.infer<typeof ListPullRequestsArgs>;

/** get_pull_request */
export const GetPullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type GetPullRequestArgsType = z.infer<typeof GetPullRequestArgs>;

/** get_diff */
export const GetDiffArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	contextLines: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Number of context lines around each change (default: 10)'),
	maxLinesPerFile: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Truncate diff output per file at this many lines (0 = no limit, default: env BITBUCKET_DIFF_MAX_LINES_PER_FILE)'),
	outputFormat: OutputFormat,
});
export type GetDiffArgsType = z.infer<typeof GetDiffArgs>;

/** get_branch_diff — compare two branches directly */
export const GetBranchDiffArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	sourceBranch: z
		.string()
		.min(1)
		.describe('The branch with changes (e.g. "feature/my-feature")'),
	targetBranch: z
		.string()
		.optional()
		.describe('The base branch to compare against (defaults to the repository default branch, e.g. "main")'),
	contextLines: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Number of context lines around each change (default: 10)'),
	maxLinesPerFile: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Truncate diff output per file at this many lines (0 = no limit, default: env BITBUCKET_DIFF_MAX_LINES_PER_FILE)'),
	outputFormat: OutputFormat,
});
export type GetBranchDiffArgsType = z.infer<typeof GetBranchDiffArgs>;

/** get_reviews (PR participants / review status) */
export const GetReviewsArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type GetReviewsArgsType = z.infer<typeof GetReviewsArgs>;

/** get_activities (PR activity / timeline) */
export const GetActivitiesArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type GetActivitiesArgsType = z.infer<typeof GetActivitiesArgs>;

/** get_comments */
export const GetCommentsArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type GetCommentsArgsType = z.infer<typeof GetCommentsArgs>;

/** search — search code across repositories */
export const SearchArgs = z.object({
	query: z.string().min(1).describe('Search query string'),
	type: z
		.enum(['code', 'file'])
		.optional()
		.describe('Search type: "file" = exact filename match; "code" = full-text code search (default: code)'),
	workspace: z
		.string()
		.optional()
		.describe(
			'Limit search to this workspace (Cloud) or project key (DC)',
		),
	repoSlug: z
		.string()
		.optional()
		.describe('Limit search to this repository slug'),
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type SearchArgsType = z.infer<typeof SearchArgs>;

/** get_file_content */
export const GetFileContentArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	path: z
		.string()
		.min(1)
		.describe('File path within the repository. Example: "src/index.ts"'),
	branch: z
		.string()
		.optional()
		.describe('Branch name or commit hash (defaults to default branch)'),
	limit: z
		.number()
		.int()
		.min(1)
		.max(1000)
		.optional()
		.describe('Maximum number of lines to return (default: 100)'),
	start: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Starting line number 0-based (default: 0)'),
	outputFormat: OutputFormat,
});
export type GetFileContentArgsType = z.infer<typeof GetFileContentArgs>;

/** browse_repository */
export const BrowseRepositoryArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	path: z
		.string()
		.optional()
		.describe('Directory path to browse (empty = root)'),
	branch: z.string().optional().describe('Branch or tag name'),
	limit: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe('Maximum number of directory entries to return (default: 50)'),
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type BrowseRepositoryArgsType = z.infer<typeof BrowseRepositoryArgs>;

/** list_branches */
export const ListBranchesArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	filterText: z
		.string()
		.optional()
		.describe('Case-insensitive partial match filter on branch name'),
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ListBranchesArgsType = z.infer<typeof ListBranchesArgs>;

/** list_commits */
export const ListCommitsArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	branch: z
		.string()
		.optional()
		.describe('Branch name or ref (defaults to default branch)'),
	author: z
		.string()
		.optional()
		.describe('Filter commits by author name or email (case-insensitive partial match, applied client-side)'),
	...PaginationFields,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ListCommitsArgsType = z.infer<typeof ListCommitsArgs>;

// ─── Write tools ───────────────────────────────────────────────────────────

/** create_pull_request */
export const CreatePullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	title: z.string().min(1).describe('Pull request title'),
	sourceBranch: z.string().min(1).describe('Source branch name'),
	targetBranch: z.string().min(1).describe('Target/destination branch name'),
	description: z.string().optional().describe('Pull request description'),
	reviewers: z
		.array(z.string())
		.optional()
		.describe('Reviewer usernames or account IDs'),
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type CreatePullRequestArgsType = z.infer<typeof CreatePullRequestArgs>;

/** merge_pull_request */
export const MergePullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	version: z
		.number()
		.int()
		.optional()
		.describe('PR version for optimistic locking (required by some DC versions)'),
	message: z.string().optional().describe('Merge commit message'),
	strategy: z
		.enum(['merge-commit', 'squash', 'fast-forward'])
		.optional()
		.describe('Merge strategy: merge-commit (default), squash, or fast-forward'),
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type MergePullRequestArgsType = z.infer<typeof MergePullRequestArgs>;

/** decline_pull_request */
export const DeclinePullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	version: z
		.number()
		.int()
		.optional()
		.describe('PR version for optimistic locking (DC)'),
	message: z
		.string()
		.optional()
		.describe('Reason for declining the PR, shown to the PR author'),
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type DeclinePullRequestArgsType = z.infer<typeof DeclinePullRequestArgs>;

/** add_comment */
export const AddCommentArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	text: z.string().min(1).describe('Comment text (plain text or markdown)'),
	parentId: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('Parent comment ID to create a threaded reply'),
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type AddCommentArgsType = z.infer<typeof AddCommentArgs>;

/** delete_branch */
export const DeleteBranchArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	branch: z.string().min(1).describe('Branch name to delete'),
});
export type DeleteBranchArgsType = z.infer<typeof DeleteBranchArgs>;

/** approve_pull_request */
export const ApprovePullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
	jq: JqFilter,
	outputFormat: OutputFormat,
});
export type ApprovePullRequestArgsType = z.infer<typeof ApprovePullRequestArgs>;

/** unapprove_pull_request */
export const UnapproveePullRequestArgs = z.object({
	workspace: WorkspaceField,
	repoSlug: RepoSlugField,
	pullRequestId: PrIdField,
});
export type UnapproveePullRequestArgsType = z.infer<
	typeof UnapproveePullRequestArgs
>;
