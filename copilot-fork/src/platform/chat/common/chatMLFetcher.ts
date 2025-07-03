/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { AsyncIterableObject, AsyncIterableSource } from '../../../util/vs/base/common/async';
import { Event } from '../../../util/vs/base/common/event';
import { FinishedCallback, IResponseDelta, OptionalChatRequestParams } from '../../networking/common/fetch';
import { IChatEndpoint } from '../../networking/common/networking';
import { TelemetryProperties } from '../../telemetry/common/telemetry';
import { ChatLocation, ChatResponse, ChatResponses } from './commonTypes';

export interface IntentParams {

	/** Copilot-only: whether to run intent classifier for off-topic detection */
	intent?: boolean;

	/** Copilot-only: threshold for intent classifier */
	intent_threshold?: number;
}

export interface Source {
	readonly extensionId?: string;
}

export interface IResponsePart {
	readonly text: string;
	readonly delta: IResponseDelta;
}

export const IChatMLFetcher = createServiceIdentifier<IChatMLFetcher>('IChatMLFetcher');

export interface IChatMLFetcher {

	readonly _serviceBrand: undefined;

	readonly onDidMakeChatMLRequest: Event<{ readonly model: string; readonly source?: Source; readonly tokenCount?: number }>;

	/**
	 * @param debugName A helpful name for the request, shown in logs and used in telemetry if telemetryProperties.messageSource isn't set. Using a single camelCase word is advised.
	 * @param messages The list of messages to send to the model
	 * @param finishedCb A callback that streams response content
	 * @param token A cancel token
	 * @param location The location of the feature making this request
	 * @param endpoint The chat model info
	 * @param source The participant/extension making this request, if applicable
	 * @param requestOptions To override the default request options
	 * @param userInitiatedRequest Whether or not the request is the user's or some background / auxillary request. Used for billing.
	 * @param telemetryProperties messageSource/messageId are included in telemetry, optional, defaults to debugName
	 * @param intentParams { intent: true } enables the offtopic classifier
	 */
	fetchOne(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		endpoint: IChatEndpoint,
		source?: Source,
		requestOptions?: Omit<OptionalChatRequestParams, 'n'>,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties,
		intentParams?: IntentParams
	): Promise<ChatResponse>;

	/**
	 * Note: the returned array of strings may be less than `n` (e.g., in case there were errors during streaming)
	 */
	fetchMany(
		debugName: string,
		messages: Raw.ChatMessage[],
		finishedCb: FinishedCallback | undefined,
		token: CancellationToken,
		location: ChatLocation,
		chatEndpointInfo: IChatEndpoint,
		source?: Source,
		requestOptions?: OptionalChatRequestParams,
		userInitiatedRequest?: boolean,
		telemetryProperties?: TelemetryProperties,
		intentParams?: IntentParams
	): Promise<ChatResponses>;
}

export class FetchStreamSource {

	private _stream = new AsyncIterableSource<IResponsePart>();
	private _paused?: (IResponsePart | undefined)[];

	// This means that we will only show one instance of each annotation type, but the IDs are not correct and there is no other way
	private _seenAnnotationTypes = new Set<string>();

	public get stream(): AsyncIterableObject<IResponsePart> {
		return this._stream.asyncIterable;
	}

	constructor() { }

	pause() {
		this._paused ??= [];
	}

	unpause() {
		const toEmit = this._paused;
		if (!toEmit) {
			return;
		}

		this._paused = undefined;
		for (const part of toEmit) {
			if (part) {
				this.update(part.text, part.delta);
			} else {
				this.resolve();
			}
		}
	}

	update(text: string, delta: IResponseDelta): void {
		if (this._paused) {
			this._paused.push({ text, delta });
			return;
		}

		if (delta.codeVulnAnnotations) {
			// We can only display vulnerabilities inside codeblocks, and it's ok to discard annotations that fell outside of them
			const numTripleBackticks = text.match(/(^|\n)```/g)?.length ?? 0;
			const insideCodeblock = numTripleBackticks % 2 === 1;
			if (!insideCodeblock || text.match(/(^|\n)```\w*\s*$/)) { // Not inside a codeblock, or right on the start triple-backtick of a codeblock
				delta.codeVulnAnnotations = undefined;
			}
		}

		if (delta.codeVulnAnnotations) {
			delta.codeVulnAnnotations = delta.codeVulnAnnotations.filter(annotation => !this._seenAnnotationTypes.has(annotation.details.type));
			delta.codeVulnAnnotations.forEach(annotation => this._seenAnnotationTypes.add(annotation.details.type));
		}
		this._stream.emitOne({ text, delta });
	}

	resolve(): void {
		if (this._paused) {
			this._paused.push(undefined);
			return;
		}

		this._stream.resolve();
	}
}

export class FetchStreamRecorder {
	public readonly callback: FinishedCallback;
	public readonly deltas: IResponseDelta[] = [];

	constructor(
		callback: FinishedCallback | undefined
	) {
		this.callback = async (text: string, index: number, delta: IResponseDelta): Promise<number | undefined> => {
			const result = callback ? await callback(text, index, delta) : undefined;
			this.deltas.push(delta);
			return result;
		};
	}
}
