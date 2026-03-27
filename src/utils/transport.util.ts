import { Logger } from './logger.util.js';
import { config } from './config.util.js';
import { NETWORK_TIMEOUTS, DATA_LIMITS } from './constants.util.js';
import {
	createAuthInvalidError,
	createApiError,
	createUnexpectedError,
	McpError,
} from './error.util.js';
import { saveRawResponse } from './response.util.js';

// Configure proxy and/or TLS verification via undici's global dispatcher.
//
// Node's built-in fetch (undici) does NOT honour HTTP_PROXY / NODE_TLS_REJECT_UNAUTHORIZED
// automatically, so we must call setGlobalDispatcher() synchronously at module load.
// The require() call is intentionally synchronous (this is a CommonJS build).
(function initNetworkDefaults(): void {
	const proxyUrl =
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy;
	// NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS cert verification (e.g. self-signed DC certs)
	const rejectUnauthorized =
		process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';

	if (proxyUrl) {
		console.debug(`[transport] Proxy URL: ${proxyUrl}`);
	}
	if (!rejectUnauthorized) {
		console.warn(
			'[transport] TLS certificate validation is DISABLED ' +
				'(NODE_TLS_REJECT_UNAUTHORIZED=0). Do not use this in production.',
		);
	}

	// Only touch the dispatcher if something non-default is needed
	if (!proxyUrl && rejectUnauthorized) return;

	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const undici = require('undici') as typeof import('undici');
		const tlsOpts = { rejectUnauthorized };

		if (proxyUrl) {
			undici.setGlobalDispatcher(
				new undici.ProxyAgent({
					uri: proxyUrl,
					requestTls: tlsOpts,
					connect: tlsOpts,
				}),
			);
		} else {
			// TLS-only change (no proxy)
			undici.setGlobalDispatcher(
				new undici.Agent({ connect: tlsOpts }),
			);
		}
	} catch {
		if (proxyUrl) {
			console.warn(
				'[transport] "undici" package not found \u2014 proxy will NOT be used.',
			);
		}
	}
})();

/**
 * Interface for Atlassian API credentials
 */
export interface AtlassianCredentials {
	// Standard Atlassian credentials (Bitbucket Cloud – scoped API token)
	siteName?: string;
	userEmail?: string;
	apiToken?: string;
	// Bitbucket Cloud legacy credentials (app password)
	bitbucketUsername?: string;
	bitbucketAppPassword?: string;
	// Indicates which Cloud auth method to use
	useBitbucketAuth?: boolean;
	// Bitbucket Data Center / Server credentials
	datacenterBaseUrl?: string;
	bitbucketDcToken?: string; // Personal Access Token (Bearer auth)
	bitbucketDcUsername?: string;
	bitbucketDcPassword?: string;
	useDataCenter?: boolean;
}

/**
 * Returns true when the server is configured to talk to a
 * Bitbucket Data Center / Server instance (BITBUCKET_DC_BASE_URL is set).
 */
export function isDataCenterMode(): boolean {
	return !!config.get('BITBUCKET_DC_BASE_URL');
}

/**
 * Interface for HTTP request options
 */
export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
}

/**
 * Transport response wrapper that includes the data and the path to the raw response file
 */
export interface TransportResponse<T> {
	data: T;
	rawResponsePath: string | null;
}

// Create a contextualized logger for this file
const transportLogger = Logger.forContext('utils/transport.util.ts');

// Log transport utility initialization
transportLogger.debug('Transport utility initialized');

/**
 * Get Atlassian credentials from environment variables
 * @returns AtlassianCredentials object or null if credentials are missing
 */
export function getAtlassianCredentials(): AtlassianCredentials | null {
	const methodLogger = Logger.forContext(
		'utils/transport.util.ts',
		'getAtlassianCredentials',
	);

	// Data Center / Server takes priority when BITBUCKET_DC_BASE_URL is set
	const dcBaseUrl = config.get('BITBUCKET_DC_BASE_URL');
	if (dcBaseUrl) {
		const dcToken = config.get('BITBUCKET_DC_TOKEN');
		const dcUsername = config.get('BITBUCKET_DC_USERNAME');
		const dcPassword = config.get('BITBUCKET_DC_PASSWORD');

		if (dcToken) {
			methodLogger.debug('Using Bitbucket Data Center credentials (PAT)');
			return {
				datacenterBaseUrl: dcBaseUrl,
				bitbucketDcToken: dcToken,
				useDataCenter: true,
			};
		}

		if (dcUsername && dcPassword) {
			methodLogger.debug(
				'Using Bitbucket Data Center credentials (Basic auth)',
			);
			return {
				datacenterBaseUrl: dcBaseUrl,
				bitbucketDcUsername: dcUsername,
				bitbucketDcPassword: dcPassword,
				useDataCenter: true,
			};
		}

		methodLogger.warn(
			'BITBUCKET_DC_BASE_URL is set but no Data Center credentials found. ' +
				'Set BITBUCKET_DC_TOKEN or both BITBUCKET_DC_USERNAME and BITBUCKET_DC_PASSWORD.',
		);
		// Fall through to try Cloud credentials
	}

	// First try standard Atlassian credentials (preferred for consistency)
	const siteName = config.get('ATLASSIAN_SITE_NAME');
	const userEmail = config.get('ATLASSIAN_USER_EMAIL');
	const apiToken = config.get('ATLASSIAN_API_TOKEN');

	// If standard credentials are available, use them
	if (userEmail && apiToken) {
		methodLogger.debug('Using standard Atlassian credentials');
		return {
			siteName,
			userEmail,
			apiToken,
			useBitbucketAuth: false,
		};
	}

	// If standard credentials are not available, try Bitbucket-specific credentials
	const bitbucketUsername = config.get('ATLASSIAN_BITBUCKET_USERNAME');
	const bitbucketAppPassword = config.get('ATLASSIAN_BITBUCKET_APP_PASSWORD');

	if (bitbucketUsername && bitbucketAppPassword) {
		methodLogger.debug('Using Bitbucket-specific credentials');
		return {
			bitbucketUsername,
			bitbucketAppPassword,
			useBitbucketAuth: true,
		};
	}

	// If no credentials are available, return null with a helpful message
	methodLogger.warn(
		'Missing credentials. Set one of the following:\n' +
			'  Bitbucket Data Center/Server: BITBUCKET_DC_BASE_URL + BITBUCKET_DC_TOKEN\n' +
			'    or: BITBUCKET_DC_BASE_URL + BITBUCKET_DC_USERNAME + BITBUCKET_DC_PASSWORD\n' +
			'  Bitbucket Cloud (scoped token): ATLASSIAN_USER_EMAIL + ATLASSIAN_API_TOKEN\n' +
			'  Bitbucket Cloud (app password): ATLASSIAN_BITBUCKET_USERNAME + ATLASSIAN_BITBUCKET_APP_PASSWORD',
	);
	return null;
}

/**
 * Fetch data from Atlassian API
 * @param credentials Atlassian API credentials
 * @param path API endpoint path (without base URL)
 * @param options Request options
 * @returns Response data wrapped with raw response path
 */
export async function fetchAtlassian<T>(
	credentials: AtlassianCredentials,
	path: string,
	options: RequestOptions = {},
): Promise<TransportResponse<T>> {
	const methodLogger = Logger.forContext(
		'utils/transport.util.ts',
		'fetchAtlassian',
	);

	// Use Data Center base URL when in DC mode, otherwise Bitbucket Cloud
	const baseUrl =
		credentials.useDataCenter && credentials.datacenterBaseUrl
			? credentials.datacenterBaseUrl.replace(/\/$/, '')
			: 'https://api.bitbucket.org';

	// Set up auth headers based on credential type
	let authHeader: string;

	if (credentials.useDataCenter) {
		// Data Center: Bearer PAT or Basic auth
		if (credentials.bitbucketDcToken) {
			authHeader = `Bearer ${credentials.bitbucketDcToken}`;
		} else if (
			credentials.bitbucketDcUsername &&
			credentials.bitbucketDcPassword
		) {
			authHeader = `Basic ${Buffer.from(
				`${credentials.bitbucketDcUsername}:${credentials.bitbucketDcPassword}`,
			).toString('base64')}`;
		} else {
			throw createAuthInvalidError(
				'Missing Bitbucket Data Center credentials. Set BITBUCKET_DC_TOKEN or both BITBUCKET_DC_USERNAME and BITBUCKET_DC_PASSWORD.',
			);
		}
	} else if (credentials.useBitbucketAuth) {
		// Cloud: legacy app password
		if (
			!credentials.bitbucketUsername ||
			!credentials.bitbucketAppPassword
		) {
			throw createAuthInvalidError(
				'Missing Bitbucket username or app password',
			);
		}
		authHeader = `Basic ${Buffer.from(
			`${credentials.bitbucketUsername}:${credentials.bitbucketAppPassword}`,
		).toString('base64')}`;
	} else {
		// Cloud: standard Atlassian scoped API token
		if (!credentials.userEmail || !credentials.apiToken) {
			throw createAuthInvalidError('Missing Atlassian credentials');
		}
		authHeader = `Basic ${Buffer.from(
			`${credentials.userEmail}:${credentials.apiToken}`,
		).toString('base64')}`;
	}

	// Ensure path starts with a slash
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;

	// Construct the full URL
	const url = `${baseUrl}${normalizedPath}`;

	// Set up authentication and headers
	const headers = {
		Authorization: authHeader,
		'Content-Type': 'application/json',
		Accept: 'application/json',
		...options.headers,
	};

	// Prepare request options
	const requestOptions: RequestInit = {
		method: options.method || 'GET',
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	};

	methodLogger.debug(`Calling Atlassian API: ${url}`);

	// Set up timeout handling with configurable values
	const defaultTimeout = config.getNumber(
		'ATLASSIAN_REQUEST_TIMEOUT',
		NETWORK_TIMEOUTS.DEFAULT_REQUEST_TIMEOUT,
	);
	const timeoutMs = options.timeout ?? defaultTimeout;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		methodLogger.warn(`Request timeout after ${timeoutMs}ms: ${url}`);
		controller.abort();
	}, timeoutMs);

	// Add abort signal to request options
	requestOptions.signal = controller.signal;

	// Track API call performance
	const startTime = performance.now();

	try {
		const response = await fetch(url, requestOptions);
		clearTimeout(timeoutId);
		const endTime = performance.now();
		const requestDuration = (endTime - startTime).toFixed(2);

		// Log the raw response status and headers
		methodLogger.debug(
			`Raw response received: ${response.status} ${response.statusText}`,
			{
				url,
				status: response.status,
				statusText: response.statusText,
				headers: Object.fromEntries(response.headers.entries()),
			},
		);

		// Validate response size to prevent excessive memory usage (CWE-770)
		const contentLength = response.headers.get('content-length');
		if (contentLength) {
			const responseSize = parseInt(contentLength, 10);
			if (responseSize > DATA_LIMITS.MAX_RESPONSE_SIZE) {
				methodLogger.warn(
					`Response size ${responseSize} bytes exceeds limit of ${DATA_LIMITS.MAX_RESPONSE_SIZE} bytes`,
				);
				throw createApiError(
					`Response size (${Math.round(responseSize / (1024 * 1024))}MB) exceeds maximum limit of ${Math.round(DATA_LIMITS.MAX_RESPONSE_SIZE / (1024 * 1024))}MB`,
					413,
					{ responseSize, limit: DATA_LIMITS.MAX_RESPONSE_SIZE },
				);
			}
		}

		if (!response.ok) {
			const errorText = await response.text();
			methodLogger.error(
				`API error: ${response.status} ${response.statusText}`,
				errorText,
			);

			// Try to parse the error response
			let errorMessage = `${response.status} ${response.statusText}`;
			let parsedBitbucketError = null;

			try {
				if (
					errorText &&
					(errorText.startsWith('{') || errorText.startsWith('['))
				) {
					const parsedError = JSON.parse(errorText);

					// Extract specific error details from various Bitbucket API response formats
					if (
						parsedError.type === 'error' &&
						parsedError.error &&
						parsedError.error.message
					) {
						// Format: {"type":"error", "error":{"message":"...", "detail":"..."}}
						parsedBitbucketError = parsedError.error;
						errorMessage = parsedBitbucketError.message;
						if (parsedBitbucketError.detail) {
							errorMessage += ` Detail: ${parsedBitbucketError.detail}`;
						}
					} else if (parsedError.error && parsedError.error.message) {
						// Alternative error format: {"error": {"message": "..."}}
						parsedBitbucketError = parsedError.error;
						errorMessage = parsedBitbucketError.message;
					} else if (
						parsedError.errors &&
						Array.isArray(parsedError.errors) &&
						parsedError.errors.length > 0
					) {
						// Format: {"errors":[{"status":400,"code":"INVALID_REQUEST_PARAMETER","title":"..."}]}
						const atlassianError = parsedError.errors[0];
						if (atlassianError.title) {
							errorMessage = atlassianError.title;
							parsedBitbucketError = atlassianError;
						}
					} else if (parsedError.message) {
						// Format: {"message":"Some error message"}
						errorMessage = parsedError.message;
						parsedBitbucketError = parsedError;
					}
				}
			} catch (parseError) {
				methodLogger.debug(`Error parsing error response:`, parseError);
				// Fall back to the default error message
			}

			// Log the parsed error or raw error text
			methodLogger.debug(
				'Parsed Bitbucket error:',
				parsedBitbucketError || errorText,
			);

			// Use parsedBitbucketError (or errorText if parsing failed) as originalError
			const originalErrorForMcp = parsedBitbucketError || errorText;

			// Handle common Bitbucket API error status codes
			if (response.status === 401) {
				throw createAuthInvalidError(
					`Bitbucket API: Authentication failed - ${errorMessage}`,
					originalErrorForMcp,
				);
			}

			if (response.status === 403) {
				throw createApiError(
					`Bitbucket API: Permission denied - ${errorMessage}`,
					403,
					originalErrorForMcp,
				);
			}

			if (response.status === 404) {
				throw createApiError(
					`Bitbucket API: Resource not found - ${errorMessage}`,
					404,
					originalErrorForMcp,
				);
			}

			if (response.status === 429) {
				throw createApiError(
					`Bitbucket API: Rate limit exceeded - ${errorMessage}`,
					429,
					originalErrorForMcp,
				);
			}

			if (response.status >= 500) {
				throw createApiError(
					`Bitbucket API: Service error - ${errorMessage}`,
					response.status,
					originalErrorForMcp,
				);
			}

			// For other API errors, preserve the original vendor message
			throw createApiError(
				`Bitbucket API Error: ${errorMessage}`,
				response.status,
				originalErrorForMcp,
			);
		}

		// Handle 204 No Content responses (common for DELETE operations)
		if (response.status === 204) {
			methodLogger.debug('Received 204 No Content response');
			return { data: {} as T, rawResponsePath: null };
		}

		// Check if the response is expected to be plain text
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('text/plain')) {
			// If we're expecting text (like a diff), return the raw text
			const textResponse = await response.text();
			methodLogger.debug(
				`Text response received (truncated)`,
				textResponse.substring(0, 200) + '...',
			);
			return {
				data: textResponse as unknown as T,
				rawResponsePath: null,
			};
		}

		// Handle empty responses (some endpoints return 200/201 with no body)
		const responseText = await response.text();
		if (!responseText || responseText.trim() === '') {
			methodLogger.debug('Received empty response body');
			return { data: {} as T, rawResponsePath: null };
		}

		// For JSON responses, parse the text we already read
		try {
			const responseJson = JSON.parse(responseText);
			methodLogger.debug(`Response body:`, responseJson);

			// Save raw response to file
			const rawResponsePath = saveRawResponse(
				url,
				requestOptions.method || 'GET',
				options.body,
				responseJson,
				response.status,
				parseFloat(requestDuration),
			);

			return { data: responseJson as T, rawResponsePath };
		} catch {
			methodLogger.debug(
				`Could not parse response as JSON, returning raw content`,
			);
			return {
				data: responseText as unknown as T,
				rawResponsePath: null,
			};
		}
	} catch (error) {
		clearTimeout(timeoutId);
		methodLogger.error(`Request failed`, error);

		// If it's already an McpError, just rethrow it
		if (error instanceof McpError) {
			throw error;
		}

		// Handle timeout errors
		if (error instanceof Error && error.name === 'AbortError') {
			methodLogger.error(
				`Request timed out after ${timeoutMs}ms: ${url}`,
			);
			throw createApiError(
				`Request timeout: Bitbucket API did not respond within ${timeoutMs / 1000} seconds`,
				408,
				error,
			);
		}

		// Handle network errors more explicitly
		if (error instanceof TypeError) {
			// TypeError is typically a network/fetch error in this context
			const errorMessage = error.message || 'Network error occurred';
			methodLogger.debug(`Network error details: ${errorMessage}`);

			throw createApiError(
				`Network error while calling Bitbucket API: ${errorMessage}`,
				500, // This will be classified as NETWORK_ERROR by detectErrorType
				error,
			);
		}

		// Handle JSON parsing errors
		if (error instanceof SyntaxError) {
			methodLogger.debug(`JSON parsing error: ${error.message}`);

			throw createApiError(
				`Invalid response format from Bitbucket API: ${error.message}`,
				500,
				error,
			);
		}

		// Generic error handler for any other types of errors
		throw createUnexpectedError(
			`Unexpected error while calling Bitbucket API: ${error instanceof Error ? error.message : String(error)}`,
			error,
		);
	}
}
