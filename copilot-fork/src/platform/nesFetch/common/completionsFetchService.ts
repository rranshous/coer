/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type { ChatErrorDetails } from 'vscode';
import { Result } from '../../../util/common/result';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { ResponseStream } from './responseStream';

export interface ModelParams {
	prompt: string;
	stop?: string[];
	// eslint-disable-next-line @typescript-eslint/naming-convention
	top_p?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	best_of?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	max_tokens?: number;
	temperature?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	presence_penalty?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	frequency_penalty?: number;
	// required to access certain experimental models
	model?: string;
	logprobs?: number;
}

export type FetchOptions = {
	requestId: string;
	headers: { [name: string]: string };
	body: any;
};

export type CompletionsFetchFailure =
	| { kind: 'cancelled' }
	| { kind: 'model_overloaded' }
	| { kind: 'model_error' }
	| { kind: 'not-registered' }
	| { kind: 'not-configured' }
	| { kind: 'quota-exceeded' }
	| {
		kind: 'context-window-exceeded';
		/** Message we get in response body. */
		message: string;
	}
	| {
		kind: 'invalid-api-key';
		/** Message we get in response body. */
		message: string;
	}
	| {
		kind: 'exceeded-rate-limit';
		/** Message we get in response body. */
		message: string;
	}
	| {
		kind: 'not-200-status';
		status: number;
		statusText: string;
	}
	;

export type CompletionsFetchErrorType = 'stop_content_filter' | 'stop_length' | 'unknown';

export class CompletionsFetchError extends Error {
	constructor(
		readonly type: CompletionsFetchErrorType,
		readonly requestId: string,
		message: string
	) {
		super(message);
	}
}

export const ICompletionsFetchService = createServiceIdentifier<ICompletionsFetchService>('ICompletionsFetchService');

/**
 * OpenAI has completions and _chat_ completions endpoints. This's (non-chat) completions endpoint fetcher.
 */
export interface ICompletionsFetchService {
	readonly _serviceBrand: undefined;

	fetch(url: string, secretKey: string, params: ModelParams, requestId: string, ct: CancellationToken, headerOverrides?: Record<string, string>): Promise<Result<ResponseStream, CompletionsFetchFailure>>;
}

export function getErrorDetailsFromFetchError(requestId: string, error: CompletionsFetchFailure): ChatErrorDetails {
	switch (error.kind) {
		case 'cancelled':
			return { message: 'Cancelled' };
		case 'exceeded-rate-limit':
			return {
				message: l10n.t(`Sorry, your request was rate-limited. Please wait and try again.`),
				responseIsFiltered: true,
			};
		case 'quota-exceeded':
			return {
				message: l10n.t(`You've reached your monthly chat messages limit. [Upgrade to Copilot Pro]({0}) (30-day Free Trial) or wait for your limit to reset.`, 'https://aka.ms/github-copilot-upgrade-plan'),
			};
		case 'model_overloaded':
		case 'model_error':
		case 'not-registered':
		case 'not-200-status':
		case 'context-window-exceeded':
		case 'invalid-api-key':
		case 'not-configured':
		default:
			return { message: l10n.t(`Sorry, your request failed. Please try again. Request id: {0}`, requestId) };
	}
}
