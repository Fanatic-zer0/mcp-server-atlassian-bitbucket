import { config } from './config.util.js';

/**
 * Returns true when BITBUCKET_READ_ONLY=true is set.
 * In read-only mode only safe, non-modifying operations are available.
 */
export function isReadOnlyMode(): boolean {
	return config.get('BITBUCKET_READ_ONLY') === 'true';
}

/**
 * Returns a standardised MCP error response for write operations
 * that are blocked by read-only mode.
 */
export function createReadOnlyError(): {
	content: Array<{ type: 'text'; text: string }>;
	isError: boolean;
} {
	return {
		content: [
			{
				type: 'text' as const,
				text:
					'Error: This operation is not permitted in read-only mode (BITBUCKET_READ_ONLY=true).\n' +
					'Only safe, non-modifying tools are available. ' +
					'Unset BITBUCKET_READ_ONLY or set it to "false" to enable write operations.',
			},
		],
		isError: true,
	};
}
